/**
 * csvEngine.ts
 * -----------------------------------------------------------------------
 * CSV export for every data type the app stores locally: marked points,
 * recorded tracks, distance/area measurements, freehand drawings, and
 * imported GIS layers. Complements fileEngine.ts (which handles CSV
 * *import*) and exportEngine.ts (which handles KML/GPX export).
 *
 * Uses Papa.unparse so quoting/escaping matches the same library already
 * used for CSV import, keeping round-trips well-behaved.
 * -----------------------------------------------------------------------
 */
import Papa from 'papaparse';
import type { FeatureCollection } from 'geojson';
import { downloadTextFile } from './exportEngine';
import { formatIctFileStamp } from './timeEngine';
import type { TrackPoint } from './exportEngine';
import type { StoredPoint, StoredMeasurement, StoredDrawing } from '../storage/db';

function triggerCsvDownload(baseName: string, rows: Record<string, unknown>[]): void {
  const csv = Papa.unparse(rows);
  downloadTextFile(`${baseName}-${formatIctFileStamp()}.csv`, csv, 'text/csv');
}

/** Export one or more marked points as a flat lat/lng/elevation/note table. */
export function exportPointsAsCsv(points: StoredPoint[]): void {
  const rows = points.map((p) => ({
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    elevation_m: p.elevationMeters ?? '',
    note: p.note,
    created_at_ict: p.createdAtIct,
  }));
  triggerCsvDownload('points', rows);
}

/** Export a GPS track (live, in-memory, or loaded from storage) as one row per fix. */
export function exportTrackAsCsv(name: string, points: TrackPoint[]): void {
  const rows = points.map((p, i) => ({
    seq: i + 1,
    name,
    lat: p.lat,
    lng: p.lng,
    elevation_m: p.elevationMeters ?? '',
    timestamp_epoch_ms: p.timestamp,
  }));
  triggerCsvDownload(`track-${name}`, rows);
}

/** Export a distance/area measurement's vertices, plus the computed result on every row. */
export function exportMeasurementAsCsv(m: StoredMeasurement): void {
  const rows = m.points.map((p, i) => ({
    seq: i + 1,
    name: m.name,
    kind: m.kind,
    lat: p.lat,
    lng: p.lng,
    result_meters: m.resultMeters ?? '',
    result_square_meters: m.resultSquareMeters ?? '',
    result_hectares: m.resultSquareMeters != null ? m.resultSquareMeters / 10_000 : '',
    created_at_ict: m.createdAtIct,
  }));
  triggerCsvDownload(`measurement-${m.name}`, rows);
}

/** Export a freehand drawing's vertices. */
export function exportDrawingAsCsv(d: StoredDrawing): void {
  const rows = d.points.map((p, i) => ({
    seq: i + 1,
    name: d.name,
    geometry_type: d.geometryType,
    lat: p.lat,
    lng: p.lng,
    color: d.color,
    created_at_ict: d.createdAtIct,
  }));
  triggerCsvDownload(`drawing-${d.name}`, rows);
}

/**
 * Export an imported GIS layer's features as CSV. Point geometries get a
 * direct lat/lng column; lines/polygons get one row per vertex with a
 * part/seq index so the shape can be reconstructed, plus every GeoJSON
 * property flattened into its own column.
 */
export function exportLayerAsCsv(name: string, geojson: FeatureCollection): void {
  const rows: Record<string, unknown>[] = [];

  geojson.features.forEach((feature, featureIndex) => {
    const props = feature.properties ?? {};
    const geom = feature.geometry;
    if (!geom) return;

    const pushVertex = (lng: number, lat: number, partIndex: number, seq: number) => {
      rows.push({ feature: featureIndex + 1, part: partIndex + 1, seq: seq + 1, lat, lng, ...props });
    };

    switch (geom.type) {
      case 'Point':
        pushVertex(geom.coordinates[0], geom.coordinates[1], 0, 0);
        break;
      case 'MultiPoint':
        geom.coordinates.forEach((c, i) => pushVertex(c[0], c[1], 0, i));
        break;
      case 'LineString':
        geom.coordinates.forEach((c, i) => pushVertex(c[0], c[1], 0, i));
        break;
      case 'MultiLineString':
        geom.coordinates.forEach((line, p) => line.forEach((c, i) => pushVertex(c[0], c[1], p, i)));
        break;
      case 'Polygon':
        geom.coordinates.forEach((ring, p) => ring.forEach((c, i) => pushVertex(c[0], c[1], p, i)));
        break;
      case 'MultiPolygon':
        geom.coordinates.forEach((poly, p) =>
          poly.forEach((ring) => ring.forEach((c, i) => pushVertex(c[0], c[1], p, i))),
        );
        break;
      default:
        break;
    }
  });

  triggerCsvDownload(`layer-${name.replace(/\.[^.]+$/, '')}`, rows);
}
