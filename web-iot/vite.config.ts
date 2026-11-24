import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

declare const process: {
  cwd: () => string;
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const espHost = env.VITE_ESP32_HOST || '192.168.4.1';
  const espPort = env.VITE_ESP32_PORT || '80';
  const deviceApiKey = env.DEVICE_API_KEY || env.VITE_DEVICE_API_KEY || 'change-me';
  const target = `http://${espHost}:${espPort}`;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      open: false,
      proxy: {
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
              if (!res.headersSent && 'writeHead' in res) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({
                    error: 'DEVICE_UNREACHABLE',
                    message: `ESP32-CAM at ${target} is unreachable (${err.message}). Connect to Wi-Fi AP "PetFeeder".`,
                  })
                );
              }
            });
          },
        },
        '/events': {
          target,
          changeOrigin: true,
          secure: false,
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
