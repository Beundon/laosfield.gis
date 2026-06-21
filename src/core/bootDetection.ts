/**
 * bootDetection.ts
 * -----------------------------------------------------------------------
 * The boot-sequence detection engine described in spec section 1.
 *
 * Runs once on app start (see hooks/useLaosBootSequence.ts) and resolves
 * a single AppRegionConfig describing:
 *   - whether the app should auto-configure itself for Laos
 *   - which UTM zone to default to
 *   - the detected time zone / whether it's ICT
 *   - the map viewport to lock to
 *
 * Detection order (each step only runs if the previous one didn't
 * conclusively resolve a Laos / non-Laos answer):
 *   1. System time zone check (fast, synchronous, no permissions needed)
 *   2. GPS geofence check (authoritative if available — requires permission)
 *   3. Locale / country code fallback (used when GPS is denied or offline)
 * -----------------------------------------------------------------------
 */

import {
  LAOS_DEFAULT_CENTER,
  LAOS_DEFAULT_ZOOM,
  UTM_ZONE_48N,
  isIctTimeZone,
  isLaosLocaleSignal,
  isWithinLaosBoundingBox,
  selectUtmZoneForLongitude,
  type UtmZone,
} from './laosGeo';

export type DetectionSource = 'gps' | 'timezone' | 'locale' | 'default';

export interface GpsFix {
  lat: number;
  lon: number;
  accuracyMeters: number | null;
  elevationMeters: number | null;
  timestamp: number;
}

export interface AppRegionConfig {
  /** True if the app should apply Laos-specific defaults. */
  isLaosMode: boolean;
  /** Which signal ultimately decided isLaosMode. */
  source: DetectionSource;
  /** Detected IANA time zone, e.g. "Asia/Vientiane". */
  timeZone: string;
  /** True if the detected time zone resolves to ICT (UTC+7). */
  isIct: boolean;
  /** Map center/zoom to apply on first paint. */
  initialCenter: [number, number];
  initialZoom: number;
  /** Whether to hard-lock the viewport (prevents panning out of Laos). */
  lockViewportToLaos: boolean;
  /** The UTM zone to default the HUD/coordinate display to. */
  utmZone: UtmZone;
  /** The GPS fix used during detection, if one was obtained. */
  gpsFix: GpsFix | null;
  /** Human-readable trail of what happened, useful for a debug panel. */
  log: string[];
}

const FALLBACK_CONFIG_NON_LAOS: Omit<AppRegionConfig, 'timeZone' | 'isIct' | 'log'> = {
  isLaosMode: false,
  source: 'default',
  initialCenter: LAOS_DEFAULT_CENTER,
  initialZoom: 3,
  lockViewportToLaos: false,
  utmZone: UTM_ZONE_48N,
  gpsFix: null,
};

/** Step 1: read the device's resolved IANA time zone via Intl. */
function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/** Step 2: request a single GPS fix, with a timeout so boot never hangs. */
function requestGpsFix(timeoutMs = 8000): Promise<GpsFix | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => resolve(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy ?? null,
          elevationMeters: pos.coords.altitude ?? null,
          timestamp: pos.timestamp,
        });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

/** Step 3: locale / country fallback when GPS is denied or unavailable. */
function detectLocaleSignal(): string | null {
  try {
    const candidates: Array<string | undefined> = [
      ...(navigator.languages ?? []),
      navigator.language,
      // Some environments expose a region via Intl locale resolution.
      new Intl.Locale(navigator.language).region,
    ];
    return candidates.find((c) => !!c && isLaosLocaleSignal(c)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Run the full boot-sequence detection. Safe to call once at app start;
 * resolves quickly even if GPS permission is denied or the device is
 * offline, because every step has a bounded timeout / synchronous fallback.
 */
export async function runLaosBootDetection(): Promise<AppRegionConfig> {
  const log: string[] = [];
  const timeZone = detectTimeZone();
  const isIct = isIctTimeZone(timeZone);
  log.push(
    isIct
      ? `Time zone "${timeZone}" matches Indochina Time (UTC+7).`
      : `Time zone "${timeZone}" is not ICT.`,
  );

  // --- Step 2: GPS geofence (authoritative) ---
  const gpsFix = await requestGpsFix();
  if (gpsFix) {
    const inBox = isWithinLaosBoundingBox(gpsFix.lat, gpsFix.lon);
    log.push(
      `GPS fix (${gpsFix.lat.toFixed(4)}, ${gpsFix.lon.toFixed(4)}) is ` +
        `${inBox ? 'inside' : 'outside'} the Laos bounding box.`,
    );
    if (inBox) {
      const utmZone = selectUtmZoneForLongitude(gpsFix.lon);
      log.push(`Auto-selected ${utmZone.label} based on live longitude.`);
      return {
        isLaosMode: true,
        source: 'gps',
        timeZone,
        isIct,
        initialCenter: [gpsFix.lat, gpsFix.lon],
        initialZoom: 12,
        lockViewportToLaos: true,
        utmZone,
        gpsFix,
        log,
      };
    }
    // GPS succeeded but the user is genuinely outside Laos — trust it,
    // don't fall through to locale guessing.
    return {
      ...FALLBACK_CONFIG_NON_LAOS,
      timeZone,
      isIct,
      gpsFix,
      log: [...log, 'GPS is authoritative and outside Laos — Laos mode not applied.'],
    };
  }
  log.push('GPS unavailable, denied, or timed out. Falling back to locale check.');

  // --- Step 3: locale / country fallback (offline-friendly) ---
  const localeSignal = detectLocaleSignal();
  if (localeSignal) {
    log.push(`Locale signal "${localeSignal}" indicates Laos.`);
    return {
      isLaosMode: true,
      source: 'locale',
      timeZone,
      isIct,
      initialCenter: LAOS_DEFAULT_CENTER,
      initialZoom: LAOS_DEFAULT_ZOOM,
      lockViewportToLaos: true,
      utmZone: UTM_ZONE_48N,
      gpsFix: null,
      log,
    };
  }

  // --- Step 3b: if no locale signal but time zone IS ICT, treat as a
  // soft Laos hint (ICT also covers Thailand/Vietnam/Cambodia, so this is
  // intentionally a softer signal than GPS or explicit locale). ---
  if (isIct) {
    log.push('No locale signal, but time zone is ICT — applying Laos defaults as a soft match.');
    return {
      isLaosMode: true,
      source: 'timezone',
      timeZone,
      isIct,
      initialCenter: LAOS_DEFAULT_CENTER,
      initialZoom: LAOS_DEFAULT_ZOOM,
      lockViewportToLaos: false, // soft signal: center on Laos but don't hard-lock panning
      utmZone: UTM_ZONE_48N,
      gpsFix: null,
      log,
    };
  }

  log.push('No GPS, locale, or time zone signal matched Laos. Using world default view.');
  return {
    ...FALLBACK_CONFIG_NON_LAOS,
    timeZone,
    isIct,
    log,
  };
}
