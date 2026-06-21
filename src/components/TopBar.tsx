/**
 * TopBar.tsx
 * -----------------------------------------------------------------------
 * Region status strip + primary actions (import, track recording,
 * export). Shows which detection source configured Laos mode, so the
 * "automatic" behavior in spec section 1 is visible and trustworthy
 * rather than a silent black box.
 * -----------------------------------------------------------------------
 */
import type { AppRegionConfig } from '../core/bootDetection';
import './TopBar.css';

interface TopBarProps {
  config: AppRegionConfig;
  layerCount: number;
  isRecording: boolean;
  trackPointCount: number;
  onToggleImport: () => void;
  onToggleData: () => void;
  onToggleRecording: () => void;
  onExportTrack: (format: 'kml' | 'gpx') => void;
}

const SOURCE_LABEL: Record<AppRegionConfig['source'], string> = {
  gps: 'GPS geofence',
  timezone: 'system time zone',
  locale: 'device locale',
  default: 'no Laos signal',
};

export default function TopBar({
  config,
  layerCount,
  isRecording,
  trackPointCount,
  onToggleImport,
  onToggleData,
  onToggleRecording,
  onExportTrack,
}: TopBarProps) {
  return (
    <div className="topbar">
      <div className="topbar__brand">
        <span className="topbar__brand-mark">LAO</span>
        <span className="topbar__brand-name">Field GIS</span>
      </div>

      <div className="topbar__status">
        <span className={'topbar__dot ' + (config.isLaosMode ? 'topbar__dot--on' : 'topbar__dot--off')} />
        {config.isLaosMode
          ? `Laos mode active (${SOURCE_LABEL[config.source]})`
          : `Laos mode inactive (${SOURCE_LABEL[config.source]})`}
        <span className="topbar__sep">|</span>
        {layerCount} layer{layerCount === 1 ? '' : 's'}
      </div>

      <div className="topbar__actions">
        <button onClick={onToggleImport}>Import</button>
        <button onClick={onToggleData}>Library</button>
        <button
          className={isRecording ? 'topbar__record topbar__record--active' : 'topbar__record'}
          onClick={onToggleRecording}
        >
          {isRecording ? `Stop track (${trackPointCount})` : 'Record track'}
        </button>
        <div className="topbar__export">
          <button onClick={() => onExportTrack('kml')} disabled={trackPointCount === 0}>
            KML
          </button>
          <button onClick={() => onExportTrack('gpx')} disabled={trackPointCount === 0}>
            GPX
          </button>
        </div>
      </div>
    </div>
  );
}
