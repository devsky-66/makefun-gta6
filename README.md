# makefun-gta6

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/devsky-66/makefun-gta6/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/devsky-66/makefun-gta6/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Cinder Bay Nights** — a 2D top-down open-world crime game that runs fully offline in a desktop browser. Explore the fictional harbour city of Cinder Bay on foot or behind the wheel, take six story jobs from the fixer Vex, steal cars, outrun the police, and shake the heat. Every pixel is hand-drawn on canvas with zero external dependencies: no libraries, no network requests, no audio files — every sound effect is synthesised live with the Web Audio API.

Inside the game: a road-grid city with live traffic, pedestrians, a day/night cycle with headlights, and a pier road running down to the docks; four vehicle types (sedan, taxi, van, motorbike) with different speed and handling; a 0–5 star wanted system with police chases, sirens and roadblocks once you hit four stars; shooting combat against mission thugs and the police; cash, health and ammo pickups; six linked missions (first wheels, a harbour run, a bank job, losing the heat, a timed three-stop rush, and the ledger finale); a HUD with minimap, start/pause/busted/wasted screens, and localStorage saves. `?seed=` pins the random city; `?shot=start|drive|chase|mission` stages a screenshot scene using the real game rules.

## How to play

```sh
node serve.ts
```

Then open http://localhost:8080 — there is no build step and nothing to install. Move with WASD or the arrow keys, press E to get in or out of a car, click or press Space to shoot, P to pause, M to mute, R to retry a failed mission.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
