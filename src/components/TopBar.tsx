/**
 * TopBar.tsx
 * -----------------------------------------------------------------------
 * Region status strip + a single menu button. All actions that used to
 * live here as a row of buttons (Import, Library, Record, Export) now
 * live in MenuDropdown — this bar only shows status plus the toggle,
 * which is what keeps it usable on a phone-width screen.
 * -----------------------------------------------------------------------
 */
import type { AppRegionConfig } from '../core/bootDetection';
import './TopBar.css';

interface TopBarProps {
  config: AppRegionConfig;
  layerCount: number;
  isRecording: boolean;
  onToggleMenu: () => void;
}

const SOURCE_LABEL: Record<AppRegionConfig['source'], string> = {
  gps: 'GPS geofence',
  timezone: 'system time zone',
  locale: 'device locale',
  default: 'no Laos signal',
};

export default function TopBar({ config, layerCount, isRecording, onToggleMenu }: TopBarProps) {
  return (
    <div className="topbar">
      <div className="topbar__brand">
        <span className="topbar__brand-mark">LAO</span>
        <span className="topbar__brand-name">Field GIS</span>
      </div>

      <div className="topbar__status">
        <span className={'topbar__dot ' + (config.isLaosMode ? 'topbar__dot--on' : 'topbar__dot--off')} />
        <span className="topbar__status-text">
          {config.isLaosMode
            ? `Laos mode active (${SOURCE_LABEL[config.source]})`
            : `Laos mode inactive (${SOURCE_LABEL[config.source]})`}
        </span>
        <span className="topbar__sep">|</span>
        {layerCount} layer{layerCount === 1 ? '' : 's'}
        {isRecording && (
          <span className="topbar__rec-badge">
            <span className="topbar__rec-dot" /> REC
          </span>
        )}
      </div>

      <button className="topbar__menu-btn" onClick={onToggleMenu} aria-label="Open menu">
        <span />
        <span />
        <span />
      </button>
    </div>
  );
}
