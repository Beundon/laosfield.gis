/**
 * App.tsx
 * -----------------------------------------------------------------------
 * Top-level wiring: runs the boot detection sequence, then renders the
 * map, HUD, top bar, tool panel, and data library once a region config
 * is resolved.
 *
 * Every tool (Point, Draw, Distance, Area, track recording) writes
 * straight into Dexie/IndexedDB so the Data library (DataPanel) always
 * reflects the latest state with no extra wiring beyond useLiveQuery.
 * -----------------------------------------------------------------------
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLaosBootSequence } from './hooks/useLaosBootSequence';
import BootSplash from './components/BootSplash';
import TopBar from './components/TopBar';
import FieldHud from './components/FieldHud';
import MapView from './components/MapView';
import ToolsPanel, { type ToolKind, type DrawGeometryType } from './components/ToolsPanel';
import ImportPanel from './components/ImportPanel';
import DataPanel from './components/DataPanel';
import db from './storage/db';
import type { LatLng } from './core/measurementEngine';
import { measureLineDistance, measurePolygonArea } from './core/measurementEngine';
import { exportTrackAsKml, exportTrackAsGpx, type TrackPoint } from './core/exportEngine';
import { formatIctIso8601 } from './core/timeEngine';
import './App.css';

export default function App() {
  const { config, liveGps, gpsError } = useLaosBootSequence();
  const [showImport, setShowImport] = useState(false);
  const [showData, setShowData] = useState(false);

  const [activeTool, setActiveTool] = useState<ToolKind>('none');
  const [toolPoints, setToolPoints] = useState<LatLng[]>([]);
  const [drawGeometryType, setDrawGeometryType] = useState<DrawGeometryType>('line');
  const [drawColor, setDrawColor] = useState('#e8a33d');
  const [formName, setFormName] = useState('');
  const [formNote, setFormNote] = useState('');

  const [isRecording, setIsRecording] = useState(false);
  const [trackPoints, setTrackPoints] = useState<TrackPoint[]>([]);
  const recordWatchId = useRef<number | null>(null);

  const storedLayers = useLiveQuery(() => db.layers.toArray(), []) ?? [];
  const storedPoints = useLiveQuery(() => db.points.toArray(), []) ?? [];
  const storedDrawings = useLiveQuery(() => db.drawings.toArray(), []) ?? [];

  const handleMapClick = useCallback(
    (point: LatLng) => {
      if (activeTool === 'none') return;
      // Point tool only ever holds a single in-progress location.
      if (activeTool === 'point') {
        setToolPoints([point]);
        return;
      }
      setToolPoints((prev) => [...prev, point]);
    },
    [activeTool],
  );

  function handleSelectTool(tool: ToolKind) {
    setActiveTool(tool);
    setToolPoints([]);
    setFormName('');
    setFormNote('');
  }

  function handleUndo() {
    setToolPoints((prev) => prev.slice(0, -1));
  }

  function handleClear() {
    setToolPoints([]);
  }

  async function handleSaveTool() {
    const now = formatIctIso8601();

    if (activeTool === 'point' && toolPoints.length >= 1) {
      const p = toolPoints[0];
      await db.points.add({
        name: formName.trim() || 'Point ' + now,
        lat: p.lat,
        lng: p.lng,
        elevationMeters: liveGps?.elevationMeters ?? null,
        note: formNote.trim(),
        createdAtIct: now,
      });
    } else if (activeTool === 'draw' && toolPoints.length >= 2) {
      await db.drawings.add({
        name: formName.trim() || 'Drawing ' + now,
        geometryType: drawGeometryType,
        points: toolPoints,
        color: drawColor,
        createdAtIct: now,
      });
    } else if (activeTool === 'distance' && toolPoints.length >= 2) {
      const result = measureLineDistance(toolPoints);
      await db.measurements.add({
        kind: 'distance',
        name: 'Distance ' + now,
        points: toolPoints,
        resultMeters: result.meters,
        createdAtIct: now,
      });
    } else if (activeTool === 'area' && toolPoints.length >= 3) {
      const result = measurePolygonArea(toolPoints);
      await db.measurements.add({
        kind: 'area',
        name: 'Area ' + now,
        points: toolPoints,
        resultSquareMeters: result.squareMeters,
        createdAtIct: now,
      });
    }

    setToolPoints([]);
    setFormName('');
    setFormNote('');
    setActiveTool('none');
  }

  async function toggleRecording() {
    if (isRecording) {
      if (recordWatchId.current !== null) {
        navigator.geolocation.clearWatch(recordWatchId.current);
        recordWatchId.current = null;
      }
      setIsRecording(false);

      // Persist the finished track to the library so it shows up under
      // Data > Tracks (and can be re-exported later in any format).
      if (trackPoints.length > 1) {
        const result = measureLineDistance(trackPoints);
        await db.tracks.add({
          name: 'Track ' + formatIctIso8601(),
          points: trackPoints.map((p) => ({
            lat: p.lat,
            lng: p.lng,
            elevationMeters: p.elevationMeters ?? null,
            timestamp: p.timestamp,
          })),
          createdAtIct: formatIctIso8601(),
          distanceMeters: result.meters,
        });
      }
      return;
    }
    setTrackPoints([]);
    setIsRecording(true);
    recordWatchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setTrackPoints((prev) => [
          ...prev,
          {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            elevationMeters: pos.coords.altitude ?? null,
            timestamp: pos.timestamp,
          },
        ]);
      },
      () => {
        /* track recording continues; HUD already surfaces GPS errors */
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
  }

  useEffect(() => {
    return () => {
      if (recordWatchId.current !== null) {
        navigator.geolocation.clearWatch(recordWatchId.current);
      }
    };
  }, []);

  function handleExportTrack(format: 'kml' | 'gpx') {
    if (trackPoints.length === 0) return;
    const name = 'track-' + formatIctIso8601().slice(0, 10);
    if (format === 'kml') exportTrackAsKml(name, trackPoints);
    else exportTrackAsGpx(name, trackPoints);
  }

  if (!config) {
    return <BootSplash />;
  }

  return (
    <div className="app-shell">
      <TopBar
        config={config}
        layerCount={storedLayers.length}
        isRecording={isRecording}
        trackPointCount={trackPoints.length}
        onToggleImport={() => setShowImport((v) => !v)}
        onToggleData={() => setShowData((v) => !v)}
        onToggleRecording={toggleRecording}
        onExportTrack={handleExportTrack}
      />

      <MapView
        config={config}
        storedLayers={storedLayers.map((l) => ({ id: l.id!, geojson: l.geojson, name: l.name }))}
        storedPoints={storedPoints}
        storedDrawings={storedDrawings}
        activeTool={activeTool}
        activeToolPoints={toolPoints}
        drawGeometryType={drawGeometryType}
        drawColor={drawColor}
        onMapClick={handleMapClick}
        trackPath={trackPoints.map((p) => ({ lat: p.lat, lng: p.lng }))}
      />

      <ToolsPanel
        activeTool={activeTool}
        points={toolPoints}
        drawGeometryType={drawGeometryType}
        drawColor={drawColor}
        formName={formName}
        formNote={formNote}
        onSelectTool={handleSelectTool}
        onSelectDrawGeometry={setDrawGeometryType}
        onColorChange={setDrawColor}
        onNameChange={setFormName}
        onNoteChange={setFormNote}
        onUndo={handleUndo}
        onClear={handleClear}
        onSave={handleSaveTool}
      />

      {showImport && (
        <ImportPanel onClose={() => setShowImport(false)} onLayerImported={() => {}} />
      )}

      {showData && <DataPanel onClose={() => setShowData(false)} />}

      <FieldHud liveGps={liveGps} gpsError={gpsError} isIct={config.isIct} />
    </div>
  );
}
