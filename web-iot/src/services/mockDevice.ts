/**
 * MockDeviceService — an in-browser simulation of the Smart Pet Feeder.
 *
 * It mimics BOTH microcontrollers from the technical reference:
 *  - ESP32-WROOM (U1): closed-loop feeding state machine (PRECHECK → DISPENSING → SETTLING →
 *    TOPUP → REPORT), jam wiggle, leftover / daily-limit / low-food checks, IR debounce and
 *    cooldown, scheduler with a persisted "fed today" token, telemetry at 1 Hz / 4 Hz.
 *  - ESP32-CAM (U2): REST-style command methods, SSE-style event stream, TinyML verdicts
 *    using 3-frame / 2-vote temporal voting, and the latest snapshot.
 *
 * Nothing here touches the network. Persistent data (schedule, config, log, visits and
 * sensor state) is stored in localStorage to stand in for the device's NVS / LittleFS.
 */
import { DEFAULT_CAL_FACTOR, DEFAULT_CONFIG, DEFAULT_SCHEDULE, HOPPER_CAPACITY_G, buildDemoSeed } from '../data/demoData';
import type { StoredLog } from '../data/demoData';
import {
  DeviceError,
  type CommandAck,
  type DeviceEvent,
  type DeviceEventListener,
  type DeviceStatus,
  type FaultCode,
  type FeedResult,
  type FeederConfig,
  type FeederState,
  type FeedingEvent,
  type FeedingSchedule,
  type PetClass,
  type PetVisit,
  type RawConfig,
  type RawScheduleSlot,
  type RawStateString,
  type RawTelemetry,
  type Snapshot,
} from '../types/device';
import type { DemoControls, DeviceService } from './deviceService';
import { renderScene, type SceneInput } from './mockSnapshot';
import {
  configFromRaw,
  configToRaw,
  dayKey,
  eventFromLog,
  hhmmss,
  localIso,
  scheduleFromRaw,
  scheduleToRaw,
  statusFromRaw,
} from './protocol';

const STORAGE_KEY = 'pawpilot.device.v1';
const LOG_LIMIT = 200;
const VISIT_LIMIT = 60;

/* Firmware tunables, copied from the U1 sketch in the reference. */
const TOL_G = 2.0;
const BOWL_MAX_G = 500;
const BOWL_MIN_G = -20;
const RISE_MIN_G = 0.4;
const MAX_DISPENSE_MS = 8000;
const JAM_MS = 2500;
const JAM_GRACE_MS = 1000;
const SETTLE_MS = 1500;
const TOPUP_MS = 250;
const WIGGLE_STEP_MS = 250;
const MAX_WIGGLES = 2;
const MAX_TOPUPS = 2;
const GRACE_MIN = 5;
const IR_COOLDOWN_MS = 10_000;
const HOP_LOW_PCT = 15;
const PET_THRESHOLD = 0.75;
/* Simulation-only timings. */
const PET_WAIT_MS = 45_000; // firmware uses 120 s; shortened for demos
const PRECHECK_MS = 900; // ~8 HX711 samples
const REPORT_MS = 450; // keep REPORT visible briefly in the UI
const TICK_MS = 50;
const FALL_TAU_S = 0.11; // kibble in flight down the 60–80 mm chute

type Subject = SceneInput['subject'];

interface Persisted {
  version: 1;
  schedule: RawScheduleSlot[];
  config: RawConfig;
  log: StoredLog[];
  visits: PetVisit[];
  hopperG: number;
  bowlG: number;
  dayKey: string;
  dayG: number;
  visitsToday: number;
  lastRun: Record<number, string>;
  feedId: number;
  calFactor: number;
  lastCapture: { at: string; subject: Subject; bowlG: number } | null;
}

