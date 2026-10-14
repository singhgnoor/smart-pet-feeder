/**
 * Protocol mapping helpers: convert between the compact wire JSON described in the
 * Smart Pet Feeder technical reference and the friendly types used by the UI.
 * These are transport-agnostic and are shared by the mock and any future REST service.
 */
import type {
  DeviceStatus,
  DeviceTelemetry,
  FaultCode,
  FeederConfig,
  FeederState,
  FeedingEvent,
  FeedingSchedule,
  RawConfig,
  RawLogRecord,
  RawScheduleSlot,
  RawStateString,
  RawStatus,
  RawTelemetry,
} from '../types/device';

const FAULTS: FaultCode[] = ['JAM', 'SENSOR', 'RTC'];

/** Split a raw `st` string into a state + optional fault code. RTC is a warning, not a latched fault. */
export function parseState(st: RawStateString): { state: FeederState; fault: FaultCode | null } {
  if ((FAULTS as string[]).includes(st)) {
    const fault = st as FaultCode;
    return { state: fault === 'RTC' ? 'IDLE' : 'FAULT', fault };
  }
  return { state: st as FeederState, fault: null };
}

export function telemetryFromRaw(raw: RawTelemetry, receivedAt = Date.now()): DeviceTelemetry {
  const { state, fault } = parseState(raw.st);
  return {
    deviceTime: raw.t,
    bowlWeightG: raw.w,
    hopperPct: raw.hop,
    state,
    fault,
    petPresent: raw.ir === 1,
    petVisitsToday: raw.vis,
    dispensedTodayG: raw.day,
    gateOpen: raw.gate === 1,
    receivedAt,
  };
}

export function statusFromRaw(raw: RawStatus): DeviceStatus {
  return { link: raw.link, rssi: raw.rssi, telemetry: telemetryFromRaw(raw.telem) };
}

export function eventFromLog(raw: RawLogRecord, demo = false): FeedingEvent {
  return {
    id: `${raw.ts}-${raw.id}-${raw.slot}-${raw.res}`,
    timestamp: raw.ts,
    source: raw.src === 'S' ? 'scheduled' : 'manual',
    slot: raw.slot >= 0 ? raw.slot : null,
    targetG: raw.tgt,
    dispensedG: Math.max(0, raw.d),
    initialWeightG: raw.w0,
    finalWeightG: raw.w1,
    result: raw.res,
    durationMs: raw.ms,
    wiggles: raw.wig,
    topups: raw.top,
    demo: demo || undefined,
  };
}

export function scheduleFromRaw(raw: RawScheduleSlot[]): FeedingSchedule[] {
  const slots: FeedingSchedule[] = [0, 1, 2, 3].map((i) => ({ slot: i, enabled: false, hour: 8, minute: 0, portionG: 50 }));
  for (const r of raw) {
    if (r.i >= 0 && r.i < 4) slots[r.i] = { slot: r.i, enabled: r.en === 1, hour: r.hh, minute: r.mm, portionG: r.g };
  }
  return slots;
}

export function scheduleToRaw(slots: FeedingSchedule[]): RawScheduleSlot[] {
  return slots.map((s) => ({ i: s.slot, hh: s.hour, mm: s.minute, g: s.portionG, en: s.enabled ? 1 : 0 }));
}

export function configFromRaw(raw: RawConfig): FeederConfig {
  return {
    leftoverThresholdG: raw.leftover_g,
    overshootMarginG: raw.overshoot_g,
    dailyLimitG: raw.daily_g,
    requirePetDetection: raw.require_pet,
  };
}

export function configToRaw(cfg: FeederConfig): RawConfig {
  return {
    leftover_g: cfg.leftoverThresholdG,
    overshoot_g: cfg.overshootMarginG,
    daily_g: cfg.dailyLimitG,
    require_pet: cfg.requirePetDetection,
  };
}

/** Local ISO-like timestamp without timezone, as produced by the DS3231 (`2026-10-13T08:00:12`). */
export function localIso(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function hhmmss(d = new Date()): string {
  return localIso(d).slice(11);
}

export function dayKey(d = new Date()): string {
  return localIso(d).slice(0, 10);
}
