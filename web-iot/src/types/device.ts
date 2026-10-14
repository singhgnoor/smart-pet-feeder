/**
 * Device data model for the Smart Pet Feeder.
 *
 * Two layers of types live here:
 *  1. "Wire" types (Raw*) that mirror the JSON exchanged by the ESP32-CAM REST/SSE API
 *     exactly as described in the technical reference (short keys such as `w`, `hop`, `st`).
 *  2. Friendly UI types (DeviceTelemetry, FeedingEvent, ...) that components consume.
 *
 * The mapping functions in `services/protocol.ts` convert between them, so the UI never
 * needs to know about protocol abbreviations.
 */

/* ------------------------------------------------------------------ */
/* Protocol enums                                                      */
/* ------------------------------------------------------------------ */

/** Feeding state machine states run by the ESP32-WROOM (U1). */
export type FeederState =
  | 'IDLE'
  | 'PRECHECK'
  | 'WAIT_PET'
  | 'DISPENSING'
  | 'WIGGLE'
  | 'SETTLING'
  | 'TOPUP'
  | 'REPORT'
  | 'FAULT';

/** Fault / warning codes reported in place of the state name (`STATUS:JAM`, ...). */
export type FaultCode = 'JAM' | 'SENSOR' | 'RTC';

/** Raw `st` value on the wire — either a state name or a fault code. */
export type RawStateString = Exclude<FeederState, 'FAULT'> | FaultCode;

/** Result codes carried in `LOG` records. */
export type FeedResult =
  | 'OK'
  | 'SHORT'
  | 'OVER'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'SKIP_LEFTOVER'
  | 'SKIP_DAILY'
  | 'SKIP_NO_PET'
  | 'LOW_FOOD'
  | 'JAM'
  | 'SENSOR';

/** `S` = scheduled by U1, `R` = remote / manual request from the dashboard. */
export type FeedSourceCode = 'S' | 'R';
export type FeedSource = 'scheduled' | 'manual';

/* ------------------------------------------------------------------ */
/* Wire types (match the reference JSON)                               */
/* ------------------------------------------------------------------ */

/** `TELEM:{...}` frame / SSE `telemetry` event. 1 Hz idle, 4 Hz while dispensing. */
export interface RawTelemetry {
  /** Device local time, HH:MM:SS (DS3231 RTC). */
  t: string;
  /** Bowl weight in grams (HX711). */
  w: number;
  /** Hopper fill percentage (HC-SR04), -1 when unknown. */
  hop: number;
  /** State name or fault code. */
  st: RawStateString;
  /** Debounced IR presence, 0/1. */
  ir: 0 | 1;
  /** Pet visits confirmed by TinyML verdicts. */
  vis: number;
  /** Grams dispensed today. */
  day: number;
  /** Gate servo position, 1 = open. */
  gate: 0 | 1;
}

/** `GET /api/status` response. */
export interface RawStatus {
  link: boolean;
  rssi: number;
  state: RawStateString;
  telem: RawTelemetry;
}

/** `LOG:{...}` record / SSE `log` event / `GET /api/log` item. */
export interface RawLogRecord {
  slot: number;
  src: FeedSourceCode;
  id: number;
  tgt: number;
  w0: number;
  w1: number;
  d: number;
  res: FeedResult;
  wig: number;
  top: number;
  ms: number;
  ts: string;
}

/** `GET/PUT /api/schedule` item. */
export interface RawScheduleSlot {
  i: number;
  hh: number;
  mm: number;
  g: number;
  en: 0 | 1;
}

/** `POST /api/config` body. `daily_g` maps to the `CFG:daily=` UART key. */
export interface RawConfig {
  leftover_g: number;
  overshoot_g: number;
  daily_g: number;
  require_pet: boolean;
}

/** SSE `pet` payload: TinyML verdict. */
export interface RawPetVerdict {
  pet: 0 | 1;
  conf: number;
}

/* ------------------------------------------------------------------ */
/* UI-facing types                                                     */
/* ------------------------------------------------------------------ */

