/**
 * Sample data used on first launch and by "Reset Demo Data".
 * Everything here is clearly demonstration data — it is generated relative to "now"
 * so the dashboard looks lived-in, and every record is flagged `demo`.
 */
import type { PetVisit, RawConfig, RawLogRecord, RawScheduleSlot } from '../types/device';
import { dayKey, localIso } from '../services/protocol';

export const HOPPER_CAPACITY_G = 1800; // ~2.9 L hopper of dry kibble
export const DEFAULT_CAL_FACTOR = 420; // placeholder counts/gram from the firmware

export const DEFAULT_SCHEDULE: RawScheduleSlot[] = [
  { i: 0, hh: 7, mm: 30, g: 45, en: 1 },
  { i: 1, hh: 12, mm: 30, g: 40, en: 1 },
  { i: 2, hh: 18, mm: 0, g: 50, en: 1 },
  { i: 3, hh: 21, mm: 30, g: 25, en: 0 },
];

export const DEFAULT_CONFIG: RawConfig = {
  leftover_g: 30,
  overshoot_g: 3,
  daily_g: 300,
  require_pet: false,
};

export const SLOT_LABELS = ['Breakfast', 'Lunch', 'Dinner', 'Late snack'];

/** Small deterministic PRNG so "Reset Demo Data" always produces the same story. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Log record as stored by the simulated device; `demo` marks seeded sample rows. */
export type StoredLog = RawLogRecord & { demo?: boolean };

export interface DemoSeed {
  log: StoredLog[];
  visits: PetVisit[];
  dayG: number;
  visitsToday: number;
  lastRun: Record<number, string>;
}

export function buildDemoSeed(now = new Date()): DemoSeed {
  const rand = mulberry32(20261014);
  const log: StoredLog[] = [];
  const visits: PetVisit[] = [];
  const today = dayKey(now);
  const lastRun: Record<number, string> = {};
  let id = 0;

  for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
    const base = new Date(now);
    base.setDate(base.getDate() - dayOffset);

    // Scheduled meals
    for (const slot of DEFAULT_SCHEDULE) {
      if (!slot.en) continue;
      const at = new Date(base);
      at.setHours(slot.hh, slot.mm, Math.floor(rand() * 20), 0);
      if (at > now) continue;
      if (dayOffset === 0) lastRun[slot.i] = today;

      const w0 = round1(2 + rand() * 9);
      const roll = rand();
      let res: RawLogRecord['res'] = 'OK';
      let d = round1(slot.g + (rand() * 3.6 - 1.8));
      let top = 0;
      let wig = 0;
      if (roll > 0.93 && dayOffset > 0) {
        res = 'SKIP_LEFTOVER';
        d = 0;
      } else if (roll > 0.87) {
        res = 'SHORT';
        d = round1(slot.g - 3 - rand() * 3);
        top = 2;
      } else if (roll > 0.82) {
        res = 'OVER';
        d = round1(slot.g + 2.5 + rand() * 2);
      } else if (roll > 0.74) {
        top = 1;
      }
      if (rand() > 0.85 && d > 0) wig = 1;
      const w0Final = res === 'SKIP_LEFTOVER' ? round1(32 + rand() * 12) : w0;
      log.push({
        slot: slot.i,
        src: 'S',
        id: 0,
        tgt: slot.g,
        w0: w0Final,
        w1: round1(w0Final + d),
        d,
        res,
        wig,
        top,
        ms: d > 0 ? Math.round(1600 + d * 32 + wig * 1500 + top * 1800 + rand() * 600) : 0,
        ts: localIso(at),
        demo: true,
      });
    }

    // Occasional manual feeds
    if (rand() > 0.45) {
      const at = new Date(base);
      at.setHours(15 + Math.floor(rand() * 4), Math.floor(rand() * 60), Math.floor(rand() * 60), 0);
      if (at <= now) {
        id += 1;
        const tgt = [25, 30, 50][Math.floor(rand() * 3)];
        const aborted = rand() > 0.8;
        const w0 = round1(3 + rand() * 8);
        const d = aborted ? round1(tgt * (0.2 + rand() * 0.4)) : round1(tgt + (rand() * 3 - 1.5));
        log.push({
          slot: -1,
          src: 'R',
          id,
          tgt,
          w0,
          w1: round1(w0 + d),
          d,
          res: aborted ? 'ABORTED' : 'OK',
          wig: 0,
          top: 0,
          ms: Math.round(aborted ? 900 + rand() * 800 : 1500 + d * 32),
          ts: localIso(at),
          demo: true,
        });
      }
    }

    // Pet visits (TinyML verdicts)
    const visitCount = dayOffset === 0 ? 5 : 4 + Math.floor(rand() * 4);
    for (let v = 0; v < visitCount; v++) {
      const at = new Date(base);
      at.setHours(6 + Math.floor(rand() * 16), Math.floor(rand() * 60), Math.floor(rand() * 60), 0);
      if (at > now) continue;
      const isPet = rand() > 0.15;
      const frames = isPet
        ? [0.78 + rand() * 0.2, 0.76 + rand() * 0.22, 0.55 + rand() * 0.4]
        : [0.05 + rand() * 0.35, 0.1 + rand() * 0.5, 0.05 + rand() * 0.3];
      const best = Math.max(...frames);
      visits.push({
        id: `demo-v-${dayOffset}-${v}`,
        timestamp: localIso(at),
        verdict: isPet ? 'PET' : 'NOPET',
        confidence: Math.round(best * 100),
        frames: frames.map((f) => Math.round(f * 100) / 100),
        topClass: isPet ? 'pet' : rand() > 0.5 ? 'person' : 'other',
        demo: true,
      });
    }
  }

  log.sort((a, b) => a.ts.localeCompare(b.ts));
  visits.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const dayG = round1(log.filter((r) => r.ts.startsWith(today) && r.d > 0).reduce((s, r) => s + r.d, 0));
  const visitsToday = visits.filter((v) => v.timestamp.startsWith(today) && v.verdict === 'PET').length;

  return { log, visits, dayG, visitsToday, lastRun };
}
