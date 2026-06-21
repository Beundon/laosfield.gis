/**
 * exportEngine.ts
 * -----------------------------------------------------------------------
 * Exports map data (tracks, points, measured shapes) to KML and GPX,
 * embedding all timestamps in Indochina Time per spec §1.
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

/** Build a KML LineString document for a recorded track, with ICT timestamps. */
export function buildKml(name: string, points: TrackPoint[]): string {
  const coords = points.map((p) => `${p.lng},${p.lat},${p.elevationMeters ?? 0}`).join(' ');
  const whenStamps = points
    .map((p) => `<when>${formatIctIso8601(new Date(p.timestamp))}</when>`)
    .join('\n      ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>${escapeXml(name)}</name>
    <description>Exported from Laos Field GIS — timestamps in Indochina Time (UTC+7)</description>
    <Placemark>
      <name>${escapeXml(name)}</name>
      <TimeStamp>
        <when>${formatIctIso8601(new Date(points[0]?.timestamp ?? Date.now()))}</when>
      </TimeStamp>
      <gx:Track>
        ${whenStamps}
      </gx:Track>
      <LineString>
        <extrude>1</extrude>
        <tessellate>1</tessellate>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
}

/** Build a GPX 1.1 track document, with ICT timestamps. */
export function buildGpx(name: string, points: TrackPoint[]): string {
  const trkpts = points
    .map(
      (p) => `      <trkpt lat="${p.lat}" lon="${p.lng}">
        ${p.elevationMeters != null ? `<ele>${p.elevationMeters}</ele>` : ''}
        <time>${formatIctIso8601(new Date(p.timestamp))}</time>
      </trkpt>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Laos Field GIS" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(name)}</name>
    <time>${formatIctIso8601()}</time>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

/** Trigger a browser download of a generated export file. */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportTrackAsKml(name: string, points: TrackPoint[]): void {
  const kml = buildKml(name, points);
  downloadTextFile(`${name}-${formatIctFileStamp()}.kml`, kml, 'application/vnd.google-earth.kml+xml');
}

export function exportTrackAsGpx(name: string, points: TrackPoint[]): void {
  const gpx = buildGpx(name, points);
  downloadTextFile(`${name}-${formatIctFileStamp()}.gpx`, gpx, 'application/gpx+xml');
}
