// The forecaster: analog ratios from past launches. For each past launch in the case's `comparables`, the shape of its
// release day is read as log-ratios ln(viewers in hour h / viewers in hour 1). Those ratios are pooled with weights:
// launches that unlocked like this one (consoles at midnight local, rolling round the world) and whose run-up into
// hour 1 looked like this case's count more. Each hour's forecast is then a log-normal around hour 1's print:
//
//   q_tau(h) = p1 * exp(centre_h + z_tau * spread_h)
//
// where centre_h is a blend of the weighted median and mean of the pooled log-ratios and spread_h their weighted
// spread, widened by a floor that grows with the horizon. Standard library only; no network.

/** The quantile levels the contest scores, and the standard normal's quantile at each. */
export const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.6449, -0.6745, 0, 0.6745, 1.6449];

export interface HourRow { from: string; viewers: number; channels?: number | null }
export interface Comparable { name: string; day_start: string; unlock: string; hourly: HourRow[] }
export interface Case {
  id: string;
  day_start: string;
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  history_hourly: Array<{ from: string; viewers: number }> | null;
  comparables: Comparable[];
}

/** The tuning, one place: every weight and width the forecaster uses. */
export const PARAMS = {
  /** Weight of a launch by its tier in the case notes. */
  tierWeight: { comparable: 1, 'early-access-contaminated': 0.35, weak: 0.15 } as Record<string, number>,
  /** Weight by how the launch unlocked: rolling midnight-local launches are GTA VI's own kind. */
  classWeight: { rolling: 3, unknown: 1, simultaneous: 0.08 } as Record<string, number>,
  /**
   * Widths (in log units) of the similarity kernels on the run-up features. Chosen, with the spread below, by a
   * leave-one-out check over the rolling midnight-local launches (tools/tune.ts): a middle setting of a flat optimum.
   */
  jumpWidth: 0.3,
  runupWidth: 0.45,
  /** Blend of weighted median (1) and weighted mean (0) for each hour's centre. */
  medianShare: 0.7,
  /** The spread's floor grows as floorPerRootHour * sqrt(h - 1), and the pooled spread is scaled by inflate. */
  floorPerRootHour: 0.12,
  inflate: 1.0,
  /** With too little weight behind an hour, fall back toward persistence with this spread per root hour. */
  fallbackSpread: 0.25,
};

const HOUR = 3600 * 1000;

/** The tier a comparable's notes name ("Tier: comparable." and so on). */
export function tierOf(comparable: Comparable): string {
  const match = /Tier:\s*([a-z-]+)/i.exec(comparable.unlock ?? '');
  return match ? match[1].toLowerCase() : 'comparable';
}

/** Hourly counts keyed by the hour's start time in ms. */
function byHour(rows: Array<{ from: string; viewers: number }>): Map<number, number> {
  const map = new Map<number, number>();
  for (const row of rows) if (row.viewers > 0) map.set(Date.parse(row.from), row.viewers);
  return map;
}

/**
 * The run-up features of a launch: `jump`, ln(hour 1 / the hour before the day), and `runup`, ln(hour 1 / the mean of
 * the previous day's 12:00-24:00 UTC hours). NaN where the data is missing.
 */
export function runupFeatures(hours: Map<number, number>, dayStart: number, hour1: number): { jump: number; runup: number } {
  const before = hours.get(dayStart - HOUR);
  const late: number[] = [];
  for (let k = 1; k <= 12; k += 1) {
    const v = hours.get(dayStart - k * HOUR);
    if (v !== undefined) late.push(v);
  }
  const mean = late.length >= 3 ? late.reduce((a, b) => a + b, 0) / late.length : NaN;
  return { jump: before ? Math.log(hour1 / before) : NaN, runup: Number.isFinite(mean) ? Math.log(hour1 / mean) : NaN };
}

/**
 * How a launch unlocked, from its notes: `rolling` (midnight local, country by country, as GTA VI does), `simultaneous`
 * (one global moment, which makes a sharp spike at an arbitrary hour), or `unknown`.
 */
export function unlockClass(comparable: Comparable): 'rolling' | 'simultaneous' | 'unknown' {
  const unlock = comparable.unlock ?? '';
  if (/midnight local/i.test(unlock)) return 'rolling';
  if (/simultaneous|single global|global unlock|single time/i.test(unlock)) return 'simultaneous';
  return 'unknown';
}

