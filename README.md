# Laos Field GIS

Offline-first, cross-platform field mapping app with automatic regional
detection for Laos (Lao PDR). One React/TypeScript codebase deploys two ways:

- **Web**: static build published to GitHub Pages.
- **Android**: the same build wrapped by Capacitor and compiled to an APK
  by GitHub Actions.

## What it does

- Detects on boot whether the device is in Laos (GPS geofence, with system
  time zone and device locale as offline fallbacks) and auto-configures the
  map, projection, and clock accordingly -- no manual setup screen.
- Auto-selects UTM Zone 48N or 47N based on live longitude (the 102 degrees E
  boundary that splits most of Laos from Bokeo/Sayabouly).
- Renders a free OpenTopoMap contour-line basemap by default.
- Imports Esri Shapefiles (zipped), KML, KMZ, GPX, GeoJSON, CSV
  (Easting/Northing or Lat/Lon), GeoTIFF, and GeoPackage.
- Measures distance (m/km) and area (m^2/ha) with a tap-to-draw tool.
- Shows a persistent HUD: decimal degrees, UTM coordinates, elevation, and
  local Indochina Time (UTC+7).
- Stores everything locally (IndexedDB via Dexie) so the workspace survives
  with no network connection.

## Project structure

```
src/
  core/                   Pure logic, framework-agnostic
    laosGeo.ts             Bounding box, UTM zone constants/selection
    bootDetection.ts       Boot-sequence detection engine
    coordinateEngine.ts    WGS84 <-> UTM via proj4
    timeEngine.ts          Indochina Time formatting
    measurementEngine.ts   Haversine distance, geodesic polygon area
    fileEngine.ts          Shapefile/KML/GPX/CSV/GeoTIFF/GPKG import
    exportEngine.ts        KML/GPX export with ICT timestamps
  hooks/
    useLaosBootSequence.ts React hook wrapping bootDetection + live GPS
  components/             Map, HUD, top bar, import + measurement panels
  storage/
    db.ts                 Dexie (IndexedDB) schema -- offline workspace
android/                  Capacitor-generated native Android project
android-shell/README.md   Notes on the native build / signing
.github/workflows/deploy.yml
```

## Local development

```bash
npm install
npm run dev
```

## Building

```bash
npm run build          # outputs dist/ (web)
npx cap sync android    # copies dist/ into the Android project
cd android && ./gradlew assembleDebug
```

## Deployment

Push to `main` and `.github/workflows/deploy.yml` will:

1. Build the web bundle once.
2. Publish it to GitHub Pages.
3. Wrap the same build in the Android shell and upload a debug APK as a
   workflow artifact (Actions tab, latest run, Artifacts).

### One-time repo setup for Pages

In the repo's Settings, Pages section, set "Source" to "GitHub Actions". No
other configuration is required -- the workflow computes the correct
`/<repo-name>/` base path automatically from the repository name.

## Coordinate reference

| Item | Value |
|---|---|
| Geographic CRS | WGS 84 (EPSG:4326) |
| Projected CRS (default) | UTM Zone 48N (EPSG:32648) |
| Projected CRS (west of 102 degrees E) | UTM Zone 47N (EPSG:32647) |
| Time zone | Indochina Time, UTC+7 |
