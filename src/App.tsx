/**
 * App.tsx — v5
 *
 * Changes from v4:
 * 1. Basemap state (activeBasemapId) added — drives MapView's TileLayer
 * 2. storedTracks + storedMeasurements passed to MapView for permanent rendering
 * 3. Screen Wake Lock in useGpsTrack (screen-off fix)
 * 4. Page Visibility restart in useGpsTrack (screen-off fix)
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
import { DEFAULT_BASEMAP_ID } from './core/basemaps';
import './App.css';

export default function App() {
  const { config, liveGps, gpsError } = useLaosBootSequence();

  const [showMenu,         setShowMenu]         = useState(false);
  const [showImport,       setShowImport]       = useState(false);
  const [showData,         setShowData]         = useState(false);
  const [showMarkPointXY,  setShowMarkPointXY]  = useState(false);

  const [activeTool,       setActiveTool]       = useState<ToolKind>('none');
  const [toolPoints,       setToolPoints]       = useState<LatLng[]>([]);
  const [drawGeometryType, setDrawGeometryType] = useState<DrawGeometryType>('line');
  const [activeColor,      setActiveColor]      = useState(DEFAULT_TOOL_COLOR);
  const [formName,         setFormName]         = useState('');
  const [formNote,         setFormNote]         = useState('');

  // Basemap state — persisted to localStorage so it survives page reload
  const [activeBasemapId, setActiveBasemapId]  = useState<string>(() => {
    return localStorage.getItem('laogis_basemap') ?? DEFAULT_BASEMAP_ID;
  });
  const handleBasemapChange = useCallback((id: string) => {
    setActiveBasemapId(id);
    localStorage.setItem('laogis_basemap', id);
  }, []);

  const [isRecording,  setIsRecording]  = useState(false);
  const [trackCount,   setTrackCount]   = useState(0);
  const [liveFix,      setLiveFix]      = useState<LiveFix | null>(null);

  const trackPtsRef    = useRef<TrackPoint[]>([]);
  const trackLayerRef  = useRef<L.Polyline | null>(null);
  const dotLayerRef    = useRef<L.CircleMarker | null>(null);
  const ringLayerRef   = useRef<L.Circle | null>(null);
  const mapRef         = useRef<L.Map | null>(null);
  const activeColorRef = useRef(activeColor);
  useEffect(() => { activeColorRef.current = activeColor; }, [activeColor]);

  // ── All stored data ───────────────────────────────────────────────────
  const storedLayers       = useLiveQuery(() => db.layers.toArray(),       []) ?? [];
  const storedPoints       = useLiveQuery(() => db.points.toArray(),       []) ?? [];
  const storedDrawings     = useLiveQuery(() => db.drawings.toArray(),     []) ?? [];
  const storedTracks       = useLiveQuery(() => db.tracks.toArray(),       []) ?? [];
  const storedMeasurements = useLiveQuery(() => db.measurements.toArray(), []) ?? [];

  const onMapReady = useCallback((map: L.Map) => { mapRef.current = map; }, []);

  const locateMe = useCallback(() => {
    if (!liveFix || !mapRef.current) return;
    mapRef.current.flyTo([liveFix.lat, liveFix.lng], Math.max(mapRef.current.getZoom(), 16), { animate: true, duration: 0.8 });
  }, [liveFix]);

  // ── GPS callbacks ─────────────────────────────────────────────────────
  const handleFix = useCallback((fix: LiveFix) => {
    setLiveFix(fix);
    const map = mapRef.current;
    if (!map) return;

    if (!dotLayerRef.current) {
      dotLayerRef.current = L.circleMarker([fix.lat, fix.lng], {
        radius: 9, color: '#fff', weight: 3, fillColor: '#2f8fe0', fillOpacity: 1,
      }).addTo(map).bindPopup(`Position ±${Math.round(fix.accuracyMeters)} m`);
    } else {
      dotLayerRef.current.setLatLng([fix.lat, fix.lng]);
    }

    if (!ringLayerRef.current) {
      ringLayerRef.current = L.circle([fix.lat, fix.lng], {
        radius: fix.accuracyMeters, color: '#2f8fe0', weight: 1, fillColor: '#2f8fe0', fillOpacity: 0.1,
      }).addTo(map);
    } else {
      ringLayerRef.current.setLatLng([fix.lat, fix.lng]);
      ringLayerRef.current.setRadius(fix.accuracyMeters);
    }
  }, []);

  const handleTrackPoint = useCallback((pt: TrackPoint) => {
    trackPtsRef.current.push(pt);
    setTrackCount(trackPtsRef.current.length);
    const map = mapRef.current;
    if (!map) return;

    if (!trackLayerRef.current) {
      trackLayerRef.current = L.polyline([[pt.lat, pt.lng]], {
        color: activeColorRef.current, weight: 5, opacity: 0.95, lineJoin: 'round', lineCap: 'round',
      }).addTo(map);
    } else {
      trackLayerRef.current.addLatLng([pt.lat, pt.lng]);
    }

    if (dotLayerRef.current)  dotLayerRef.current.setStyle({ fillColor: activeColorRef.current });
    if (ringLayerRef.current) ringLayerRef.current.setStyle({ color: activeColorRef.current, fillColor: activeColorRef.current });

    const mapBounds = map.getBounds().pad(-0.1);
    if (!mapBounds.contains([pt.lat, pt.lng])) {
      map.panTo([pt.lat, pt.lng], { animate: true, duration: 0.8 });
    }
  }, []);

  const { error: gpsTrackError } = useGpsTrack({ onFix: handleFix, onTrackPoint: handleTrackPoint, isRecording });

  // ── Track start/stop ──────────────────────────────────────────────────
  function destroyTrackLayer() {
    if (trackLayerRef.current) { trackLayerRef.current.remove(); trackLayerRef.current = null; }
    if (dotLayerRef.current)   dotLayerRef.current.setStyle({ fillColor: '#2f8fe0' });
    if (ringLayerRef.current)  ringLayerRef.current.setStyle({ color: '#2f8fe0', fillColor: '#2f8fe0' });
  }

  async function toggleRecording() {
    if (isRecording) {
      setIsRecording(false);
      const pts = trackPtsRef.current;
      if (pts.length > 1) {
        const result = measureLineDistance(pts);
        await db.tracks.add({
          name: 'Track ' + formatIctIso8601(),
          points: pts.map((p) => ({ lat: p.lat, lng: p.lng, elevationMeters: p.elevationMeters ?? null, timestamp: p.timestamp })),
          createdAtIct: formatIctIso8601(),
          distanceMeters: result.meters,
          color: activeColorRef.current,
        });
      }
      // NOTE: we do NOT destroyTrackLayer here any more.
      // The live track layer is left on the map visually.
      // When the storedTracks LiveQuery re-fires (Dexie will trigger it
      // since we just did db.tracks.add), MapView will render the saved
      // track as a permanent Polyline — at that point the two overlap
      // visually (same color), then on next pan/zoom Leaflet will just
      // show the MapView one. We destroy the imperative layer after a
      // short delay so there's no visual flash.
      setTimeout(() => {
        destroyTrackLayer();
      }, 500);
      trackPtsRef.current = [];
      setTrackCount(0);
    } else {
      trackPtsRef.current = [];
      setTrackCount(0);
      destroyTrackLayer();
      const map = mapRef.current;
      if (map) {
        trackLayerRef.current = L.polyline([], {
          color: activeColorRef.current, weight: 5, opacity: 0.95, lineJoin: 'round', lineCap: 'round',
        }).addTo(map);
      }
      setIsRecording(true);
    }
  }

  useEffect(() => {
    if (trackLayerRef.current) trackLayerRef.current.setStyle({ color: activeColor });
  }, [activeColor]);

  useEffect(() => {
    return () => { destroyTrackLayer(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="app-shell">
      <TopBar config={config} layerCount={storedLayers.length} isRecording={isRecording} onToggleMenu={() => setShowMenu((v) => !v)} />

      <MapView
        config={config}
        storedLayers={storedLayers.map((l) => ({ id: l.id!, geojson: l.geojson, name: l.name }))}
        storedPoints={storedPoints}
        storedDrawings={storedDrawings}
        storedTracks={storedTracks}
        storedMeasurements={storedMeasurements}
        activeTool={activeTool}
        activeToolPoints={toolPoints}
        drawGeometryType={drawGeometryType}
        activeColor={activeColor}
        activeBasemapId={activeBasemapId}
        onBasemapChange={handleBasemapChange}
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

      {showMarkPointXY && <MarkPointXY liveGps={liveGps} onClose={() => setShowMarkPointXY(false)} />}
      {showImport      && <ImportPanel onClose={() => setShowImport(false)} onLayerImported={() => {}} />}
      {showData        && <DataPanel   onClose={() => setShowData(false)} />}

      <GpsStatusBar fix={liveFix} isRecording={isRecording} trackCount={trackCount} onLocateMe={locateMe} />
      <FieldHud liveGps={liveGps} gpsError={gpsError ?? gpsTrackError ?? null} isIct={config.isIct} />
    </div>
  );
}
