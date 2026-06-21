/**
 * BootSplash.tsx
 * -----------------------------------------------------------------------
 * Shown while runLaosBootDetection() resolves. Communicates what the
 * boot sequence is doing (time zone check, GPS geofence, locale fallback)
 * so the auto-configuration doesn't feel like a silent black box.
 * -----------------------------------------------------------------------
 */
import './BootSplash.css';

export default function BootSplash() {
  return (
    <div className="boot-splash">
      <div className="boot-splash__inner">
        <div className="boot-splash__mark">LAO</div>
        <h1 className="boot-splash__title">Field GIS</h1>
        <p className="boot-splash__step">Resolving region, time zone, and UTM projection...</p>
        <div className="boot-splash__bar">
          <div className="boot-splash__bar-fill" />
        </div>
        <ul className="boot-splash__checklist">
          <li>Checking system time zone</li>
          <li>Requesting GPS fix</li>
          <li>Selecting UTM zone (47N / 48N)</li>
        </ul>
      </div>
    </div>
  );
}
