/**
 * gpkgEngine.ts
 * -----------------------------------------------------------------------
 * Real vector extraction for OGC GeoPackage files (spec §3 import list).
 *
 * A .gpkg file IS a SQLite database, so we read it with sql.js (SQLite
 * compiled to WASM — runs fully client-side, no server round-trip, which
 * keeps the app offline-capable). Standard GeoPackage tables consulted:
 *   - gpkg_contents            which tables hold feature data
 *   - gpkg_geometry_columns    which column in each table holds geometry
 *   - gpkg_spatial_ref_sys     what SRS each table's geometries are in
 *
 * Geometry values are stored as "GeoPackage Binary" blobs: a small
 * header (magic 'GP', version, flags, SRS id, optional envelope) wrapping
 * a standard ISO WKB geometry. We parse that WKB by hand below — Point,
 * LineString, Polygon and their Multi* variants, which covers the vast
 * majority of real-world boundary/parcel/feature data.
 *
 * Coordinates are reprojected to WGS84 only when the table's SRS is one
 * this app already understands (EPSG:4326, or UTM 47N/48N — the two
 * zones relevant to Laos). Other SRSes are reported via a warning rather
 * than silently mis-projected.
 * -----------------------------------------------------------------------
 */
import initSqlJs, { type Database } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { utmToLatLon } from './coordinateEngine';
import { UTM_ZONE_47N, UTM_ZONE_48N } from './laosGeo';

let sqlJsPromise: ReturnType<typeof initSqlJs> | null = null;

function loadSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({ locateFile: () => sqlWasmUrl });
  }
  return sqlJsPromise;
}

// --- Minimal WKB reader -------------------------------------------------

type Pos = [number, number];

type WkbGeometry =
  | { type: 'Point'; coordinates: Pos }
  | { type: 'LineString'; coordinates: Pos[] }
  | { type: 'Polygon'; coordinates: Pos[][] }
  | { type: 'MultiPoint'; coordinates: Pos[] }
  | { type: 'MultiLineString'; coordinates: Pos[][] }
  | { type: 'MultiPolygon'; coordinates: Pos[][][] }
  | { type: 'GeometryCollection' };

class WkbReader {
  private view: DataView;
  private pos: number;
  constructor(view: DataView, start: number) {
    this.view = view;
    this.pos = start;
  }

  private u8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }
  private u32(le: boolean): number {
    const v = this.view.getUint32(this.pos, le);
    this.pos += 4;
    return v;
  }
  private f64(le: boolean): number {
    const v = this.view.getFloat64(this.pos, le);
    this.pos += 8;
    return v;
  }

  /** Reads one full WKB geometry, including its own byte-order + type header. */
  readGeometry(): WkbGeometry {
    const le = this.u8() === 1;
    const rawType = this.u32(le);

    let hasZ = (rawType & 0x80000000) !== 0;
    let hasM = (rawType & 0x40000000) !== 0;
    if (rawType & 0x20000000) this.u32(le); // EWKB embedded SRID, if present — skip it

    let base = rawType & 0xffff;
    if (base >= 3000) {
      hasZ = true;
      hasM = true;
      base -= 3000;
    } else if (base >= 2000) {
      hasM = true;
      base -= 2000;
    } else if (base >= 1000) {
      hasZ = true;
      base -= 1000;
    }
    const dim = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);

    switch (base) {
      case 1:
        return { type: 'Point', coordinates: this.readPoint(le, dim) };
      case 2:
        return { type: 'LineString', coordinates: this.readLineString(le, dim) };
      case 3:
        return { type: 'Polygon', coordinates: this.readPolygon(le, dim) };
      case 4:
        return { type: 'MultiPoint', coordinates: this.readMultiPoint(le, dim) };
      case 5:
        return { type: 'MultiLineString', coordinates: this.readMultiLineString(le, dim) };
      case 6:
        return { type: 'MultiPolygon', coordinates: this.readMultiPolygon(le, dim) };
      default:
        // GeometryCollection or anything unrecognized — not expanded into features here.
        return { type: 'GeometryCollection' };
    }
  }

  private readPoint(le: boolean, dim: number): Pos {
    const x = this.f64(le);
    const y = this.f64(le);
    for (let i = 2; i < dim; i++) this.f64(le); // consume Z/M, unused for 2D output
    return [x, y];
  }
  private readLineString(le: boolean, dim: number): Pos[] {
    const n = this.u32(le);
    const pts: Pos[] = [];
    for (let i = 0; i < n; i++) pts.push(this.readPoint(le, dim));
    return pts;
  }
  private readPolygon(le: boolean, dim: number): Pos[][] {
    const n = this.u32(le);
    const rings: Pos[][] = [];
    for (let i = 0; i < n; i++) rings.push(this.readLineString(le, dim));
    return rings;
  }
  /** Multi* members are each a complete sub-geometry with their own header. */
  private readMultiPoint(le: boolean, dim: number): Pos[] {
    const n = this.u32(le);
    const pts: Pos[] = [];
    for (let i = 0; i < n; i++) {
      const subLe = this.u8() === 1;
      this.u32(subLe);
      pts.push(this.readPoint(subLe, dim));
    }
    return pts;
  }
  private readMultiLineString(le: boolean, dim: number): Pos[][] {
    const n = this.u32(le);
    const lines: Pos[][] = [];
    for (let i = 0; i < n; i++) {
      const subLe = this.u8() === 1;
      this.u32(subLe);
      lines.push(this.readLineString(subLe, dim));
    }
    return lines;
  }
  private readMultiPolygon(le: boolean, dim: number): Pos[][][] {
    const n = this.u32(le);
    const polys: Pos[][][] = [];
    for (let i = 0; i < n; i++) {
      const subLe = this.u8() === 1;
      this.u32(subLe);
      polys.push(this.readPolygon(subLe, dim));
    }
    return polys;
  }
}

