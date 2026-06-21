/**
 * fileEngine.ts
 * -----------------------------------------------------------------------
 * Multi-format GIS file import engine (spec §3).
 *
 * All parsing happens client-side (no server upload) so the app stays
 * fully offline-capable. Every importer normalizes its input down to
 * GeoJSON, which is what the map layer and local storage layer consume
 * — this keeps the rest of the app format-agnostic.
 * -----------------------------------------------------------------------
 */
import shp from 'shpjs';
import { kml as kmlToGeoJson, gpx as gpxToGeoJson } from '@tmcw/togeojson';
import Papa from 'papaparse';
import JSZip from 'jszip';
import type { FeatureCollection } from 'geojson';
import { utmToLatLon } from './coordinateEngine';
import { UTM_ZONE_47N, UTM_ZONE_48N, type UtmZone } from './laosGeo';
import { importGeoPackageVector } from './gpkgEngine';

export type SupportedFormat =
  | 'shp'
  | 'geojson'
  | 'kml'
  | 'kmz'
  | 'gpx'
  | 'csv'
  | 'geotiff'
  | 'gpkg';

export interface ImportResult {
  format: SupportedFormat;
  name: string;
  geojson: FeatureCollection | null;
  /** Raw binary payload, kept for formats we store but don't vectorize (GeoTIFF/GPKG). */
  rawBlob: Blob | null;
  warnings: string[];
}

function detectFormat(file: File): SupportedFormat | null {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'shp':
    case 'zip':
      return 'shp';
    case 'geojson':
    case 'json':
      return 'geojson';
    case 'kml':
      return 'kml';
    case 'kmz':
      return 'kmz';
    case 'gpx':
      return 'gpx';
    case 'csv':
    case 'tsv':
      return 'csv';
    case 'tif':
    case 'tiff':
      return 'geotiff';
    case 'gpkg':
      return 'gpkg';
    default:
      return null;
  }
}

/** Import a zipped or single-file Esri Shapefile (.shp/.shx/.dbf/.prj, or a .zip bundle). */
async function importShapefile(file: File): Promise<ImportResult> {
  const buffer = await file.arrayBuffer();
  const warnings: string[] = [];
  try {
    const result = await shp(buffer);
    // shpjs returns either a single FeatureCollection or an array of them
    // (one per layer) when given a multi-layer zip.
    const fc: FeatureCollection = Array.isArray(result)
      ? { type: 'FeatureCollection', features: result.flatMap((r) => r.features) }
      : result;
    return { format: 'shp', name: file.name, geojson: fc, rawBlob: null, warnings };
  } catch (err) {
    warnings.push(
      `Could not parse shapefile "${file.name}". Ensure the .zip bundle includes ` +
        `matching .shp, .shx, .dbf, and (ideally) .prj files. ${(err as Error).message}`,
    );
    return { format: 'shp', name: file.name, geojson: null, rawBlob: null, warnings };
  }
}

/** Import KML — single file. */
async function importKml(file: File): Promise<ImportResult> {
  const text = await file.text();
  const dom = new DOMParser().parseFromString(text, 'text/xml');
  const geojson = kmlToGeoJson(dom) as FeatureCollection;
  return { format: 'kml', name: file.name, geojson, rawBlob: null, warnings: [] };
}

/** Import KMZ — zipped KML; extract doc.kml (or first .kml found) then parse. */
async function importKmz(file: File): Promise<ImportResult> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(file);
  const kmlEntry =
    zip.file('doc.kml') ?? Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith('.kml'));
  if (!kmlEntry) {
    return {
      format: 'kmz',
      name: file.name,
      geojson: null,
      rawBlob: null,
      warnings: [`No .kml entry found inside "${file.name}".`],
    };
  }
  const text = await kmlEntry.async('text');
  const dom = new DOMParser().parseFromString(text, 'text/xml');
  const geojson = kmlToGeoJson(dom) as FeatureCollection;
  return { format: 'kmz', name: file.name, geojson, rawBlob: null, warnings };
}

/** Import GPX (tracks, routes, waypoints). */
async function importGpx(file: File): Promise<ImportResult> {
  const text = await file.text();
  const dom = new DOMParser().parseFromString(text, 'text/xml');
  const geojson = gpxToGeoJson(dom) as FeatureCollection;
  return { format: 'gpx', name: file.name, geojson, rawBlob: null, warnings: [] };
}

/** Import plain GeoJSON. */
async function importGeoJson(file: File): Promise<ImportResult> {
  const text = await file.text();
  const geojson = JSON.parse(text) as FeatureCollection;
  return { format: 'geojson', name: file.name, geojson, rawBlob: null, warnings: [] };
}

/**
 * Heuristics for recognizing Lao-convention spatial CSV columns.
 * Accepts common variants: Easting/Northing, X/Y, plus plain Lat/Lon.
 */
