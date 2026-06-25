/**
 * exportEngine.ts
 * -----------------------------------------------------------------------
 * KML and GPX export with ICT timestamps (UTC+7).
 *
 * KML format: Track as LineString + individual Waypoint Placemarks per
 * fix. The gx:Track extension has been removed — it was malformed (missing
 * gx:coord elements) and caused Google Earth and QGIS to silently ignore
 * the geometry. Standard LineString + Placemarks is universally compatible.
 *
 * GPX format: Standard 1.1 with <trk><trkseg><trkpt> per fix, plus ele
 * and time elements. Also exports each fix as a <wpt> element so the file
 * works as both a track AND a waypoint collection.
 * -----------------------------------------------------------------------
 */
import { formatIctIso8601, formatIctFileStamp } from './timeEngine';
import type { LatLng } from './measurementEngine';

export interface TrackPoint extends LatLng {
  elevationMeters?: number | null;
  timestamp: number; // epoch ms
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build a KML 2.2 document:
 * - One LineString Placemark for the full track path
 * - Individual Placemark (Point) for each fix with timestamp and elevation
 *   (these are the "waypoints" in the KML sense)
 */
export function buildKml(name: string, points: TrackPoint[]): string {
  if (points.length === 0) return '';

  const coords = points
    .map((p) => `${p.lng},${p.lat},${(p.elevationMeters ?? 0).toFixed(2)}`)
    .join('\n          ');

  const waypoints = points
    .map(
      (p, i) => `    <Placemark>
      <name>${escapeXml(name)}-${String(i + 1).padStart(4, '0')}</name>
      <TimeStamp><when>${formatIctIso8601(new Date(p.timestamp))}</when></TimeStamp>
      <Point>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>${p.lng},${p.lat},${(p.elevationMeters ?? 0).toFixed(2)}</coordinates>
      </Point>
    </Placemark>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(name)}</name>
    <description>Exported from Laos Field GIS — timestamps in Indochina Time (UTC+7). ${points.length} fixes.</description>
    <Style id="trackStyle">
      <LineStyle><color>ff0000ff</color><width>3</width></LineStyle>
    </Style>
    <Placemark>
      <name>${escapeXml(name)} — Track</name>
      <styleUrl>#trackStyle</styleUrl>
      <TimeStamp><when>${formatIctIso8601(new Date(points[0].timestamp))}</when></TimeStamp>
      <LineString>
        <extrude>0</extrude>
        <tessellate>1</tessellate>
        <altitudeMode>clampToGround</altitudeMode>
        <coordinates>
          ${coords}
        </coordinates>
      </LineString>
    </Placemark>
${waypoints}
  </Document>
</kml>`;
}

/**
 * Build a GPX 1.1 document with:
 * - <trk><trkseg> containing all fixes as <trkpt> (standard track)
 * - <wpt> elements for each fix (waypoints — works in Garmin, OsmAnd etc.)
 */
export function buildGpx(name: string, points: TrackPoint[]): string {
  if (points.length === 0) return '';

  const trkpts = points
    .map(
      (p) => `      <trkpt lat="${p.lat}" lon="${p.lng}">
        ${p.elevationMeters != null ? `<ele>${p.elevationMeters.toFixed(2)}</ele>` : '<ele>0</ele>'}
        <time>${formatIctIso8601(new Date(p.timestamp))}</time>
      </trkpt>`,
    )
    .join('\n');

  const wpts = points
    .map(
      (p, i) => `  <wpt lat="${p.lat}" lon="${p.lng}">
    ${p.elevationMeters != null ? `<ele>${p.elevationMeters.toFixed(2)}</ele>` : '<ele>0</ele>'}
    <time>${formatIctIso8601(new Date(p.timestamp))}</time>
    <name>${escapeXml(name)}-${String(i + 1).padStart(4, '0')}</name>
    <sym>Waypoint</sym>
  </wpt>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Laos Field GIS"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(name)}</name>
    <desc>Exported from Laos Field GIS — timestamps in Indochina Time (UTC+7). ${points.length} fixes.</desc>
    <time>${formatIctIso8601()}</time>
  </metadata>
${wpts}
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function exportTrackAsKml(name: string, points: TrackPoint[]): void {
  const kml = buildKml(name, points);
  if (kml) downloadTextFile(`${name}-${formatIctFileStamp()}.kml`, kml, 'application/vnd.google-earth.kml+xml');
}

export function exportTrackAsGpx(name: string, points: TrackPoint[]): void {
  const gpx = buildGpx(name, points);
  if (gpx) downloadTextFile(`${name}-${formatIctFileStamp()}.gpx`, gpx, 'application/gpx+xml');
}
