import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

declare const process: {
  cwd: () => string;
};

export default defineConfig(({ mode }) => {
  // Load env variables based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '');
  const espHost = env.VITE_ESP32_HOST || '192.168.1.100';
  const espPort = env.VITE_ESP32_PORT || '80';
  // Keep the device credential in the dev-server process. VITE_ variables are
  // available to browser bundles, so the legacy name is read only server-side.
  const deviceApiKey = env.DEVICE_API_KEY || env.VITE_DEVICE_API_KEY || '';
  const target = `http://${espHost}:${espPort}`;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      open: false,
      proxy: {
        // Forward all REST API requests to the ESP32-CAM HTTP server
        '/api': {
          target,
          changeOrigin: true,
          secure: false,
          timeout: 8000,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              if (
                deviceApiKey &&
                req.method !== 'GET' &&
                req.method !== 'HEAD' &&
                req.method !== 'OPTIONS'
              ) {
                proxyReq.setHeader('X-API-Key', deviceApiKey);
              }
            });
            proxy.on('error', (err, _req, res) => {
              // Gracefully handle hardware connection errors without crashing Vite
              if (!res.headersSent && 'writeHead' in res) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({
                    error: 'DEVICE_UNREACHABLE',
                    message: `ESP32-CAM at ${target} is unreachable (${err.message}). Is the feeder powered and on the same Wi-Fi?`,
                  })
                );
              }
            });
          },
        },
        // Forward Server-Sent Events stream to the ESP32-CAM /events endpoint
        '/events': {
          target,
          changeOrigin: true,
          secure: false,
          // SSE streams must never be buffered
          headers: {
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
          configure: (proxy) => {
            proxy.on('proxyReq', (_proxyReq, req) => {
              req.headers['accept'] = 'text/event-stream';
            });
            proxy.on('error', (err, _req, res) => {
              if (!res.headersSent && 'writeHead' in res) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({
                    error: 'SSE_UNREACHABLE',
                    message: `ESP32-CAM SSE stream at ${target}/events is unreachable (${err.message}).`,
                  })
                );
              }
            });
          },
        },
      },
    },
  };
});
