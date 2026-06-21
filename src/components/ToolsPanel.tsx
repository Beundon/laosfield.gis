/**
 * ToolsPanel.tsx
 * -----------------------------------------------------------------------
 * Controls for all four tap-on-map tools:
 *   - Point    drop a single named marker (saved to db.points)
 *   - Draw     sketch a line or polygon annotation with a chosen color
 *              (saved to db.drawings) — distinct from Distance/Area,
 *              which compute and store a measurement result
 *   - Distance tap-to-draw line, shown live in meters/kilometers
 *   - Area     tap-to-draw polygon, shown live in square meters/hectares
 * -----------------------------------------------------------------------
 */
import { measureLineDistance, measurePolygonArea, formatDistance, formatArea } from '../core/measurementEngine';
import type { LatLng } from '../core/measurementEngine';
import './ToolsPanel.css';

export type ToolKind = 'none' | 'point' | 'draw' | 'distance' | 'area';
export type DrawGeometryType = 'line' | 'polygon';

export const DRAW_COLORS = ['#e8a33d', '#5fb87a', '#e8541f', '#6fb1e8', '#d9534f', '#f1ede2'];

interface ToolsPanelProps {
  activeTool: ToolKind;
  points: LatLng[];
  drawGeometryType: DrawGeometryType;
  drawColor: string;
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
  drawColor,
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

  return (
    <div className="tools-panel">
      <div className="tools-panel__tools">
        <ToolButton label="Point" active={activeTool === 'point'} onClick={() => onSelectTool(activeTool === 'point' ? 'none' : 'point')} />
        <ToolButton label="Draw" active={activeTool === 'draw'} onClick={() => onSelectTool(activeTool === 'draw' ? 'none' : 'draw')} />
        <ToolButton label="Distance" active={activeTool === 'distance'} onClick={() => onSelectTool(activeTool === 'distance' ? 'none' : 'distance')} />
        <ToolButton label="Area" active={activeTool === 'area'} onClick={() => onSelectTool(activeTool === 'area' ? 'none' : 'area')} />
      </div>

      {activeTool !== 'none' && (
        <div className="tools-panel__readout">
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

          {activeTool === 'distance' && distanceResult && (
            <div className="tools-panel__value">
              {formatDistance(distanceResult.meters)}
              <span className="tools-panel__value-alt">({distanceResult.kilometers.toFixed(3)} km)</span>
            </div>
          )}
          {activeTool === 'area' && areaResult && (
            <div className="tools-panel__value">{formatArea(areaResult.squareMeters)}</div>
          )}
          {activeTool === 'draw' && drawGeometryType === 'line' && drawResult && (
            <div className="tools-panel__value">
              {formatDistance(drawResult.meters)}
              <span className="tools-panel__value-alt">({drawResult.kilometers.toFixed(3)} km)</span>
            </div>
          )}

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
          {activeTool === 'draw' && (
            <div className="tools-panel__colors">
              {DRAW_COLORS.map((c) => (
                <button
                  key={c}
                  className={'color-swatch ' + (drawColor === c ? 'color-swatch--active' : '')}
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                  onClick={() => onColorChange(c)}
                />
              ))}
            </div>
          )}

          <div className="tools-panel__actions">
            <button onClick={onUndo} disabled={points.length === 0}>
              Undo point
            </button>
            <button onClick={onClear} disabled={points.length === 0}>
              Clear
            </button>
            <button className="tools-panel__save" onClick={onSave} disabled={!canSave}>
              Save
            </button>
          </div>

          <p className="tools-panel__hint">
            {activeTool === 'point' && 'Tap the map to drop a point, then name and save it.'}
            {activeTool === 'draw' &&
              `Tap the map to add ${drawGeometryType} vertices (need ${drawGeometryType === 'polygon' ? 'at least 3' : 'at least 2'}).`}
            {activeTool === 'distance' && 'Tap the map to add line points.'}
            {activeTool === 'area' && 'Tap the map to add polygon points.'}
          </p>
        </div>
      )}
    </div>
  );
}

function ToolButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={'tool-btn ' + (active ? 'tool-btn--active' : '')} onClick={onClick}>
      {label}
    </button>
  );
}
