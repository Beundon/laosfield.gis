/**
 * DataPanel.tsx
 * -----------------------------------------------------------------------
 * Local workspace browser. Every tool in the app (Point, Draw, Distance,
 * Area, Track recording, Import) saves into Dexie/IndexedDB — this panel
 * is where the user reviews what's been collected, exports it (CSV
 * everywhere, plus KML/GPX for tracks), and deletes old entries.
 *
 * Self-contained: queries Dexie directly via useLiveQuery rather than
 * receiving data as props, so it always reflects the latest state
 * without any parent wiring beyond onClose.
 * -----------------------------------------------------------------------
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import db from '../storage/db';
import { formatDistance, formatArea } from '../core/measurementEngine';
import { exportTrackAsKml, exportTrackAsGpx } from '../core/exportEngine';
import {
  exportPointsAsCsv,
  exportTrackAsCsv,
  exportMeasurementAsCsv,
  exportDrawingAsCsv,
  exportLayerAsCsv,
} from '../core/csvEngine';
import './DataPanel.css';

type Tab = 'points' | 'drawings' | 'tracks' | 'measurements' | 'layers';

const TABS: { id: Tab; label: string }[] = [
  { id: 'points', label: 'Points' },
  { id: 'drawings', label: 'Drawings' },
  { id: 'tracks', label: 'Tracks' },
  { id: 'measurements', label: 'Measure' },
  { id: 'layers', label: 'Imported' },
];

export default function DataPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('points');

  const points = useLiveQuery(() => db.points.orderBy('createdAtIct').reverse().toArray(), []) ?? [];
  const drawings = useLiveQuery(() => db.drawings.orderBy('createdAtIct').reverse().toArray(), []) ?? [];
  const tracks = useLiveQuery(() => db.tracks.orderBy('createdAtIct').reverse().toArray(), []) ?? [];
  const measurements =
    useLiveQuery(() => db.measurements.orderBy('createdAtIct').reverse().toArray(), []) ?? [];
  const layers = useLiveQuery(() => db.layers.orderBy('createdAtIct').reverse().toArray(), []) ?? [];

  const counts: Record<Tab, number> = {
    points: points.length,
    drawings: drawings.length,
    tracks: tracks.length,
    measurements: measurements.length,
    layers: layers.length,
  };

  return (
    <div className="data-panel">
      <div className="data-panel__header">
        <h2>Data library</h2>
        <button className="data-panel__close" onClick={onClose} aria-label="Close">
          x
        </button>
      </div>

      <div className="data-panel__tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={'data-panel__tab ' + (tab === t.id ? 'data-panel__tab--active' : '')}
            onClick={() => setTab(t.id)}
          >
            {t.label} <span className="data-panel__count">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      <div className="data-panel__list">
        {tab === 'points' && (
          <>
            {points.length > 1 && (
              <button className="data-panel__bulk" onClick={() => exportPointsAsCsv(points)}>
                Export all points as CSV
              </button>
            )}
            {points.length === 0 && <Empty label="No saved points yet. Use the Point tool on the map." />}
            {points.map((p) => (
              <Row
                key={p.id}
                title={p.name}
                subtitle={`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}${p.note ? ' — ' + p.note : ''}`}
                meta={p.createdAtIct}
                onExportCsv={() => exportPointsAsCsv([p])}
                onDelete={() => db.points.delete(p.id!)}
              />
            ))}
          </>
        )}

        {tab === 'drawings' && (
          <>
            {drawings.length === 0 && <Empty label="No saved drawings yet. Use the Draw tool on the map." />}
            {drawings.map((d) => (
              <Row
                key={d.id}
                title={d.name}
                subtitle={`${d.geometryType} — ${d.points.length} vertices`}
                meta={d.createdAtIct}
                swatch={d.color}
                onExportCsv={() => exportDrawingAsCsv(d)}
                onDelete={() => db.drawings.delete(d.id!)}
              />
            ))}
          </>
        )}

        {tab === 'tracks' && (
          <>
            {tracks.length === 0 && <Empty label="No saved tracks yet. Use Record track in the top bar." />}
            {tracks.map((t) => (
              <Row
                key={t.id}
                title={t.name}
                subtitle={`${formatDistance(t.distanceMeters)} — ${t.points.length} fixes`}
                meta={t.createdAtIct}
                swatch={t.color}
                onExportCsv={() => exportTrackAsCsv(t.name, t.points)}
                onExportKml={() => exportTrackAsKml(t.name, t.points)}
                onExportGpx={() => exportTrackAsGpx(t.name, t.points)}
                onDelete={() => db.tracks.delete(t.id!)}
              />
            ))}
          </>
        )}

        {tab === 'measurements' && (
          <>
            {measurements.length === 0 && (
              <Empty label="No saved measurements yet. Use Distance or Area on the map." />
            )}
            {measurements.map((m) => (
              <Row
                key={m.id}
                title={m.name}
                subtitle={
                  m.kind === 'distance'
                    ? formatDistance(m.resultMeters ?? 0)
                    : formatArea(m.resultSquareMeters ?? 0)
                }
                meta={m.createdAtIct}
                swatch={m.color}
                onExportCsv={() => exportMeasurementAsCsv(m)}
                onDelete={() => db.measurements.delete(m.id!)}
              />
            ))}
          </>
        )}

        {tab === 'layers' && (
          <>
            {layers.length === 0 && <Empty label="No imported layers yet. Use Import in the top bar." />}
            {layers.map((l) => (
              <Row
                key={l.id}
                title={l.name}
                subtitle={`${l.format.toUpperCase()} — ${l.geojson.features.length} features`}
                meta={l.createdAtIct}
                onExportCsv={() => exportLayerAsCsv(l.name, l.geojson)}
                onDelete={() => db.layers.delete(l.id!)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="data-panel__empty">{label}</p>;
}

function Row({
  title,
  subtitle,
  meta,
  swatch,
  onExportCsv,
  onExportKml,
  onExportGpx,
  onDelete,
}: {
  title: string;
  subtitle: string;
  meta: string;
  swatch?: string;
  onExportCsv: () => void;
  onExportKml?: () => void;
  onExportGpx?: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="data-row">
      <div className="data-row__main">
        {swatch && <span className="data-row__swatch" style={{ background: swatch }} />}
        <div>
          <div className="data-row__title">{title}</div>
          <div className="data-row__subtitle">{subtitle}</div>
          <div className="data-row__meta">{meta}</div>
        </div>
      </div>
      <div className="data-row__actions">
        <button onClick={onExportCsv}>CSV</button>
        {onExportKml && <button onClick={onExportKml}>KML</button>}
        {onExportGpx && <button onClick={onExportGpx}>GPX</button>}
        <button className="data-row__delete" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
