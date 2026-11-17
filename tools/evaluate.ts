// Leave-one-out check: each comparable launch in a case file becomes a pseudo-case,
// forecast from the other launches, scored with the contest's log pinball loss
// beside the house persistence baseline.
// Usage: node tools/evaluate.ts <case.in> [paramOverridesJson]

import { readFileSync } from "node:fs";
import type { Comparable, LaunchSeries } from "../src/launch.ts";
import { runUp, toLaunch } from "../src/launch.ts";
import type { Params } from "../src/model.ts";
import { DEFAULT_PARAMS, forecast, quantilesFrom } from "../src/model.ts";

const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];

function pinball(y: number, q: number, tau: number): number {
  const d = Math.log(Math.max(1, y)) - Math.log(q);
  return 2 * Math.max(tau * d, (tau - 1) * d);
}

interface Score {
  model: number;
  base: number;
  n: number;
}

function scoreLaunch(target: LaunchSeries, others: LaunchSeries[], p: Params): Score | null {
  const p1 = target.byOffset.get(0);
  if (p1 === undefined) return null;
  const rows = forecast({ p1, runUp: runUp(target.byOffset) }, others, p);
  let model = 0;
  let base = 0;
  let n = 0;
  for (const r of rows) {
    const y = target.byOffset.get(r.hour - 1);
    if (y === undefined) continue;
    const bq = quantilesFrom(Math.max(1, p1), 0, 0.15 * Math.sqrt(r.hour - 1));
    for (let i = 0; i < 5; i++) {
      model += pinball(y, r.q[i], LEVELS[i]);
      base += pinball(y, bq[i], LEVELS[i]);
      n++;
    }
  }
  return n > 0 ? { model, base, n } : null;
}

export function evaluate(launches: LaunchSeries[], p: Params, verbose = false): Map<string, Score> {
  const groups = new Map<string, Score>();
  const add = (key: string, s: Score) => {
    const g = groups.get(key) ?? { model: 0, base: 0, n: 0 };
    g.model += s.model;
    g.base += s.base;
    g.n += s.n;
    groups.set(key, g);
  };
  for (const t of launches) {
    if (t.tier === "target-history") continue;
    const s = scoreLaunch(t, launches.filter((o) => o !== t), p);
    if (!s) continue;
    if (verbose) {
      console.log(
        `${t.style.padEnd(12)} ${t.tier.padEnd(13)} model ${(s.model / s.n).toFixed(3)} base ${(s.base / s.n).toFixed(3)}  ${t.name}`,
      );
    }
    add("all", s);
    add(t.style, s);
    if (t.tier === "comparable") add(`${t.style}/comparable`, s);
  }
  return groups;
}

function main(): void {
  const file = process.argv[2];
  if (!file) throw new Error("usage: node tools/evaluate.ts <case.in> [overrides]");
  const c = JSON.parse(readFileSync(file, "utf8")) as { comparables: Comparable[] };
  const launches = c.comparables.map(toLaunch);
  const p: Params = { ...DEFAULT_PARAMS, ...(process.argv[3] ? JSON.parse(process.argv[3]) : {}) };
  const groups = evaluate(launches, p, true);
  console.log("");
  for (const [k, g] of [...groups].sort()) {
    console.log(`${k.padEnd(24)} model ${(g.model / g.n).toFixed(4)}  baseline ${(g.base / g.n).toFixed(4)}  items ${g.n}`);
  }
}

main();
