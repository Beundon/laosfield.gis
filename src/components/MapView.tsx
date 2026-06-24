/**
 * MapView.tsx
 * -----------------------------------------------------------------------
 * FIXES applied (matching App.tsx changes):
 *
 * FIX 1 — Dual watchPosition / straight-line bug:
 *   MapView previously auto-started its own watchPosition on mount for
 *   the locate-me blue dot. While track recording was active in App.tsx,
 *   two GPS watches ran simultaneously. On Android/iOS this causes the
 *   GPS callbacks to be interleaved between both consumers — track
 *   recording received only every other position fix, giving a sparse
 *   track that looked like a straight line between start and end.
 *
 *   Fix: two new props added:
 *     • isRecording — true while App.tsx's track watch is active
 *     • recordingPosition — the latest fix from the track watch
 *
 *   When isRecording=true, MapView's own watchPosition is PAUSED and the
 *   blue dot is driven by recordingPosition instead. Only one GPS watch
 *   runs at any given time. When recording stops, MapView resumes its own
 *   watch automatically.
 *
 * FIX 2 — Locate button moved DOWN:
 *   Button was at top:64 (just below the top bar), which is too high
 *   on phones and overlaps with the HUD area visually. Moved to
 *   bottom:160 (just above the ToolsPanel and HUD) so it sits near the
 *   relevant "I'm standing here" information in the bottom section.
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
  drawColor: string;
  onMapClick: (point: LatLng) => void;
  trackPath: LatLng[];
  /** FIX 1: true while App.tsx track watch is running — MapView pauses
   *  its own watch to avoid two concurrent GPS consumers. */
  isRecording: boolean;
  /** FIX 1: latest fix from App.tsx track watch, drives the blue dot
   *  while isRecording=true so MapView doesn't need its own watch. */
  recordingPosition: { lat: number; lng: number; accuracyMeters: number | null } | null;
}

interface MyFix {
  lat: number;
  lng: number;
  accuracyMeters: number;
}

function ClickHandler({ onClick }: { onClick: (p: LatLng) => void }) {
  useMapEvents({
    click(e) { onClick({ lat: e.latlng.lat, lng: e.latlng.lng }); },
  });
  return null;
}

/**
 * LiveTrackPolyline — incremental track rendering.
 * Holds a stable Leaflet Polyline ref and extends it with addLatLng()
 * on each new point. O(1) per fix — does not rebuild from scratch,
 * so no frame-flicker and no missed intermediate points.
 */
