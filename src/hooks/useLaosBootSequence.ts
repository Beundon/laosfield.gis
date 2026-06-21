/**
 * useLaosBootSequence.ts
 * -----------------------------------------------------------------------
 * React entry point for the boot-sequence detection engine. Runs once on
 * mount, exposes the resolved AppRegionConfig, and then keeps a live GPS
 * watch running so the HUD and UTM-zone auto-switch stay current as the
 * device moves (e.g. crossing the 102°E 47N/48N boundary in the field).
 * -----------------------------------------------------------------------
 */
import { useEffect, useRef, useState } from 'react';
import { runLaosBootDetection, type AppRegionConfig, type GpsFix } from '../core/bootDetection';
import { selectUtmZoneForLongitude } from '../core/laosGeo';

export interface LiveGps extends GpsFix {
  /** UTM zone re-evaluated live for the current fix (handles the 47N/48N field switch). */
  utmZone: ReturnType<typeof selectUtmZoneForLongitude>;
}

export function useLaosBootSequence() {
  const [config, setConfig] = useState<AppRegionConfig | null>(null);
  const [liveGps, setLiveGps] = useState<LiveGps | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    runLaosBootDetection().then((result) => {
      if (cancelled) return;
      setConfig(result);
      if (result.gpsFix) {
        setLiveGps({ ...result.gpsFix, utmZone: selectUtmZoneForLongitude(result.gpsFix.lon) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Continuous GPS watch — keeps the HUD and the 47N/48N auto-switch live.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError('Geolocation is not available on this device/browser.');
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const fix: GpsFix = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy ?? null,
          elevationMeters: pos.coords.altitude ?? null,
          timestamp: pos.timestamp,
        };
        setLiveGps({ ...fix, utmZone: selectUtmZoneForLongitude(fix.lon) });
        setGpsError(null);
      },
      (err) => setGpsError(err.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return { config, liveGps, gpsError };
}
