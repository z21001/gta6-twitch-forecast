// Weighted summary statistics used to pool analog log-ratios.

export interface WeightedValue {
  value: number;
  weight: number;
}

export function totalWeight(items: WeightedValue[]): number {
  let s = 0;
  for (const it of items) s += it.weight;
  return s;
}

// Weighted median: the smallest value whose cumulative weight reaches half.
export function weightedQuantile(items: WeightedValue[], tau: number): number {
  const sorted = items.filter((it) => it.weight > 0).sort((a, b) => a.value - b.value);
  if (sorted.length === 0) return NaN;
  const total = totalWeight(sorted);
  const target = tau * total;
  let acc = 0;
  for (const it of sorted) {
    acc += it.weight;
    if (acc >= target - 1e-12) return it.value;
  }
  return sorted[sorted.length - 1].value;
}

export function weightedMean(items: WeightedValue[]): number {
  const total = totalWeight(items);
  if (total <= 0) return NaN;
  let s = 0;
  for (const it of items) s += it.value * it.weight;
  return s / total;
}

// Weighted median absolute deviation around a given centre.
export function weightedMad(items: WeightedValue[], centre: number): number {
  const dev = items.map((it) => ({ value: Math.abs(it.value - centre), weight: it.weight }));
  return weightedQuantile(dev, 0.5);
}

// Kish effective sample size: (sum w)^2 / sum w^2.
export function effectiveSize(items: WeightedValue[]): number {
  let s = 0;
  let s2 = 0;
  for (const it of items) {
    s += it.weight;
    s2 += it.weight * it.weight;
  }
  return s2 > 0 ? (s * s) / s2 : 0;
}

export function gaussianKernel(distance: number, width: number): number {
  const u = distance / width;
  return Math.exp(-0.5 * u * u);
}
