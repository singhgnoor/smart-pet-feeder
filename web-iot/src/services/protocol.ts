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
    cooldownRemainingS: typeof raw.cd === 'number' && Number.isFinite(raw.cd) ? raw.cd : 0,
    cameraOn: raw.cam === 1,
    receivedAt,
  };
}

export function statusFromRaw(raw: RawStatus): DeviceStatus {
  return {
    link: raw.link,
    rssi: raw.rssi,
    cameraOn: raw.cam,
    flashOn: raw.flash,
    telemetry: telemetryFromRaw(raw.telem),
  };
}

export function eventFromLog(raw: RawLogRecord, demo = false): FeedingEvent {
  const source = raw.src === 'S' ? 'scheduled' : raw.src === 'I' ? 'ir' : 'manual';
  return {
    id: `${raw.ts}-${raw.id}-${raw.slot}-${raw.res}`,
    timestamp: raw.ts,
    source,
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
  const slots: FeedingSchedule[] = [0, 1, 2, 3].map((i) => ({ slot: i, enabled: false, hour: 8, minute: 0, portionG: 30 }));
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
    leftoverThresholdG: raw.leftover_g ?? 200,
    overshootMarginG: raw.overshoot_g ?? 3,
    dailyLimitG: raw.daily_g ?? 300,
    requirePetDetection: Boolean(raw.require_pet),
    cooldownMin: typeof raw.cooldown_min === 'number' ? raw.cooldown_min : 10,
    irPortionG: typeof raw.ir_portion_g === 'number' ? raw.ir_portion_g : 20,
  };
}

export function configToRaw(cfg: FeederConfig): RawConfig {
  return {
    leftover_g: cfg.leftoverThresholdG,
    overshoot_g: cfg.overshootMarginG,
    daily_g: cfg.dailyLimitG,
    require_pet: cfg.requirePetDetection,
    cooldown_min: cfg.cooldownMin,
    ir_portion_g: cfg.irPortionG ?? 20,
  };
}

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
