/**
 * MenuDropdown.tsx
 * -----------------------------------------------------------------------
 * Single hamburger-triggered menu that replaces what used to be several
 * always-visible floating panels (tool selector buttons, top-bar action
 * row). Opens as an anchored dropdown on desktop and a full-width sheet
 * on phones. Closes on backdrop click, Escape, or after most actions.
 * -----------------------------------------------------------------------
 */
import { useEffect } from 'react';
import type { ToolKind } from './ToolsPanel';
import './MenuDropdown.css';

interface MenuDropdownProps {
  activeTool: ToolKind;
  isRecording: boolean;
  trackPointCount: number;
  onSelectTool: (tool: ToolKind) => void;
  onMarkPointXY: () => void;
  onImport: () => void;
  onLibrary: () => void;
  onToggleRecording: () => void;
  onExportTrack: (format: 'kml' | 'gpx') => void;
  onClose: () => void;
}

export default function MenuDropdown({
  activeTool,
  isRecording,
  trackPointCount,
  onSelectTool,
  onMarkPointXY,
  onImport,
  onLibrary,
  onToggleRecording,
  onExportTrack,
  onClose,
}: MenuDropdownProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function pick(action: () => void) {
    action();
    onClose();
  }

  return (
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div className="menu-dropdown" role="menu">
        <div className="menu-dropdown__section">
          <div className="menu-dropdown__label">Tools</div>
          <div className="menu-dropdown__grid">
            <MenuItem label="Mark point" active={activeTool === 'point'} onClick={() => pick(() => onSelectTool('point'))} />
            <MenuItem label="Draw" active={activeTool === 'draw'} onClick={() => pick(() => onSelectTool('draw'))} />
            <MenuItem label="Distance" active={activeTool === 'distance'} onClick={() => pick(() => onSelectTool('distance'))} />
            <MenuItem label="Area" active={activeTool === 'area'} onClick={() => pick(() => onSelectTool('area'))} />
          </div>
          <button className="menu-dropdown__row-btn" onClick={() => pick(onMarkPointXY)}>
            Mark point by coordinates (XY)
          </button>
        </div>

        <div className="menu-dropdown__section">
          <div className="menu-dropdown__label">Data</div>
          <button className="menu-dropdown__row-btn" onClick={() => pick(onImport)}>
            Import file
          </button>
          <button className="menu-dropdown__row-btn" onClick={() => pick(onLibrary)}>
            Data library
          </button>
        </div>

        <div className="menu-dropdown__section">
          <div className="menu-dropdown__label">Track</div>
          <button
            className={'menu-dropdown__row-btn ' + (isRecording ? 'menu-dropdown__row-btn--rec' : '')}
            onClick={() => pick(onToggleRecording)}
          >
            {isRecording ? `Stop recording (${trackPointCount} fixes)` : 'Start recording'}
          </button>
          <div className="menu-dropdown__grid menu-dropdown__grid--2">
            <button disabled={trackPointCount === 0} onClick={() => pick(() => onExportTrack('kml'))}>
              Export KML
            </button>
            <button disabled={trackPointCount === 0} onClick={() => pick(() => onExportTrack('gpx'))}>
              Export GPX
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function MenuItem({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={'menu-item ' + (active ? 'menu-item--active' : '')} onClick={onClick}>
      {label}
    </button>
  );
}