interface Job {
  tgt: number;
  src: 'S' | 'R';
  slot: number;
  id: number;
  w0: number;
  w1: number;
  t0: number;
  timedOut: boolean;
  wig: number;
  top: number;
  result: FeedResult | null;
  lastRiseW: number;
  lastRiseMs: number;
  wigglePhase: number;
  phaseMs: number;
  flow: number;
  stallAt: number | null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const round1 = (n: number) => Math.round(n * 10) / 10;
const gauss = () => {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

function seedState(): Persisted {
  const s = buildDemoSeed();
  const lastVisit = [...s.visits].reverse().find((v) => v.verdict === 'PET');
  return {
    version: 1,
    schedule: DEFAULT_SCHEDULE.map((x) => ({ ...x })),
    config: { ...DEFAULT_CONFIG },
    log: s.log,
    visits: s.visits,
    hopperG: HOPPER_CAPACITY_G * 0.72,
    bowlG: 18.4,
    dayKey: dayKey(),
    dayG: s.dayG,
    visitsToday: s.visitsToday,
    lastRun: s.lastRun,
    feedId: 0,
    calFactor: DEFAULT_CAL_FACTOR,
    lastCapture: lastVisit ? { at: lastVisit.timestamp, subject: 'dog', bowlG: 22 } : null,
  };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Load persisted device state, falling back to fresh demo data on any inconsistency. */
function loadState(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const p = JSON.parse(raw) as Partial<Persisted>;
    const ok =
      p &&
      p.version === 1 &&
      Array.isArray(p.schedule) &&
      p.schedule.length === 4 &&
      p.schedule.every((s) => isNum(s.i) && isNum(s.hh) && isNum(s.mm) && isNum(s.g)) &&
      Array.isArray(p.log) &&
      Array.isArray(p.visits) &&
      p.config &&
      isNum(p.config.leftover_g) &&
      isNum(p.config.overshoot_g) &&
      isNum(p.config.daily_g) &&
      isNum(p.hopperG) &&
      isNum(p.bowlG) &&
      isNum(p.dayG);
    if (!ok) return seedState();
    return {
      ...(p as Persisted),
      log: p.log!.filter((r) => r && typeof r.ts === 'string' && isNum(r.tgt)).slice(-LOG_LIMIT),
      visits: p.visits!.filter((v) => v && typeof v.timestamp === 'string').slice(-VISIT_LIMIT),
      lastRun: p.lastRun ?? {},
      feedId: isNum(p.feedId) ? p.feedId : 0,
      calFactor: isNum(p.calFactor) ? p.calFactor : DEFAULT_CAL_FACTOR,
      visitsToday: isNum(p.visitsToday) ? p.visitsToday : 0,
      dayKey: typeof p.dayKey === 'string' ? p.dayKey : dayKey(),
      lastCapture: p.lastCapture ?? null,
    };
  } catch {
    return seedState();
  }
}

export class MockDeviceService implements DeviceService {
  readonly mode = 'mock' as const;
  readonly demo: DemoControls;

  private p: Persisted = loadState();

  // U1 runtime state
  private st: FeederState = 'IDLE';
  private fault: FaultCode | null = null;
  private rtcWarn = false;
  private stSince = Date.now();
  private gateOpen = false;
  private airborne = 0;
  private stalled = false;
  private job: Job | null = null;
  private wt = this.p.bowlG;
  private lowSent = false;

  // IR / camera / TinyML
  private ir = false;
  private subject: Subject = 'none';
  private lastIrEvt = 0;
  private petLeavesAt = 0;
  private verdictAt = 0;
  private pendingKind: PetClass | null = null;
  private forcedKind: PetClass | null = null;
  private nextVisitAt = Date.now() + rnd(25_000, 55_000);
  private eatRate = 2;
  private petOk = false;
  private petOkMs = 0;

  // U2 / transport
  private rssi = -57;
  private reachable = true;
  private listeners = new Set<DeviceEventListener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = Date.now();
  private lastTel = 0;
  private lastClk = 0;
  private lastPersist = 0;
  private lastRssi = 0;

  constructor() {
    this.demo = {
      simulateConnectionLoss: () => this.simulateConnectionLoss(),
      injectFault: (code) => this.injectFault(code),
      triggerVisit: (kind = 'pet') => this.startVisit(kind, Date.now(), true),
      refillHopper: () => {
        this.p.hopperG = HOPPER_CAPACITY_G;
        this.persist();
        this.lastTel = 0;
      },
      emptyBowl: () => {
        if (this.st !== 'IDLE' && this.st !== 'FAULT') return;
        this.p.bowlG = rnd(0.5, 2.5);
        this.persist();
        this.lastTel = 0;
      },
      reset: () => this.reset(),
    };
  }

  /* ================================================================ */
  /* DeviceService API                                                */
  /* ================================================================ */

  getStatus(): Promise<DeviceStatus> {
    return this.roundTrip(() => statusFromRaw({ link: true, rssi: this.rssi, state: this.rawSt(), telem: this.rawTelem() }));
  }

  async feed(grams: number): Promise<CommandAck> {
    const validPortions = [10, 20, 30, 50];
    if (!Number.isFinite(grams) || !validPortions.includes(grams)) {
      throw new DeviceError('RANGE', 'Manual portion must be 10 g, 20 g, 30 g, or 50 g.');
    }
    return this.roundTrip(() => {
      if (this.st === 'FAULT') throw new DeviceError('FAULT', 'The feeder is in a fault state. Clear the fault first.');
      if (this.st !== 'IDLE') throw new DeviceError('BUSY', 'The feeder is busy with another operation.');
      const id = ++this.p.feedId;
      this.requestFeed(Math.round(grams), 'R', -1, id);
      this.persist();
      return { accepted: true, id };
    });
  }

  abort(): Promise<CommandAck> {
    return this.roundTrip(() => {
      this.gateMove(false);
      if (this.job && this.st !== 'IDLE' && this.st !== 'FAULT' && this.st !== 'REPORT') {
        const j = this.job;
        j.result = 'ABORTED';
        if (!j.t0) {
          // Aborted before the gate ever opened: nothing was dispensed.
          if (!j.w0) j.w0 = round1(this.wt);
          j.w1 = j.w0;
        } else {
          j.w1 = this.wt;
        }
        this.enter('REPORT');
      }
      return { accepted: true, message: 'ACK:ABORT' };
    }, [120, 260]);
  }

  clearFault(): Promise<CommandAck> {
    return this.roundTrip(() => {
      let cleared = false;
      if (this.st === 'FAULT') {
        this.fault = null;
        this.stalled = false;
        this.enter('IDLE');
        cleared = true;
      }
      if (this.rtcWarn) {
        // On hardware the CAM re-sends SET_TIME from NTP, which restores the RTC.
        this.rtcWarn = false;
        this.emit({ type: 'status', data: { st: this.rawSt() } });
        cleared = true;
      }
      return { accepted: true, message: cleared ? 'ACK:CLEAR' : 'No active fault' };
    }, [500, 900]);
  }

  getSchedule(): Promise<FeedingSchedule[]> {
    return this.roundTrip(() => scheduleFromRaw(this.p.schedule));
  }

  putSchedule(slots: FeedingSchedule[]): Promise<CommandAck> {
    return this.roundTrip(() => {
      const raw = scheduleToRaw(slots);
      const bad = raw.find(
        (s) =>
          s.i < 0 || s.i > 3 || !Number.isInteger(s.hh) || s.hh < 0 || s.hh > 23 ||
          !Number.isInteger(s.mm) || s.mm < 0 || s.mm > 59 || !Number.isFinite(s.g) || s.g < 5 || s.g > 250,
      );
      if (bad) throw new DeviceError('RANGE', `NAK:SCHED_SET,RANGE — slot ${bad.i + 1} is out of range.`);
      for (const s of raw) this.p.schedule[s.i] = { ...s, g: Math.round(s.g) };
      this.persist();
      return { accepted: true, message: 'ACK:SCHED_SET' };
    }, [350, 700]);
  }

  getLog(): Promise<FeedingEvent[]> {
    return this.roundTrip(() => [...this.p.log].reverse().map((r) => eventFromLog(r, r.demo)));
  }

  getSnapshot(): Promise<Snapshot> {
    return this.roundTrip(() => this.snapshot(), [250, 500]);
  }

  tare(): Promise<CommandAck> {
    return this.roundTrip(() => {
      if (this.st !== 'IDLE') throw new DeviceError('BUSY', 'NAK:TARE,BUSY — the scale can only be tared while idle.');
      this.p.bowlG = 0;
      this.airborne = 0;
      this.wt = 0;
      this.persist();
      this.lastTel = 0;
      return { accepted: true, message: 'ACK:TARE' };
    }, [600, 1100]);
  }

  calibrate(knownG: number): Promise<CommandAck & { factor?: number }> {
    return this.roundTrip(() => {
      if (this.st !== 'IDLE') throw new DeviceError('BUSY', 'The scale can only be calibrated while idle.');
      if (!Number.isFinite(knownG) || knownG <= 1 || knownG > 5000) {
        throw new DeviceError('RANGE', 'NAK:CAL,RANGE — use a known mass between 1 g and 5000 g.');
      }
      const factor = Math.round(DEFAULT_CAL_FACTOR * rnd(0.975, 1.025) * 100) / 100;
      this.p.calFactor = factor;
      this.persist();
      return { accepted: true, factor, message: `ACK:CAL,${factor.toFixed(2)}` };
    }, [900, 1500]);
  }

  setConfig(config: FeederConfig): Promise<CommandAck> {
    return this.roundTrip(() => {
      const raw = configToRaw(config);
      if (
        !isNum(raw.leftover_g) || raw.leftover_g < 0 || raw.leftover_g > 500 ||
        !isNum(raw.overshoot_g) || raw.overshoot_g < 0 || raw.overshoot_g > 50 ||
        !isNum(raw.daily_g) || raw.daily_g < 5 || raw.daily_g > 2000
      ) {
        throw new DeviceError('RANGE', 'One or more configuration values are out of range.');
      }
      this.p.config = raw;
      this.persist();
      return { accepted: true, message: 'ACK:CFG' };
    }, [300, 600]);
  }

  getConfig(): Promise<FeederConfig> {
    return this.roundTrip(() => configFromRaw(this.p.config));
  }

  getPetVisits(): Promise<PetVisit[]> {
    return this.roundTrip(() => [...this.p.visits].reverse());
  }

  subscribe(listener: DeviceEventListener): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    queueMicrotask(() =>
      listener({ type: 'connection', data: { state: this.reachable ? 'connected' : 'disconnected' } }),
    );
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  async reconnect(): Promise<void> {
    this.broadcast({ type: 'connection', data: { state: 'connecting' } });
    await sleep(this.reachable ? 600 : rnd(1200, 1800));
    this.reachable = true;
    this.broadcast({ type: 'connection', data: { state: 'connected' } });
    this.lastTel = 0;
  }

  /* ================================================================ */
  /* Lifecycle                                                        */
  /* ================================================================ */

  private start() {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.persist();
  }

  private async reset(): Promise<void> {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    this.p = seedState();
    this.job = null;
    this.fault = null;
    this.rtcWarn = false;
    this.gateOpen = false;
    this.airborne = 0;
    this.stalled = false;
    this.ir = false;
    this.subject = 'none';
    this.pendingKind = null;
    this.forcedKind = null;
    this.lowSent = false;
    this.wt = this.p.bowlG;
    this.nextVisitAt = Date.now() + rnd(25_000, 55_000);
    this.reachable = true;
    this.persist();
    await sleep(500);
    this.broadcast({ type: 'connection', data: { state: 'connected' } });
    this.enter('IDLE');
  }

  /* ================================================================ */
  /* Simulation loop                                                  */
  /* ================================================================ */

  private tick() {
    const now = Date.now();
    const dt = Math.min(1, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;

    this.rollover();
    this.physics(dt);
    this.petService(now);
    this.feederTask(now);

    if (now - this.lastClk >= 1000) {
      this.lastClk = now;
      this.clockService();
    }
    if (now - this.lastRssi >= 3000) {
      this.lastRssi = now;
      this.rssi = Math.round(Math.max(-74, Math.min(-46, this.rssi + gauss() * 1.6 + (-58 - this.rssi) * 0.08)));
    }
    this.lowFoodService();

    const fast = this.st === 'DISPENSING' || this.st === 'SETTLING' || this.st === 'TOPUP';
    if (now - this.lastTel >= (fast ? 250 : 1000)) {
      this.lastTel = now;
      this.emit({ type: 'telemetry', data: this.rawTelem() });
    }
    if (now - this.lastPersist >= 5000) {
      this.lastPersist = now;
      this.persist();
    }
  }

  private physics(dt: number) {
    if (this.gateOpen && this.p.hopperG > 0 && !this.stalled) {
      const flow = (this.job?.flow ?? 30) * (this.st === 'TOPUP' ? 0.3 : 1);
      const produced = Math.min(this.p.hopperG, flow * dt * rnd(0.85, 1.15));
      this.p.hopperG -= produced;
      this.airborne += produced;
    }
    if (this.airborne > 0) {
      const land = this.airborne * (1 - Math.exp(-dt / FALL_TAU_S));
      this.airborne -= land;
      this.p.bowlG += land;
      if (this.airborne < 0.02) {
        this.p.bowlG += this.airborne;
        this.airborne = 0;
      }
    }
    const eating = this.ir && (this.subject === 'dog' || this.subject === 'cat') && this.st === 'IDLE';
    if (eating && this.p.bowlG > 0) this.p.bowlG = Math.max(0, this.p.bowlG - this.eatRate * dt);

    const busy = this.gateOpen || this.airborne > 0;
    this.wt = this.p.bowlG + gauss() * (busy ? 0.35 : 0.08) + (eating ? gauss() * 0.6 : 0);
  }

  private rollover() {
    const k = dayKey();
    if (k !== this.p.dayKey) {
      this.p.dayKey = k;
      this.p.dayG = 0;
      this.p.visitsToday = 0;
      this.persist();
    }
  }

  private lowFoodService() {
    const pct = this.hopPct();
    if (pct < HOP_LOW_PCT && !this.lowSent) {
      this.lowSent = true;
      this.emit({ type: 'low_food', data: { pct } });
    } else if (pct > HOP_LOW_PCT + 8) {
      this.lowSent = false;
    }
  }

  /* ---------------- scheduler (U1 clockService) ---------------- */

  private clockService() {
    if (this.st !== 'IDLE' || this.rtcWarn) return;
    const d = new Date();
    const today = dayKey(d);
    const minNow = d.getHours() * 60 + d.getMinutes();
    for (const s of this.p.schedule) {
      if (!s.en) continue;
      const diff = minNow - (s.hh * 60 + s.mm);
      if (diff < 0 || diff > GRACE_MIN) continue; // late-start window only; never back-fill old meals
      if (this.p.lastRun[s.i] === today) continue; // never feed a slot twice a day
      this.p.lastRun[s.i] = today;
      this.persist(); // save the token BEFORE dispensing
      this.requestFeed(s.g, 'S', s.i, 0);
      break;
    }
  }

  /* ---------------- feeding state machine (U1 feederTask) ---------------- */

  private requestFeed(g: number, src: 'S' | 'R', slot: number, id: number): boolean {
    if (this.st !== 'IDLE' || g < 5 || g > 250) return false;
    this.job = {
      tgt: g, src, slot, id, w0: 0, w1: 0, t0: 0, timedOut: false, wig: 0, top: 0, result: null,
      lastRiseW: 0, lastRiseMs: 0, wigglePhase: 0, phaseMs: 0, flow: rnd(26, 34), stallAt: null,
    };
    this.enter('PRECHECK');
    return true;
  }

  private skipFeed(why: FeedResult) {
    if (!this.job) return;
    this.job.result = why;
    this.job.w1 = this.job.w0;
    this.enter('REPORT');
  }

  private beginDispense(now: number) {
    const j = this.job!;
    j.t0 = now;
    j.lastRiseW = this.wt;
    j.lastRiseMs = now + JAM_GRACE_MS;
    // Occasionally kibble bridges over the gate; the wiggle routine clears it.
    j.stallAt = Math.random() < 0.06 ? rnd(300, 1200) : null;
    this.gateMove(true);
    this.enter('DISPENSING');
  }

  private feederTask(now: number) {
    const j = this.job;
    const cfg = this.p.config;
    switch (this.st) {
      case 'IDLE':
      case 'FAULT':
        return;
      case 'PRECHECK': {
        if (!j || now - this.stSince < PRECHECK_MS) return;
        j.w0 = round1(this.p.bowlG + gauss() * 0.05);
        if (j.w0 < BOWL_MIN_G || j.w0 > BOWL_MAX_G) this.raiseFault('SENSOR');
        else if (j.w0 > cfg.leftover_g) this.skipFeed('SKIP_LEFTOVER');
        else if (this.p.dayG + j.tgt > cfg.daily_g) this.skipFeed('SKIP_DAILY');
        else if (this.hopPct() < 3) this.skipFeed('LOW_FOOD');
        else if (cfg.require_pet && j.src === 'S') {
          this.petOk = false;
          this.enter('WAIT_PET');
          if (!this.ir) {
            if (Math.random() < 0.75) {
              this.forcedKind = 'pet';
              this.nextVisitAt = now + rnd(3000, 8000);
            } else {
              this.nextVisitAt = now + PET_WAIT_MS + 15_000;
            }
          }
        } else this.beginDispense(now);
        return;
      }
      case 'WAIT_PET':
        if (this.petOk && now - this.petOkMs < 15_000) this.beginDispense(now);
        else if (now - this.stSince > PET_WAIT_MS) this.skipFeed('SKIP_NO_PET');
        return;
      case 'DISPENSING': {
        if (!j) return;
        if (j.stallAt !== null && now - j.t0 >= j.stallAt) {
          this.stalled = true;
          j.stallAt = null;
        }
        if (this.wt >= j.w0 + j.tgt - cfg.overshoot_g) {
          this.gateMove(false);
          this.enter('SETTLING');
        } else if (now - j.t0 > MAX_DISPENSE_MS) {
          this.gateMove(false);
          j.timedOut = true;
          this.enter('SETTLING');
        } else if (this.wt - j.lastRiseW >= RISE_MIN_G) {
          j.lastRiseW = this.wt;
          j.lastRiseMs = now;
        } else if (now - j.lastRiseMs > JAM_MS) {
          j.wigglePhase = 0;
          j.phaseMs = now - WIGGLE_STEP_MS;
          this.enter('WIGGLE');
        }
        return;
      }
      case 'WIGGLE': {
        if (!j) return;
        if (j.wigglePhase < 4) {
          if (now - j.phaseMs >= WIGGLE_STEP_MS) {
            this.gateMove((j.wigglePhase & 1) === 1);
            j.wigglePhase++;
            j.phaseMs = now;
          }
        } else if (now - j.phaseMs >= WIGGLE_STEP_MS) {
          this.stalled = false; // the shake breaks the kibble bridge
          if (++j.wig > MAX_WIGGLES) this.raiseFault('JAM');
          else {
            j.lastRiseW = this.wt;
            j.lastRiseMs = now + JAM_GRACE_MS;
            this.enter('DISPENSING');
          }
        }
        return;
      }
      case 'SETTLING': {
        if (!j || now - this.stSince < SETTLE_MS) return;
        j.w1 = this.wt;
        if (j.w1 - j.w0 < j.tgt - TOL_G && !j.timedOut && j.top < MAX_TOPUPS && this.p.hopperG > 0) {
          j.top++;
          this.gateMove(true);
          this.enter('TOPUP');
        } else this.enter('REPORT');
        return;
      }
      case 'TOPUP':
        if (now - this.stSince >= TOPUP_MS) {
          this.gateMove(false);
          this.enter('SETTLING');
        }
        return;
      case 'REPORT': {
        if (!j) {
          this.enter('IDLE');
          return;
        }
        if (now - this.stSince < REPORT_MS) return;
        const d = j.t0 ? j.w1 - j.w0 : 0;
        if (!j.result) {
          if (j.timedOut && d < j.tgt - TOL_G) j.result = 'TIMEOUT';
          else if (Math.abs(d - j.tgt) <= TOL_G) j.result = 'OK';
          else j.result = d < j.tgt ? 'SHORT' : 'OVER';
        }
        this.finishJob(now, d);
        this.enter('IDLE');
        return;
      }
    }
  }

  private finishJob(now: number, d: number) {
    const j = this.job;
    if (!j) return;
    if (d > 0 && j.t0) this.p.dayG += d;
    const rec: StoredLog = {
      slot: j.slot,
      src: j.src,
      id: j.id,
      tgt: j.tgt,
      w0: round1(j.w0),
      w1: round1(j.w1),
      d: round1(d),
      res: j.result ?? 'OK',
      wig: j.wig,
      top: j.top,
      ms: j.t0 ? now - j.t0 : 0,
      ts: localIso(),
    };
    this.p.log.push(rec);
    if (this.p.log.length > LOG_LIMIT) this.p.log.splice(0, this.p.log.length - LOG_LIMIT);
    this.job = null;
    this.persist();
    this.emit({ type: 'log', data: rec });
    // A freshly filled bowl tends to attract a hungry visitor.
    if ((rec.res === 'OK' || rec.res === 'OVER' || rec.res === 'SHORT') && !this.ir && Math.random() < 0.55) {
      this.forcedKind = 'pet';
      this.nextVisitAt = Math.min(this.nextVisitAt, now + rnd(6000, 14_000));
    }
  }

  private raiseFault(code: 'JAM' | 'SENSOR') {
    this.gateMove(false);
    this.fault = code;
    if (this.job) {
      this.job.result = code;
      this.job.w1 = this.wt;
      this.finishJob(Date.now(), this.job.t0 ? this.job.w1 - this.job.w0 : 0);
    }
    this.enter('FAULT');
    this.emit({ type: 'error', data: { err: code } });
  }

  private injectFault(code: FaultCode) {
    if (code === 'RTC') {
      this.rtcWarn = true;
      this.emit({ type: 'status', data: { st: this.rawSt() } });
      this.lastTel = 0;
      return;
    }
    if (this.st === 'FAULT') return;
    this.raiseFault(code);
  }

  /* ---------------- IR + TinyML (U1 irService + U2 aiTask) ---------------- */

  private petService(now: number) {
    const dispensing = this.st === 'DISPENSING' || this.st === 'SETTLING' || this.st === 'TOPUP' || this.st === 'WIGGLE';
    if (!this.ir && now >= this.nextVisitAt && now - this.lastIrEvt > IR_COOLDOWN_MS && !dispensing) {
      const kind = this.forcedKind ?? (Math.random() < 0.8 ? 'pet' : Math.random() < 0.6 ? 'person' : 'other');
      this.forcedKind = null;
      this.startVisit(kind, now, false);
    }
    if (this.pendingKind && now >= this.verdictAt) this.verdict(now);
    if (this.ir && now >= this.petLeavesAt) {
      this.ir = false;
      this.subject = 'none';
      this.nextVisitAt = now + rnd(60_000, 150_000);
      this.lastTel = 0;
    }
  }

  private startVisit(kind: PetClass, now: number, manual: boolean) {
    if (this.ir) {
      if (!manual) return;
      // Manual trigger while someone is already there: just re-run the classifier.
    }
    const isPet = kind === 'pet';
    this.ir = true;
    this.lastIrEvt = now;
    this.subject = isPet ? (Math.random() < 0.6 ? 'dog' : 'cat') : kind;
    this.petLeavesAt = now + (isPet ? rnd(10_000, 24_000) : rnd(3000, 6000));
    this.eatRate = rnd(1.2, 2.6);
    this.pendingKind = kind;
    this.verdictAt = now + 3 * 250; // 3 frames, 250 ms apart
    this.p.lastCapture = { at: localIso(), subject: this.subject, bowlG: this.p.bowlG };
    this.lastTel = 0;
  }

  private verdict(now: number) {
    const kind = this.pendingKind!;
    this.pendingKind = null;
    let frames: number[];
    if (kind === 'pet') {
      frames = [rnd(0.74, 0.98), rnd(0.72, 0.97), rnd(0.55, 0.96)];
      if (Math.random() < 0.05) frames = [rnd(0.5, 0.8), rnd(0.3, 0.7), rnd(0.4, 0.74)]; // occasional miss
    } else if (kind === 'person') {
      frames = [rnd(0.02, 0.3), rnd(0.03, 0.35), rnd(0.02, 0.25)];
    } else {
      frames = [rnd(0.05, 0.5), rnd(0.1, 0.82), rnd(0.05, 0.45)]; // transient motion: at most 1 vote
    }
    frames = frames.map((f) => Math.round(f * 100) / 100);
    const votes = frames.filter((f) => f >= PET_THRESHOLD).length;
    const pet = votes >= 2;
    const conf = Math.round(Math.max(...frames) * 100);
    const ts = localIso();

    this.petOk = pet;
    this.petOkMs = now;
    if (pet) this.p.visitsToday++;
    this.p.visits.push({
      id: `v-${now}`,
      timestamp: ts,
      verdict: pet ? 'PET' : 'NOPET',
      confidence: conf,
      frames,
      topClass: pet ? 'pet' : kind,
    });
    if (this.p.visits.length > VISIT_LIMIT) this.p.visits.splice(0, this.p.visits.length - VISIT_LIMIT);
    this.persist();
    this.emit({ type: 'pet', data: { pet: pet ? 1 : 0, conf, frames, topClass: pet ? 'pet' : kind, ts } });
    this.lastTel = 0;
  }

  /* ---------------- helpers ---------------- */

  private gateMove(open: boolean) {
    this.gateOpen = open;
  }

  private enter(s: FeederState) {
    this.st = s;
    this.stSince = Date.now();
    this.emit({ type: 'status', data: { st: this.rawSt() } });
    this.lastTel = 0; // push a telemetry frame on every state change
  }

  private rawSt(): RawStateString {
    if (this.st === 'FAULT') return this.fault ?? 'SENSOR';
    if (this.st === 'IDLE' && this.rtcWarn) return 'RTC';
    return this.st;
  }

  private hopPct(): number {
    return Math.max(0, Math.min(100, Math.round((this.p.hopperG / HOPPER_CAPACITY_G) * 100)));
  }

  private rawTelem(): RawTelemetry {
    return {
      t: hhmmss(),
      w: round1(this.wt),
      hop: this.hopPct(),
      st: this.rawSt(),
      ir: this.ir ? 1 : 0,
      vis: this.p.visitsToday,
      day: Math.round(this.p.dayG),
      gate: this.gateOpen ? 1 : 0,
    };
  }

  private snapshot(): Snapshot {
    const c = this.p.lastCapture;
    const at = c ? new Date(c.at) : new Date();
    return {
      url: renderScene({ capturedAt: at, subject: c?.subject ?? 'none', bowlG: c?.bowlG ?? this.p.bowlG }),
      capturedAt: c?.at ?? localIso(at),
      simulated: true,
    };
  }

  private simulateConnectionLoss() {
    this.broadcast({ type: 'connection', data: { state: 'disconnected' } });
    this.reachable = false;
  }

  private async roundTrip<T>(fn: () => T, latency: [number, number] = [180, 480]): Promise<T> {
    await sleep(rnd(latency[0], latency[1]));
    if (!this.reachable) {
      throw new DeviceError('LINK_DOWN', 'The feeder is not reachable. Reconnect and try again.');
    }
    return fn();
  }

  /** Device events are only delivered while the (simulated) stream is connected. */
  private emit(evt: DeviceEvent) {
    if (!this.reachable) return;
    this.broadcast(evt);
  }

  private broadcast(evt: DeviceEvent) {
    for (const l of this.listeners) {
      try {
        l(evt);
      } catch (e) {
        console.error('[mockDevice] listener error', e);
      }
    }
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.p));
    } catch {
      /* storage full or unavailable: keep running in memory */
    }
  }
}
