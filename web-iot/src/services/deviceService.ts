/**
 * Device service contract.
 *
 * This abstraction supports the mock feature set and the verified subset of the
 * current CAM API. Hardware methods may reject as UNSUPPORTED when the WROOM
 * firmware cannot perform or confirm the operation:
 *
 *   Browser ──HTTP/SSE──▶ ESP32-CAM (U2) ──UART <CMD*HH>──▶ ESP32-WROOM (U1)
 *
 * The UI talks ONLY to this interface. It is implemented by:
 *  - `RestDeviceService`: communicates with the real ESP32-CAM HTTP server and SSE stream.
 *  - `MockDeviceService`: full in-browser simulation of U1 + U2 for development/testing.
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
import { RestDeviceService } from './restDevice';

export type DeviceMode = 'hardware' | 'mock';

export interface DeviceService {
  /** 'hardware' when communicating with the physical ESP32-CAM, 'mock' when simulating. */
  readonly mode: DeviceMode;

  /** GET /api/status; hardware telemetry may be null when CAM defaults are unverifiable. */
  getStatus(): Promise<DeviceStatus>;
  /** POST /api/feed; hardware 202 reports CAM acceptance only until correlated device results exist. */
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
   * implementation keeps a client-side ring buffer.
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

export { MockDeviceService, RestDeviceService };

/**
 * Factory. Creates either real hardware REST service or mock simulation service.
 */
export function createDeviceService(mode?: DeviceMode): DeviceService {
  const chosenMode =
    mode ??
    ((import.meta.env.VITE_DEVICE_MODE as DeviceMode) === 'hardware' ? 'hardware' : 'mock');

  if (chosenMode === 'hardware') {
    return new RestDeviceService();
  }
  return new MockDeviceService();
}
