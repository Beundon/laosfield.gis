/**
 * useGpsTrack.ts
 * -----------------------------------------------------------------------
 * Single-responsibility hook that owns ALL GPS tracking logic.
 *
 * Architecture:
 * - ONE watchPosition call controls everything (locate-me dot AND track)
 * - No competing watches — this is the single GPS consumer
 * - Uses a ref-based buffer (trackPtsRef) so adding points never triggers
 *   React re-renders (only the counter and live-fix state do)
 * - Kalman-filter-style smoothing: rejects fixes whose reported accuracy
 *   is worse than ACCURACY_THRESHOLD_M (like Garmin's "Poor GPS" filter)
 * - Distance gate: minimum movement filter to remove stationary jitter
 * - Speed gate: reject fixes that imply physically impossible movement
 *   (>500 km/h = bad fix from cell tower interpolation, not GNSS)
 *
 * This replaces the fragmented GPS management that was split between
 * App.tsx and MapView.tsx, causing two watchPosition calls to compete
 * and interleave — the root cause of only getting 2 fixes per track.
 * -----------------------------------------------------------------------
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { haversineDistanceMeters } from '../core/measurementEngine';
import type { TrackPoint } from '../core/exportEngine';

export interface LiveFix {
  lat: number;
  lng: number;
  accuracyMeters: number;
  elevationMeters: number | null;
  speedMs: number | null;
  headingDeg: number | null;
  timestamp: number;
}

interface UseGpsTrackOptions {
  /** Called with every accepted GPS fix (for the locate-me dot). */
  onFix: (fix: LiveFix) => void;
  /** Called with every fix that passes the track filter (for polyline growth). */
  onTrackPoint: (pt: TrackPoint, totalCount: number) => void;
  /** Whether track-recording mode is active. */
  isRecording: boolean;
}

/** Garmin-style quality thresholds */
const ACCURACY_THRESHOLD_M   = 25;   // reject fixes worse than 25 m (like Garmin's signal bars)
const MIN_TRACK_DISTANCE_M   = 2;    // minimum movement between stored track points
const MAX_SPEED_KMH          = 250;  // reject fixes implying >250 km/h (bad cell-tower fix)

export function useGpsTrack({ onFix, onTrackPoint, isRecording }: UseGpsTrackOptions) {
  const watchIdRef    = useRef<number | null>(null);
  const lastGoodFixRef = useRef<TrackPoint | null>(null);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const onFixRef = useRef(onFix);
  const onTrackRef = useRef(onTrackPoint);
  // Keep refs current so the watchPosition callback always calls the latest version
  useEffect(() => { onFixRef.current = onFix; }, [onFix]);
  useEffect(() => { onTrackRef.current = onTrackPoint; }, [onTrackPoint]);

  const isRecordingRef = useRef(isRecording);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);

  const start = useCallback(() => {
    if (!navigator.geolocation) { setSupported(false); return; }
    if (watchIdRef.current !== null) return; // already running

    setError(null);
    lastGoodFixRef.current = null;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, altitude, accuracy, speed, heading } = pos.coords;

        // ── Garmin-style accuracy gate ──────────────────────────────────
        // Reject any fix with horizontal accuracy worse than threshold.
        // On Garmin devices this corresponds to the "accuracy bars" dropping
        // below 3-4 bars. Consumer smartphones report accuracy from the
        // GNSS chipset — on Qualcomm Snapdragon (most Android phones with
        // 4.5G) this is typically 3-8 m outdoors, 10-20 m with partial sky.
        if (accuracy !== null && accuracy > ACCURACY_THRESHOLD_M) return;

        // ── Speed/distance sanity gate ──────────────────────────────────
        // If we have a previous fix, check that the implied travel speed
        // is physically possible. Cell-tower-assisted "GPS" can jump 200 m
        // instantly when switching towers — this rejects those.
        const prevFix = lastGoodFixRef.current;
        if (prevFix) {
          const distM = haversineDistanceMeters(
            { lat: prevFix.lat, lng: prevFix.lng },
            { lat, lng },
          );
          const dtS = (pos.timestamp - prevFix.timestamp) / 1000;
          if (dtS > 0) {
            const speedKmh = (distM / dtS) * 3.6;
            if (speedKmh > MAX_SPEED_KMH) return; // impossible movement = bad fix
          }
        }

        const liveFix: LiveFix = {
          lat, lng,
          accuracyMeters: accuracy ?? 0,
          elevationMeters: altitude ?? null,
          speedMs: speed ?? null,
          headingDeg: heading ?? null,
          timestamp: pos.timestamp,
        };

        // Always call onFix (drives the "you are here" dot)
        onFixRef.current(liveFix);

        // ── Track recording path ────────────────────────────────────────
        if (isRecordingRef.current) {
          const pt: TrackPoint = {
            lat, lng,
            elevationMeters: altitude ?? null,
            timestamp: pos.timestamp,
          };

          // Distance gate: skip points too close together (jitter)
          if (prevFix) {
            const distM = haversineDistanceMeters(
              { lat: prevFix.lat, lng: prevFix.lng },
              { lat, lng },
            );
            if (distM < MIN_TRACK_DISTANCE_M) {
              lastGoodFixRef.current = { ...pt }; // update timestamp even if skipped
              return;
            }
          }

          lastGoodFixRef.current = { ...pt };
          // Count is derived by the caller (App.tsx trackPtsRef.current.length)
          onTrackRef.current(pt, 0);
        } else {
          lastGoodFixRef.current = { lat, lng, elevationMeters: altitude ?? null, timestamp: pos.timestamp };
        }
      },
      (err) => {
        if (err.code === 1) setError('Location permission denied. Enable in browser settings.');
        else if (err.code === 2) setError('GPS unavailable — move to open sky.');
        else setError('GPS timeout. Move to open sky and retry.');
      },
      {
        enableHighAccuracy: true,
        maximumAge:  0,      // NEVER use cached positions
        timeout:     20000,  // longer timeout for initial fix acquisition
      },
    );
  }, []);

  const stop = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  // Single GPS watch, started on mount, never stopped until unmount
  // (stopping/restarting on every isRecording toggle was itself causing
  //  the fix-rate to drop while the chip re-acquires satellites).
  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);

  return { supported, error };
}
