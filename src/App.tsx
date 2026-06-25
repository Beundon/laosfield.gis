/**
 * App.tsx — GPS Track recording rewrite.
 *
 * Core architecture change for reliable track rendering:
 * -------------------------------------------------------
 * Previously: trackPoints were stored in React state, passed as a prop
 * to MapView → LiveTrackPolyline component which used useMap() context.
 * Problem: React re-renders triggered by isRecording/recordingPosition
 * state changes could cause the LiveTrackPolyline component to remount,
 * lose its polyline ref, and stop rendering — the line disappeared.
 *
 * Fix: The Leaflet polyline is now managed ENTIRELY outside React state.
 * - trackLayerRef holds the L.Polyline instance directly in App.tsx
 * - Each GPS fix calls polyline.addLatLng() imperatively — zero React
 *   re-render required for the line to grow on screen
 * - React state (trackPointsRef + trackCountState) is only used to
 *   drive the point-count display in the menu and the export functions
 * - The polyline is created once when recording starts, destroyed on stop
 * - No child component, no useMap(), no context race
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import L from 'leaflet';
import { useLaosBootSequence } from './hooks/useLaosBootSequence';
import BootSplash from './components/BootSplash';
import TopBar from './components/TopBar';
import FieldHud from './components/FieldHud';
import MapView from './components/MapView';
import ToolsPanel, { type ToolKind, type DrawGeometryType, DEFAULT_TOOL_COLOR } from './components/ToolsPanel';
import MenuDropdown from './components/MenuDropdown';
import MarkPointXY from './components/MarkPointXY';
import ImportPanel from './components/ImportPanel';
import DataPanel from './components/DataPanel';
import db from './storage/db';
import type { LatLng } from './core/measurementEngine';
import { measureLineDistance, measurePolygonArea, haversineDistanceMeters } from './core/measurementEngine';
import { exportTrackAsKml, exportTrackAsGpx, type TrackPoint } from './core/exportEngine';
import { formatIctIso8601 } from './core/timeEngine';
import './App.css';

/** Minimum metres between accepted GPS fixes — eliminates stationary jitter. */
const MIN_TRACK_DISTANCE_M = 2;

