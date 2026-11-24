import type { FaultCode, FeedResult, FeederState } from '../types/device';

export type Tone = 'ok' | 'info' | 'busy' | 'warn' | 'danger' | 'muted';

export const STATE_INFO: Record<FeederState, { label: string; hint: string; tone: Tone }> = {
  IDLE: { label: 'Ready', hint: 'Standing by for the next meal.', tone: 'ok' },
  PRECHECK: { label: 'Checking bowl', hint: 'Checking bowl weight and cooldown barrier.', tone: 'busy' },
  WAIT_PET: { label: 'Waiting for pet', hint: 'Will dispense once a pet is confirmed.', tone: 'busy' },
  DISPENSING: { label: 'Dispensing food', hint: 'Servo shifted 10° — kibble is flowing into the bowl.', tone: 'busy' },
  WIGGLE: { label: 'Clearing jam', hint: 'Shaking the gate to break a kibble bridge.', tone: 'warn' },
  SETTLING: { label: 'Settling scale', hint: 'Gate closed — waiting for HX711 reading to stabilise.', tone: 'busy' },
  TOPUP: { label: 'Topping up', hint: 'Adding a small top-up.', tone: 'busy' },
  REPORT: { label: 'Recording result', hint: 'Saving the feeding log with RTC timestamp.', tone: 'busy' },
  FAULT: { label: 'Fault', hint: 'The feeder needs attention.', tone: 'danger' },
};

export const FAULT_INFO: Record<FaultCode, { label: string; description: string; action: string }> = {
  JAM: {
    label: 'Gate jammed',
    description: 'Kibble stopped flowing and the gate was closed for safety.',
    action: 'Check the chute and gate for blocked kibble, then clear the fault.',
  },
  SENSOR: {
    label: 'Scale sensor error',
    description: 'The load cell returned missing or implausible readings, so feeding was halted.',
    action: 'Make sure the bowl sits freely on the platform, then clear the fault.',
  },
  RTC: {
    label: 'Clock not set',
    description: 'The real-time clock lost its time. Sync the RTC from Settings.',
    action: 'Click Sync RTC in Settings.',
  },
};

export const RESULT_INFO: Record<FeedResult, { label: string; tone: Tone; emoji: string; explain: string }> = {
  OK: { label: 'Completed', tone: 'ok', emoji: '🥣', explain: 'Portion dispensed successfully.' },
  SHORT: { label: 'Under target', tone: 'warn', emoji: '🥄', explain: 'Dispensed less than requested.' },
  OVER: { label: 'Over target', tone: 'warn', emoji: '🍚', explain: 'Slightly more than requested landed in the bowl.' },
  TIMEOUT: { label: 'Timed out', tone: 'danger', emoji: '⏱️', explain: 'Dispensing timeout reached.' },
  ABORTED: { label: 'Aborted', tone: 'warn', emoji: '✋', explain: 'Stopped by request; gate closed immediately.' },
  SKIP_LEFTOVER: { label: 'Skipped · bowl > limit', tone: 'info', emoji: '🐾', explain: 'Bowl already holds more than the 200 g max weight limit.' },
  SKIP_COOLDOWN: { label: 'Skipped · cooldown', tone: 'warn', emoji: '⏳', explain: 'Blocked by the T-minute cooldown barrier.' },
  SKIP_DAILY: { label: 'Skipped · daily limit', tone: 'info', emoji: '📏', explain: 'This portion would exceed the daily food limit.' },
  SKIP_NO_PET: { label: 'Skipped · no pet', tone: 'info', emoji: '🙈', explain: 'No pet detected in time.' },
  LOW_FOOD: { label: 'Hopper empty', tone: 'danger', emoji: '🫙', explain: 'Hopper is almost empty.' },
  JAM: { label: 'Jam fault', tone: 'danger', emoji: '⚠️', explain: 'The gate jammed during dispensing.' },
  SENSOR: { label: 'Sensor fault', tone: 'danger', emoji: '⚠️', explain: 'The scale reported an invalid reading.' },
};

export const SUCCESS_RESULTS: FeedResult[] = ['OK', 'SHORT', 'OVER'];

export function isActiveState(s: FeederState): boolean {
  return s !== 'IDLE' && s !== 'FAULT';
}
