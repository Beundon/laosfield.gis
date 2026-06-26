/**
 * basemaps.ts — Available tile layer definitions for the map.
 * All tile URLs use HTTPS. Google tiles require no API key when used
 * via the standard lyrs parameter in a browser context (direct tile access).
 */
export interface BasemapDef {
  id: string;
  label: string;
  group: 'Topographic' | 'Satellite' | 'Street' | 'Other';
  url: string;
  attribution: string;
  maxZoom: number;
  /** Optional sub-domains array for {s} placeholder */
  subdomains?: string;
}

export const BASEMAPS: BasemapDef[] = [
  // ── Topographic ──────────────────────────────────────────────────────
  {
    id: 'opentopomap',
    label: 'OpenTopoMap',
    group: 'Topographic',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Map: OpenStreetMap contributors, SRTM | Style: OpenTopoMap (CC-BY-SA)',
    maxZoom: 17,
    subdomains: 'abc',
  },
  {
    id: 'esri-topo',
    label: 'ESRI World Topo',
    group: 'Topographic',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles: Esri, HERE, Garmin, Intermap, METI/NASA, NRCAN, USGS, EPA, NPS',
    maxZoom: 19,
  },

  // ── Satellite ────────────────────────────────────────────────────────
  {
    id: 'google-satellite',
    label: 'Google Satellite',
    group: 'Satellite',
    url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    attribution: 'Map data: Google',
    maxZoom: 20,
    subdomains: '0123',
  },
  {
    id: 'google-hybrid',
    label: 'Google Hybrid',
    group: 'Satellite',
    url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    attribution: 'Map data: Google',
    maxZoom: 20,
    subdomains: '0123',
  },
  {
    id: 'esri-satellite',
    label: 'ESRI Satellite',
    group: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles: Esri, Maxar, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS',
    maxZoom: 19,
  },

  // ── Street ───────────────────────────────────────────────────────────
  {
    id: 'google-road',
    label: 'Google Road',
    group: 'Street',
    url: 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    attribution: 'Map data: Google',
    maxZoom: 20,
    subdomains: '0123',
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    group: 'Street',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: 'Map data: OpenStreetMap contributors (ODbL)',
    maxZoom: 19,
    subdomains: 'abc',
  },
  {
    id: 'google-terrain',
    label: 'Google Terrain',
    group: 'Other',
    url: 'https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
    attribution: 'Map data: Google',
    maxZoom: 20,
    subdomains: '0123',
  },
  {
    id: 'esri-street',
    label: 'ESRI Street',
    group: 'Street',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles: Esri, HERE, Garmin, METI/NASA, USGS',
    maxZoom: 19,
  },
];

export const DEFAULT_BASEMAP_ID = 'opentopomap';
export function getBasemap(id: string): BasemapDef {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
}
