/**
 * laosGeo.ts
 * -----------------------------------------------------------------------
 * Core geographic constants and pure math for Laos (Lao PDR) detection,
 * UTM zone selection, and bounding-box containment checks.
 *
 * Kept dependency-free and pure so it can be unit-tested in isolation
 * from React / Leaflet / IndexedDB.
 * -----------------------------------------------------------------------
 */

/** National bounding box for Laos (approximate, per spec). */
export const LAOS_BBOX = {
  minLat: 13.9,
  maxLat: 22.5,
  minLon: 100.1,
  maxLon: 107.7,
} as const;

/** Default map center: geographic center of Laos. */
export const LAOS_DEFAULT_CENTER: [number, number] = [18.0, 103.0];

/** Default zoom level when locking viewport to the whole country. */
export const LAOS_DEFAULT_ZOOM = 7;

/** IANA time zone identifiers that resolve to Indochina Time (UTC+7). */
export const ICT_TIMEZONE_IDS = [
  'Asia/Vientiane',
  'Asia/Bangkok',
  'Asia/Phnom_Penh',
  'Asia/Ho_Chi_Minh',
  'Asia/Saigon',
] as const;

export const ICT_UTC_OFFSET_MINUTES = 7 * 60;

/** Locale / country codes treated as a Laos signal when GPS is unavailable. */
export const LAOS_LOCALE_SIGNALS = ['la', 'lao', 'la-la', 'lo', 'lo-la'] as const;

/**
 * The longitude that splits UTM Zone 47N from UTM Zone 48N in mainland
 * Southeast Asia. Zones are 6 degrees wide; the 47N/48N boundary sits at
 * 102°E. Strictly, UTM zone boundaries run every 6°, with zone 47N
 * spanning 96°E–102°E and zone 48N spanning 102°E–108°E.
 */
export const UTM_47N_48N_BOUNDARY_LON = 102.0;

export type UtmZone = {
  zoneNumber: 47 | 48;
  hemisphere: 'N';
  epsg: 32647 | 32648;
  label: string;
  /** proj4 definition string for this zone (WGS84 datum). */
  proj4def: string;
};

export const UTM_ZONE_48N: UtmZone = {
  zoneNumber: 48,
  hemisphere: 'N',
  epsg: 32648,
  label: 'UTM Zone 48N (WGS84 / EPSG:32648)',
  proj4def: '+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs +type=crs',
};

export const UTM_ZONE_47N: UtmZone = {
  zoneNumber: 47,
  hemisphere: 'N',
  epsg: 32647,
  label: 'UTM Zone 47N (WGS84 / EPSG:32647)',
  proj4def: '+proj=utm +zone=47 +datum=WGS84 +units=m +no_defs +type=crs',
};

/**
 * Determine whether a coordinate falls inside the national bounding box
 * of Laos. This is a coarse rectangular check (not a true polygon
 * point-in-country test) — intentional, since it's meant to run instantly
 * at boot before any boundary shapefile has been loaded.
 */
export function isWithinLaosBoundingBox(lat: number, lon: number): boolean {
  return (
    lat >= LAOS_BBOX.minLat &&
    lat <= LAOS_BBOX.maxLat &&
    lon >= LAOS_BBOX.minLon &&
    lon <= LAOS_BBOX.maxLon
  );
}

/**
 * Automatic UTM zone selector.
 *
 * Rule (per spec):
 *  - Default to Zone 48N (covers >90% of Laos: Vientiane, Luang Prabang, Pakse).
 *  - If the live longitude is west of 102°E (Bokeo / Sayabouly), switch to 47N.
 *
 * This intentionally uses a single longitude threshold rather than the
 * full global UTM zone formula (floor((lon+180)/6)+1), because the spec
 * calls for a *Laos-specific* logical switch at the 47N/48N boundary,
 * not a general-purpose UTM zone calculator.
 */
export function selectUtmZoneForLongitude(lon: number): UtmZone {
  return lon < UTM_47N_48N_BOUNDARY_LON ? UTM_ZONE_47N : UTM_ZONE_48N;
}

/** Returns true if the resolved IANA time zone is Indochina Time. */
export function isIctTimeZone(tz: string): boolean {
  return (ICT_TIMEZONE_IDS as readonly string[]).includes(tz);
}

/** Returns true if a BCP-47 / locale country signal indicates Laos. */
export function isLaosLocaleSignal(localeOrCountry: string | null | undefined): boolean {
  if (!localeOrCountry) return false;
  const v = localeOrCountry.toLowerCase();
  return (LAOS_LOCALE_SIGNALS as readonly string[]).some(
    (sig) => v === sig || v.startsWith(`${sig}-`) || v.endsWith(`-${sig}`),
  );
}
