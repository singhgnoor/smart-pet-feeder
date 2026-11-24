import type {
  CommandAck,
  DeviceEventListener,
  DeviceStatus,
  FeederConfig,
  FeedingEvent,
  FeedingSchedule,
  PetVisit,
  RawConfig,
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
  configFromRaw,
  configToRaw,
  eventFromLog,
  localIso,
  scheduleFromRaw,
  scheduleToRaw,
  statusFromRaw,
} from './protocol';

const REQUEST_TIMEOUT_MS = 6000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class RestDeviceService implements DeviceService {
  readonly mode = 'hardware' as const;

  private baseUrl: string;
  private eventSource: EventSource | null = null;
  private listeners = new Set<DeviceEventListener>();
  private pollTimer: number | null = null;
  private lastSnapshotObjectUrl: string | null = null;
  private isConnected = false;
  private recentVisits: PetVisit[] = [];

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
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

      if (response.status === 202) {
        const payload: unknown = await response.json();
        if (!isRecord(payload) || payload.accepted !== true) {
          throw new DeviceError('UNKNOWN', `Malformed 202 response from ${endpoint}`);
        }
        return { ...payload, stage: 'device-accepted' } as T;
      }

      if (!response.ok) {
        let errData: { error?: string; message?: string; nak?: string } | null = null;
        try {
          errData = await response.json();
        } catch {
          /* ignore */
        }
        const msg = errData?.message || errData?.nak || errData?.error || response.statusText;
        if (response.status === 400) throw new DeviceError('RANGE', msg || 'Invalid parameter range');
        if (response.status === 401) throw new DeviceError('INVALID', 'Unauthorized: Invalid X-API-Key');
        if (response.status === 429) throw new DeviceError('QUEUE_FULL', msg || 'Device busy');
        if (response.status === 503) throw new DeviceError('LINK_DOWN', msg || 'ESP32-CAM to ESP32-S UART link is down');
        if (response.status === 502) throw new DeviceError('LINK_DOWN', msg || 'ESP32-CAM unreachable');
        throw new DeviceError('UNKNOWN', `HTTP ${response.status}: ${msg}`);
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof DeviceError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new DeviceError('TIMEOUT', `Request to ${endpoint} timed out`);
      }
      throw new DeviceError(
        'LINK_DOWN',
        `Network error reaching ${endpoint}: ${err instanceof Error ? err.message : 'Device offline'}`
      );
    }
  }

  async getStatus(): Promise<DeviceStatus> {
    const raw = await this.request<RawStatus>('/api/status');
    if (!isRecord(raw) || typeof raw.link !== 'boolean' || !isRecord(raw.telem)) {
      throw new DeviceError('UNKNOWN', 'Malformed status response from ESP32-CAM');
    }
    const status = statusFromRaw(raw);
    this.updateConnectionState(true);
    return status;
  }

  async feed(grams: number, force = false): Promise<CommandAck> {
    if (grams < 5 || grams > 200) {
      throw new DeviceError('RANGE', 'Portion must be between 5 g and 200 g');
    }
    return this.request<CommandAck>('/api/feed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grams: Math.round(grams), force }),
    });
  }

  async abort(): Promise<CommandAck> {
    return this.request<CommandAck>('/api/abort', { method: 'POST' });
  }

  async clearFault(): Promise<CommandAck> {
    return this.request<CommandAck>('/api/clear', { method: 'POST' });
  }

  async getSchedule(): Promise<FeedingSchedule[]> {
    const raw = await this.request<RawScheduleSlot[]>('/api/schedule');
    return Array.isArray(raw) ? scheduleFromRaw(raw) : [];
  }

  async putSchedule(slots: FeedingSchedule[]): Promise<CommandAck> {
    return this.request<CommandAck>('/api/schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scheduleToRaw(slots)),
    });
  }

  async getLog(): Promise<FeedingEvent[]> {
    const raw = await this.request<RawLogRecord[]>('/api/log');
    return Array.isArray(raw) ? raw.map((r) => eventFromLog(r, false)) : [];
  }

  async getSnapshot(wake = false): Promise<Snapshot> {
    const url = `${this.baseUrl}/api/snapshot.jpg?t=${Date.now()}${wake ? '&wake=1' : ''}`;
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
      if (this.lastSnapshotObjectUrl) URL.revokeObjectURL(this.lastSnapshotObjectUrl);
      const objectUrl = URL.createObjectURL(blob);
      this.lastSnapshotObjectUrl = objectUrl;

      return { url: objectUrl, capturedAt: localIso(), simulated: false };
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof DeviceError) throw err;
      throw new DeviceError(
        'LINK_DOWN',
        `Live camera capture unavailable: ${err instanceof Error ? err.message : 'Device offline'}`
      );
    }
  }

  async tare(): Promise<CommandAck> {
    return this.request<CommandAck>('/api/tare', { method: 'POST' });
  }

  async calibrate(knownG: number): Promise<CommandAck & { factor?: number }> {
    return this.request<CommandAck & { factor?: number }>('/api/calibrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ known_g: knownG }),
    });
  }

  async setConfig(config: FeederConfig): Promise<CommandAck> {
    return this.request<CommandAck>('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configToRaw(config)),
    });
  }

  async getConfig(): Promise<FeederConfig> {
    const raw = await this.request<RawConfig>('/api/config');
    return configFromRaw(raw);
  }

  async getPetVisits(): Promise<PetVisit[]> {
    return this.recentVisits;
  }

  async setCamera(on: boolean): Promise<{ on: boolean }> {
    return this.request<{ on: boolean }>('/api/camera', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on }),
    });
  }

  async setFlash(on: boolean): Promise<{ flash: string }> {
    return this.request<{ flash: string }>('/api/flash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on }),
    });
  }

  async syncTime(): Promise<CommandAck> {
    const now = new Date();
    return this.request<CommandAck>('/api/time', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
        hour: now.getHours(),
        minute: now.getMinutes(),
        second: now.getSeconds(),
      }),
    });
  }

  subscribe(listener: DeviceEventListener): () => void {
    this.listeners.add(listener);
    if (!this.eventSource) {
      this.initEventSource();
    } else if (this.isConnected) {
      listener({ type: 'connection', data: { state: 'connected' } });
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.closeEventSource();
    };
  }

  async reconnect(): Promise<void> {
    this.closeEventSource();
    this.initEventSource();
    try {
      await this.getStatus();
    } catch {
      /* handled by caller */
    }
  }

  private initEventSource(): void {
    const sseUrl = `${this.baseUrl}/events`;
    try {
      const es = new EventSource(sseUrl);
      this.eventSource = es;

      es.onopen = () => this.updateConnectionState(true);
      es.onerror = () => this.updateConnectionState(false);

      es.addEventListener('telemetry', (e) => {
        try {
          const raw = JSON.parse(e.data) as RawTelemetry;
          this.emit({ type: 'telemetry', data: raw });
        } catch {
          /* ignore */
        }
      });

      es.addEventListener('status', (e) => {
        try {
          const raw = JSON.parse(e.data) as { st: RawStateString };
          this.emit({ type: 'status', data: raw });
        } catch {
          /* ignore */
        }
      });

      es.addEventListener('log', (e) => {
        try {
          const raw = JSON.parse(e.data) as RawLogRecord;
          this.emit({ type: 'log', data: raw });
        } catch {
          /* ignore */
        }
      });

      es.addEventListener('pet', (e) => {
        try {
          const raw = JSON.parse(e.data) as RawPetVerdict;
          const ts = localIso();
          const visit: PetVisit = {
            id: `v-${ts}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: ts,
            verdict: raw.pet ? 'PET' : 'NOPET',
            confidence: raw.conf ?? 100,
            frames: [1],
            topClass: 'pet',
          };
          this.recentVisits = [visit, ...this.recentVisits].slice(0, 60);
          this.emit({ type: 'pet', data: { ...raw, frames: [1], topClass: 'pet', ts } });
        } catch {
          /* ignore */
        }
      });

      es.addEventListener('camera', (e) => {
        try {
          const raw = JSON.parse(e.data) as { on: boolean };
          this.emit({ type: 'camera', data: { on: Boolean(raw.on) } });
        } catch {
          /* ignore */
        }
      });

      es.addEventListener('low_food', (e) => {
        try {
          const raw: unknown = JSON.parse(e.data);
          if (!isRecord(raw) || !Number.isFinite(raw.pct)) return;
          this.emit({ type: 'low_food', data: { pct: Number(raw.pct) } });
        } catch {
          /* ignore */
        }
      });

      es.addEventListener('error', (e: Event) => {
        if ('data' in e && typeof (e as MessageEvent).data === 'string') {
          try {
            const raw = JSON.parse((e as MessageEvent).data) as { err?: string; nak?: string };
            this.emit({ type: 'error', data: raw });
          } catch {
            /* ignore */
          }
        }
      });

      this.startFallbackPoll();
    } catch {
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
