/** Formatting helpers for weights, times and durations. */
import type { FeedingSchedule } from '../types/device';

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function grams(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)} g`;
}

/** Parse the device's local ISO timestamp (no timezone) as local time. */
export function parseLocal(ts: string): Date {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function timeOfDay(d: Date, seconds = false): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: seconds ? '2-digit' : undefined });
}

export function shortDate(d: Date): string {
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function longDate(d: Date): string {
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function dateTime(ts: string): string {
  const d = parseLocal(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const prefix = sameDay(d, today) ? 'Today' : sameDay(d, yesterday) ? 'Yesterday' : shortDate(d);
  return `${prefix}, ${timeOfDay(d)}`;
}

export function relative(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function duration(ms: number): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${pad2(m)}m`;
  if (m > 0) return `${m}m ${pad2(s)}s`;
  return `${s}s`;
}

export function slotTime(s: Pick<FeedingSchedule, 'hour' | 'minute'>): string {
  const d = new Date();
  d.setHours(s.hour, s.minute, 0, 0);
  return timeOfDay(d);
}

export function rssiQuality(rssi: number): { bars: 1 | 2 | 3 | 4; label: string } {
  if (rssi >= -55) return { bars: 4, label: 'Excellent' };
  if (rssi >= -65) return { bars: 3, label: 'Good' };
  if (rssi >= -75) return { bars: 2, label: 'Fair' };
  return { bars: 1, label: 'Weak' };
}

export function dateKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
