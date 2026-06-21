/**
 * MarkPointXY.tsx
 * -----------------------------------------------------------------------
 * Drop a point from typed coordinates instead of tapping the map —
 * essential for field GIS work where a known survey coordinate (often
 * UTM Easting/Northing) needs to be plotted exactly. Saves straight to
 * db.points, so it appears on the map and in the Data library immediately.
 * -----------------------------------------------------------------------
 */
import { useState } from 'react';
import db from '../storage/db';
import { toAutoUtm, utmToLatLon } from '../core/coordinateEngine';
import { UTM_ZONE_47N, UTM_ZONE_48N, type UtmZone } from '../core/laosGeo';
import { formatIctIso8601 } from '../core/timeEngine';
import type { LiveGps } from '../hooks/useLaosBootSequence';
import './MarkPointXY.css';

type Mode = 'latlon' | 'utm';

interface MarkPointXYProps {
  liveGps: LiveGps | null;
  onClose: () => void;
}

export default function MarkPointXY({ liveGps, onClose }: MarkPointXYProps) {
  const [mode, setMode] = useState<Mode>('latlon');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [easting, setEasting] = useState('');
  const [northing, setNorthing] = useState('');
  const [zone, setZone] = useState<UtmZone>(
    liveGps ? (liveGps.utmZone as UtmZone) : UTM_ZONE_48N,
  );
  const [error, setError] = useState<string | null>(null);

  function useCurrentPosition() {
    if (!liveGps) return;
    if (mode === 'latlon') {
      setLat(liveGps.lat.toFixed(6));
      setLon(liveGps.lon.toFixed(6));
    } else {
      const utm = toAutoUtm(liveGps.lat, liveGps.lon);
      setZone(utm.zone);
      setEasting(Math.round(utm.easting).toString());
      setNorthing(Math.round(utm.northing).toString());
    }
  }

  function resolveLatLng(): { lat: number; lng: number } | null {
    if (mode === 'latlon') {
      const latNum = parseFloat(lat);
      const lonNum = parseFloat(lon);
      if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
        setError('Enter valid decimal-degree latitude and longitude.');
        return null;
      }
      if (latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
        setError('Latitude must be -90..90 and longitude -180..180.');
        return null;
      }
      return { lat: latNum, lng: lonNum };
    }
    const e = parseFloat(easting);
    const n = parseFloat(northing);
    if (Number.isNaN(e) || Number.isNaN(n)) {
      setError('Enter valid UTM Easting and Northing values.');
      return null;
    }
    const [latNum, lonNum] = utmToLatLon(e, n, zone);
    return { lat: latNum, lng: lonNum };
  }

  async function handleSave() {
    setError(null);
    const resolved = resolveLatLng();
    if (!resolved) return;

    await db.points.add({
      name: name.trim() || 'Point ' + formatIctIso8601(),
      lat: resolved.lat,
      lng: resolved.lng,
      elevationMeters: null,
      note: note.trim(),
      createdAtIct: formatIctIso8601(),
    });
    onClose();
  }

  return (
    <>
      <div className="markxy-backdrop" onClick={onClose} />
      <div className="markxy-modal" role="dialog" aria-label="Mark point by coordinates">
        <div className="markxy__header">
          <h2>Mark point (XY)</h2>
          <button className="markxy__close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        <div className="markxy__row">
          <button
            className={'markxy__mode-btn ' + (mode === 'latlon' ? 'markxy__mode-btn--active' : '')}
            onClick={() => setMode('latlon')}
          >
            Lat / Lon
          </button>
          <button
            className={'markxy__mode-btn ' + (mode === 'utm' ? 'markxy__mode-btn--active' : '')}
            onClick={() => setMode('utm')}
          >
            UTM (E / N)
          </button>
        </div>

        {mode === 'latlon' ? (
          <div className="markxy__fields">
            <label>
              Latitude (decimal degrees)
              <input
                inputMode="decimal"
                placeholder="e.g. 17.9757"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
              />
            </label>
            <label>
              Longitude (decimal degrees)
              <input
                inputMode="decimal"
                placeholder="e.g. 102.6331"
                value={lon}
                onChange={(e) => setLon(e.target.value)}
              />
            </label>
          </div>
        ) : (
          <div className="markxy__fields">
            <label>
              UTM zone
              <div className="markxy__row">
                <button
                  className={'markxy__mode-btn ' + (zone.zoneNumber === 47 ? 'markxy__mode-btn--active' : '')}
                  onClick={() => setZone(UTM_ZONE_47N)}
                >
                  47N
                </button>
                <button
                  className={'markxy__mode-btn ' + (zone.zoneNumber === 48 ? 'markxy__mode-btn--active' : '')}
                  onClick={() => setZone(UTM_ZONE_48N)}
                >
                  48N
                </button>
              </div>
            </label>
            <label>
              Easting (m)
              <input
                inputMode="decimal"
                placeholder="e.g. 234567"
                value={easting}
                onChange={(e) => setEasting(e.target.value)}
              />
            </label>
            <label>
              Northing (m)
              <input
                inputMode="decimal"
                placeholder="e.g. 1989123"
                value={northing}
                onChange={(e) => setNorthing(e.target.value)}
              />
            </label>
          </div>
        )}

        {liveGps && (
          <button className="markxy__gps-btn" onClick={useCurrentPosition}>
            Use my current GPS position
          </button>
        )}

        <label className="markxy__label-block">
          Name
          <input
            className="markxy__name"
            type="text"
            placeholder="Point name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
        </label>
        <label className="markxy__label-block">
          Note (optional)
          <textarea
            placeholder="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            rows={2}
          />
        </label>

        {error && <p className="markxy__error">{error}</p>}

        <div className="markxy__actions">
          <button onClick={onClose}>Cancel</button>
          <button className="markxy__save" onClick={handleSave}>
            Save point
          </button>
        </div>
      </div>
    </>
  );
}