export type DeviceConnectionState = 'connected' | 'connecting' | 'disconnected';

export interface DeviceTelemetry {
  deviceTime: string;
  bowlWeightG: number;
  hopperPct: number;
  state: FeederState;
  fault: FaultCode | null;
  petPresent: boolean;
  petVisitsToday: number;
  dispensedTodayG: number;
  gateOpen: boolean;
  /** Browser timestamp (ms) when this frame was received. */
  receivedAt: number;
}

export interface DeviceStatus {
  /** UART link between the ESP32-CAM and the ESP32-WROOM. */
  link: boolean;
  rssi: number;
  /** Null when the reported values cannot be distinguished from CAM defaults. */
  telemetry: DeviceTelemetry | null;
}

/** Live progress of the job currently running on the feeder (derived client-side). */
export interface ActiveFeed {
  targetG: number;
  startWeightG: number;
  source: FeedSource;
  slot: number | null;
  startedAt: number;
}

export interface FeedingSchedule {
  slot: number; // 0..3
  enabled: boolean;
  hour: number;
  minute: number;
  portionG: number;
}

export interface FeedingEvent {
  id: string;
  timestamp: string; // ISO, device local time
  source: FeedSource;
  slot: number | null;
  targetG: number;
  dispensedG: number;
  initialWeightG: number;
  finalWeightG: number;
  result: FeedResult;
  durationMs: number;
  wiggles: number;
  topups: number;
  /** True for the sample records generated on first launch. */
  demo?: boolean;
}

export type PetClass = 'pet' | 'person' | 'other';

export interface PetVisit {
  id: string;
  timestamp: string;
  /** Final verdict after 2-of-3 temporal voting. */
  verdict: 'PET' | 'NOPET';
  /** Highest p(pet) of the three frames, 0–100. */
  confidence: number;
  /** p(pet) of each of the three frames, 0–1. */
  frames: number[];
  /** Simulated top class, purely illustrative. */
  topClass: PetClass;
  demo?: boolean;
}

export interface FeederConfig {
  leftoverThresholdG: number;
  overshootMarginG: number;
  dailyLimitG: number;
  requirePetDetection: boolean;
}

export interface CalibrationInfo {
  factor: number;
  lastTaredAt: string | null;
  lastCalibratedAt: string | null;
  knownMassG: number | null;
}

export interface Snapshot {
  /** Image URL (object URL for a real JPEG; data URL for the simulated scene). */
  url: string;
  capturedAt: string;
  simulated: boolean;
}

/** Acknowledgement returned by command endpoints (HTTP 202 on the real device). */
export interface CommandAck {
  accepted: boolean;
  id?: number;
  message?: string;
  /** An HTTP 202 from the current CAM proves only that the CAM accepted the HTTP request. */
  stage?: 'cam-accepted' | 'device-accepted' | 'started' | 'completed';
}

/** Error raised by the service; `code` mirrors HTTP/NAK reasons from the reference. */
export class DeviceError extends Error {
  constructor(
    public code: 'LINK_DOWN' | 'RANGE' | 'BUSY' | 'FAULT' | 'QUEUE_FULL' | 'TIMEOUT' | 'INVALID' | 'UNSUPPORTED' | 'UNKNOWN',
    message: string,
  ) {
    super(message);
    this.name = 'DeviceError';
  }
}

/* ------------------------------------------------------------------ */
/* Live events (GET /events)                                           */
/* ------------------------------------------------------------------ */

export type DeviceEvent =
  | { type: 'telemetry'; data: RawTelemetry }
  | { type: 'status'; data: { st: RawStateString } }
  | { type: 'log'; data: RawLogRecord }
  | { type: 'pet'; data: RawPetVerdict & { frames: number[]; topClass: PetClass; ts: string } }
  | { type: 'low_food'; data: { pct: number } }
  | { type: 'error'; data: { err?: string; nak?: string } }
  /** Transport-level event (EventSource open / error). Not a device frame. */
  | { type: 'connection'; data: { state: DeviceConnectionState } };

export type DeviceEventListener = (event: DeviceEvent) => void;
