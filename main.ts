// An entry for make.fun's gta6-twitch-ccu-forecast-01 (Node 22, standard library only): forecasts Grand Theft Auto VI's
// concurrent Twitch viewers for hours 2 to 24 of its release day from hour 1's print, by pooling the release-day shapes
// of past launches (model.ts). For every <id>.in in the input directory it writes <id>.out to the output directory:
// {"hours":[{"hour":h,"q":[q05,q25,q50,q75,q95]}, ...]}, hours 2..24.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEVELS, forecastCase, type Case } from './model.ts';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
for (const file of readdirSync(INPUT_DIR).filter((name) => name.endsWith('.in')).sort()) {
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}`);
  writeFileSync(join(OUTPUT_DIR, `${file.slice(0, -'.in'.length)}.out`), `${JSON.stringify({ hours: forecastCase(c) })}\n`);
}