/** Strips the GeoPackage Binary header (magic 'GP' + flags + envelope) and parses the inner WKB. */
function parseGpkgGeometryBlob(blob: Uint8Array): WkbGeometry | null {
  if (blob.length < 8) return null;
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);

  if (view.getUint8(0) !== 0x47 || view.getUint8(1) !== 0x50) {
    // Not a GeoPackage-wrapped blob — try treating it as bare WKB.
    try {
      return new WkbReader(view, 0).readGeometry();
    } catch {
      return null;
    }
  }

  const flags = view.getUint8(3);
  const isEmpty = (flags >> 4) & 0x01;
  if (isEmpty) return null;
  const envelopeIndicator = (flags >> 1) & 0x07;
  const envelopeSizes = [0, 32, 48, 48, 64];
  const offset = 8 + (envelopeSizes[envelopeIndicator] ?? 0);

  try {
    return new WkbReader(view, offset).readGeometry();
  } catch {
    return null;
  }
}

type Transform = (x: number, y: number) => [number, number];

function wkbToGeoJsonGeometry(g: WkbGeometry, transform: Transform): Geometry | null {
  switch (g.type) {
    case 'Point': {
      const [lon, lat] = transform(g.coordinates[0], g.coordinates[1]);
      return { type: 'Point', coordinates: [lon, lat] };
    }
    case 'LineString':
      return { type: 'LineString', coordinates: g.coordinates.map(([x, y]) => transform(x, y)) };
    case 'Polygon':
      return {
        type: 'Polygon',
        coordinates: g.coordinates.map((ring) => ring.map(([x, y]) => transform(x, y))),
      };
    case 'MultiPoint':
      return { type: 'MultiPoint', coordinates: g.coordinates.map(([x, y]) => transform(x, y)) };
    case 'MultiLineString':
      return {
        type: 'MultiLineString',
        coordinates: g.coordinates.map((line) => line.map(([x, y]) => transform(x, y))),
      };
    case 'MultiPolygon':
      return {
        type: 'MultiPolygon',
        coordinates: g.coordinates.map((poly) => poly.map((ring) => ring.map(([x, y]) => transform(x, y)))),
      };
    default:
      return null;
  }
}

