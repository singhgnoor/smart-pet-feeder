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
  FeederConfig,
  FeedingEvent,
  FeedingSchedule,
  PetVisit,
  RawLogRecord,
  RawPetVerdict,
  RawScheduleSlot,
  RawStateString,
  RawStatus,
  RawTelemetry,
  Snapshot,
} from '../types/device';
import { DeviceError } from '../types/device';
import type { DeviceService } from './deviceService';
import {
  configToRaw,
  eventFromLog,
  localIso,
  scheduleFromRaw,
  scheduleToRaw,
  statusFromRaw,
} from './protocol';

const HARDWARE_CONFIG_STORAGE_KEY = 'pawpilot.config.hardware';
const HARDWARE_VISITS_STORAGE_KEY = 'pawpilot.visits.hardware';
const REQUEST_TIMEOUT_MS = 6000;

export class RestDeviceService implements DeviceService {
  readonly mode = 'hardware' as const;

  private baseUrl: string;
  private apiKey: string;
  private eventSource: EventSource | null = null;
  private listeners = new Set<DeviceEventListener>();
  private visitRingBuffer: PetVisit[] = [];
  private pollTimer: number | null = null;
  private lastSnapshotObjectUrl: string | null = null;
  private isConnected = false;

  constructor(
    baseUrl = '',
    apiKey = import.meta.env.VITE_DEVICE_API_KEY || ''
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.loadPersistedVisits();
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

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Handle expected HTTP status codes per technical reference
      if (response.status === 202) {
        // Accepted (command endpoints)
        try {
          return (await response.json()) as T;
        } catch {
          return { accepted: true } as unknown as T;
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
    const status = statusFromRaw(raw);
    this.updateConnectionState(true);
    return status;
  }

  /** POST /api/feed {"grams": number} → 202 { id, accepted } */
  async feed(grams: number): Promise<CommandAck> {
    if (grams < 5 || grams > 200) {
      throw new DeviceError('RANGE', 'Portion size must be between 5 g and 200 g');
    }
    return this.request<CommandAck>('/api/feed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grams: Math.round(grams) }),
    });
  }

  /** POST /api/abort → 202 */
  async abort(): Promise<CommandAck> {
    return this.request<CommandAck>('/api/abort', {
      method: 'POST',
    });
  }

  /** POST /api/clear → 202 (clears latched JAM / SENSOR fault) */
  async clearFault(): Promise<CommandAck> {
    return this.request<CommandAck>('/api/clear', {
      method: 'POST',
    });
  }

  /** GET /api/schedule → [{ i, hh, mm, g, en }, ...] */
  async getSchedule(): Promise<FeedingSchedule[]> {
    try {
      const raw = await this.request<RawScheduleSlot[]>('/api/schedule');
      if (Array.isArray(raw)) {
        return scheduleFromRaw(raw);
      }
      return scheduleFromRaw([]);
    } catch (err) {
      console.warn('[RestDevice] Could not fetch schedule from hardware:', err);
      return scheduleFromRaw([]);
    }
  }

  /** PUT /api/schedule [{ i, hh, mm, g, en }, ...] → 202 */
  async putSchedule(slots: FeedingSchedule[]): Promise<CommandAck> {
    const raw = scheduleToRaw(slots);
    return this.request<CommandAck>('/api/schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(raw),
    });
  }

  /** GET /api/log → [{ slot, src, id, tgt, w0, w1, d, res, wig, top, ms, ts }, ...] */
  async getLog(): Promise<FeedingEvent[]> {
    try {
      const raw = await this.request<RawLogRecord[]>('/api/log');
      if (Array.isArray(raw)) {
        return raw.map((r) => eventFromLog(r, false));
      }
      return [];
    } catch (err) {
      console.warn('[RestDevice] Could not fetch log from hardware:', err);
      return [];
    }
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

      const blob = await res.blob();
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
    return this.request<CommandAck>('/api/tare', {
      method: 'POST',
    });
  }

