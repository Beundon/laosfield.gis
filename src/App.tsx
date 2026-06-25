/**
 * App.tsx
 *
 * GPS architecture — rebuilt for Garmin-grade tracking accuracy:
 * ----------------------------------------------------------------
 * Root cause of the straight-line bug: MapView.tsx auto-started its own
 * navigator.geolocation.watchPosition for the "locate me" dot. When
 * recording started, App.tsx opened a SECOND watch. Android Chrome and
 * iOS Safari interleave callbacks between both consumers — track
 * recording received only 1 fix per ~30 s instead of every 1–3 s.
 * Two GPS points = one straight line, regardless of route taken.
 *
 * Fix: ONE watchPosition, started once, never stopped while the app is
 * open. Managed entirely in the useGpsTrack hook. This mirrors how
 * Garmin GPSMAP 64 hardware works — the GNSS chip runs continuously
 * at its native rate; the track logger and the "current position" display
 * both read from the same position stream, never from separate requests.
 *
 * Quality filtering (Garmin-equivalent):
 *   - Accuracy gate: reject fixes >25 m horizontal error (Garmin's
 *     equivalent of requiring ≥3 satellite bars before recording)
 *   - Speed gate: reject fixes implying >250 km/h movement between
 *     consecutive fixes (cell-tower interpolation artefacts)
 *   - Distance gate: minimum 2 m movement between stored track points
 *     (eliminates stationary jitter clusters)
 *
 * Track rendering: the Leaflet polyline is managed imperatively via
 * a direct L.Map ref — never via React state or re-renders, so every
 * GPS fix extends the line immediately with zero frame delay.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import L from 'leaflet';
import { useGpsTrack, type LiveFix } from './hooks/useGpsTrack';
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
import GpsStatusBar from './components/GpsStatusBar';
import db from './storage/db';
import type { LatLng } from './core/measurementEngine';
import { measureLineDistance, measurePolygonArea } from './core/measurementEngine';
import { exportTrackAsKml, exportTrackAsGpx, type TrackPoint } from './core/exportEngine';
import { formatIctIso8601 } from './core/timeEngine';
import './App.css';

export default function App() {
  const { config, liveGps, gpsError } = useLaosBootSequence();

  // ── UI panels ────────────────────────────────────────────────────────
  const [showMenu,       setShowMenu]       = useState(false);
  const [showImport,     setShowImport]     = useState(false);
  const [showData,       setShowData]       = useState(false);
  const [showMarkPointXY, setShowMarkPointXY] = useState(false);

  // ── Tool state ───────────────────────────────────────────────────────
  const [activeTool,       setActiveTool]       = useState<ToolKind>('none');
  const [toolPoints,       setToolPoints]       = useState<LatLng[]>([]);
  const [drawGeometryType, setDrawGeometryType] = useState<DrawGeometryType>('line');
  const [activeColor,      setActiveColor]      = useState(DEFAULT_TOOL_COLOR);
  const [formName,         setFormName]         = useState('');
  const [formNote,         setFormNote]         = useState('');

  // ── Track recording state ────────────────────────────────────────────
  const [isRecording,  setIsRecording]  = useState(false);
  const [trackCount,   setTrackCount]   = useState(0);
  const [liveFix,      setLiveFix]      = useState<LiveFix | null>(null);

  // Refs: never trigger re-renders, used by GPS callbacks
  const trackPtsRef     = useRef<TrackPoint[]>([]);
  const trackLayerRef   = useRef<L.Polyline | null>(null);
  const dotLayerRef     = useRef<L.CircleMarker | null>(null);
  const ringLayerRef    = useRef<L.Circle | null>(null);
  const mapRef          = useRef<L.Map | null>(null);
  const activeColorRef  = useRef(activeColor);
  useEffect(() => { activeColorRef.current = activeColor; }, [activeColor]);

  // ── Stored data ──────────────────────────────────────────────────────
  const storedLayers   = useLiveQuery(() => db.layers.toArray(),   []) ?? [];
  const storedPoints   = useLiveQuery(() => db.points.toArray(),   []) ?? [];
  const storedDrawings = useLiveQuery(() => db.drawings.toArray(), []) ?? [];

  // ── Map ready callback ───────────────────────────────────────────────
  const onMapReady = useCallback((map: L.Map) => {
    mapRef.current = map;
  }, []);


  // Locate-me: pan to current fix
  const locateMe = useCallback(() => {
    if (!liveFix || !mapRef.current) return;
    mapRef.current.flyTo([liveFix.lat, liveFix.lng], Math.max(mapRef.current.getZoom(), 16), { animate: true, duration: 0.8 });
  }, [liveFix]);

  // ── GPS hook — single watch, runs the whole app lifetime ─────────────
  const handleFix = useCallback((fix: LiveFix) => {
    setLiveFix(fix);

    // Update "you are here" dot imperatively (no re-render)
    const map = mapRef.current;
    if (!map) return;

    if (!dotLayerRef.current) {
      dotLayerRef.current = L.circleMarker([fix.lat, fix.lng], {
        radius: 9, color: '#fff', weight: 3,
        fillColor: '#2f8fe0', fillOpacity: 1,
        className: 'gps-dot',
      }).addTo(map).bindPopup(`Position ±${Math.round(fix.accuracyMeters)} m`);
    } else {
      dotLayerRef.current.setLatLng([fix.lat, fix.lng]);
    }

    if (!ringLayerRef.current) {
      ringLayerRef.current = L.circle([fix.lat, fix.lng], {
        radius: fix.accuracyMeters,
        color: '#2f8fe0', weight: 1,
        fillColor: '#2f8fe0', fillOpacity: 0.1,
      }).addTo(map);
    } else {
      ringLayerRef.current.setLatLng([fix.lat, fix.lng]);
      ringLayerRef.current.setRadius(fix.accuracyMeters);
    }
  }, []);

  const handleTrackPoint = useCallback((pt: TrackPoint) => {
    trackPtsRef.current.push(pt);
    const count = trackPtsRef.current.length;
    setTrackCount(count);

    const map = mapRef.current;
    if (!map) return;

    // Create the polyline layer if it doesn't exist yet
    if (!trackLayerRef.current) {
      trackLayerRef.current = L.polyline([[pt.lat, pt.lng]], {
        color: activeColorRef.current,
        weight: 5, opacity: 0.95,
        lineJoin: 'round', lineCap: 'round',
      }).addTo(map);
    } else {
      // O(1) incremental extension — the key to smooth real-time tracking
      trackLayerRef.current.addLatLng([pt.lat, pt.lng]);
    }

    // Change dot color to track color while recording
    if (dotLayerRef.current) {
      dotLayerRef.current.setStyle({ fillColor: activeColorRef.current });
    }
    if (ringLayerRef.current) {
      ringLayerRef.current.setStyle({ color: activeColorRef.current, fillColor: activeColorRef.current });
    }

    // Auto-pan to keep position visible without jarring the user
    const mapBounds = map.getBounds().pad(-0.1);
    if (!mapBounds.contains([pt.lat, pt.lng])) {
      map.panTo([pt.lat, pt.lng], { animate: true, duration: 0.8 });
    }
  }, []);

  const { error: gpsTrackError } = useGpsTrack({
    onFix: handleFix,
    onTrackPoint: handleTrackPoint,
    isRecording,
  });

  // ── Track start/stop ─────────────────────────────────────────────────
  function destroyTrackLayer() {
    if (trackLayerRef.current) { trackLayerRef.current.remove(); trackLayerRef.current = null; }
    // Restore dot to blue (not recording color)
    if (dotLayerRef.current) dotLayerRef.current.setStyle({ fillColor: '#2f8fe0' });
    if (ringLayerRef.current) ringLayerRef.current.setStyle({ color: '#2f8fe0', fillColor: '#2f8fe0' });
  }

  async function toggleRecording() {
    if (isRecording) {
      // ── STOP ──────────────────────────────────────────────────────────
      setIsRecording(false);

      const pts = trackPtsRef.current;
      if (pts.length > 1) {
        const result = measureLineDistance(pts);
        await db.tracks.add({
          name: 'Track ' + formatIctIso8601(),
          points: pts.map((p) => ({
            lat: p.lat, lng: p.lng,
            elevationMeters: p.elevationMeters ?? null,
            timestamp: p.timestamp,
          })),
          createdAtIct: formatIctIso8601(),
          distanceMeters: result.meters,
          color: activeColorRef.current,
        });
      }

      destroyTrackLayer();
      trackPtsRef.current = [];
      setTrackCount(0);

    } else {
      // ── START ─────────────────────────────────────────────────────────
      trackPtsRef.current = [];
      setTrackCount(0);
      destroyTrackLayer(); // clean slate

      // Pre-create the polyline if map is already ready
      const map = mapRef.current;
      if (map) {
        trackLayerRef.current = L.polyline([], {
          color: activeColorRef.current,
          weight: 5, opacity: 0.95,
          lineJoin: 'round', lineCap: 'round',
        }).addTo(map);
      }

      setIsRecording(true);
    }
  }

  // Update track color live if user changes picker while recording
  useEffect(() => {
    if (trackLayerRef.current)  trackLayerRef.current.setStyle({ color: activeColor });
  }, [activeColor]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { destroyTrackLayer(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Export ────────────────────────────────────────────────────────────
  function handleExportTrack(format: 'kml' | 'gpx') {
    const pts = trackPtsRef.current;
    if (pts.length === 0) return;
    const name = 'track-' + formatIctIso8601().slice(0, 10);
    if (format === 'kml') exportTrackAsKml(name, pts);
    else exportTrackAsGpx(name, pts);
  }

  // ── Tool handlers ─────────────────────────────────────────────────────
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

  if (!config) return <BootSplash />;

  // Compose GPS error for HUD from both sources
  const combinedGpsError = gpsError ?? gpsTrackError ?? null;

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
        onMapReady={onMapReady}
      />

      <ToolsPanel
        activeTool={activeTool} points={toolPoints}
        drawGeometryType={drawGeometryType} activeColor={activeColor}
        formName={formName} formNote={formNote}
        onSelectTool={handleSelectTool} onSelectDrawGeometry={setDrawGeometryType}
        onColorChange={setActiveColor} onNameChange={setFormName}
        onNoteChange={setFormNote} onUndo={handleUndo}
        onClear={handleClear} onSave={handleSaveTool}
      />

      {showMenu && (
        <MenuDropdown
          activeTool={activeTool} isRecording={isRecording}
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

      {showMarkPointXY  && <MarkPointXY liveGps={liveGps} onClose={() => setShowMarkPointXY(false)} />}
      {showImport       && <ImportPanel onClose={() => setShowImport(false)} onLayerImported={() => {}} />}
      {showData         && <DataPanel   onClose={() => setShowData(false)} />}

      <GpsStatusBar fix={liveFix} isRecording={isRecording} trackCount={trackCount} onLocateMe={locateMe} />

      <FieldHud liveGps={liveGps} gpsError={combinedGpsError} isIct={config.isIct} />
    </div>
  );
}
