# makefun-gta6

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/devsky-66/makefun-gta6/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/devsky-66/makefun-gta6/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Neon Bay Nights** — a 2D top-down open-world crime game that plays offline in a desktop browser. Explore the fictional harbour city of Neon Bay on foot or behind the wheel, run six story missions, steal cars, dodge the police, and lose the heat. Everything is hand-drawn on canvas with zero external dependencies: no libraries, no network requests, no audio files — all sound effects are synthesised live with the Web Audio API.

What is inside: a road-grid city with traffic, pedestrians, day/night cycle and headlights; three vehicle types (sedan, bus, motorbike) with different speed and handling; a 0–5 star wanted system with police chases, sirens and roadblocks at four stars; melee and shooting combat; cash, health and ammo pickups; six linked missions (dockside pickup, cross-town delivery, losing the heat, a 30-second bank standoff, a three-stop timed rush, and the mayor's ledger finale); HUD, minimap, start/pause/busted/wasted screens, and localStorage saves. `?seed=` fixes the random city; `?shot=start|drive|chase|mission` stages a screenshot scene from the real rules.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 — no build step, no install. Move with WASD or arrow keys, press E to enter or leave a car, Space for melee, click to shoot, P to pause, M to mute, R to retry a failed mission.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
