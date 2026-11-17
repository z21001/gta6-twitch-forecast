// Leave-one-out check of the forecaster (Node 22, standard library only): every past launch in a case file's
// comparables is turned into a pseudo-case (its run-up as history, its hour 1 as the print, the other launches as
// comparables), forecast, and scored with the contest's loss: the mean over hours 2..24 and the five levels of
// 2 * max(tau * d, (tau - 1) * d), d = ln(y) - ln(q). The house baseline (persistence, 0.15 per root hour) is scored
// the same way for comparison.
//   node tools/evaluate.ts <case.in> [--all-tiers]
import { readFileSync } from 'node:fs';
import { LEVELS, forecastCase, tierOf, unlockClass, type Case, type Comparable } from '../model.ts';

const HOUR = 3600 * 1000;
const Z = [-1.645, -0.674, 0, 0.674, 1.645];

/** The contest's loss for one forecast against the actual counts by hour. */
function loss(rows: Array<{ hour: number; q: number[] }>, actual: Map<number, number>): { sum: number; n: number } {
  let sum = 0;
  let n = 0;
  for (const row of rows) {
    const y = actual.get(row.hour);
    if (y === undefined) continue;
    row.q.forEach((q, j) => {
      const d = Math.log(Math.max(1, y)) - Math.log(q);
      sum += 2 * Math.max(LEVELS[j] * d, (LEVELS[j] - 1) * d);
      n += 1;
    });
  }
  return { sum, n };
}

/** The pseudo-case for one launch, forecast from the others. */
function pseudoCase(target: Comparable, others: Comparable[]): { c: Case; actual: Map<number, number> } | null {
  const start = Date.parse(target.day_start);
  const hours = new Map(target.hourly.map((row) => [Date.parse(row.from), row.viewers]));
  const p1 = hours.get(start);
  if (!p1) return null;
  const actual = new Map<number, number>();
  for (let h = 2; h <= 24; h += 1) {
    const v = hours.get(start + (h - 1) * HOUR);
    if (v !== undefined) actual.set(h, v);
  }
  if (actual.size < 12) return null;
  const c: Case = {
    id: target.name,
    day_start: target.day_start,
    levels: LEVELS,
    known: [{ hour: 1, viewers: p1 }],
    forecast: Array.from({ length: 23 }, (_, i) => ({ hour: i + 2 })),
    history_hourly: target.hourly.filter((row) => Date.parse(row.from) < start),
    comparables: others,
  };
  return { c, actual };
}

const file = process.argv[2];
const allTiers = process.argv.includes('--all-tiers');
const source = JSON.parse(readFileSync(file, 'utf8')) as Case;
const pool = source.comparables.filter((c) => tierOf(c) !== 'target-history');
let model = { sum: 0, n: 0 };
let base = { sum: 0, n: 0 };
const lines: string[] = [];
const byClass = new Map<string, { model: number; base: number; n: number }>();
for (const target of pool) {
  if (!allTiers && tierOf(target) !== 'comparable') continue;
  const built = pseudoCase(target, pool.filter((c) => c !== target));
  if (!built) continue;
  const ours = loss(forecastCase(built.c), built.actual);
  const p1 = built.c.known[0].viewers;
  const baseline = loss(built.c.forecast.map(({ hour }) => ({ hour, q: Z.map((z) => p1 * Math.exp(z * 0.15 * Math.sqrt(hour - 1))) })), built.actual);
  model = { sum: model.sum + ours.sum, n: model.n + ours.n };
  base = { sum: base.sum + baseline.sum, n: base.n + baseline.n };
  const kind = unlockClass(target);
  const group = byClass.get(kind) ?? { model: 0, base: 0, n: 0 };
  byClass.set(kind, { model: group.model + ours.sum, base: group.base + baseline.sum, n: group.n + ours.n });
  lines.push(`${(ours.sum / ours.n).toFixed(3)}  base ${(baseline.sum / baseline.n).toFixed(3)}  ${kind.padEnd(12)} ${target.name}`);
}
console.log(lines.join('\n'));
console.log(`MODEL ${(model.sum / model.n).toFixed(4)}   BASELINE ${(base.sum / base.n).toFixed(4)}   launches ${lines.length}`);
for (const [kind, group] of byClass) console.log(`  ${kind.padEnd(12)} model ${(group.model / group.n).toFixed(4)}  baseline ${(group.base / group.n).toFixed(4)}`);
