/**
 * MapView.tsx — GPS-free, map-display only.
 *
 * All GPS management has been moved to useGpsTrack hook (called in App.tsx).
 * MapView now only:
 *   1. Renders the MapContainer and calls onMapReady with the L.Map instance
 *   2. Shows the OpenTopoMap basemap + stored layers
 *   3. Renders in-progress tool geometry (draw/distance/area/point)
 *
 * The "you are here" dot, accuracy ring, and track polyline are all
 * rendered imperatively by App.tsx using the mapRef — no React-Leaflet
 * context dependencies, no GPS watches in this file.
 */
import {
  MapContainer, TileLayer, Polyline, Polygon, GeoJSON,
  useMapEvents, Marker, Popup, CircleMarker,
} from 'react-leaflet';
import { useMemo, useRef, useEffect } from 'react';
import L from 'leaflet';
import type { FeatureCollection } from 'geojson';
import { LAOS_BBOX } from '../core/laosGeo';
import type { AppRegionConfig } from '../core/bootDetection';
import type { LatLng } from '../core/measurementEngine';
import type { StoredPoint, StoredDrawing } from '../storage/db';
import type { ToolKind, DrawGeometryType } from './ToolsPanel';

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
  activeToolPoints: LatLng[];
  activeTool: ToolKind;
  drawGeometryType: DrawGeometryType;
  activeColor: string;
  onMapClick: (point: LatLng) => void;
  /** App.tsx receives this map instance to manage GPS layers imperatively. */
  onMapReady: (map: L.Map) => void;
}

function ClickHandler({ onClick }: { onClick: (p: LatLng) => void }) {
  useMapEvents({ click(e) { onClick({ lat: e.latlng.lat, lng: e.latlng.lng }); } });
  return null;
}

/** Reports the Leaflet map instance to App.tsx via onMapReady. */
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
  activeToolPoints, activeTool, drawGeometryType, activeColor,
  onMapClick, onMapReady,
}: MapViewProps) {
  const laosBounds = useMemo<L.LatLngBoundsExpression>(
    () => [[LAOS_BBOX.minLat, LAOS_BBOX.minLon], [LAOS_BBOX.maxLat, LAOS_BBOX.maxLon]],
    [],
  );

  return (
    <MapContainer
      center={config.initialCenter} zoom={config.initialZoom}
      maxBounds={config.lockViewportToLaos ? laosBounds : undefined}
      maxBoundsViscosity={config.lockViewportToLaos ? 0.8 : 0}
      minZoom={config.lockViewportToLaos ? 6 : 2}
      className="map-root" zoomControl={false}
    >
      <TileLayer
        url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
        attribution="Map data: OpenStreetMap contributors, SRTM | OpenTopoMap (CC-BY-SA)"
        maxZoom={17}
      />
      <ClickHandler onClick={onMapClick} />
      <MapReadyReporter onMapReady={onMapReady} />

      {storedLayers.map((l) => <GeoJSON key={l.id} data={l.geojson} />)}

      {storedPoints.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]}>
          <Popup><strong>{p.name}</strong>{p.note && <div>{p.note}</div>}</Popup>
        </Marker>
      ))}

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
  );
}
