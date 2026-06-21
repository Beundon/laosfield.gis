/**
 * measurementEngine.ts
 * -----------------------------------------------------------------------
 * Precision measurement math for the Distance and Area tools (spec §4).
 *
 * Distance uses the haversine great-circle formula, summed across each
 * segment of a multi-point line — accurate to within ~0.5% over the
 * short-to-medium distances typical of field GIS work in Laos, and
 * dependency-free (no need to pull in a full geodesy library for this).
 *
 * Area uses the spherical excess / "shoelace on a sphere" formula
 * (equivalent to the algorithm behind Turf.js's `area`), which correctly
 * accounts for the Earth's curvature rather than naively shoelacing
 * planar degrees — important for forestry/agricultural plots that can
 * span hundreds of meters.
 * -----------------------------------------------------------------------
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6_378_137; // WGS84 equatorial radius

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two points, in meters (haversine formula).
 */
export function haversineDistanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

export interface DistanceResult {
  meters: number;
  kilometers: number;
  /** Cumulative distance at each vertex, in meters — for segment labels. */
  segmentDistancesMeters: number[];
}

/**
 * Total length of a multi-segment line (a "polyline" drawn point-by-point
 * by the user), plus a running list of per-segment distances.
 */
export function measureLineDistance(points: LatLng[]): DistanceResult {
  if (points.length < 2) {
    return { meters: 0, kilometers: 0, segmentDistancesMeters: [] };
  }
  const segmentDistancesMeters: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = haversineDistanceMeters(points[i - 1], points[i]);
    segmentDistancesMeters.push(d);
    total += d;
  }
  return {
    meters: total,
    kilometers: total / 1000,
    segmentDistancesMeters,
  };
}

export interface AreaResult {
  squareMeters: number;
  hectares: number;
}

/**
 * Geodesic area of a closed polygon, in square meters, using the
 * spherical excess method (sum of signed triangle areas projected
 * from the polygon centroid down to each edge, accounting for
 * Earth curvature). The ring does not need to be explicitly closed
 * (first point repeated as last) — this function closes it implicitly.
 *
 * Algorithm reference: L'Huilier's theorem applied to a planar
 * decomposition in radians, scaled by R². This is the same approach
 * used by Turf.js / Google's Geometry library for "good enough"
 * field-survey-grade polygon area on the WGS84 sphere.
 */
export function measurePolygonArea(points: LatLng[]): AreaResult {
  if (points.length < 3) {
    return { squareMeters: 0, hectares: 0 };
  }

  let total = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    total +=
      toRad(p2.lng - p1.lng) *
      (2 + Math.sin(toRad(p1.lat)) + Math.sin(toRad(p2.lat)));
  }
  const squareMeters = Math.abs((total * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS) / 2);

  return {
    squareMeters,
    hectares: squareMeters / 10_000,
  };
}

/** Convenience formatter: picks m vs km based on magnitude. */
export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(3)} km`;
  return `${meters.toFixed(1)} m`;
}

/** Convenience formatter: always shows both m² and ha, per spec. */
export function formatArea(squareMeters: number): string {
  const ha = squareMeters / 10_000;
  return `${squareMeters.toFixed(1)} m² (${ha.toFixed(4)} ha)`;
}
