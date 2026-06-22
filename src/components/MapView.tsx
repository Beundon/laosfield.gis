/**
 * MapView.tsx
 * -----------------------------------------------------------------------
 * Core map surface. Forces OpenTopoMap as the default basemap (spec
 * requires a free contour-line topo layer), centers/locks on Laos per
 * the resolved AppRegionConfig, and renders imported layers, saved
 * points/drawings/tracks, and in-progress tool geometry.
 *
 * Also owns a fully self-contained "locate me" feature: a button that
 * finds the device's current GPS position, flies the map to it, and
 * keeps a live "you are standing here" marker + accuracy ring on screen
 * while tracking is on. This runs its own geolocation watch independent
 * of anything in App.tsx, so it's a one-file addition.
 * -----------------------------------------------------------------------
 */
import { MapContainer, TileLayer, Polyline, Polygon, GeoJSON, useMapEvents, useMap, Marker, Popup, CircleMarker, Circle } from 'react-leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { FeatureCollection } from 'geojson';
import { LAOS_BBOX } from '../core/laosGeo';
import type { AppRegionConfig } from '../core/bootDetection';
import type { LatLng } from '../core/measurementEngine';
import type { StoredPoint, StoredDrawing } from '../storage/db';
import type { ToolKind, DrawGeometryType } from './ToolsPanel';

// Leaflet's default marker icons reference image paths that don't survive
// bundling; point them at the CDN-hosted assets explicitly.
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
}

interface MyFix {
  lat: number;
  lng: number;
  accuracyMeters: number;
}

