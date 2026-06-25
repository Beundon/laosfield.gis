/**
 * GpsStatusBar.tsx
 * -----------------------------------------------------------------------
 * Garmin-style GPS signal quality bar shown during recording.
 * Shows: fix count, accuracy, speed, and signal quality indicator.
 * -----------------------------------------------------------------------
 */
import type { LiveFix } from '../hooks/useGpsTrack';
import './GpsStatusBar.css';

interface GpsStatusBarProps {
  fix: LiveFix | null;
  isRecording: boolean;
  trackCount: number;
  onLocateMe: () => void;
}

function accuracyToSignal(acc: number): number {
  // Map accuracy to 0-5 bars (like Garmin)
  if (acc <= 3)  return 5;
  if (acc <= 5)  return 4;
  if (acc <= 10) return 3;
  if (acc <= 15) return 2;
  if (acc <= 25) return 1;
  return 0;
}

export default function GpsStatusBar({ fix, isRecording, trackCount, onLocateMe }: GpsStatusBarProps) {
  const signal = fix ? accuracyToSignal(fix.accuracyMeters) : 0;
  const speedKmh = fix?.speedMs != null ? (fix.speedMs * 3.6).toFixed(1) : null;

  return (
    <div className={'gps-bar ' + (isRecording ? 'gps-bar--rec' : '')}>
      {/* Locate-me button */}
      <button className="gps-bar__locate" onClick={onLocateMe} title="Center map on my position">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" /><line x1="12" y1="1" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="23" /><line x1="1" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="23" y2="12" />
        </svg>
      </button>

      {/* Signal bars */}
      <div className="gps-bar__signal" title={fix ? `±${Math.round(fix.accuracyMeters)} m accuracy` : 'No GPS fix'}>
        {[1,2,3,4,5].map((bar) => (
          <span key={bar} className={'gps-bar__signal-bar ' + (bar <= signal ? 'gps-bar__signal-bar--on' : '')} />
        ))}
      </div>

      {/* Fix quality text */}
      {fix ? (
        <span className="gps-bar__acc">
          {signal >= 4 ? 'Excellent' : signal >= 3 ? 'Good' : signal >= 2 ? 'Fair' : 'Poor'}
          {' '}±{Math.round(fix.accuracyMeters)} m
        </span>
      ) : (
        <span className="gps-bar__acc gps-bar__acc--wait">Acquiring GPS…</span>
      )}

      {/* Speed (when available) */}
      {speedKmh && (
        <span className="gps-bar__speed">{speedKmh} km/h</span>
      )}

      {/* Recording indicator */}
      {isRecording && (
        <span className="gps-bar__rec">
          <span className="gps-bar__rec-dot" />
          REC {trackCount} pts
        </span>
      )}
    </div>
  );
}
