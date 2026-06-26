// 'react';
import { BASEMAPS, type BasemapDef } from '../core/basemaps';
import './BasemapPicker.css';

const GROUPS = ['Topographic', 'Satellite', 'Street', 'Other'] as const;
const GROUP_ICONS: Record<string, string> = {
  Topographic: '🗺', Satellite: '🛰', Street: '🛣', Other: '🌐',
};

interface BasemapPickerProps {
  activeId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export default function BasemapPicker({ activeId, onSelect, onClose }: BasemapPickerProps) {
  return (
    <div className="bm-picker">
      <div className="bm-picker__header">
        <span className="bm-picker__title">Basemap</span>
        <button className="bm-picker__close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {GROUPS.map((group) => {
        const maps = BASEMAPS.filter((b) => b.group === group);
        if (!maps.length) return null;
        return (
          <div key={group} className="bm-picker__group">
            <div className="bm-picker__group-label">{GROUP_ICONS[group]} {group}</div>
            <div className="bm-picker__grid">
              {maps.map((b) => (
                <button
                  key={b.id}
                  className={'bm-tile ' + (b.id === activeId ? 'bm-tile--active' : '')}
                  onClick={() => { onSelect(b.id); onClose(); }}
                >
                  <BasemapThumb basemap={b} />
                  <span className="bm-tile__label">{b.label}</span>
                  {b.id === activeId && <span className="bm-tile__check">✓</span>}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Tiny thumbnail generated from a static tile for visual recognition
function BasemapThumb({ basemap }: { basemap: BasemapDef }) {
  const THUMB_Z = 6, THUMB_X = 102, THUMB_Y = 51; // tile near Laos center
  const url = basemap.url
    .replace('{z}', String(THUMB_Z))
    .replace('{x}', String(THUMB_X))
    .replace('{y}', String(THUMB_Y))
    .replace('{s}', basemap.subdomains ? basemap.subdomains[0] : 'a');

  return (
    <div className="bm-thumb" style={{ backgroundImage: `url(${url})` }} />
  );
}
