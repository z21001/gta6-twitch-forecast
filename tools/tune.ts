// A small grid search over the forecaster's spread and weighting (Node 22, standard library only): for each setting it
// runs the leave-one-out check over the rolling midnight-local launches (GTA VI's own kind) and over every comparable
// launch, and prints the best settings by the rolling loss.
//   node tools/tune.ts <case.in>
import { readFileSync } from 'node:fs';
import { LEVELS, PARAMS, forecastCase, tierOf, unlockClass, type Case, type Comparable } from '../model.ts';

const HOUR = 3600 * 1000;
const source = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Case;
const pool = source.comparables.filter((c) => tierOf(c) !== 'target-history');

/** The mean loss of the forecaster over the launches `keep` selects, each forecast from all the others. */
function score(keep: (c: Comparable) => boolean): number {
  let sum = 0;
  let n = 0;
  for (const target of pool) {
    if (tierOf(target) !== 'comparable' || !keep(target)) continue;
    const start = Date.parse(target.day_start);
    const hours = new Map(target.hourly.map((row) => [Date.parse(row.from), row.viewers]));
    const p1 = hours.get(start);
    if (!p1) continue;
    const c: Case = {
      id: target.name, day_start: target.day_start, levels: LEVELS, known: [{ hour: 1, viewers: p1 }],
      forecast: Array.from({ length: 23 }, (_, i) => ({ hour: i + 2 })),
      history_hourly: target.hourly.filter((row) => Date.parse(row.from) < start),
      comparables: pool.filter((other) => other !== target),
    };
    for (const row of forecastCase(c)) {
      const y = hours.get(start + (row.hour - 1) * HOUR);
      if (y === undefined) continue;
      row.q.forEach((q, j) => {
        const d = Math.log(Math.max(1, y)) - Math.log(q);
        sum += 2 * Math.max(LEVELS[j] * d, (LEVELS[j] - 1) * d);
        n += 1;
      });
    }
  }
  return sum / n;
}

const results: Array<{ setting: string; rolling: number; all: number }> = [];
for (const inflate of [0.9, 1.0, 1.15, 1.3])
  for (const floor of [0.03, 0.07, 0.12])
    for (const medianShare of [0.4, 0.7, 1])
      for (const rolling of [3, 8])
        for (const jumpWidth of [0.3, 0.6, 99]) {
          Object.assign(PARAMS, { inflate, floorPerRootHour: floor, medianShare, jumpWidth, runupWidth: jumpWidth * 1.5 });
          PARAMS.classWeight.rolling = rolling;
          results.push({ setting: JSON.stringify({ inflate, floor, medianShare, rolling, jumpWidth }), rolling: score((c) => unlockClass(c) === 'rolling'), all: score(() => true) });
        }
results.sort((a, b) => a.rolling - b.rolling);
for (const r of results.slice(0, 10)) console.log(`${r.rolling.toFixed(4)}  all ${r.all.toFixed(4)}  ${r.setting}`);