function ClickHandler({ onClick }: { onClick: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

/**
 * LiveTrackPolyline: renders a GPS track that grows in real time.
 *
 * react-leaflet's <Polyline> re-creates the Leaflet layer on every
 * positions-prop change, which flickers and sometimes drops points when
 * the array grows fast (e.g. every 1-2 s from watchPosition).
 * This component holds a stable Leaflet Polyline layer and calls
 * layer.addLatLng() for every new point — no flicker, no missed fixes.
 */
function LiveTrackPolyline({ trackPath }: { trackPath: LatLng[] }) {
  const map = useMap();
  const polyRef = useRef<L.Polyline | null>(null);
  const prevLenRef = useRef(0);

  useEffect(() => {
    if (!polyRef.current) {
      polyRef.current = L.polyline([], { color: '#e8541f', weight: 3 }).addTo(map);
    }

    const poly = polyRef.current;
    const prev = prevLenRef.current;

    if (trackPath.length === 0) {
      // Track was cleared/stopped — reset the layer
      poly.setLatLngs([]);
      prevLenRef.current = 0;
      return;
    }

    if (trackPath.length < prev) {
      // Rare: track was reset — rebuild from scratch
      poly.setLatLngs(trackPath.map((p) => [p.lat, p.lng]));
      prevLenRef.current = trackPath.length;
      return;
    }

    // Normal case: append only the new points since last render
    for (let i = prev; i < trackPath.length; i++) {
      poly.addLatLng([trackPath[i].lat, trackPath[i].lng]);
    }
    prevLenRef.current = trackPath.length;
  }, [map, trackPath]);

  // Clean up Leaflet layer on unmount
  useEffect(() => {
    return () => {
      if (polyRef.current) {
        polyRef.current.remove();
        polyRef.current = null;
      }
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
}: MapViewProps) {
  const laosBounds = useMemo<L.LatLngBoundsExpression>(
    () => [
      [LAOS_BBOX.minLat, LAOS_BBOX.minLon],
      [LAOS_BBOX.maxLat, LAOS_BBOX.maxLon],
    ],
    [],
  );

  // --- Locate me: show where I'm currently standing on the map -------
  // Auto-starts on every app open/refresh (see effect below), and can
  // still be toggled on/off manually with the button.
  const mapRef = useRef<L.Map | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const centeredOnceRef = useRef(false);
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
      () => {
        setLocating(false);
        setTracking(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
  }

  function stopLocating() {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    setTracking(false);
    setLocating(false);
  }

  function toggleLocate() {
    if (tracking) stopLocating();
    else startLocating();
  }

  // Auto-start the moment the app opens/refreshes -- shows current
  // position status right away with no manual button tap required.
  useEffect(() => {
    startLocating();
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ---------------------------------------------------------------------

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

        {/* Persisted markers from the Point tool */}
        {storedPoints.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]}>
            <Popup>
              <strong>{p.name}</strong>
              {p.note && <div>{p.note}</div>}
            </Popup>
          </Marker>
        ))}

        {/* Persisted shapes from the Draw tool */}
        {storedDrawings.map((d) =>
          d.geometryType === 'polygon' ? (
            <Polygon
              key={d.id}
              positions={d.points.map((p) => [p.lat, p.lng])}
              pathOptions={{ color: d.color, fillOpacity: 0.2, weight: 3 }}
            >
              <Popup>{d.name}</Popup>
            </Polygon>
          ) : (
            <Polyline
              key={d.id}
              positions={d.points.map((p) => [p.lat, p.lng])}
              pathOptions={{ color: d.color, weight: 3 }}
            >
              <Popup>{d.name}</Popup>
            </Polyline>
          ),
        )}

        {/* Saved + live track path — uses imperative addLatLng for flicker-free real-time tracking */}
        <LiveTrackPolyline trackPath={trackPath} />

        {/* In-progress tool geometry */}
        {activeTool === 'point' &&
          activeToolPoints.map((p, i) => (
            <CircleMarker key={i} center={[p.lat, p.lng]} radius={8} pathOptions={{ color: '#f2b657', weight: 2 }} />
          ))}

        {activeTool === 'draw' && activeToolPoints.length > 0 && (
          <>
            {drawGeometryType === 'polygon' ? (
              <Polygon
                positions={activeToolPoints.map((p) => [p.lat, p.lng])}
                pathOptions={{ color: drawColor, fillOpacity: 0.2, weight: 3, dashArray: '6 4' }}
              />
            ) : (
              <Polyline
                positions={activeToolPoints.map((p) => [p.lat, p.lng])}
                pathOptions={{ color: drawColor, weight: 3, dashArray: '6 4' }}
              />
            )}
            {activeToolPoints.map((p, i) => (
              <CircleMarker key={i} center={[p.lat, p.lng]} radius={5} pathOptions={{ color: drawColor, weight: 2 }} />
            ))}
          </>
        )}

        {activeTool === 'distance' && activeToolPoints.length > 0 && (
          <>
            <Polyline
              positions={activeToolPoints.map((p) => [p.lat, p.lng])}
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
            positions={activeToolPoints.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: '#5fb87a', fillOpacity: 0.18, weight: 3 }}
          />
        )}

        {/* "You are standing here" — live position + accuracy ring */}
        {myFix && (
          <>
            <Circle
              center={[myFix.lat, myFix.lng]}
              radius={myFix.accuracyMeters}
              pathOptions={{ color: '#6fb1e8', weight: 1, fillColor: '#6fb1e8', fillOpacity: 0.15 }}
            />
            <CircleMarker
              center={[myFix.lat, myFix.lng]}
              radius={7}
              pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#2f8fe0', fillOpacity: 1 }}
            >
              <Popup>You are standing here (+/- {Math.round(myFix.accuracyMeters)} m)</Popup>
            </CircleMarker>
          </>
        )}
      </MapContainer>

      {/* Locate-me button — fixed in the empty top-right slot below the top bar */}
      <style>{`
        @keyframes locate-btn-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
      <button
        onClick={toggleLocate}
        aria-label={tracking ? 'Stop showing my position' : 'Show my current position on the map'}
        title={tracking ? 'Stop showing my position' : 'Show my current position on the map'}
        style={{
          position: 'fixed',
          top: 64,
          right: 14,
          zIndex: 1360,
          width: 44,
          height: 44,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: tracking ? 'var(--c-olive-600)' : 'var(--c-charcoal-900)',
          border: tracking ? '1px solid var(--c-amber-500)' : '1px solid var(--c-line-subtle)',
          boxShadow: '0 6px 16px rgba(0, 0, 0, 0.4)',
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            position: 'relative',
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: `2px solid ${tracking ? 'var(--c-amber-400)' : 'var(--c-paper-100)'}`,
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
              background: tracking ? 'var(--c-amber-400)' : 'var(--c-paper-100)',
            }}
          />
        </span>
      </button>
    </>
  );
}
