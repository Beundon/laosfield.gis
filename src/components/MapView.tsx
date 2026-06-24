/**
 * MapView.tsx
 * -----------------------------------------------------------------------
 * COLOR CHANGE: All live-preview geometry (distance line, area polygon,
 * draw line/polygon, track line) now uses `activeColor` / `trackColor`
 * passed from App.tsx instead of hardcoded hex values. Saved geometries
 * in storedDrawings already carry their own `color` field and are
 * unchanged.
 *
 * TRACK FIX (carried forward): single GPS consumer, MapView pauses its
 * own watch while isRecording=true. Locate button moved to bottom:160.
 * -----------------------------------------------------------------------
 */
import {
  MapContainer, TileLayer, Polyline, Polygon, GeoJSON,
  useMapEvents, useMap, Marker, Popup, CircleMarker, Circle,
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
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface MapViewProps {
  config: AppRegionConfig;
  storedLayers: { id: number; geojson: FeatureCollection; name: string }[];
  storedPoints: StoredPoint[];
  storedDrawings: StoredDrawing[];
  activeToolPoints: LatLng[];
  activeTool: ToolKind;
  drawGeometryType: DrawGeometryType;
  /** Color used for ALL live preview geometry (draw, distance, area). */
  activeColor: string;
  onMapClick: (point: LatLng) => void;
  trackPath: LatLng[];
  /** Color used for the live track line while recording. */
  trackColor: string;
  isRecording: boolean;
  recordingPosition: { lat: number; lng: number; accuracyMeters: number | null } | null;
}

interface MyFix { lat: number; lng: number; accuracyMeters: number; }

function ClickHandler({ onClick }: { onClick: (p: LatLng) => void }) {
  useMapEvents({ click(e) { onClick({ lat: e.latlng.lat, lng: e.latlng.lng }); } });
  return null;
}

/** Incremental track polyline — extends with addLatLng(), never rebuilt. */
function LiveTrackPolyline({ trackPath, color }: { trackPath: LatLng[]; color: string }) {
  const map = useMap();
  const polyRef  = useRef<L.Polyline | null>(null);
  const prevLenRef = useRef(0);
  const colorRef = useRef(color);

  // Update stroke color live when user changes the picker while recording
  useEffect(() => {
    colorRef.current = color;
    if (polyRef.current) polyRef.current.setStyle({ color });
  }, [color]);

  useEffect(() => {
    if (!polyRef.current) {
      polyRef.current = L.polyline([], {
        color: colorRef.current,
        weight: 4, opacity: 0.9, lineJoin: 'round', lineCap: 'round',
      }).addTo(map);
    }
    const poly = polyRef.current;
    const prev = prevLenRef.current;

    if (trackPath.length === 0) {
      poly.setLatLngs([]);
      prevLenRef.current = 0;
      return;
    }
    if (trackPath.length < prev) {
      poly.setLatLngs(trackPath.map((p) => [p.lat, p.lng] as [number, number]));
      prevLenRef.current = trackPath.length;
      return;
    }
    for (let i = prev; i < trackPath.length; i++) {
      poly.addLatLng([trackPath[i].lat, trackPath[i].lng]);
    }
    prevLenRef.current = trackPath.length;
  }, [map, trackPath]);

  useEffect(() => {
    return () => { if (polyRef.current) { polyRef.current.remove(); polyRef.current = null; } };
  }, [map]);

  return null;
}

export default function MapView({
  config, storedLayers, storedPoints, storedDrawings,
  activeToolPoints, activeTool, drawGeometryType, activeColor,
  onMapClick, trackPath, trackColor, isRecording, recordingPosition,
}: MapViewProps) {
  const laosBounds = useMemo<L.LatLngBoundsExpression>(
    () => [[LAOS_BBOX.minLat, LAOS_BBOX.minLon], [LAOS_BBOX.maxLat, LAOS_BBOX.maxLon]],
    [],
  );

  const mapRef = useRef<L.Map | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const centeredOnceRef = useRef(false);
  const [myFix, setMyFix] = useState<MyFix | null>(null);
  const [tracking, setTracking] = useState(false);
  const [locating, setLocating] = useState(false);

  function startLocating() {
    if (!navigator.geolocation || watchIdRef.current !== null) return;
    setLocating(true); setTracking(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const fix: MyFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyMeters: pos.coords.accuracy ?? 30 };
        setMyFix(fix); setLocating(false);
        if (!centeredOnceRef.current && mapRef.current) {
          centeredOnceRef.current = true;
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

  useEffect(() => {
    if (isRecording) { stopLocating(); }
    else { startLocating(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  useEffect(() => { startLocating(); return stopLocating; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const displayFix: MyFix | null = isRecording && recordingPosition
    ? { lat: recordingPosition.lat, lng: recordingPosition.lng, accuracyMeters: recordingPosition.accuracyMeters ?? 10 }
    : myFix;

  useEffect(() => {
    if (isRecording && recordingPosition && !centeredOnceRef.current && mapRef.current) {
      centeredOnceRef.current = true;
      mapRef.current.flyTo([recordingPosition.lat, recordingPosition.lng], Math.max(mapRef.current.getZoom(), 16));
    }
  }, [isRecording, recordingPosition]);

  useEffect(() => { if (!isRecording) centeredOnceRef.current = false; }, [isRecording]);

  const buttonActive = tracking || isRecording;
  // Dot color matches the track color while recording; blue when just locating
  const dotFill  = isRecording ? trackColor : '#2f8fe0';
  const ringFill = isRecording ? trackColor : '#6fb1e8';

  return (
    <>
      <MapContainer
        ref={mapRef}
        center={config.initialCenter} zoom={config.initialZoom}
        maxBounds={config.lockViewportToLaos ? laosBounds : undefined}
        maxBoundsViscosity={config.lockViewportToLaos ? 0.8 : 0}
        minZoom={config.lockViewportToLaos ? 6 : 2}
        className="map-root" zoomControl={false}
      >
        <TileLayer
          url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
          attribution="Map data: OpenStreetMap contributors, SRTM | Map style: OpenTopoMap (CC-BY-SA)"
          maxZoom={17}
        />
        <ClickHandler onClick={onMapClick} />

        {storedLayers.map((layer) => <GeoJSON key={layer.id} data={layer.geojson} />)}

        {storedPoints.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]}>
            <Popup><strong>{p.name}</strong>{p.note && <div>{p.note}</div>}</Popup>
          </Marker>
        ))}

        {/* Saved drawings — each carries its own stored color */}
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

        {/* Live track — color updates immediately when picker changes */}
        <LiveTrackPolyline trackPath={trackPath} color={trackColor} />

        {/* "You are here" dot — matches track color while recording */}
        {displayFix && (
          <>
            <Circle center={[displayFix.lat, displayFix.lng]} radius={displayFix.accuracyMeters}
              pathOptions={{ color: ringFill, weight: 1, fillColor: ringFill, fillOpacity: 0.15 }} />
            <CircleMarker center={[displayFix.lat, displayFix.lng]} radius={8}
              pathOptions={{ color: '#ffffff', weight: 2, fillColor: dotFill, fillOpacity: 1 }}>
              <Popup>{isRecording ? 'Recording — ' : ''}You are here (&plusmn;{Math.round(displayFix.accuracyMeters)} m)</Popup>
            </CircleMarker>
          </>
        )}

        {/* ── In-progress tool geometry — ALL use activeColor ── */}
        {activeTool === 'point' && activeToolPoints.map((p, i) => (
          <CircleMarker key={i} center={[p.lat, p.lng]} radius={8}
            pathOptions={{ color: '#f2b657', weight: 2 }} />
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
                pathOptions={{ color: activeColor, weight: 2 }} />
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

      {/* ── Locate-me button — bottom:160 (above HUD/ToolsPanel) ── */}
      <style>{`
        @keyframes locate-btn-pulse { 0%,100%{opacity:1}50%{opacity:0.35} }
      `}</style>
      <button
        onClick={() => { if (!isRecording) { if (tracking) stopLocating(); else startLocating(); } }}
        aria-label={buttonActive ? 'GPS active' : 'Show my position'}
        title={isRecording ? 'GPS active — recording' : tracking ? 'Stop showing my position' : 'Show my position'}
        style={{
          position: 'fixed', bottom: 160, right: 14, zIndex: 1360,
          width: 44, height: 44, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: buttonActive ? 'var(--c-olive-600)' : 'var(--c-charcoal-900)',
          border: buttonActive ? '1px solid var(--c-amber-500)' : '1px solid var(--c-line-subtle)',
          boxShadow: '0 6px 16px rgba(0,0,0,0.4)', cursor: isRecording ? 'default' : 'pointer',
        }}
      >
        <span style={{
          position: 'relative', width: 18, height: 18, borderRadius: '50%',
          border: `2px solid ${buttonActive ? 'var(--c-amber-400)' : 'var(--c-paper-100)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: locating ? 'locate-btn-pulse 1s ease-in-out infinite' : undefined,
        }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: buttonActive ? 'var(--c-amber-400)' : 'var(--c-paper-100)' }} />
        </span>
      </button>
    </>
  );
}
