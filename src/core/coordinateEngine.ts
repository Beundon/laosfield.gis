/**
 * coordinateEngine.ts
 * -----------------------------------------------------------------------
 * Coordinate transformation engine. Wraps proj4 to convert between
 * WGS84 decimal degrees and the auto-selected UTM zone (47N or 48N),
 * and formats coordinates for the HUD / exports.
 * -----------------------------------------------------------------------
 */
import proj4 from 'proj4';
import { UTM_ZONE_47N, UTM_ZONE_48N, selectUtmZoneForLongitude, type UtmZone } from './laosGeo';

const WGS84 = 'EPSG:4326';

// Register both Laos-relevant UTM zones with proj4 up front.
proj4.defs(`EPSG:${UTM_ZONE_47N.epsg}`, UTM_ZONE_47N.proj4def);
proj4.defs(`EPSG:${UTM_ZONE_48N.epsg}`, UTM_ZONE_48N.proj4def);

export interface UtmCoordinate {
  easting: number;
  northing: number;
  zone: UtmZone;
}

/** Convert a WGS84 decimal-degree pair to UTM, using the supplied zone. */
export function toUtm(lat: number, lon: number, zone: UtmZone): UtmCoordinate {
  const [easting, northing] = proj4(WGS84, `EPSG:${zone.epsg}`, [lon, lat]);
  return { easting, northing, zone };
}

/** Convert a WGS84 pair to UTM using the auto-selected zone for that longitude. */
export function toAutoUtm(lat: number, lon: number): UtmCoordinate {
  return toUtm(lat, lon, selectUtmZoneForLongitude(lon));
}

/** Convert a UTM coordinate back to WGS84 decimal degrees. */
export function utmToLatLon(easting: number, northing: number, zone: UtmZone): [number, number] {
  const [lon, lat] = proj4(`EPSG:${zone.epsg}`, WGS84, [easting, northing]);
  return [lat, lon];
}

/** Format decimal degrees, e.g. "18.0123° N, 103.0045° E". */
export function formatDecimalDegrees(lat: number, lon: number, precision = 5): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(precision)}° ${ns}, ${Math.abs(lon).toFixed(precision)}° ${ew}`;
}

/** Format a UTM coordinate, e.g. "48N 234567 E, 1989123 N". */
export function formatUtm(utm: UtmCoordinate): string {
  return `${utm.zone.zoneNumber}${utm.zone.hemisphere}  ${Math.round(utm.easting)} E, ${Math.round(
    utm.northing,
  )} N`;
}
