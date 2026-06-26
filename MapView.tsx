/**
 * MapView.tsx
 * -----------------------------------------------------------------------
 * Renders the Leaflet map. GPS is managed externally (App.tsx / useGpsTrack).
 *
 * NEW in this version:
 * 1. Basemap switcher — `activeBasemapId` prop drives which TileLayer is shown.
 *    A "layers" button appears bottom-left to open the BasemapPicker overlay.
 * 2. Permanent saved geometry rendering:
 *    - storedTracks (from IndexedDB via useLiveQuery in App.tsx) are drawn
 *      as permanent polylines in their saved color
 *    - storedMeasurements are drawn as polylines (distance) or filled
 *      polygons (area) in their saved color
 *    These persist until explicitly deleted from the Data library.
 * 3. Basemap toggle button at bottom-left corner of the map.
 * -----------------------------------------------------------------------
 */
import {
  MapContainer, TileLayer, Polyline, Polygon, GeoJSON,
  useMapEvents, Marker, Popup, CircleMarker,
} from 'react-leaflet';
import { useMemo, useRef, useEffect, useState } from 'react';
import L from 'leaflet';
import type { FeatureCollection } from 'geojson';
import { LAOS_BBOX } from '../core/laosGeo';
import type { AppRegionConfig } from '../core/bootDetection';
import type { LatLng } from '../core/measurementEngine';
import { formatDistance, formatArea } from '../core/measurementEngine';
import type { StoredPoint, StoredDrawing, StoredTrack, StoredMeasurement } from '../storage/db';
import type { ToolKind, DrawGeometryType } from './ToolsPanel';
import { getBasemap } from '../core/basemaps';
import BasemapPicker from './BasemapPicker';

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface MapViewProps {
  config: AppRegionConfig;
  storedLayers: { id: number; geojson: FeatureCollection; name: string }[];
  storedPoints: StoredPoint[];
  storedDrawings: StoredDrawing[];
  storedTracks: StoredTrack[];
  storedMeasurements: StoredMeasurement[];
  activeToolPoints: LatLng[];
  activeTool: ToolKind;
  drawGeometryType: DrawGeometryType;
  activeColor: string;
  activeBasemapId: string;
  onBasemapChange: (id: string) => void;
  onMapClick: (point: LatLng) => void;
  onMapReady: (map: L.Map) => void;
}

function ClickHandler({ onClick }: { onClick: (p: LatLng) => void }) {
  useMapEvents({ click(e) { onClick({ lat: e.latlng.lat, lng: e.latlng.lng }); } });
  return null;
}

function MapReadyReporter({ onMapReady }: { onMapReady: (m: L.Map) => void }) {
  const map = useMapEvents({ click() {} });
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (!notifiedRef.current && map) {
      notifiedRef.current = true;
      onMapReady(map);
    }
  }, [map, onMapReady]);
  return null;
}

