import type { ScheduleStore, ScheduledJob } from './schedule-store.js';

/**
 * Minimal cron matcher. Supports 5-field standard cron:
 *   minute hour day-of-month month day-of-week
 *
 * Field syntax:
 *   * (any)
 *   N (literal)
 *   N,M,O (list)
 *   N-M (range)
 *   *\/N (step)
 *   N-M/K (stepped range)
 *
 * Day-of-week: 0-6 (0=Sunday).
 */
const RANGES: Array<[number, number]> = [
  [0, 59],  // minute
  [0, 23],  // hour
  [1, 31],  // day of month
  [1, 12],  // month
  [0, 6],   // day of week
];

function parseField(field: string, min: number, max: number): Set<number> | 'any' {
  if (field === '*') return 'any';
  const values = new Set<number>();
  for (const part of field.split(',')) {
    let stepStr: string | undefined;
    let rangeStr = part;
    const slashIdx = part.indexOf('/');
    if (slashIdx >= 0) {
      rangeStr = part.slice(0, slashIdx);
      stepStr = part.slice(slashIdx + 1);
    }
    const step = stepStr ? parseInt(stepStr, 10) : 1;
    if (!Number.isFinite(step) || step <= 0) continue;
    let lo: number;
    let hi: number;
    if (rangeStr === '*') {
      lo = min;
      hi = max;
    } else if (rangeStr.includes('-')) {
      const [a, b] = rangeStr.split('-');
      lo = parseInt(a, 10);
      hi = parseInt(b, 10);
    } else {
      lo = parseInt(rangeStr, 10);
      hi = lo;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    for (let v = lo; v <= hi; v += step) {
      if (v >= min && v <= max) values.add(v);
    }
  }
  return values;
}

interface ParsedCron {
  minute: Set<number> | 'any';
  hour: Set<number> | 'any';
  dom: Set<number> | 'any';
  month: Set<number> | 'any';
  dow: Set<number> | 'any';
}

export function parseCron(expr: string): ParsedCron | null {
  // Aliases
  let trimmed = expr.trim();
  switch (trimmed) {
    case '@yearly':
    case '@annually':
      trimmed = '0 0 1 1 *';
      break;
    case '@monthly':
      trimmed = '0 0 1 * *';
      break;
    case '@weekly':
      trimmed = '0 0 * * 0';
      break;
    case '@daily':
    case '@midnight':
      trimmed = '0 0 * * *';
      break;
    case '@hourly':
      trimmed = '0 * * * *';
      break;
  }

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) return null;
  const parsed: ParsedCron = {
    minute: parseField(fields[0], RANGES[0][0], RANGES[0][1]),
    hour: parseField(fields[1], RANGES[1][0], RANGES[1][1]),
    dom: parseField(fields[2], RANGES[2][0], RANGES[2][1]),
    month: parseField(fields[3], RANGES[3][0], RANGES[3][1]),
    dow: parseField(fields[4], RANGES[4][0], RANGES[4][1]),
  };
  return parsed;
}

function matches(set: Set<number> | 'any', val: number): boolean {
  return set === 'any' || set.has(val);
}

export function cronMatches(expr: string, date: Date): boolean {
  const parsed = parseCron(expr);
  if (!parsed) return false;
  return (
    matches(parsed.minute, date.getMinutes()) &&
    matches(parsed.hour, date.getHours()) &&
    matches(parsed.dom, date.getDate()) &&
    matches(parsed.month, date.getMonth() + 1) &&
    matches(parsed.dow, date.getDay())
  );
}

/**
 * Compute the next firing time at-or-after `from`, scanning up to
 * `maxMinutes` ahead. Used for "next run in X" UI hints.
 */
export function nextRun(expr: string, from: Date, maxMinutes = 60 * 24 * 7): Date | null {
  const parsed = parseCron(expr);
  if (!parsed) return null;
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  for (let i = 0; i < maxMinutes; i++) {
    if (
      matches(parsed.minute, cursor.getMinutes()) &&
      matches(parsed.hour, cursor.getHours()) &&
      matches(parsed.dom, cursor.getDate()) &&
      matches(parsed.month, cursor.getMonth() + 1) &&
      matches(parsed.dow, cursor.getDay())
    ) {
      return cursor;
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

export class Scheduler {
  private store: ScheduleStore;
  private onFire: (job: ScheduledJob) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastTickMinute: number | null = null;
  private destroyed = false;

  constructor(store: ScheduleStore, onFire: (job: ScheduledJob) => void) {
    this.store = store;
    this.onFire = onFire;
  }

  start(): void {
    if (this.destroyed || this.timer) return;
    this.scheduleNextTick();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.stop();
  }

  private scheduleNextTick(): void {
    if (this.destroyed) return;
    const now = new Date();
    // Sleep until the start of the next minute (+50ms slack to avoid edge cases)
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50;
    this.timer = setTimeout(() => {
      this.tick();
      this.scheduleNextTick();
    }, msToNextMinute);
  }

  private tick(): void {
    if (this.destroyed) return;
    const now = new Date();
    now.setSeconds(0, 0);
    const minuteKey = now.getTime();
    if (minuteKey === this.lastTickMinute) return;
    this.lastTickMinute = minuteKey;

    for (const job of this.store.listJobs()) {
      if (!job.enabled) continue;
      try {
        if (cronMatches(job.cron, now)) {
          this.onFire(job);
        }
      } catch (e) {
        console.error('schedule check failed for', job.id, e);
      }
    }
  }
}
