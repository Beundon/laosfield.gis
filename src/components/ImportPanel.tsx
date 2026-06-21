/**
 * ImportPanel.tsx
 * -----------------------------------------------------------------------
 * "Import Administrative Boundary" / general GIS file upload utility
 * (spec section 3). Accepts shapefile bundles, KML/KMZ, GPX, GeoJSON,
 * CSV, GeoTIFF, and GeoPackage, parses via fileEngine, and persists the
 * result to the local offline workspace (Dexie/IndexedDB).
 * -----------------------------------------------------------------------
 */
import { useRef, useState } from 'react';
import { importGisFile } from '../core/fileEngine';
import db from '../storage/db';
import { formatIctIso8601 } from '../core/timeEngine';
import './ImportPanel.css';

interface ImportPanelProps {
  onLayerImported: () => void;
  onClose: () => void;
}

export default function ImportPanel({ onLayerImported, onClose }: ImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    const newMessages: string[] = [];

    for (const file of Array.from(fileList)) {
      try {
        const result = await importGisFile(file);
        newMessages.push(...result.warnings);

        if (result.geojson && result.geojson.features.length > 0) {
          await db.layers.add({
            name: result.name,
            format: result.format,
            geojson: result.geojson,
            createdAtIct: formatIctIso8601(),
            sourceFileName: file.name,
          });
          newMessages.push(
            `Imported "${file.name}" as ${result.format.toUpperCase()} ` +
              `(${result.geojson.features.length} features).`,
          );
        } else if (result.rawBlob) {
          await db.rasters.add({
            name: result.name,
            format: result.format as 'geotiff' | 'gpkg',
            blob: result.rawBlob,
            createdAtIct: formatIctIso8601(),
          });
          newMessages.push(`Stored "${file.name}" as a raw raster/binary asset.`);
        } else {
          newMessages.push(`"${file.name}" produced no mappable features.`);
        }
      } catch (err) {
        newMessages.push(`Failed to import "${file.name}": ${(err as Error).message}`);
      }
    }

    setMessages(newMessages);
    setBusy(false);
    onLayerImported();
  }

  return (
    <div className="import-panel">
      <div className="import-panel__header">
        <h2>Import GIS data</h2>
        <button className="import-panel__close" onClick={onClose} aria-label="Close">
          x
        </button>
      </div>

      <p className="import-panel__desc">
        Shapefile bundles (.zip with .shp/.shx/.dbf/.prj), KML, KMZ, GPX, GeoJSON, CSV
        (Easting/Northing or Lat/Lon), GeoTIFF, and GeoPackage.
      </p>

      <button
        className="import-panel__dropzone"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
      >
        {busy ? 'Importing...' : 'Choose files'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        accept=".shp,.shx,.dbf,.prj,.zip,.kml,.kmz,.gpx,.geojson,.json,.csv,.tsv,.tif,.tiff,.gpkg"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div className="import-panel__hint">
        Tip: for Esri Shapefiles, zip the .shp, .shx, .dbf, and .prj files together before
        uploading -- this is the most reliable way to import Lao provincial/district/village
        boundaries.
      </div>

      {messages.length > 0 && (
        <ul className="import-panel__log">
          {messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