export default function App() {
  const { config, liveGps, gpsError } = useLaosBootSequence();
  const [showMenu, setShowMenu]   = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showData, setShowData]   = useState(false);
  const [showMarkPointXY, setShowMarkPointXY] = useState(false);

  const [activeTool, setActiveTool]     = useState<ToolKind>('none');
  const [toolPoints, setToolPoints]     = useState<LatLng[]>([]);
  const [drawGeometryType, setDrawGeometryType] = useState<DrawGeometryType>('line');
  const [activeColor, setActiveColor]   = useState(DEFAULT_TOOL_COLOR);
  const [formName, setFormName]         = useState('');
  const [formNote, setFormNote]         = useState('');

  // ── Track recording ─────────────────────────────────────────────────
  const [isRecording, setIsRecording]   = useState(false);
  const [trackCount, setTrackCount]     = useState(0);   // drives UI only
  const trackPointsRef  = useRef<TrackPoint[]>([]);       // never causes re-render
  const trackLayerRef   = useRef<L.Polyline | null>(null); // the actual Leaflet layer
  const positionDotRef  = useRef<L.CircleMarker | null>(null);
  const accuracyRingRef = useRef<L.Circle | null>(null);
  const recordWatchId   = useRef<number | null>(null);
  const mapInstanceRef  = useRef<L.Map | null>(null);     // shared map ref from MapView

  // Callback for MapView to share its Leaflet map instance with App
  const onMapReady = useCallback((map: L.Map) => {
    mapInstanceRef.current = map;
  }, []);

  const storedLayers   = useLiveQuery(() => db.layers.toArray(),   []) ?? [];
  const storedPoints   = useLiveQuery(() => db.points.toArray(),   []) ?? [];
  const storedDrawings = useLiveQuery(() => db.drawings.toArray(), []) ?? [];

  // ── Map click → tool ─────────────────────────────────────────────────
  const handleMapClick = useCallback((point: LatLng) => {
    if (activeTool === 'none') return;
    if (activeTool === 'point') { setToolPoints([point]); return; }
    setToolPoints((prev) => [...prev, point]);
  }, [activeTool]);

  function handleSelectTool(tool: ToolKind) {
    setActiveTool(tool); setToolPoints([]); setFormName(''); setFormNote('');
  }
  function handleUndo()  { setToolPoints((prev) => prev.slice(0, -1)); }
  function handleClear() { setToolPoints([]); }

  async function handleSaveTool() {
    const now = formatIctIso8601();
    if (activeTool === 'point' && toolPoints.length >= 1) {
      const p = toolPoints[0];
      await db.points.add({ name: formName.trim() || 'Point ' + now, lat: p.lat, lng: p.lng, elevationMeters: liveGps?.elevationMeters ?? null, note: formNote.trim(), createdAtIct: now });
    } else if (activeTool === 'draw' && toolPoints.length >= 2) {
      await db.drawings.add({ name: formName.trim() || 'Drawing ' + now, geometryType: drawGeometryType, points: toolPoints, color: activeColor, createdAtIct: now });
    } else if (activeTool === 'distance' && toolPoints.length >= 2) {
      const r = measureLineDistance(toolPoints);
      await db.measurements.add({ kind: 'distance', name: 'Distance ' + now, points: toolPoints, resultMeters: r.meters, color: activeColor, createdAtIct: now });
    } else if (activeTool === 'area' && toolPoints.length >= 3) {
      const r = measurePolygonArea(toolPoints);
      await db.measurements.add({ kind: 'area', name: 'Area ' + now, points: toolPoints, resultSquareMeters: r.squareMeters, color: activeColor, createdAtIct: now });
    }
    setToolPoints([]); setFormName(''); setFormNote(''); setActiveTool('none');
  }

  // ── Track recording core ─────────────────────────────────────────────
  function destroyTrackLayer() {
    if (trackLayerRef.current) { trackLayerRef.current.remove(); trackLayerRef.current = null; }
    if (positionDotRef.current) { positionDotRef.current.remove(); positionDotRef.current = null; }
    if (accuracyRingRef.current) { accuracyRingRef.current.remove(); accuracyRingRef.current = null; }
  }

  function updatePositionDot(lat: number, lng: number, accuracyM: number, color: string) {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Accuracy ring
    if (accuracyM > 0) {
      if (!accuracyRingRef.current) {
        accuracyRingRef.current = L.circle([lat, lng], {
          radius: accuracyM, color, weight: 1, fillColor: color, fillOpacity: 0.12,
        }).addTo(map);
      } else {
        accuracyRingRef.current.setLatLng([lat, lng]);
        accuracyRingRef.current.setRadius(accuracyM);
        accuracyRingRef.current.setStyle({ color, fillColor: color });
      }
    }

    // Position dot
    if (!positionDotRef.current) {
      positionDotRef.current = L.circleMarker([lat, lng], {
        radius: 9, color: '#fff', weight: 2.5, fillColor: color, fillOpacity: 1,
      }).addTo(map).bindPopup(`Recording\n${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    } else {
      positionDotRef.current.setLatLng([lat, lng]);
      positionDotRef.current.setStyle({ fillColor: color });
    }
  }

  async function toggleRecording() {
    if (isRecording) {
      // ── STOP ──────────────────────────────────────────────────────────
      if (recordWatchId.current !== null) {
        navigator.geolocation.clearWatch(recordWatchId.current);
        recordWatchId.current = null;
      }
      setIsRecording(false);

      const pts = trackPointsRef.current;
      if (pts.length > 1) {
        const result = measureLineDistance(pts);
        await db.tracks.add({
          name: 'Track ' + formatIctIso8601(),
          points: pts.map((p) => ({ lat: p.lat, lng: p.lng, elevationMeters: p.elevationMeters ?? null, timestamp: p.timestamp })),
          createdAtIct: formatIctIso8601(),
          distanceMeters: result.meters,
          color: activeColor,
        });
      }

      destroyTrackLayer();
      trackPointsRef.current = [];
      setTrackCount(0);
      return;
    }

    // ── START ────────────────────────────────────────────────────────────
    if (!navigator.geolocation) { alert('GPS not available in this browser.'); return; }

    trackPointsRef.current = [];
    setTrackCount(0);
    setIsRecording(true);
    destroyTrackLayer(); // clean slate

    const map = mapInstanceRef.current;

    // Create the polyline layer immediately — before any fixes arrive.
    // This guarantees it exists on the correct map instance.
    if (map) {
      trackLayerRef.current = L.polyline([], {
        color: activeColor,
        weight: 5,
        opacity: 0.95,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(map);
    }

    recordWatchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, altitude, accuracy } = pos.coords;

        const newPt: TrackPoint = {
          lat, lng,
          elevationMeters: altitude ?? null,
          timestamp: pos.timestamp,
        };

        const pts = trackPointsRef.current;

        // Distance gate: skip jitter < MIN_TRACK_DISTANCE_M
        if (pts.length > 0) {
          const last = pts[pts.length - 1];
          const dist = haversineDistanceMeters(
            { lat: last.lat, lng: last.lng },
            { lat: newPt.lat, lng: newPt.lng },
          );
          if (dist < MIN_TRACK_DISTANCE_M) return;
        }

        pts.push(newPt);
        setTrackCount(pts.length); // update UI counter

        // If trackLayerRef wasn't created yet (map wasn't ready at start),
        // create it now with the first valid fix.
        if (!trackLayerRef.current && mapInstanceRef.current) {
          trackLayerRef.current = L.polyline([[lat, lng]], {
            color: activeColor, weight: 5, opacity: 0.95, lineJoin: 'round', lineCap: 'round',
          }).addTo(mapInstanceRef.current);
        } else if (trackLayerRef.current) {
          // Extend the existing polyline with the new point — O(1), no rebuild
          trackLayerRef.current.addLatLng([lat, lng]);
        }

        // Update position dot and accuracy ring
        updatePositionDot(lat, lng, accuracy ?? 0, activeColor);

        // Pan map to keep current position visible (only if it would go off-screen)
        if (mapInstanceRef.current) {
          const mapBounds = mapInstanceRef.current.getBounds();
          const padding = 0.0002; // ~20m buffer
          if (!mapBounds.pad(-padding).contains([lat, lng])) {
            mapInstanceRef.current.panTo([lat, lng], { animate: true, duration: 1 });
          }
        }
      },
      (err) => {
        console.error('GPS error during track recording:', err.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,      // always a fresh hardware fix — critical for route tracking
        timeout: 15000,
      },
    );
  }

  // Update track line color live if user changes picker while recording
  useEffect(() => {
    if (trackLayerRef.current) trackLayerRef.current.setStyle({ color: activeColor });
    if (positionDotRef.current) positionDotRef.current.setStyle({ fillColor: activeColor });
    if (accuracyRingRef.current) accuracyRingRef.current.setStyle({ color: activeColor, fillColor: activeColor });
  }, [activeColor]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordWatchId.current !== null) navigator.geolocation.clearWatch(recordWatchId.current);
      destroyTrackLayer();
    };
  }, []);

  // ── Export ─────────────────────────────────────────────────────────────
  function handleExportTrack(format: 'kml' | 'gpx') {
    const pts = trackPointsRef.current;
    if (pts.length === 0) return;
    const name = 'track-' + formatIctIso8601().slice(0, 10);
    if (format === 'kml') exportTrackAsKml(name, pts);
    else exportTrackAsGpx(name, pts);
  }

  if (!config) return <BootSplash />;

  return (
    <div className="app-shell">
      <TopBar config={config} layerCount={storedLayers.length} isRecording={isRecording} onToggleMenu={() => setShowMenu((v) => !v)} />

      <MapView
        config={config}
        storedLayers={storedLayers.map((l) => ({ id: l.id!, geojson: l.geojson, name: l.name }))}
        storedPoints={storedPoints}
        storedDrawings={storedDrawings}
        activeTool={activeTool}
        activeToolPoints={toolPoints}
        drawGeometryType={drawGeometryType}
        activeColor={activeColor}
        onMapClick={handleMapClick}
        isRecording={isRecording}
        onMapReady={onMapReady}
      />

      <ToolsPanel
        activeTool={activeTool}
        points={toolPoints}
        drawGeometryType={drawGeometryType}
        activeColor={activeColor}
        formName={formName}
        formNote={formNote}
        onSelectTool={handleSelectTool}
        onSelectDrawGeometry={setDrawGeometryType}
        onColorChange={setActiveColor}
        onNameChange={setFormName}
        onNoteChange={setFormNote}
        onUndo={handleUndo}
        onClear={handleClear}
        onSave={handleSaveTool}
      />

      {showMenu && (
        <MenuDropdown
          activeTool={activeTool}
          isRecording={isRecording}
          trackPointCount={trackCount}
          onSelectTool={handleSelectTool}
          onMarkPointXY={() => setShowMarkPointXY(true)}
          onImport={() => setShowImport(true)}
          onLibrary={() => setShowData(true)}
          onToggleRecording={toggleRecording}
          onExportTrack={handleExportTrack}
          onClose={() => setShowMenu(false)}
        />
      )}

      {showMarkPointXY && <MarkPointXY liveGps={liveGps} onClose={() => setShowMarkPointXY(false)} />}
      {showImport && <ImportPanel onClose={() => setShowImport(false)} onLayerImported={() => {}} />}
      {showData && <DataPanel onClose={() => setShowData(false)} />}

      <FieldHud liveGps={liveGps} gpsError={gpsError} isIct={config.isIct} />
    </div>
  );
}
