// Minimal cron matcher — mirror of server/scheduler.ts logic.
// 5-field standard cron: minute hour day-of-month month day-of-week.

const RANGES: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

function parseField(field: string, min: number, max: number): Set<number> | "any" {
  if (field === "*") return "any";
  const values = new Set<number>();
  for (const part of field.split(",")) {
    let stepStr: string | undefined;
    let rangeStr = part;
    const slashIdx = part.indexOf("/");
    if (slashIdx >= 0) {
      rangeStr = part.slice(0, slashIdx);
      stepStr = part.slice(slashIdx + 1);
    }
    const step = stepStr ? parseInt(stepStr, 10) : 1;
    if (!Number.isFinite(step) || step <= 0) continue;
    let lo: number;
    let hi: number;
    if (rangeStr === "*") {
      lo = min;
      hi = max;
    } else if (rangeStr.includes("-")) {
      const [a, b] = rangeStr.split("-");
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
  minute: Set<number> | "any";
  hour: Set<number> | "any";
  dom: Set<number> | "any";
  month: Set<number> | "any";
  dow: Set<number> | "any";
}

export function parseCron(expr: string): ParsedCron | null {
  let trimmed = expr.trim();
  switch (trimmed) {
    case "@yearly":
    case "@annually":
      trimmed = "0 0 1 1 *";
      break;
    case "@monthly":
      trimmed = "0 0 1 * *";
      break;
    case "@weekly":
      trimmed = "0 0 * * 0";
      break;
    case "@daily":
    case "@midnight":
      trimmed = "0 0 * * *";
      break;
    case "@hourly":
      trimmed = "0 * * * *";
      break;
  }
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) return null;
  return {
    minute: parseField(fields[0], RANGES[0][0], RANGES[0][1]),
    hour: parseField(fields[1], RANGES[1][0], RANGES[1][1]),
    dom: parseField(fields[2], RANGES[2][0], RANGES[2][1]),
    month: parseField(fields[3], RANGES[3][0], RANGES[3][1]),
    dow: parseField(fields[4], RANGES[4][0], RANGES[4][1]),
  };
}

function matches(set: Set<number> | "any", val: number): boolean {
  return set === "any" || set.has(val);
}

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

export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Best-effort human-readable description of a cron expression.
 * Falls back to the raw expression for complex cases.
 */
export function describeCron(expr: string): string {
  const trimmed = expr.trim();
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) return trimmed;

  const [min, hour, dom, month, dow] = fields;
  const time = (() => {
    if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
      const h = parseInt(hour, 10);
      const m = parseInt(min, 10);
      const hh = h.toString().padStart(2, "0");
      const mm = m.toString().padStart(2, "0");
      return `${hh}:${mm}`;
    }
    return null;
  })();

  // Pure interval forms
  if (dom === "*" && month === "*" && dow === "*") {
    const minStep = /^\*\/(\d+)$/.exec(min);
    const hourStep = /^\*\/(\d+)$/.exec(hour);
    if (minStep && hour === "*") return `every ${minStep[1]} min`;
    if (hourStep && min === "0") return `every ${hourStep[1]}h`;
    if (time && dom === "*" && month === "*" && dow === "*") return `daily at ${time}`;
  }

  // Weekly forms: minute hour * * <dow>
  if (dom === "*" && month === "*" && dow !== "*" && time) {
    const days = parseDayList(dow);
    if (days) return `${days} at ${time}`;
  }

  return trimmed;
}

function parseDayList(dow: string): string | null {
  // Accept lists like "1,3,5" and ranges "1-5"
  const parts = dow.split(",");
  const days: number[] = [];
  for (const p of parts) {
    if (/^\d+$/.test(p)) {
      days.push(parseInt(p, 10));
    } else if (/^\d+-\d+$/.test(p)) {
      const [a, b] = p.split("-").map((x) => parseInt(x, 10));
      for (let d = a; d <= b; d++) days.push(d);
    } else {
      return null;
    }
  }
  days.sort((a, b) => a - b);
  if (days.length === 7) return "every day";
  if (days.length === 5 && days.join(",") === "1,2,3,4,5") return "weekdays";
  if (days.length === 2 && days.join(",") === "0,6") return "weekends";
  return days.map((d) => DAY_NAMES[d]).join(", ");
}