const EASTING_HEADERS = ['easting', 'x', 'utm_x', 'utm_e', 'east'];
const NORTHING_HEADERS = ['northing', 'y', 'utm_y', 'utm_n', 'north'];
const LAT_HEADERS = ['lat', 'latitude', 'y_dd'];
const LON_HEADERS = ['lon', 'lng', 'long', 'longitude', 'x_dd'];
const ZONE_HEADERS = ['zone', 'utm_zone'];

function findHeader(headers: string[], candidates: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidates) {
    const idx = lower.indexOf(c);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

/**
 * Import a CSV. If it has Easting/Northing (or X/Y) columns, treat them as
 * UTM Zone 47N/48N (auto-detected per-row, or from a `zone` column if
 * present) and convert to lat/lon for mapping. If it has Lat/Lon columns
 * instead, those are used directly.
 */
async function importCsv(file: File): Promise<ImportResult> {
  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const warnings: string[] = parsed.errors.map((e) => `Row ${e.row}: ${e.message}`);
  const headers = parsed.meta.fields ?? [];

  const eastingCol = findHeader(headers, EASTING_HEADERS);
  const northingCol = findHeader(headers, NORTHING_HEADERS);
  const latCol = findHeader(headers, LAT_HEADERS);
  const lonCol = findHeader(headers, LON_HEADERS);
  const zoneCol = findHeader(headers, ZONE_HEADERS);

  const features: FeatureCollection['features'] = [];

  for (const row of parsed.data) {
    let lat: number | null = null;
    let lon: number | null = null;

    if (latCol && lonCol && row[latCol] && row[lonCol]) {
      lat = parseFloat(row[latCol]);
      lon = parseFloat(row[lonCol]);
    } else if (eastingCol && northingCol && row[eastingCol] && row[northingCol]) {
      const easting = parseFloat(row[eastingCol]);
      const northing = parseFloat(row[northingCol]);
      const zoneNum = zoneCol ? parseInt(row[zoneCol], 10) : null;
      const zone: UtmZone = zoneNum === 47 ? UTM_ZONE_47N : UTM_ZONE_48N;
      if (!Number.isNaN(easting) && !Number.isNaN(northing)) {
        [lat, lon] = utmToLatLon(easting, northing, zone);
      }
    }

    if (lat === null || lon === null || Number.isNaN(lat) || Number.isNaN(lon)) continue;

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { ...row },
    });
  }

  if (!eastingCol && !northingCol && !latCol && !lonCol) {
    warnings.push(
      'No recognizable spatial columns found (expected Easting/Northing, X/Y, or Lat/Lon). ' +
        'CSV stored as a flat table only — no map markers created.',
    );
  } else if (eastingCol && northingCol && !zoneCol) {
    warnings.push(
      `No "zone" column found — assumed UTM Zone 48N for all Easting/Northing rows. ` +
        `Add a "zone" column (47 or 48) for mixed-zone datasets.`,
    );
  }

  return {
    format: 'csv',
    name: file.name,
    geojson: { type: 'FeatureCollection', features },
    rawBlob: null,
    warnings,
  };
}

/** GeoTIFF — stored as a raw raster blob for the local raster layer; not vectorized. */
async function importGeoTiff(file: File): Promise<ImportResult> {
  return {
    format: 'geotiff',
    name: file.name,
    geojson: null,
    rawBlob: file,
    warnings: [
      'GeoTIFF stored locally as a raster asset. Render via the raster overlay panel ' +
        '(requires georeferencing tags embedded in the file to auto-place on the map).',
    ],
  };
}

/**
 * OGC GeoPackage — parsed with sql.js (SQLite-over-WASM) into real
 * vector features. Falls back to storing the raw file as a binary asset
 * if the file has no readable feature tables (e.g. raster-only GeoPackage).
 */
async function importGeoPackage(file: File): Promise<ImportResult> {
  const { geojson, warnings } = await importGeoPackageVector(file);
  if (geojson && geojson.features.length > 0) {
    return { format: 'gpkg', name: file.name, geojson, rawBlob: null, warnings };
  }
  return {
    format: 'gpkg',
    name: file.name,
    geojson: null,
    rawBlob: file,
    warnings: [...warnings, 'Stored as a raw binary asset instead — no vector features were extracted.'],
  };
}

/** Single entry point — detects format by extension and dispatches. */
export async function importGisFile(file: File): Promise<ImportResult> {
  const format = detectFormat(file);
  if (!format) {
    return {
      format: 'geojson',
      name: file.name,
      geojson: null,
      rawBlob: null,
      warnings: [`Unrecognized file extension for "${file.name}".`],
    };
  }
  switch (format) {
    case 'shp':
      return importShapefile(file);
    case 'kml':
      return importKml(file);
    case 'kmz':
      return importKmz(file);
    case 'gpx':
      return importGpx(file);
    case 'geojson':
      return importGeoJson(file);
    case 'csv':
      return importCsv(file);
    case 'geotiff':
      return importGeoTiff(file);
    case 'gpkg':
      return importGeoPackage(file);
  }
}
