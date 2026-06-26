declare module 'shpjs' {
  import type { FeatureCollection } from 'geojson';
  export default function shp(
    buffer: ArrayBuffer | string,
  ): Promise<FeatureCollection | FeatureCollection[]>;
}

declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: unknown) => void;
  }
  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}

interface WakeLockSentinel extends EventTarget {
  release(): Promise<void>;
  readonly type: string;
  readonly released: boolean;
}
