# gta6-twitch-forecast

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/z21001/gta6-twitch-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/z21001/gta6-twitch-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Forecasts Grand Theft Auto VI's Twitch viewers for each hour of release day (hours 2 to 24) as five quantiles, from the first hour's count. Every past launch in the case's comparables gives the log-ratio of each release-day hour to its hour 1. The ratios are pooled per hour with weights: by data tier (early-access launches count about a third, weak ones less, GTA VI's own pre-release history not at all), by unlock style (rolling midnight-local launches like GTA VI count 3x, single global unlocks almost nothing), and by how closely each launch's run-up into hour 1 matches the case's own. The centre is a median/mean blend; the spread is a robust MAD with a small-sample correction and a drift term that grows with the hour. With fewer than 3 analogs it falls back to persistence. Node 22, standard library only, deterministic.

`tools/evaluate.ts` scores the method leave-one-out on the comparables (each launch forecast from the others) against the house persistence baseline. On p00's 38 comparables the rolling midnight-local launches score a pinball loss of 0.294 against the baseline's 0.357, and all launches 0.808 against 0.930.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
node tools/evaluate.ts input/p00.in
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=zejggrsx&utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
