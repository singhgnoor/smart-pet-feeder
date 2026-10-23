/**
 * RestDeviceService — Real hardware communication implementation of DeviceService.
 *
 * Communicates with the physical ESP32-CAM (U2) and ESP32-WROOM (U1) smart pet feeder
 * via HTTP REST endpoints and Server-Sent Events (SSE) as defined in the Smart Pet Feeder
 * architecture specification.
 *
 * Topology:
 *   React Web App (browser) ──HTTP / SSE──▶ ESP32-CAM (U2) ──UART <CMD*HH>──▶ ESP32-WROOM (U1)
 */
import type {
  CommandAck,
  DeviceEventListener,
  DeviceStatus,
  RawLogRecord,
  RawPetVerdict,
  RawStateString,
  RawStatus,
  RawTelemetry,
  Snapshot,
} from '../types/device';
import { DeviceError } from '../types/device';
import type { DeviceService } from './deviceService';
import {
  localIso,
  statusFromRaw,
} from './protocol';

const REQUEST_TIMEOUT_MS = 6000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unsupported(operation: string): DeviceError {
  return new DeviceError('UNSUPPORTED', `${operation} is unavailable: the connected WROOM firmware has no handler for this operation.`);
}

export class RestDeviceService implements DeviceService {
  readonly mode = 'hardware' as const;

