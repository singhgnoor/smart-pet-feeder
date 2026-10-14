/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEVICE_MODE?: 'hardware' | 'mock';
  readonly VITE_ESP32_HOST?: string;
  readonly VITE_ESP32_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
