/**
 * ToolsPanel.tsx
 * -----------------------------------------------------------------------
 * Controls for all tap-on-map tools: Point, Draw, Distance, Area.
 *
 * COLOR CHANGE: All geometry tools (Draw, Distance, Area) now share the
 * same 3-color picker (Red / Blue / Orange). Default is Red (#d9534f).
 * The chosen color is passed up via onColorChange and used both for the
 * live preview on the map AND stored in the DB on save so it persists
 * in the Data library and when re-exported.
 *
 * Track recording uses the same activeColor from App.tsx state — the
 * color picker shown here while tool='none' still applies if you change
 * it before starting a recording. (The picker is always visible in the
 * track-recording banner in MenuDropdown, handled in App.tsx.)
 * -----------------------------------------------------------------------
 */
import { measureLineDistance, measurePolygonArea, formatDistance, formatArea } from '../core/measurementEngine';
import type { LatLng } from '../core/measurementEngine';
import './ToolsPanel.css';

export type ToolKind = 'none' | 'point' | 'draw' | 'distance' | 'area';
export type DrawGeometryType = 'line' | 'polygon';

/** The 3 user-selectable colors — same set for Draw, Distance, Area, and Track. */
export const TOOL_COLORS: { hex: string; label: string }[] = [
  { hex: '#d9534f', label: 'Red' },
  { hex: '#2f8fe0', label: 'Blue' },
  { hex: '#e8541f', label: 'Orange' },
];

/** Default color for every new tool session and new recording. */
export const DEFAULT_TOOL_COLOR = '#d9534f';

interface ToolsPanelProps {
  activeTool: ToolKind;
  points: LatLng[];
  drawGeometryType: DrawGeometryType;
  activeColor: string;           // shared across ALL tools (draw, distance, area, track)
  formName: string;
  formNote: string;
  onSelectTool: (tool: ToolKind) => void;
  onSelectDrawGeometry: (g: DrawGeometryType) => void;
  onColorChange: (c: string) => void;
  onNameChange: (n: string) => void;
  onNoteChange: (n: string) => void;
  onUndo: () => void;
  onClear: () => void;
  onSave: () => void;
}

export default function ToolsPanel({
  activeTool,
  points,
  drawGeometryType,
  activeColor,
  formName,
  formNote,
  onSelectTool,
  onSelectDrawGeometry,
  onColorChange,
  onNameChange,
  onNoteChange,
  onUndo,
  onClear,
  onSave,
}: ToolsPanelProps) {
  const distanceResult = activeTool === 'distance' ? measureLineDistance(points) : null;
  const areaResult = activeTool === 'area' ? measurePolygonArea(points) : null;
  const drawResult =
    activeTool === 'draw' && drawGeometryType === 'line' ? measureLineDistance(points) : null;

  const minPointsToSave =
    activeTool === 'point' ? 1 : activeTool === 'draw' && drawGeometryType === 'polygon' ? 3 : 2;
  const canSave = activeTool !== 'none' && points.length >= minPointsToSave;

  if (activeTool === 'none') return null;

  const TITLES: Record<Exclude<ToolKind, 'none'>, string> = {
    point: 'Mark point',
    draw: 'Draw',
    distance: 'Distance',
    area: 'Area',
  };

  // Color picker is shown for Draw, Distance, and Area (not Point)
  const showColorPicker = activeTool === 'draw' || activeTool === 'distance' || activeTool === 'area';

  return (
    <div className="tools-panel">
      <div className="tools-panel__readout">
        <div className="tools-panel__title-row">
          <span className="tools-panel__title">{TITLES[activeTool]}</span>
          <button className="tools-panel__cancel" onClick={() => onSelectTool('none')} aria-label="Cancel tool">
            ✕
          </button>
        </div>

        {/* Draw sub-type: Line / Polygon */}
        {activeTool === 'draw' && (
          <div className="tools-panel__row">
            <button
              className={'subtool-btn ' + (drawGeometryType === 'line' ? 'subtool-btn--active' : '')}
              onClick={() => onSelectDrawGeometry('line')}
            >
              Line
            </button>
            <button
              className={'subtool-btn ' + (drawGeometryType === 'polygon' ? 'subtool-btn--active' : '')}
              onClick={() => onSelectDrawGeometry('polygon')}
            >
              Polygon
            </button>
          </div>
        )}

        {/* Live measurement readouts */}
        {activeTool === 'distance' && distanceResult && (
          <div className="tools-panel__value" style={{ color: activeColor }}>
            {formatDistance(distanceResult.meters)}
            <span className="tools-panel__value-alt">({distanceResult.kilometers.toFixed(3)} km)</span>
          </div>
        )}
        {activeTool === 'area' && areaResult && (
          <div className="tools-panel__value" style={{ color: activeColor }}>
            {formatArea(areaResult.squareMeters)}
          </div>
        )}
        {activeTool === 'draw' && drawGeometryType === 'line' && drawResult && (
          <div className="tools-panel__value" style={{ color: activeColor }}>
            {formatDistance(drawResult.meters)}
            <span className="tools-panel__value-alt">({drawResult.kilometers.toFixed(3)} km)</span>
          </div>
        )}

        {/* Name / note inputs for Point and Draw */}
        {(activeTool === 'point' || activeTool === 'draw') && (
          <input
            className="tools-panel__input"
            type="text"
            placeholder={activeTool === 'point' ? 'Point name' : 'Drawing name'}
            value={formName}
            onChange={(e) => onNameChange(e.target.value)}
            maxLength={80}
          />
        )}
        {activeTool === 'point' && (
          <textarea
            className="tools-panel__input tools-panel__textarea"
            placeholder="Note (optional)"
            value={formNote}
            onChange={(e) => onNoteChange(e.target.value)}
            maxLength={300}
            rows={2}
          />
        )}

        {/* ── Unified color picker for Draw / Distance / Area ── */}
        {showColorPicker && (
          <div className="tools-panel__colors">
            <span className="tools-panel__colors-label">Color</span>
            {TOOL_COLORS.map((c) => (
              <button
                key={c.hex}
                className={'color-swatch ' + (activeColor === c.hex ? 'color-swatch--active' : '')}
                style={{ background: c.hex }}
                aria-label={c.label}
                title={c.label}
                onClick={() => onColorChange(c.hex)}
              />
            ))}
            <span className="tools-panel__colors-name">
              {TOOL_COLORS.find((c) => c.hex === activeColor)?.label ?? ''}
            </span>
          </div>
        )}

        <div className="tools-panel__actions">
          <button onClick={onUndo} disabled={points.length === 0}>Undo</button>
          <button onClick={onClear} disabled={points.length === 0}>Clear</button>
          <button
            className="tools-panel__save"
            style={{ background: activeColor, borderColor: activeColor }}
            onClick={onSave}
            disabled={!canSave}
          >
            Save
          </button>
        </div>

        <p className="tools-panel__hint">
          {activeTool === 'point' && 'Tap the map to drop a point, then name and save it.'}
          {activeTool === 'draw' &&
            `Tap the map to add ${drawGeometryType} vertices (need ${drawGeometryType === 'polygon' ? '≥3' : '≥2'}).`}
          {activeTool === 'distance' && 'Tap the map to add line points. Choose a color above.'}
          {activeTool === 'area' && 'Tap the map to add polygon points. Choose a color above.'}
        </p>
      </div>
    </div>
  );
}