  private baseUrl: string;
  private eventSource: EventSource | null = null;
  private listeners = new Set<DeviceEventListener>();
  private pollTimer: number | null = null;
  private lastSnapshotObjectUrl: string | null = null;
  private isConnected = false;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  // ---------------------------------------------------------------------------
  // HTTP Helpers
  // ---------------------------------------------------------------------------

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.headers as Record<string, string>),
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Handle expected HTTP status codes per technical reference
      if (response.status === 202) {
        // 202 means accepted for processing. It is never evidence of completion.
        try {
          const payload: unknown = await response.json();
          if (!isRecord(payload) || payload.accepted !== true) {
            throw new DeviceError('UNKNOWN', `Malformed 202 response from ${endpoint}: accepted:true is required`);
          }
          return { ...payload, stage: 'cam-accepted' } as T;
        } catch (err) {
          if (err instanceof DeviceError) throw err;
          throw new DeviceError('UNKNOWN', `Malformed 202 response from ${endpoint}`);
        }
      }

      if (!response.ok) {
        let errData: { error?: string; message?: string; nak?: string } | null = null;
        try {
          errData = await response.json();
        } catch {
          /* non-json error body */
        }

        const msg = errData?.message || errData?.nak || errData?.error || response.statusText;

        if (response.status === 400) {
          throw new DeviceError('RANGE', msg || 'Invalid parameter range (must be 5 g to 200 g)');
        }
        if (response.status === 401) {
          throw new DeviceError('INVALID', 'Unauthorized: Invalid or missing X-API-Key');
        }
        if (response.status === 429) {
          throw new DeviceError('QUEUE_FULL', msg || 'Device busy: another feed is in progress');
        }
        if (response.status === 503) {
          throw new DeviceError('LINK_DOWN', msg || 'ESP32-CAM to ESP32-WROOM UART link is down');
        }
        if (response.status === 502) {
          throw new DeviceError('LINK_DOWN', msg || 'ESP32-CAM is unreachable via network');
        }

        throw new DeviceError('UNKNOWN', `HTTP ${response.status}: ${msg}`);
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof DeviceError) throw err;

      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new DeviceError('TIMEOUT', `Request to ${endpoint} timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }

      throw new DeviceError(
        'LINK_DOWN',
        `Network error reaching ${endpoint}: ${err instanceof Error ? err.message : 'Device offline'}`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // DeviceService Implementation
  // ---------------------------------------------------------------------------

  /** GET /api/status → { link, rssi, state, telem } */
  async getStatus(): Promise<DeviceStatus> {
    const raw = await this.request<RawStatus>('/api/status');
    if (!isRecord(raw) || typeof raw.link !== 'boolean' || typeof raw.rssi !== 'number' || !Number.isFinite(raw.rssi) ||
        typeof raw.state !== 'string' || !isRecord(raw.telem)) {
      throw new DeviceError('UNKNOWN', 'Malformed status response from ESP32-CAM');
    }
    const status = statusFromRaw(raw);
    // The CAM serves initialized defaults until the WROOM's first TELEM frame
    // arrives, so these values cannot be presented as sensor readings.
    status.telemetry = null;
    this.updateConnectionState(true);
    return status;
  }

  /** POST /api/feed {"grams": number} → 202 { id, accepted } */
  async feed(grams: number): Promise<CommandAck> {
    const validPortions = [10, 20, 30, 50];
    if (!validPortions.includes(grams)) {
      throw new DeviceError('RANGE', 'Manual portion must be 10 g, 20 g, 30 g, or 50 g');
    }
    return this.request<CommandAck>('/api/feed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grams: Math.round(grams) }),
    });
  }

  /** POST /api/abort → 202 */
  async abort(): Promise<CommandAck> {
    return this.request<CommandAck>('/api/abort', { method: 'POST' });
  }

  /** POST /api/clear → 202 (clears latched JAM / SENSOR fault) */
  async clearFault(): Promise<CommandAck> {
    return this.request<CommandAck>('/api/clear', { method: 'POST' });
  }

  /** GET /api/schedule → [{ i, hh, mm, g, en }, ...] */
  async getSchedule(): Promise<import('../types/device').FeedingSchedule[]> {
    throw unsupported('Reading the device schedule');
  }

  /** PUT /api/schedule [{ i, hh, mm, g, en }, ...] → 202 */
  async putSchedule(slots: import('../types/device').FeedingSchedule[]): Promise<CommandAck> {
    void slots;
    throw unsupported('Updating the device schedule');
  }

  /** GET /api/log → [{ slot, src, id, tgt, w0, w1, d, res, wig, top, ms, ts }, ...] */
  async getLog(): Promise<import('../types/device').FeedingEvent[]> {
    throw unsupported('Reading device feeding history');
  }

  /** GET /api/snapshot.jpg → latest camera frame */
  async getSnapshot(): Promise<Snapshot> {
    const url = `${this.baseUrl}/api/snapshot.jpg?t=${Date.now()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new DeviceError('BUSY', `Camera snapshot returned HTTP ${res.status}`);
      }

      if (!res.headers.get('content-type')?.toLowerCase().startsWith('image/jpeg')) {
        throw new DeviceError('UNKNOWN', 'Camera snapshot response was not image/jpeg');
      }

      const blob = await res.blob();
      if (blob.size === 0) throw new DeviceError('UNKNOWN', 'Camera snapshot was empty');
      if (this.lastSnapshotObjectUrl) {
        URL.revokeObjectURL(this.lastSnapshotObjectUrl);
      }
      const objectUrl = URL.createObjectURL(blob);
      this.lastSnapshotObjectUrl = objectUrl;

      return {
        url: objectUrl,
        capturedAt: localIso(),
        simulated: false,
      };
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof DeviceError) throw err;
      throw new DeviceError(
        'LINK_DOWN',
        `Live camera capture unavailable: ${err instanceof Error ? err.message : 'Device offline'}`
      );
    }
  }

  /** POST /api/tare → 202 */
  async tare(): Promise<CommandAck> {
    return this.request<CommandAck>('/api/tare', { method: 'POST' });
  }

  /** POST /api/calibrate {"known_g": number} → 202 { accepted, factor } */
  async calibrate(knownG: number): Promise<CommandAck & { factor?: number }> {
    void knownG;
    throw unsupported('Scale calibration');
  }

  /** POST /api/config { leftover_g, overshoot_g, daily_g, require_pet } → 202 */
  async setConfig(config: import('../types/device').FeederConfig): Promise<CommandAck> {
    void config;
    throw unsupported('Updating feeder configuration');
  }

  /** Returns current config (cached from previous setConfig or defaults) */
  async getConfig(): Promise<import('../types/device').FeederConfig> {
    throw unsupported('Reading feeder configuration');
  }

  /** Returns recent TinyML verdicts received via SSE */
  async getPetVisits(): Promise<import('../types/device').PetVisit[]> {
    return [];
  }

  // ---------------------------------------------------------------------------
  // Live Server-Sent Events (GET /events)
  // ---------------------------------------------------------------------------

  subscribe(listener: DeviceEventListener): () => void {
    this.listeners.add(listener);

    if (!this.eventSource) {
      this.initEventSource();
    } else if (this.isConnected) {
      // Immediately notify newly added listener of active connection
      listener({ type: 'connection', data: { state: 'connected' } });
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.closeEventSource();
      }
    };
  }

  async reconnect(): Promise<void> {
    this.closeEventSource();
    this.initEventSource();
    try {
      const st = await this.getStatus();
      // getStatus establishes CAM reachability only. The CAM's telemetry fields
      // are not attributable to fresh WROOM sensor data in the checked-in firmware.
      void st;
    } catch (err) {
      console.warn('[RestDevice] Reconnect getStatus failed:', err);
    }
  }

  private initEventSource(): void {
    const sseUrl = `${this.baseUrl}/events`;
    try {
      const es = new EventSource(sseUrl);
      this.eventSource = es;

      es.onopen = () => {
        this.updateConnectionState(true);
      };

      es.onerror = () => {
        this.updateConnectionState(false);
      };

      // 1. Telemetry frames (1 Hz idle, 4 Hz dispensing)
      es.addEventListener('telemetry', (e) => {
        try {
          // Current CAM periodically republishes its own default telemetry when
          // WROOM has not supplied a TELEM frame. Do not treat it as sensor data.
          JSON.parse(e.data) as RawTelemetry;
        } catch (err) {
          console.warn('[RestDevice] Malformed telemetry frame:', err);
        }
      });

      // 2. State transition updates
      es.addEventListener('status', (e) => {
        try {
          const raw = JSON.parse(e.data) as { st: RawStateString };
          this.emit({ type: 'status', data: raw });
        } catch (err) {
          console.warn('[RestDevice] Malformed status frame:', err);
        }
      });

      // 3. Completed feed log events
      es.addEventListener('log', (e) => {
        try {
          // CAM constructs a full-looking record from WROOM's amount-only LOG frame.
          JSON.parse(e.data) as RawLogRecord;
        } catch (err) {
          console.warn('[RestDevice] Malformed log event:', err);
        }
      });

      // 4. Pet detection verdicts from TinyML
      es.addEventListener('pet', (e) => {
        try {
          // CAM maps an IR edge to a fixed confidence; this is not a vision verdict.
          JSON.parse(e.data) as RawPetVerdict;
        } catch (err) {
          console.warn('[RestDevice] Malformed pet event:', err);
        }
      });

      // 5. Low hopper warning
      es.addEventListener('low_food', (e) => {
        try {
          const raw: unknown = JSON.parse(e.data);
          if (!isRecord(raw) || !Number.isFinite(raw.pct)) return;
          // The threshold alert is real, but CAM's percentage (12) is hard-coded.
          this.emit({ type: 'low_food', data: { pct: -1 } });
        } catch (err) {
          console.warn('[RestDevice] Malformed low_food event:', err);
        }
      });

      // 6. Device error / NAK
      es.addEventListener('error', (e: Event) => {
        // Distinguish SSE connection error from device error event
        if ('data' in e && typeof (e as MessageEvent).data === 'string') {
          try {
            const raw = JSON.parse((e as MessageEvent).data) as { err?: string; nak?: string };
            this.emit({ type: 'error', data: raw });
          } catch {
            /* ignore */
          }
        }
      });

      // Start fallback polling to check link when SSE is disconnected
      this.startFallbackPoll();
    } catch (err) {
      console.warn('[RestDevice] Failed to initialize EventSource:', err);
      this.updateConnectionState(false);
      this.startFallbackPoll();
    }
  }

  private closeEventSource(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private startFallbackPoll(): void {
    if (this.pollTimer !== null) return;
    // Check status every 5 seconds if connection is lost
    this.pollTimer = window.setInterval(async () => {
      if (!this.isConnected) {
        try {
          await this.getStatus();
        } catch {
          /* still offline */
        }
      }
    }, 5000);
  }

  private updateConnectionState(connected: boolean): void {
    if (this.isConnected !== connected) {
      this.isConnected = connected;
      this.emit({
        type: 'connection',
        data: { state: connected ? 'connected' : 'disconnected' },
      });
    }
  }

  private emit(event: Parameters<DeviceEventListener>[0]): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[RestDevice] Listener error:', err);
      }
    }
  }

}
