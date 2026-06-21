/**
 * FieldHud.tsx
 * -----------------------------------------------------------------------
 * Persistent bottom-of-screen HUD (spec section 5). Shows live coordinates
 * in both Decimal Degrees and the auto-detected UTM zone, local ICT clock,
 * and current GPS elevation. Styled as an instrument readout, not a
 * dashboard card -- this is the signature visual element of the app.
 * -----------------------------------------------------------------------
 */
import { useEffect, useState } from 'react';
import type { LiveGps } from '../hooks/useLaosBootSequence';
import { toUtm, formatDecimalDegrees, formatUtm } from '../core/coordinateEngine';
import { formatIctClock } from '../core/timeEngine';
import './FieldHud.css';

interface FieldHudProps {
  liveGps: LiveGps | null;
  gpsError: string | null;
  isIct: boolean;
}

export default function FieldHud({ liveGps, gpsError, isIct }: FieldHudProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const dd = liveGps ? formatDecimalDegrees(liveGps.lat, liveGps.lon) : '-- --';
  const utm = liveGps ? formatUtm(toUtm(liveGps.lat, liveGps.lon, liveGps.utmZone)) : '-- --';
  const elevation =
    liveGps?.elevationMeters != null ? Math.round(liveGps.elevationMeters) + ' m' : '--';
  const accuracy = liveGps?.accuracyMeters != null ? '+/-' + Math.round(liveGps.accuracyMeters) + ' m' : '';

  return (
    <div className="field-hud" role="status" aria-label="Field coordinate readout">
      <div className="field-hud__row">
        <HudCell label="DD" value={dd} />
        <HudCell label={'UTM ' + (liveGps?.utmZone.zoneNumber ?? '--') + 'N'} value={utm} accent />
        <HudCell label="ELEV" value={elevation} sub={accuracy} />
        <HudCell
          label={isIct ? 'TIME (ICT)' : 'TIME'}
          value={formatIctClock(now).replace(' ICT', '')}
        />
      </div>
      {gpsError && <div className="field-hud__error">GPS: {gpsError}</div>}
    </div>
  );
}

function HudCell({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className={'hud-cell ' + (accent ? 'hud-cell--accent' : '')}>
      <span className="hud-cell__label">{label}</span>
      <span className="hud-cell__value">
        {value}
        {sub ? <span className="hud-cell__sub"> {sub}</span> : null}
      </span>
    </div>
  );
}
