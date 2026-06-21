/**
 * timeEngine.ts
 * -----------------------------------------------------------------------
 * Indochina Time (UTC+7) formatting helpers, used for:
 *  - the live HUD clock
 *  - track-log timestamps
 *  - KML <TimeStamp> / GPX <time> export metadata
 *
 * We always compute ICT explicitly via the UTC offset rather than relying
 * on the browser's local time, so that exports are correct even if the
 * detection engine applied Laos mode via the "soft" time-zone/locale path
 * on a device whose system clock is set to a different zone.
 * -----------------------------------------------------------------------
 */
import { ICT_UTC_OFFSET_MINUTES } from './laosGeo';

/** Convert any Date to its equivalent wall-clock time in ICT (UTC+7). */
export function toIctDate(date: Date): Date {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60_000;
  return new Date(utcMs + ICT_UTC_OFFSET_MINUTES * 60_000);
}

function pad(n: number, width = 2): string {
  return n.toString().padStart(width, '0');
}

/** "YYYY-MM-DD HH:mm:ss ICT" — used in the HUD and human-readable logs. */
export function formatIctClock(date: Date = new Date()): string {
  const d = toIctDate(date);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ICT`
  );
}

/**
 * ISO-8601 string with the literal "+07:00" offset, for embedding in
 * KML <TimeStamp> and GPX <time> elements. This is the format GIS
 * consumers (QGIS, Google Earth, Garmin tools) parse most reliably.
 */
export function formatIctIso8601(date: Date = new Date()): string {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60_000;
  const ict = new Date(utcMs + ICT_UTC_OFFSET_MINUTES * 60_000);
  return (
    `${ict.getFullYear()}-${pad(ict.getMonth() + 1)}-${pad(ict.getDate())}T` +
    `${pad(ict.getHours())}:${pad(ict.getMinutes())}:${pad(ict.getSeconds())}+07:00`
  );
}

/** Filename-safe ICT timestamp, e.g. "20260620-143012" — used for exports. */
export function formatIctFileStamp(date: Date = new Date()): string {
  const d = toIctDate(date);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}${pad(d.getSeconds())}`;
}
