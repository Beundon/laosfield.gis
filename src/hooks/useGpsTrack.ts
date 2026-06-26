/**
 * useGpsTrack.ts
 * -----------------------------------------------------------------------
 * Single GPS watch for the entire app lifetime.
 *
 * SCREEN-OFF FIX (Android/iOS):
 * When the device screen turns off, the browser suspends JS execution
 * (Doze mode on Android, App Nap on iOS). watchPosition callbacks stop
 * arriving. Two countermeasures are used:
 *
 *  1. Screen Wake Lock API (where supported, Android Chrome 84+, iOS 16.4+):
 *     Keeps the display ON while recording so the browser stays active.
 *     The lock is automatically re-acquired when the page becomes visible
 *     again (e.g. user wakes the screen).
 *
 *  2. Page Visibility API: When visibilitychange fires to 'visible'
 *     (screen woke up), immediately clear and re-create the watchPosition
 *     so the GPS chip re-acquires and callbacks resume without waiting for
 *     a timeout.
 *
 * These two together replicate Garmin-style always-on tracking: the
 * screen stays lit during recording, and if it ever goes off (battery
 * saver override, phone call), the watch is instantly re-started on wake.
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
  onFix: (fix: LiveFix) => void;
  onTrackPoint: (pt: TrackPoint) => void;
  isRecording: boolean;
}

const ACCURACY_THRESHOLD_M = 30;
const MIN_TRACK_DISTANCE_M = 2;
const MAX_SPEED_KMH        = 250;

export function useGpsTrack({ onFix, onTrackPoint, isRecording }: UseGpsTrackOptions) {
  const watchIdRef      = useRef<number | null>(null);
  const lastFixRef      = useRef<TrackPoint | null>(null);
  const wakeLockRef     = useRef<WakeLockSentinel | null>(null);
  const isRecordingRef  = useRef(isRecording);
  const onFixRef        = useRef(onFix);
  const onTrackRef      = useRef(onTrackPoint);
  const [error, setError] = useState<string | null>(null);

  // Keep refs current without re-creating the watch
  useEffect(() => { onFixRef.current = onFix; },        [onFix]);
  useEffect(() => { onTrackRef.current = onTrackPoint; }, [onTrackPoint]);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);

  // ── Screen Wake Lock ─────────────────────────────────────────────────
  const acquireWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      if (wakeLockRef.current) return; // already held
      wakeLockRef.current = await (navigator as Navigator & { wakeLock: { request: (type: string) => Promise<WakeLockSentinel> } }).wakeLock.request('screen');
      wakeLockRef.current.addEventListener('release', () => { wakeLockRef.current = null; });
    } catch {
      // Wake lock denied (low battery, power saver) — not fatal
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) { wakeLockRef.current.release(); wakeLockRef.current = null; }
  }, []);

  // ── GPS watch lifecycle ──────────────────────────────────────────────
  const startWatch = useCallback(() => {
    if (!navigator.geolocation) return;
    if (watchIdRef.current !== null) {
      // Clear existing watch before creating a new one
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setError(null);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, altitude, accuracy, speed, heading } = pos.coords;

        // Accuracy gate — reject poor fixes
        if (accuracy !== null && accuracy > ACCURACY_THRESHOLD_M) return;

        // Speed gate — reject impossible jumps (cell-tower artefacts)
        const prev = lastFixRef.current;
        if (prev) {
          const distM = haversineDistanceMeters({ lat: prev.lat, lng: prev.lng }, { lat, lng });
          const dtS   = (pos.timestamp - prev.timestamp) / 1000;
          if (dtS > 0 && (distM / dtS) * 3.6 > MAX_SPEED_KMH) return;
        }

        const liveFix: LiveFix = {
          lat, lng,
          accuracyMeters: accuracy ?? 0,
          elevationMeters: altitude ?? null,
          speedMs: speed ?? null,
          headingDeg: heading ?? null,
          timestamp: pos.timestamp,
        };
        onFixRef.current(liveFix);

        if (isRecordingRef.current) {
          const pt: TrackPoint = { lat, lng, elevationMeters: altitude ?? null, timestamp: pos.timestamp };
          if (prev) {
            const distM = haversineDistanceMeters({ lat: prev.lat, lng: prev.lng }, { lat, lng });
            if (distM < MIN_TRACK_DISTANCE_M) {
              lastFixRef.current = { ...pt };
              return;
            }
          }
          lastFixRef.current = { ...pt };
          onTrackRef.current(pt);
        } else {
          lastFixRef.current = { lat, lng, elevationMeters: altitude ?? null, timestamp: pos.timestamp };
        }
      },
      (err) => {
        if (err.code === 1) setError('Location permission denied.');
        else if (err.code === 2) setError('GPS signal lost — move to open sky.');
        else setError('GPS timeout — restarting…');
        // On timeout, restart the watch immediately
        if (err.code === 3) {
          setTimeout(() => startWatch(), 1000);
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }, []);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  // ── Wake lock management tied to recording state ─────────────────────
  useEffect(() => {
    if (isRecording) {
      acquireWakeLock();
    } else {
      releaseWakeLock();
    }
  }, [isRecording, acquireWakeLock, releaseWakeLock]);

  // ── Re-acquire wake lock and restart watch when screen wakes ────────
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Screen woke up — restart the GPS watch immediately so we don't
        // wait up to 20 s for the timeout to expire.
        startWatch();
        // Re-acquire wake lock if still recording
        if (isRecordingRef.current) acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [startWatch, acquireWakeLock]);

  // ── Start once on mount, stop on unmount ─────────────────────────────
  useEffect(() => {
    startWatch();
    return () => {
      stopWatch();
      releaseWakeLock();
    };
  }, [startWatch, stopWatch, releaseWakeLock]);

  return { error };
}
