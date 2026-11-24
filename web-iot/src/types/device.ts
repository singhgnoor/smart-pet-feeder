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

export type FaultCode = 'JAM' | 'SENSOR' | 'RTC';

export type RawStateString = Exclude<FeederState, 'FAULT'> | FaultCode;

export type FeedResult =
  | 'OK'
  | 'SHORT'
  | 'OVER'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'SKIP_LEFTOVER'
  | 'SKIP_COOLDOWN'
  | 'SKIP_DAILY'
  | 'SKIP_NO_PET'
  | 'LOW_FOOD'
  | 'JAM'
  | 'SENSOR';

export type FeedSourceCode = 'S' | 'R' | 'I';
export type FeedSource = 'scheduled' | 'manual' | 'ir';

export interface RawTelemetry {
  t: string;
  w: number;
  hop: number;
  st: RawStateString;
  ir: 0 | 1;
  vis: number;
  day: number;
  gate: 0 | 1;
  cd?: number;
  cam?: 0 | 1;
}

export interface RawStatus {
  link: boolean;
  rssi: number;
  state: RawStateString;
  cam?: boolean;
  flash?: boolean;
  telem: RawTelemetry;
}

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

export interface RawScheduleSlot {
  i: number;
  hh: number;
  mm: number;
  g: number;
  en: 0 | 1;
}

export interface RawConfig {
  leftover_g: number;
  overshoot_g: number;
  daily_g: number;
  require_pet: boolean;
  cooldown_min?: number;
  ir_portion_g?: number;
}

export interface RawPetVerdict {
  pet: 0 | 1;
  conf: number;
}

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
  cooldownRemainingS: number;
  cameraOn: boolean;
  receivedAt: number;
}

export interface DeviceStatus {
  link: boolean;
  rssi: number;
  cameraOn?: boolean;
  flashOn?: boolean;
  telemetry: DeviceTelemetry | null;
}

export interface ActiveFeed {
  targetG: number;
  startWeightG: number;
  source: FeedSource;
  slot: number | null;
  startedAt: number;
}

export interface FeedingSchedule {
  slot: number;
  enabled: boolean;
  hour: number;
  minute: number;
  portionG: number;
}

export interface FeedingEvent {
  id: string;
  timestamp: string;
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
  demo?: boolean;
}

export type PetClass = 'pet' | 'person' | 'other';

export interface PetVisit {
  id: string;
  timestamp: string;
  verdict: 'PET' | 'NOPET';
  confidence: number;
  frames: number[];
  topClass: PetClass;
  demo?: boolean;
}

export interface FeederConfig {
  leftoverThresholdG: number;
  overshootMarginG: number;
  dailyLimitG: number;
  requirePetDetection: boolean;
  cooldownMin: number;
  irPortionG?: number;
}

export interface CalibrationInfo {
  factor: number;
  lastTaredAt: string | null;
  lastCalibratedAt: string | null;
  knownMassG: number | null;
}

export interface Snapshot {
  url: string;
  capturedAt: string;
  simulated: boolean;
}

export interface CommandAck {
  accepted: boolean;
  id?: number;
  message?: string;
  stage?: 'cam-accepted' | 'device-accepted' | 'started' | 'completed';
}

export class DeviceError extends Error {
  constructor(
    public code: 'LINK_DOWN' | 'RANGE' | 'BUSY' | 'FAULT' | 'QUEUE_FULL' | 'TIMEOUT' | 'INVALID' | 'UNSUPPORTED' | 'UNKNOWN',
    message: string,
  ) {
    super(message);
    this.name = 'DeviceError';
  }
}

export type DeviceEvent =
  | { type: 'telemetry'; data: RawTelemetry }
  | { type: 'status'; data: { st: RawStateString } }
  | { type: 'log'; data: RawLogRecord }
  | { type: 'pet'; data: RawPetVerdict & { frames: number[]; topClass: PetClass; ts: string } }
  | { type: 'camera'; data: { on: boolean } }
  | { type: 'low_food'; data: { pct: number } }
  | { type: 'error'; data: { err?: string; nak?: string } }
  | { type: 'connection'; data: { state: DeviceConnectionState } };

export type DeviceEventListener = (event: DeviceEvent) => void;