function transformForSrs(organization: string, code: number): Transform | null {
  const org = organization.toUpperCase();
  if (org === 'EPSG' && code === 4326) return (x, y) => [x, y];
  if (org === 'EPSG' && code === 32647) {
    return (x, y) => {
      const [lat, lon] = utmToLatLon(x, y, UTM_ZONE_47N);
      return [lon, lat];
    };
  }
  if (org === 'EPSG' && code === 32648) {
    return (x, y) => {
      const [lat, lon] = utmToLatLon(x, y, UTM_ZONE_48N);
      return [lon, lat];
    };
  }
  return null;
}

export interface GpkgImportResult {
  geojson: FeatureCollection | null;
  warnings: string[];
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Reads every feature table in a .gpkg file and returns it as one combined GeoJSON FeatureCollection. */
export async function importGeoPackageVector(file: File): Promise<GpkgImportResult> {
  const warnings: string[] = [];
  const SQL = await loadSqlJs();
  const bytes = new Uint8Array(await file.arrayBuffer());

  let handle: Database;
  try {
    handle = new SQL.Database(bytes);
  } catch (err) {
    return {
      geojson: null,
      warnings: [`Could not open "${file.name}" as a SQLite/GeoPackage database: ${(err as Error).message}`],
    };
  }

  try {
    const contentsRes = handle.exec(
      "SELECT table_name, srs_id FROM gpkg_contents WHERE data_type = 'features'",
    );
    if (contentsRes.length === 0) {
      warnings.push(
        'No feature tables found in gpkg_contents (this GeoPackage may hold only raster/tile layers).',
      );
      return { geojson: null, warnings };
    }

    const features: Feature[] = [];

    for (const [tableName, srsId] of contentsRes[0].values as [string, number][]) {
      const gcRes = handle.exec(
        `SELECT column_name FROM gpkg_geometry_columns WHERE table_name = ${JSON.stringify(tableName)}`,
      );
      if (gcRes.length === 0) {
        warnings.push(`Table "${tableName}": no entry in gpkg_geometry_columns — skipped.`);
        continue;
      }
      const geomCol = String(gcRes[0].values[0][0]);

      const srsRes = handle.exec(
        `SELECT organization, organization_coordsys_id FROM gpkg_spatial_ref_sys WHERE srs_id = ${Number(srsId)}`,
      );
      const transform =
        srsRes.length > 0
          ? transformForSrs(String(srsRes[0].values[0][0]), Number(srsRes[0].values[0][1]))
          : null;

      if (!transform) {
        warnings.push(
          `Table "${tableName}": unsupported SRS (srs_id ${srsId}) — skipped. ` +
            'Supported: EPSG:4326, EPSG:32647 (UTM 47N), EPSG:32648 (UTM 48N).',
        );
        continue;
      }

      const rowsRes = handle.exec(`SELECT * FROM ${quoteIdent(tableName)}`);
      if (rowsRes.length === 0) continue;
      const { columns, values } = rowsRes[0];
      const geomIdx = columns.indexOf(geomCol);

      let skippedGeoms = 0;
      for (const row of values) {
        const raw = row[geomIdx];
        if (!raw || !(raw instanceof Uint8Array)) continue;
        const wkb = parseGpkgGeometryBlob(raw);
        if (!wkb) {
          skippedGeoms++;
          continue;
        }
        const geometry = wkbToGeoJsonGeometry(wkb, transform);
        if (!geometry) {
          skippedGeoms++;
          continue;
        }
        const properties: Record<string, unknown> = { __gpkg_table: tableName };
        columns.forEach((col: string, i: number) => {
          if (i !== geomIdx) properties[col] = row[i];
        });
        features.push({ type: 'Feature', geometry, properties });
      }
      if (skippedGeoms > 0) {
        warnings.push(`Table "${tableName}": ${skippedGeoms} feature(s) had an unsupported geometry and were skipped.`);
      }
    }

    if (features.length === 0) {
      warnings.push('GeoPackage parsed, but no mappable features were extracted.');
      return { geojson: null, warnings };
    }

    return { geojson: { type: 'FeatureCollection', features }, warnings };
  } catch (err) {
    return {
      geojson: null,
      warnings: [`Error reading GeoPackage tables in "${file.name}": ${(err as Error).message}`],
    };
  } finally {
    handle.close();
  }
}