export default function MapView({
  config, storedLayers, storedPoints, storedDrawings,
  storedTracks, storedMeasurements,
  activeToolPoints, activeTool, drawGeometryType, activeColor,
  activeBasemapId, onBasemapChange,
  onMapClick, onMapReady,
}: MapViewProps) {
  const laosBounds = useMemo<L.LatLngBoundsExpression>(
    () => [[LAOS_BBOX.minLat, LAOS_BBOX.minLon], [LAOS_BBOX.maxLat, LAOS_BBOX.maxLon]],
    [],
  );
  const [showBasemapPicker, setShowBasemapPicker] = useState(false);
  const basemap = getBasemap(activeBasemapId);

  return (
    <>
      <MapContainer
        center={config.initialCenter} zoom={config.initialZoom}
        maxBounds={config.lockViewportToLaos ? laosBounds : undefined}
        maxBoundsViscosity={config.lockViewportToLaos ? 0.8 : 0}
        minZoom={config.lockViewportToLaos ? 6 : 2}
        className="map-root" zoomControl={false}
      >
        {/* Active basemap tile layer */}
        <TileLayer
          key={basemap.id}
          url={basemap.url}
          attribution={basemap.attribution}
          maxZoom={basemap.maxZoom}
          subdomains={basemap.subdomains ?? 'abc'}
        />

        <ClickHandler onClick={onMapClick} />
        <MapReadyReporter onMapReady={onMapReady} />

        {/* ── Imported vector layers ── */}
        {storedLayers.map((l) => <GeoJSON key={l.id} data={l.geojson} />)}

        {/* ── Saved points ── */}
        {storedPoints.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]}>
            <Popup><strong>{p.name}</strong>{p.note && <div>{p.note}</div>}</Popup>
          </Marker>
        ))}

        {/* ── Saved drawings (Draw tool) ── */}
        {storedDrawings.map((d) =>
          d.geometryType === 'polygon' ? (
            <Polygon key={d.id} positions={d.points.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: d.color, fillColor: d.color, fillOpacity: 0.2, weight: 3 }}>
              <Popup>{d.name}</Popup>
            </Polygon>
          ) : (
            <Polyline key={d.id} positions={d.points.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: d.color, weight: 3 }}>
              <Popup>{d.name}</Popup>
            </Polyline>
          ),
        )}

        {/* ── Saved tracks — permanently visible until deleted ── */}
        {storedTracks.map((t) => (
          <Polyline
            key={t.id}
            positions={t.points.map((p) => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: t.color ?? '#d9534f', weight: 4, opacity: 0.85, lineJoin: 'round', lineCap: 'round' }}
          >
            <Popup>
              <strong>{t.name}</strong>
              <div>{formatDistance(t.distanceMeters)} — {t.points.length} fixes</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>{t.createdAtIct}</div>
            </Popup>
          </Polyline>
        ))}

        {/* ── Saved measurements — permanently visible until deleted ── */}
        {storedMeasurements.map((m) =>
          m.kind === 'area' ? (
            <Polygon
              key={m.id}
              positions={m.points.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: m.color ?? '#d9534f', fillColor: m.color ?? '#d9534f', fillOpacity: 0.18, weight: 3 }}
            >
              <Popup>
                <strong>{m.name}</strong>
                <div>{formatArea(m.resultSquareMeters ?? 0)}</div>
              </Popup>
            </Polygon>
          ) : (
            <Polyline
              key={m.id}
              positions={m.points.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: m.color ?? '#d9534f', weight: 3, dashArray: '8 5' }}
            >
              <Popup>
                <strong>{m.name}</strong>
                <div>{formatDistance(m.resultMeters ?? 0)}</div>
              </Popup>
            </Polyline>
          ),
        )}

        {/* ── In-progress tool geometry ── */}
        {activeTool === 'point' && activeToolPoints.map((p, i) => (
          <CircleMarker key={i} center={[p.lat, p.lng]} radius={8}
            pathOptions={{ color: '#f2b657', fillColor: '#f2b657', fillOpacity: 0.9, weight: 2 }} />
        ))}

        {activeTool === 'draw' && activeToolPoints.length > 0 && (
          <>
            {drawGeometryType === 'polygon' ? (
              <Polygon positions={activeToolPoints.map((p) => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: activeColor, fillColor: activeColor, fillOpacity: 0.2, weight: 3, dashArray: '6 4' }} />
            ) : (
              <Polyline positions={activeToolPoints.map((p) => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: activeColor, weight: 3, dashArray: '6 4' }} />
            )}
            {activeToolPoints.map((p, i) => (
              <CircleMarker key={i} center={[p.lat, p.lng]} radius={5}
                pathOptions={{ color: activeColor, fillColor: activeColor, fillOpacity: 0.9, weight: 2 }} />
            ))}
          </>
        )}

        {activeTool === 'distance' && activeToolPoints.length > 0 && (
          <>
            <Polyline positions={activeToolPoints.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: activeColor, weight: 4, dashArray: '8 5' }} />
            {activeToolPoints.map((p, i) => (
              <CircleMarker key={i} center={[p.lat, p.lng]} radius={6}
                pathOptions={{ color: activeColor, fillColor: activeColor, fillOpacity: 0.9, weight: 2 }}>
                <Popup>Point {i + 1}</Popup>
              </CircleMarker>
            ))}
          </>
        )}

        {activeTool === 'area' && activeToolPoints.length > 0 && (
          <>
            <Polygon positions={activeToolPoints.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: activeColor, fillColor: activeColor, fillOpacity: 0.18, weight: 3 }} />
            {activeToolPoints.map((p, i) => (
              <CircleMarker key={i} center={[p.lat, p.lng]} radius={6}
                pathOptions={{ color: activeColor, fillColor: activeColor, fillOpacity: 0.9, weight: 2 }} />
            ))}
          </>
        )}
      </MapContainer>

      {/* ── Basemap toggle button ── */}
      <button
        className="basemap-btn"
        onClick={() => setShowBasemapPicker((v) => !v)}
        title="Change basemap"
        aria-label="Change basemap"
      >
        <span className="basemap-btn__icon">🗺</span>
        <span className="basemap-btn__label">{basemap.label}</span>
      </button>

      {/* ── Basemap picker overlay ── */}
      {showBasemapPicker && (
        <BasemapPicker
          activeId={activeBasemapId}
          onSelect={(id) => { onBasemapChange(id); }}
          onClose={() => setShowBasemapPicker(false)}
        />
      )}
    </>
  );
}
