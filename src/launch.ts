// Turning a case's comparables and history into hour-indexed launch series.

const HOUR_MS = 3600 * 1000;

export interface HourlyRow {
  from: string;
  viewers: number | null;
}

export interface Comparable {
  name: string;
  day_start: string;
  unlock: string;
  hourly: HourlyRow[];
}

export type Tier = "comparable" | "early-access" | "weak" | "target-history";
export type UnlockStyle = "rolling" | "simultaneous" | "other";

// A launch reduced to what the model uses: hour-of-day values and run-up features.
export interface LaunchSeries {
  name: string;
  tier: Tier;
  style: UnlockStyle;
  dayStartMs: number;
  // byOffset.get(k) = viewers of the hour starting at day_start + k hours (k may be negative).
  byOffset: Map<number, number>;
}

export function parseTier(unlock: string): Tier {
  const m = /Tier:\s*([a-z-]+)/i.exec(unlock);
  const t = m ? m[1].toLowerCase() : "comparable";
  if (t.startsWith("early")) return "early-access";
  if (t.startsWith("weak")) return "weak";
  if (t.startsWith("target")) return "target-history";
  return "comparable";
}

export function parseStyle(unlock: string): UnlockStyle {
  const s = unlock.toLowerCase();
  if (s.includes("midnight local")) return "rolling";
  if (s.includes("simultaneous") || s.includes("single global") || s.includes("single time")) {
    return "simultaneous";
  }
  return "other";
}

export function seriesFromRows(rows: HourlyRow[], dayStartMs: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of rows) {
    if (r.viewers === null || r.viewers === undefined || !Number.isFinite(r.viewers)) continue;
    const t = Date.parse(r.from);
    if (!Number.isFinite(t)) continue;
    const k = Math.round((t - dayStartMs) / HOUR_MS);
    out.set(k, Math.max(1, r.viewers));
  }
  return out;
}

export function toLaunch(c: Comparable): LaunchSeries {
  const dayStartMs = Date.parse(c.day_start);
  return {
    name: c.name,
    tier: parseTier(c.unlock),
    style: parseStyle(c.unlock),
    dayStartMs,
    byOffset: seriesFromRows(c.hourly, dayStartMs),
  };
}

// Run-up features of a series at its hour 1 (offset 0): ln(h1 / previous hour) and
// ln(h1 / mean of the previous 12 hours present). NaN where the data is missing.
export interface RunUp {
  jump: number;
  ramp: number;
}

export function runUp(byOffset: Map<number, number>): RunUp {
  const h1 = byOffset.get(0);
  if (h1 === undefined) return { jump: NaN, ramp: NaN };
  const prev = byOffset.get(-1);
  const jump = prev !== undefined ? Math.log(h1 / prev) : NaN;
  let s = 0;
  let n = 0;
  for (let k = -12; k <= -1; k++) {
    const v = byOffset.get(k);
    if (v !== undefined) {
      s += v;
      n++;
    }
  }
  const ramp = n > 0 ? Math.log(h1 / (s / n)) : NaN;
  return { jump, ramp };
}
