import type { FeedingSchedule } from '../types/device';

export interface NextFeed {
  slot: FeedingSchedule;
  at: Date;
  msUntil: number;
}

/** Next upcoming enabled slot strictly after `now` (rolls over to tomorrow). */
export function nextFeeding(schedule: FeedingSchedule[], now = new Date()): NextFeed | null {
  let best: NextFeed | null = null;
  for (const s of schedule) {
    if (!s.enabled) continue;
    const at = new Date(now);
    at.setHours(s.hour, s.minute, 0, 0);
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
    const msUntil = at.getTime() - now.getTime();
    if (!best || msUntil < best.msUntil) best = { slot: s, at, msUntil };
  }
  return best;
}
