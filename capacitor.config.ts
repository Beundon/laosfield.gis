import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'la.fieldgis.app',
  appName: 'Laos Field GIS',
  webDir: 'dist',
  android: {
    // Field devices in Laos commonly run older Android versions on
    // budget hardware; keep the WebView config conservative.
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
