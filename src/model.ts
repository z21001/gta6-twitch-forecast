// Analog-launch forecaster: pool other launches' hour-h / hour-1 log-ratios.

import type { LaunchSeries, RunUp, Tier, UnlockStyle } from "./launch.ts";
import { runUp } from "./launch.ts";
import type { WeightedValue } from "./stats.ts";
import {
  effectiveSize,
  gaussianKernel,
  weightedMad,
  weightedMean,
  weightedQuantile,
} from "./stats.ts";

export const Z_LEVELS = [-1.6449, -0.6745, 0, 0.6745, 1.6449];

export interface Params {
  tierWeight: Record<Tier, number>;
  styleWeight: Record<UnlockStyle, number>;
  jumpWidth: number;
  rampWidth: number;
  missingFeature: number; // kernel factor when a feature cannot be computed
  kernelFloor: number; // least kernel factor for a feature that can be computed
  medianShare: number; // centre = share x median + (1 - share) x mean
  driftPerRootHour: number;
  fallbackPerRootHour: number;
  minAnalogs: number;
}

export const DEFAULT_PARAMS: Params = {
  tierWeight: { comparable: 1, "early-access": 0.33, weak: 0.1, "target-history": 0 },
  styleWeight: { rolling: 3, simultaneous: 0.08, other: 1 },
  jumpWidth: 0.3,
  rampWidth: 0.45,
  missingFeature: 0.5,
  kernelFloor: 0.02,
  medianShare: 0.7,
  driftPerRootHour: 0.12,
  fallbackPerRootHour: 0.25,
  minAnalogs: 3,
};

export interface Target {
  p1: number;
  runUp: RunUp;
}

export interface HourForecast {
  hour: number;
  q: number[];
}

// A floored kernel: a launch whose run-up looks unlike the target's keeps a small
// share of weight, so the pool never collapses onto one or two analogs.
function featureFactor(a: number, b: number, width: number, missing: number, floor: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return missing;
  return floor + (1 - floor) * gaussianKernel(a - b, width);
}

export function analogWeight(target: RunUp, analog: LaunchSeries, p: Params): number {
  const base = p.tierWeight[analog.tier] * p.styleWeight[analog.style];
  if (base <= 0) return 0;
  const ru = runUp(analog.byOffset);
  return (
    base *
    featureFactor(target.jump, ru.jump, p.jumpWidth, p.missingFeature, p.kernelFloor) *
    featureFactor(target.ramp, ru.ramp, p.rampWidth, p.missingFeature, p.kernelFloor)
  );
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function quantilesFrom(p1: number, centre: number, spread: number): number[] {
  const out: number[] = [];
  let prev = 0;
  for (const z of Z_LEVELS) {
    let q = round2(p1 * Math.exp(centre + z * spread));
    if (!(q > 0)) q = 0.01;
    if (q > 1e9) q = 1e9;
    if (q < prev) q = prev;
    out.push(q);
    prev = q;
  }
  return out;
}

export function forecast(target: Target, analogs: LaunchSeries[], p: Params = DEFAULT_PARAMS): HourForecast[] {
  const p1 = Math.max(1, target.p1);
  const weights = analogs.map((a) => analogWeight(target.runUp, a, p));
  const rows: HourForecast[] = [];
  for (let h = 2; h <= 24; h++) {
    const items: WeightedValue[] = [];
    analogs.forEach((a, i) => {
      const w = weights[i];
      if (w <= 0) return;
      const v1 = a.byOffset.get(0);
      const vh = a.byOffset.get(h - 1);
      if (v1 === undefined || vh === undefined) return;
      items.push({ value: Math.log(vh / v1), weight: w });
    });
    const root = Math.sqrt(h - 1);
    let centre = 0;
    let spread = p.fallbackPerRootHour * root;
    if (items.length >= p.minAnalogs) {
      const med = weightedQuantile(items, 0.5);
      const mean = weightedMean(items);
      centre = p.medianShare * med + (1 - p.medianShare) * mean;
      const sigma = 1.4826 * weightedMad(items, med);
      const nEff = Math.max(1, effectiveSize(items));
      const drift = p.driftPerRootHour * root;
      spread = Math.sqrt(sigma * sigma * (1 + 1 / nEff) + drift * drift);
    }
    rows.push({ hour: h, q: quantilesFrom(p1, centre, spread) });
  }
  return rows;
}
