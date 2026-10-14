/**
 * Device service contract.
 *
 * Every method corresponds to an endpoint of the ESP32-CAM web API described in the
 * Smart Pet Feeder technical reference:
 *
 *   Browser ──HTTP/SSE──▶ ESP32-CAM (U2) ──UART <CMD*HH>──▶ ESP32-WROOM (U1)
 *
 * The UI talks ONLY to this interface. Today it is implemented by `MockDeviceService`
 * (a full in-browser simulation of U1 + U2). A future `RestDeviceService` can implement the
 * same interface with `fetch()` and `EventSource` without touching any component.
 * See README.md → "Switching to the real ESP32 API".
 */
import type {
  CommandAck,
  DeviceEventListener,
  DeviceStatus,
  FaultCode,
  FeederConfig,
  FeedingEvent,
  FeedingSchedule,
  PetVisit,
  Snapshot,
} from '../types/device';
import { MockDeviceService } from './mockDevice';

export interface DeviceService {
  /** 'mock' while running the in-browser simulation. */
  readonly mode: 'mock' | 'rest';

  /** GET /api/status → `{link, rssi, state, telem}` */
  getStatus(): Promise<DeviceStatus>;
  /** POST /api/feed `{"grams":50}` → 202 `{id, accepted}`; result arrives as a `log` event. */
  feed(grams: number): Promise<CommandAck>;
  /** POST /api/abort → closes the gate and aborts the active feed. */
  abort(): Promise<CommandAck>;
  /** POST /api/clear → clears a latched fault (JAM / SENSOR). */
  clearFault(): Promise<CommandAck>;
  /** GET /api/schedule → `[{i,hh,mm,g,en}]` */
  getSchedule(): Promise<FeedingSchedule[]>;
  /** PUT /api/schedule `[{i,hh,mm,g,en}, ...]` */
  putSchedule(slots: FeedingSchedule[]): Promise<CommandAck>;
  /** GET /api/log → most recent LOG records. Returned newest first. */
  getLog(): Promise<FeedingEvent[]>;
  /** GET /api/snapshot.jpg → latest camera capture. */
  getSnapshot(): Promise<Snapshot>;
  /** POST /api/tare */
  tare(): Promise<CommandAck>;
  /** POST /api/calibrate `{"known_g":200}` → ACK carries the new counts-per-gram factor. */
  calibrate(knownG: number): Promise<CommandAck & { factor?: number }>;
  /** POST /api/config `{leftover_g, overshoot_g, daily_g, require_pet}` */
  setConfig(config: FeederConfig): Promise<CommandAck>;
  /**
   * Current feeder configuration. Not part of the reference API: a REST implementation can
   * cache the last POSTed config locally (or the firmware can add `GET /api/config`).
   */
  getConfig(): Promise<FeederConfig>;
  /**
   * Recent TinyML verdicts. The real device only pushes these as SSE `pet` events, so a REST
   * implementation would keep a small client-side ring buffer.
   */
  getPetVisits(): Promise<PetVisit[]>;

  /** GET /events — subscribe to live SSE events. Returns an unsubscribe function. */
  subscribe(listener: DeviceEventListener): () => void;
  /** Re-open the live event stream (EventSource) and resynchronise. */
  reconnect(): Promise<void>;

  /** Demo-only controls. `undefined` on a real device. */
  readonly demo?: DemoControls;
}

/** Controls that exist only in the simulation, used for demonstrations. */
export interface DemoControls {
  simulateConnectionLoss(): void;
  injectFault(code: FaultCode): void;
  /** Trigger the IR sensor; `kind` controls what the simulated camera "sees". */
  triggerVisit(kind?: 'pet' | 'person' | 'other'): void;
  refillHopper(): void;
  /** Pretend the pet has eaten everything in the bowl. */
  emptyBowl(): void;
  /** Restore the original sample telemetry, schedules, history and configuration. */
  reset(): Promise<void>;
}

/**
 * Factory. Swap the implementation here when the hardware is ready, e.g.
 *   return new RestDeviceService(import.meta.env.VITE_FEEDER_URL, apiKey);
 */
export function createDeviceService(): DeviceService {
  return new MockDeviceService();
}
