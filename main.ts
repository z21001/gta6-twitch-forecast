// make.fun gta6-twitch-ccu-forecast-01 entry: read every case in the input
// directory, forecast hours 2..24 from analog launches, write <id>.out.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Comparable, HourlyRow } from "./src/launch.ts";
import { runUp, seriesFromRows, toLaunch } from "./src/launch.ts";
import { forecast, quantilesFrom } from "./src/model.ts";

interface CaseFile {
  id: string;
  day_start: string;
  known: { hour: number; viewers: number }[];
  history_hourly: HourlyRow[] | null;
  comparables: Comparable[] | null;
}

function solve(c: CaseFile): string {
  const dayStartMs = Date.parse(c.day_start);
  const h1 = c.known.find((k) => k.hour === 1);
  const p1 = h1 && Number.isFinite(h1.viewers) ? Math.max(1, h1.viewers) : 1;
  const own = seriesFromRows(c.history_hourly ?? [], dayStartMs);
  own.set(0, p1);
  const analogs = (c.comparables ?? []).map(toLaunch);
  const hours = forecast({ p1, runUp: runUp(own) }, analogs);
  return JSON.stringify({ hours });
}

function main(): void {
  const inDir = process.env.MAKEFUN_INPUT_DIR || "/input";
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  const files = readdirSync(inDir).filter((f) => f.endsWith(".in")).sort();
  for (const f of files) {
    const c = JSON.parse(readFileSync(join(inDir, f), "utf8")) as CaseFile;
    const id = c.id || f.slice(0, -3);
    let text: string;
    try {
      text = solve(c);
    } catch {
      // Never leave a case invalid: fall back to persistence with a widening band.
      const h1 = c.known?.find((k) => k.hour === 1);
      const p1 = Math.max(1, h1?.viewers ?? 1);
      const hours = [];
      for (let h = 2; h <= 24; h++) hours.push({ hour: h, q: quantilesFrom(p1, 0, 0.25 * Math.sqrt(h - 1)) });
      text = JSON.stringify({ hours });
    }
    writeFileSync(join(outDir, `${id}.out`), text);
  }
}

main();
