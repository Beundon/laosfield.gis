import Dexie, { type EntityTable } from 'dexie';
import type { FeatureCollection } from 'geojson';

export interface StoredLayer {
  id?: number;
  name: string;
  format: string;
  geojson: FeatureCollection;
  createdAtIct: string;
  sourceFileName: string;
}

export interface StoredRasterAsset {
  id?: number;
  name: string;
  format: 'geotiff' | 'gpkg';
  blob: Blob;
  createdAtIct: string;
}

export interface StoredTrack {
  id?: number;
  name: string;
  points: { lat: number; lng: number; elevationMeters: number | null; timestamp: number }[];
  createdAtIct: string;
  distanceMeters: number;
  /** Hex color chosen in the toolbar at record time. Default '#d9534f' (red). */
  color: string;
}

export interface StoredMeasurement {
  id?: number;
  kind: 'distance' | 'area';
  name: string;
  points: { lat: number; lng: number }[];
  resultMeters?: number;
  resultSquareMeters?: number;
  createdAtIct: string;
  /** Hex color chosen in the toolbar when the measurement was saved. */
  color: string;
}

export interface StoredPoint {
  id?: number;
  name: string;
  lat: number;
  lng: number;
  elevationMeters: number | null;
  note: string;
  createdAtIct: string;
}

export interface StoredDrawing {
  id?: number;
  name: string;
  geometryType: 'line' | 'polygon';
  points: { lat: number; lng: number }[];
  color: string;
  createdAtIct: string;
}

const db = new Dexie('LaosFieldGisDB') as Dexie & {
  layers: EntityTable<StoredLayer, 'id'>;
  rasters: EntityTable<StoredRasterAsset, 'id'>;
  tracks: EntityTable<StoredTrack, 'id'>;
  measurements: EntityTable<StoredMeasurement, 'id'>;
  points: EntityTable<StoredPoint, 'id'>;
  drawings: EntityTable<StoredDrawing, 'id'>;
};

db.version(1).stores({
  layers: '++id, name, format, createdAtIct',
  rasters: '++id, name, format, createdAtIct',
  tracks: '++id, name, createdAtIct',
  measurements: '++id, kind, name, createdAtIct',
});

db.version(2).stores({
  layers: '++id, name, format, createdAtIct',
  rasters: '++id, name, format, createdAtIct',
  tracks: '++id, name, createdAtIct',
  measurements: '++id, kind, name, createdAtIct',
  points: '++id, name, createdAtIct',
  drawings: '++id, name, geometryType, createdAtIct',
});

// v3: adds `color` field to tracks and measurements. Existing rows get
// the default red so they render consistently with new ones.
db.version(3)
  .stores({
    layers: '++id, name, format, createdAtIct',
    rasters: '++id, name, format, createdAtIct',
    tracks: '++id, name, createdAtIct',
    measurements: '++id, kind, name, createdAtIct',
    points: '++id, name, createdAtIct',
    drawings: '++id, name, geometryType, createdAtIct',
  })
  .upgrade(async (tx) => {
    await tx.table('tracks').toCollection().modify((row) => {
      if (!row.color) row.color = '#d9534f';
    });
    await tx.table('measurements').toCollection().modify((row) => {
      if (!row.color) row.color = '#d9534f';
    });
  });

export default db;
