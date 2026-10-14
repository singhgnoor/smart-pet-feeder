/** Human-readable labels and visual tones for protocol values. */
import type { FaultCode, FeedResult, FeederState } from '../types/device';

export type Tone = 'ok' | 'info' | 'busy' | 'warn' | 'danger' | 'muted';

export const STATE_INFO: Record<FeederState, { label: string; hint: string; tone: Tone }> = {
  IDLE: { label: 'Ready', hint: 'Standing by for the next meal.', tone: 'ok' },
  PRECHECK: { label: 'Checking bowl', hint: 'Measuring the baseline bowl weight.', tone: 'busy' },
  WAIT_PET: { label: 'Waiting for pet', hint: 'Will dispense once a pet is confirmed by the camera.', tone: 'busy' },
  DISPENSING: { label: 'Dispensing food', hint: 'Gate open — kibble is flowing into the bowl.', tone: 'busy' },
  WIGGLE: { label: 'Clearing jam', hint: 'Shaking the gate to break a kibble bridge.', tone: 'warn' },
  SETTLING: { label: 'Settling scale', hint: 'Gate closed — waiting for the reading to stabilise.', tone: 'busy' },
  TOPUP: { label: 'Topping up', hint: 'A little short — adding a small top-up.', tone: 'busy' },
  REPORT: { label: 'Recording result', hint: 'Saving the feeding record.', tone: 'busy' },
  FAULT: { label: 'Fault', hint: 'The feeder needs attention.', tone: 'danger' },
};

export const FAULT_INFO: Record<FaultCode, { label: string; description: string; action: string }> = {
  JAM: {
    label: 'Gate jammed',
    description: 'Kibble stopped flowing and the automatic wiggle could not clear it. The gate has been closed for safety.',
    action: 'Check the chute and gate for blocked kibble, then clear the fault.',
  },
  SENSOR: {
    label: 'Scale sensor error',
    description: 'The load cell returned missing or implausible readings, so feeding was halted.',
    action: 'Make sure the bowl sits freely on the platform, then clear the fault. Re-tare if readings look off.',
  },
  RTC: {
    label: 'Clock not set',
    description: 'The real-time clock lost its time. Scheduled meals are paused until the time is synced.',
    action: 'Clear the warning to re-sync the clock from the network.',
  },
};

export const RESULT_INFO: Record<FeedResult, { label: string; tone: Tone; emoji: string; explain: string }> = {
  OK: { label: 'Completed', tone: 'ok', emoji: '🥣', explain: 'Portion dispensed within tolerance.' },
  SHORT: { label: 'Under target', tone: 'warn', emoji: '🥄', explain: 'Dispensed less than requested even after top-ups.' },
  OVER: { label: 'Over target', tone: 'warn', emoji: '🍚', explain: 'A little more than requested landed in the bowl.' },
  TIMEOUT: { label: 'Timed out', tone: 'danger', emoji: '⏱️', explain: 'The 8-second dispensing limit was reached before the target.' },
  ABORTED: { label: 'Aborted', tone: 'warn', emoji: '✋', explain: 'Stopped by request; the gate was closed immediately.' },
  SKIP_LEFTOVER: { label: 'Skipped · food left', tone: 'info', emoji: '🐾', explain: 'The bowl already held more than the leftover threshold.' },
  SKIP_DAILY: { label: 'Skipped · daily limit', tone: 'info', emoji: '📏', explain: 'This portion would exceed the daily food limit.' },
  SKIP_NO_PET: { label: 'Skipped · no pet', tone: 'info', emoji: '🙈', explain: 'No pet was confirmed by the camera in time.' },
  LOW_FOOD: { label: 'Hopper empty', tone: 'danger', emoji: '🫙', explain: 'The hopper is almost empty, so nothing was dispensed.' },
  JAM: { label: 'Jam fault', tone: 'danger', emoji: '⚠️', explain: 'The gate jammed during dispensing.' },
  SENSOR: { label: 'Sensor fault', tone: 'danger', emoji: '⚠️', explain: 'The scale reported an invalid reading.' },
};

export const SUCCESS_RESULTS: FeedResult[] = ['OK', 'SHORT', 'OVER'];

export function isActiveState(s: FeederState): boolean {
  return s !== 'IDLE' && s !== 'FAULT';
}