  /** POST /api/calibrate {"known_g": number} → 202 { accepted, factor } */
  async calibrate(knownG: number): Promise<CommandAck & { factor?: number }> {
    return this.request<CommandAck & { factor?: number }>('/api/calibrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ known_g: knownG }),
    });
  }

  /** POST /api/config { leftover_g, overshoot_g, daily_g, require_pet } → 202 */
  async setConfig(config: FeederConfig): Promise<CommandAck> {
    const raw = configToRaw(config);
    const ack = await this.request<CommandAck>('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(raw),
    });

    // Cache locally since firmware has no GET /api/config
    try {
      localStorage.setItem(HARDWARE_CONFIG_STORAGE_KEY, JSON.stringify(config));
    } catch {
      /* ignore */
    }

    return ack;
  }

  /** Returns current config (cached from previous setConfig or defaults) */
  async getConfig(): Promise<FeederConfig> {
    try {
      const raw = localStorage.getItem(HARDWARE_CONFIG_STORAGE_KEY);
      if (raw) return JSON.parse(raw) as FeederConfig;
    } catch {
      /* ignore */
    }
    return {
      dailyLimitG: 300,
      leftoverThresholdG: 30,
      overshootMarginG: 3,
      requirePetDetection: false,
    };
  }

  /** Returns recent TinyML verdicts received via SSE */
  async getPetVisits(): Promise<PetVisit[]> {
    return [...this.visitRingBuffer];
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
      this.emit({ type: 'telemetry', data: {
        t: st.telemetry.deviceTime,
        w: st.telemetry.bowlWeightG,
        hop: st.telemetry.hopperPct,
        st: (st.telemetry.fault ?? st.telemetry.state) as RawStateString,
        ir: st.telemetry.petPresent ? 1 : 0,
        vis: st.telemetry.petVisitsToday,
        day: st.telemetry.dispensedTodayG,
        gate: st.telemetry.gateOpen ? 1 : 0,
      }});
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
          const raw = JSON.parse(e.data) as RawTelemetry;
          this.updateConnectionState(true);
          this.emit({ type: 'telemetry', data: raw });
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
          const raw = JSON.parse(e.data) as RawLogRecord;
          this.emit({ type: 'log', data: raw });
        } catch (err) {
          console.warn('[RestDevice] Malformed log event:', err);
        }
      });

      // 4. Pet detection verdicts from TinyML
      es.addEventListener('pet', (e) => {
        try {
          const raw = JSON.parse(e.data) as RawPetVerdict & { frames?: number[]; topClass?: 'pet' | 'person' | 'other'; ts?: string };
          const visit: PetVisit = {
            id: `hw-visit-${Date.now()}`,
            timestamp: raw.ts || localIso(),
            verdict: raw.pet === 1 ? 'PET' : 'NOPET',
            confidence: raw.conf,
            frames: raw.frames || [raw.conf, raw.conf, raw.conf],
            topClass: raw.topClass || (raw.pet === 1 ? 'pet' : 'other'),
            demo: false,
          };
          this.visitRingBuffer = [visit, ...this.visitRingBuffer].slice(0, 50);
          this.persistVisits();
          this.emit({
            type: 'pet',
            data: {
              pet: raw.pet,
              conf: raw.conf,
              frames: visit.frames,
              topClass: visit.topClass,
              ts: visit.timestamp,
            },
          });
        } catch (err) {
          console.warn('[RestDevice] Malformed pet event:', err);
        }
      });

      // 5. Low hopper warning
      es.addEventListener('low_food', (e) => {
        try {
          const raw = JSON.parse(e.data) as { pct: number };
          this.emit({ type: 'low_food', data: raw });
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

  private loadPersistedVisits(): void {
    try {
      const raw = localStorage.getItem(HARDWARE_VISITS_STORAGE_KEY);
      if (raw) {
        this.visitRingBuffer = JSON.parse(raw);
      }
    } catch {
      this.visitRingBuffer = [];
    }
  }

  private persistVisits(): void {
    try {
      localStorage.setItem(
        HARDWARE_VISITS_STORAGE_KEY,
        JSON.stringify(this.visitRingBuffer)
      );
    } catch {
      /* ignore */
    }
  }
}