/** How much a comparable's unlock and tier make it count, before similarity. */
export function baseWeight(comparable: Comparable): number {
  const tier = tierOf(comparable);
  if (tier === 'target-history') return 0;
  const weight = PARAMS.tierWeight[tier] ?? 0.5;
  return weight * PARAMS.classWeight[unlockClass(comparable)];
}

/** One analog: its weight and its log-ratio to hour 1 for each hour 2..24 it has. */
interface Analog { name: string; weight: number; ratios: Map<number, number> }

/** The analogs a case draws on, weighted by unlock, tier and how alike their run-up into hour 1 was. */
export function analogsFor(c: Case, p1: number): Analog[] {
  const dayStart = Date.parse(c.day_start);
  const own = runupFeatures(byHour(c.history_hourly ?? []), dayStart, p1);
  const analogs: Analog[] = [];
  for (const comparable of c.comparables ?? []) {
    let weight = baseWeight(comparable);
    if (weight <= 0) continue;
    const start = Date.parse(comparable.day_start);
    const hours = byHour(comparable.hourly ?? []);
    const first = hours.get(start);
    if (!first) continue;
    const theirs = runupFeatures(hours, start, first);
    if (Number.isFinite(own.jump) && Number.isFinite(theirs.jump)) weight *= Math.exp(-((own.jump - theirs.jump) ** 2) / (2 * PARAMS.jumpWidth ** 2));
    if (Number.isFinite(own.runup) && Number.isFinite(theirs.runup)) weight *= Math.exp(-((own.runup - theirs.runup) ** 2) / (2 * PARAMS.runupWidth ** 2));
    const ratios = new Map<number, number>();
    for (let h = 2; h <= 24; h += 1) {
      const v = hours.get(start + (h - 1) * HOUR);
      if (v !== undefined) ratios.set(h, Math.log(v / first));
    }
    if (ratios.size > 0 && weight > 1e-6) analogs.push({ name: comparable.name, weight, ratios });
  }
  return analogs;
}

/** The weighted median of values. */
function weightedMedian(values: number[], weights: number[]): number {
  const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
  const total = weights.reduce((a, b) => a + b, 0);
  let running = 0;
  for (const i of order) {
    running += weights[i];
    if (running >= total / 2) return values[i];
  }
  return values[order[order.length - 1]];
}

/** Five quantiles for each forecast hour of a case. */
export function forecastCase(c: Case): Array<{ hour: number; q: number[] }> {
  const first = c.known.find((k) => k.hour === 1);
  if (!first) throw new Error(`${c.id} has no hour-1 print`);
  const p1 = Math.max(1, first.viewers);
  const analogs = analogsFor(c, p1);
  return c.forecast.map(({ hour }) => {
    const values: number[] = [];
    const weights: number[] = [];
    for (const analog of analogs) {
      const r = analog.ratios.get(hour);
      if (r !== undefined) {
        values.push(r);
        weights.push(analog.weight);
      }
    }
    const total = weights.reduce((a, b) => a + b, 0);
    const root = Math.sqrt(hour - 1);
    let centre = 0;
    let spread = PARAMS.fallbackSpread * root;
    if (values.length >= 3 && total > 0) {
      const mean = values.reduce((acc, v, i) => acc + v * weights[i], 0) / total;
      const median = weightedMedian(values, weights);
      centre = PARAMS.medianShare * median + (1 - PARAMS.medianShare) * mean;
      // A robust spread: the weighted median absolute deviation, scaled to a normal's standard deviation, so a few
      // wild launches do not blow up every hour's band.
      const mad = weightedMedian(values.map((v) => Math.abs(v - centre)), weights) * 1.4826;
      // Effective sample size: few heavy analogs mean the spread itself is uncertain, so widen it.
      const effective = total ** 2 / weights.reduce((acc, w) => acc + w * w, 0);
      const small = 1 + 1 / Math.max(1, effective);
      spread = Math.sqrt(mad * mad * small + (PARAMS.floorPerRootHour * root) ** 2) * PARAMS.inflate;
    }
    const q = Z.map((z) => Math.min(1e9, Math.max(0.01, Math.round(p1 * Math.exp(centre + z * spread) * 100) / 100)));
    for (let j = 1; j < q.length; j += 1) q[j] = Math.max(q[j], q[j - 1]);
    return { hour, q };
  });
}
