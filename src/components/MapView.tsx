/**
 * MapView.tsx — simplified, track-layer-free.
 *
 * The track polyline, position dot, and accuracy ring are now managed
 * imperatively by App.tsx using mapInstanceRef (via onMapReady callback).
 * This component no longer renders any track geometry — it only provides:
 *   1. The MapContainer (Leaflet map instance via onMapReady callback)
 *   2. Basemap + stored layer overlays
 *   3. In-progress tool geometry (draw/distance/area/point previews)
 *   4. The locate-me button (for non-recording positioning)
 */
import {
  MapContainer, TileLayer, Polyline, Polygon, GeoJSON,
  useMapEvents, Marker, Popup, CircleMarker, Circle,
} from 'react-leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  isRecording: boolean;
  /** Called once the Leaflet map instance is ready — App.tsx holds this ref
   *  and uses it to manage the track polyline imperatively. */
  onMapReady: (map: L.Map) => void;
}

function ClickHandler({ onClick }: { onClick: (p: LatLng) => void }) {
  useMapEvents({ click(e) { onClick({ lat: e.latlng.lat, lng: e.latlng.lng }); } });
  return null;
}


interface LocateFix { lat: number; lng: number; accuracyMeters: number; }

export default function MapView({
  config, storedLayers, storedPoints, storedDrawings,
  activeToolPoints, activeTool, drawGeometryType, activeColor,
  onMapClick, isRecording, onMapReady,
}: MapViewProps) {
  const laosBounds = useMemo<L.LatLngBoundsExpression>(
    () => [[LAOS_BBOX.minLat, LAOS_BBOX.minLon], [LAOS_BBOX.maxLat, LAOS_BBOX.maxLon]],
    [],
  );

  const mapRef = useRef<L.Map | null>(null);
  // Notify App.tsx as soon as the MapContainer ref is populated
  useEffect(() => {
    if (mapRef.current) onMapReady(mapRef.current);
  });
  const watchIdRef = useRef<number | null>(null);
  const centeredRef = useRef(false);
  const [locateFix, setLocateFix] = useState<LocateFix | null>(null);
  const [tracking, setTracking] = useState(false);
  const [locating, setLocating] = useState(false);

  function startLocating() {
    if (!navigator.geolocation || watchIdRef.current !== null) return;
    setLocating(true); setTracking(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const fix: LocateFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyMeters: pos.coords.accuracy ?? 20 };
        setLocateFix(fix); setLocating(false);
        if (!centeredRef.current && mapRef.current) {
          centeredRef.current = true;
          mapRef.current.flyTo([fix.lat, fix.lng], Math.max(mapRef.current.getZoom(), 16));
        }
      },
      () => { setLocating(false); setTracking(false); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
  }

  function stopLocating() {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null; setTracking(false); setLocating(false);
  }

  // Pause locate-me while recording to avoid two GPS consumers
  useEffect(() => {
    if (isRecording) stopLocating();
    else startLocating();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  useEffect(() => {
    startLocating();
    return stopLocating;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (!isRecording) centeredRef.current = false; }, [isRecording]);

  const buttonActive = tracking || isRecording;

  return (
    <>
      <MapContainer
        ref={mapRef}
        center={config.initialCenter}
        zoom={config.initialZoom}
        maxBounds={config.lockViewportToLaos ? laosBounds : undefined}
        maxBoundsViscosity={config.lockViewportToLaos ? 0.8 : 0}
        minZoom={config.lockViewportToLaos ? 6 : 2}
        className="map-root"
        zoomControl={false}

      >
        <TileLayer
          url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
          attribution="Map data: OpenStreetMap contributors, SRTM | OpenTopoMap (CC-BY-SA)"
          maxZoom={17}
        />
        <ClickHandler onClick={onMapClick} />

        {/* Stored layers */}
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

        {/* Locate-me dot (only shown when NOT recording — App.tsx manages the recording dot) */}
        {!isRecording && locateFix && (
          <>
            <Circle center={[locateFix.lat, locateFix.lng]} radius={locateFix.accuracyMeters}
              pathOptions={{ color: '#2f8fe0', weight: 1, fillColor: '#6fb1e8', fillOpacity: 0.15 }} />
            <CircleMarker center={[locateFix.lat, locateFix.lng]} radius={8}
              pathOptions={{ color: '#fff', weight: 2.5, fillColor: '#2f8fe0', fillOpacity: 1 }}>
              <Popup>You are here (&plusmn;{Math.round(locateFix.accuracyMeters)} m)</Popup>
            </CircleMarker>
          </>
        )}

        {/* ── In-progress tool geometry ── */}
        {activeTool === 'point' && activeToolPoints.map((p, i) => (
          <CircleMarker key={i} center={[p.lat, p.lng]} radius={8}
            pathOptions={{ color: '#f2b657', weight: 2, fillColor: '#f2b657', fillOpacity: 0.9 }} />
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

      {/* Locate-me button — bottom:160, above HUD */}
      <style>{`@keyframes locate-pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
      <button
        onClick={() => { if (!isRecording) { if (tracking) stopLocating(); else startLocating(); } }}
        aria-label={isRecording ? 'GPS recording active' : tracking ? 'Stop locating' : 'Show my location'}
        title={isRecording ? 'GPS active — recording' : tracking ? 'Stop' : 'Show my location'}
        style={{
          position: 'fixed', bottom: 160, right: 14, zIndex: 1360,
          width: 44, height: 44, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: buttonActive ? 'var(--c-olive-600)' : 'var(--c-charcoal-900)',
          border: buttonActive ? '1px solid var(--c-amber-500)' : '1px solid var(--c-line-subtle)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          cursor: isRecording ? 'default' : 'pointer',
        }}
      >
        <span style={{
          width: 18, height: 18, borderRadius: '50%',
          border: `2px solid ${buttonActive ? 'var(--c-amber-400)' : 'var(--c-paper-100)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: locating ? 'locate-pulse 1s ease-in-out infinite' : undefined,
        }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: buttonActive ? 'var(--c-amber-400)' : 'var(--c-paper-100)' }} />
        </span>
      </button>
    </>
  );
}