function LiveTrackPolyline({ trackPath }: { trackPath: LatLng[] }) {
  const map = useMap();
  const polyRef = useRef<L.Polyline | null>(null);
  const prevLenRef = useRef(0);

  useEffect(() => {
    if (!polyRef.current) {
      polyRef.current = L.polyline([], {
        color: '#e8541f',
        weight: 4,
        opacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round',
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
      // Track was reset mid-session — rebuild
      poly.setLatLngs(trackPath.map((p) => [p.lat, p.lng] as [number, number]));
      prevLenRef.current = trackPath.length;
      return;
    }

    // Normal: O(1) — append only new points
    for (let i = prev; i < trackPath.length; i++) {
      poly.addLatLng([trackPath[i].lat, trackPath[i].lng]);
    }
    prevLenRef.current = trackPath.length;
  }, [map, trackPath]);

  useEffect(() => {
    return () => {
      if (polyRef.current) { polyRef.current.remove(); polyRef.current = null; }
    };
  }, [map]);

  return null;
}

export default function MapView({
  config,
  storedLayers,
  storedPoints,
  storedDrawings,
  activeToolPoints,
  activeTool,
  drawGeometryType,
  drawColor,
  onMapClick,
  trackPath,
  isRecording,
  recordingPosition,
}: MapViewProps) {
  const laosBounds = useMemo<L.LatLngBoundsExpression>(
    () => [
      [LAOS_BBOX.minLat, LAOS_BBOX.minLon],
      [LAOS_BBOX.maxLat, LAOS_BBOX.maxLon],
    ],
    [],
  );

  const mapRef = useRef<L.Map | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const centeredOnceRef = useRef(false);

  // MapView's OWN fix — only used when NOT recording
  const [myFix, setMyFix] = useState<MyFix | null>(null);
  const [tracking, setTracking] = useState(false);
  const [locating, setLocating] = useState(false);

  function startLocating() {
    if (!navigator.geolocation || watchIdRef.current !== null) return;
    setLocating(true);
    setTracking(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const fix: MyFix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy ?? 30,
        };
        setMyFix(fix);
        setLocating(false);
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
    watchIdRef.current = null;
    setTracking(false);
    setLocating(false);
  }

  // FIX 1: Pause MapView's own watch while track recording is active
  // so only ONE GPS consumer exists at a time.
  useEffect(() => {
    if (isRecording) {
      // Pause own watch — blue dot is driven by recordingPosition prop
      stopLocating();
    } else {
      // Recording stopped — resume own watch
      startLocating();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  // Auto-start on mount (only when not recording, which is always true at mount)
  useEffect(() => {
    startLocating();
    return stopLocating;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Decide which fix to show on the map:
  // • While recording → use recordingPosition from App.tsx track watch
  // • Otherwise       → use MapView's own locate-me fix
  const displayFix: MyFix | null = isRecording && recordingPosition
    ? {
        lat: recordingPosition.lat,
        lng: recordingPosition.lng,
        accuracyMeters: recordingPosition.accuracyMeters ?? 10,
      }
    : myFix;

  // Pan map to first recording fix (same as locate-me auto-center)
  useEffect(() => {
    if (isRecording && recordingPosition && !centeredOnceRef.current && mapRef.current) {
      centeredOnceRef.current = true;
      mapRef.current.flyTo(
        [recordingPosition.lat, recordingPosition.lng],
        Math.max(mapRef.current.getZoom(), 16),
      );
    }
  }, [isRecording, recordingPosition]);

  // Reset centeredOnce when recording stops so next session re-centers
  useEffect(() => {
    if (!isRecording) centeredOnceRef.current = false;
  }, [isRecording]);

  const buttonActive = tracking || isRecording;
  const dotColor = isRecording ? '#e8541f' : '#2f8fe0';
  const ringColor = isRecording ? '#e8541f' : '#6fb1e8';

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
          attribution="Map data: OpenStreetMap contributors, SRTM | Map style: OpenTopoMap (CC-BY-SA)"
          maxZoom={17}
        />

        <ClickHandler onClick={onMapClick} />

        {storedLayers.map((layer) => (
          <GeoJSON key={layer.id} data={layer.geojson} />
        ))}

        {storedPoints.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]}>
            <Popup>
              <strong>{p.name}</strong>
              {p.note && <div>{p.note}</div>}
            </Popup>
          </Marker>
        ))}

        {storedDrawings.map((d) =>
          d.geometryType === 'polygon' ? (
            <Polygon
              key={d.id}
              positions={d.points.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: d.color, fillOpacity: 0.2, weight: 3 }}
            >
              <Popup>{d.name}</Popup>
            </Polygon>
          ) : (
            <Polyline
              key={d.id}
              positions={d.points.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: d.color, weight: 3 }}
            >
              <Popup>{d.name}</Popup>
            </Polyline>
          ),
        )}

        {/* Track line — grows incrementally, never rebuilt from scratch */}
        <LiveTrackPolyline trackPath={trackPath} />

        {/* "You are here" — colour shifts to orange while recording */}
        {displayFix && (
          <>
            <Circle
              center={[displayFix.lat, displayFix.lng]}
              radius={displayFix.accuracyMeters}
              pathOptions={{ color: ringColor, weight: 1, fillColor: ringColor, fillOpacity: 0.15 }}
            />
            <CircleMarker
              center={[displayFix.lat, displayFix.lng]}
              radius={8}
              pathOptions={{ color: '#ffffff', weight: 2, fillColor: dotColor, fillOpacity: 1 }}
            >
              <Popup>
                {isRecording ? 'Recording — ' : ''}
                You are here (&plusmn;{Math.round(displayFix.accuracyMeters)} m)
              </Popup>
            </CircleMarker>
          </>
        )}

        {/* In-progress tool geometry */}
        {activeTool === 'point' &&
          activeToolPoints.map((p, i) => (
            <CircleMarker key={i} center={[p.lat, p.lng]} radius={8}
              pathOptions={{ color: '#f2b657', weight: 2 }} />
          ))}

        {activeTool === 'draw' && activeToolPoints.length > 0 && (
          <>
            {drawGeometryType === 'polygon' ? (
              <Polygon
                positions={activeToolPoints.map((p) => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: drawColor, fillOpacity: 0.2, weight: 3, dashArray: '6 4' }}
              />
            ) : (
              <Polyline
                positions={activeToolPoints.map((p) => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: drawColor, weight: 3, dashArray: '6 4' }}
              />
            )}
            {activeToolPoints.map((p, i) => (
              <CircleMarker key={i} center={[p.lat, p.lng]} radius={5}
                pathOptions={{ color: drawColor, weight: 2 }} />
            ))}
          </>
        )}

        {activeTool === 'distance' && activeToolPoints.length > 0 && (
          <>
            <Polyline
              positions={activeToolPoints.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: '#f2b657', weight: 3, dashArray: '6 4' }}
            />
            {activeToolPoints.map((p, i) => (
              <Marker key={i} position={[p.lat, p.lng]}>
                <Popup>Point {i + 1}</Popup>
              </Marker>
            ))}
          </>
        )}

        {activeTool === 'area' && activeToolPoints.length > 0 && (
          <Polygon
            positions={activeToolPoints.map((p) => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: '#5fb87a', fillOpacity: 0.18, weight: 3 }}
          />
        )}
      </MapContainer>

      {/* ── Locate-me button ──────────────────────────────────────────────
          FIX 2: Moved from top:64 to bottom:160 so it sits above the HUD
          and ToolsPanel — near the "you are here" context, not lost at
          the top of the screen next to the menu bar.
          While recording is active the button turns orange and is
          disabled (the track watch IS the locate-me watch).
      ─────────────────────────────────────────────────────────────────── */}
      <style>{`
        @keyframes locate-btn-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
      <button
        onClick={() => { if (!isRecording) { if (tracking) stopLocating(); else startLocating(); } }}
        aria-label={buttonActive ? 'GPS active' : 'Show my position on map'}
        title={isRecording ? 'GPS active — recording in progress' : tracking ? 'Stop showing my position' : 'Show my current position'}
        style={{
          position: 'fixed',
          bottom: 160,       // FIX 2: was top:64 — now sits above HUD/ToolsPanel
          right: 14,
          zIndex: 1360,
          width: 44,
          height: 44,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: buttonActive ? 'var(--c-olive-600)' : 'var(--c-charcoal-900)',
          border: buttonActive ? '1px solid var(--c-amber-500)' : '1px solid var(--c-line-subtle)',
          boxShadow: '0 6px 16px rgba(0,0,0,0.4)',
          cursor: isRecording ? 'default' : 'pointer',
          opacity: 1,
        }}
      >
        <span
          style={{
            position: 'relative',
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: `2px solid ${buttonActive ? 'var(--c-amber-400)' : 'var(--c-paper-100)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: locating ? 'locate-btn-pulse 1s ease-in-out infinite' : undefined,
          }}
        >
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: buttonActive ? 'var(--c-amber-400)' : 'var(--c-paper-100)',
            }}
          />
        </span>
      </button>
    </>
  );
}
