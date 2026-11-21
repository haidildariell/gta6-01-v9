[![make.fun bounty](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/haidildariell/gta6-01-v9/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/haidildariell/gta6-01-v9/reward.svg)](https://make.fun/bounty/gta6-01)

# Neon Shores — Bahía Rosa

An original open-world crime game for the [make.fun "Make GTA 6" bounty](https://make.fun/bounty/gta6-01), built to run offline in a desktop browser from static files — no build step, no network requests, every texture, sound and song generated in code.

**Bahía Rosa, 1986.** Rosa Delgado, a getaway driver trying to go straight, takes one last set of jobs across a neon sunset city: an Ocean Drive of art-deco hotels and palm boulevards, a downtown of glass towers, a working port island reached by a causeway bridge, and a marina where the Midnight Run leaves after dark.

## What's in the game

- **A full open world** — seven avenues and nine streets of procedural city, a beach and boardwalk, a causeway bridge, the Puerto Alba port island with cranes and container yards, parks, parking lots and a marina.
- **On foot and behind the wheel** — third-person walking and driving with an arcade drift model: handbrake slides, skid marks, tire smoke, stunt ramps, breakable palms and hydrants, and a speedboat with a wake for the water.
- **Traffic and pedestrians** — civilian cars follow the street plan and brake for trouble; pedestrians stroll the sidewalks and run from gunfire.
- **A five-star wanted system** — interceptors pursue, ram and set roadblocks; at four stars a helicopter holds a spotlight on you. Lay low to cool the heat, or get wasted/busted and wake up at the hospital or the station, fined.
- **Combat** — fists, pistol, SMG and shotgun with tracers and hit reactions, health and armor pickups.
- **Four missions plus free-roam play** — the Pink Slip Sprint checkpoint race, Hot Hands (steal and deliver the gold Vesper), Armored & Dangerous (stop the port's armored truck), and the Midnight Run boat smuggling run — plus stunt-jump bonuses and cash pickups.
- **A living HUD** — radar minimap with police view-cones and mission markers, wanted stars, cash, weapon and vehicle readouts, health and armor bars, an in-game clock on a full day-night cycle.
- **Procedural everything** — canvas-painted building facades that light up at night, neon signs, a gradient sky with sun, stars and drifting clouds; Web Audio synth for the engine, sirens, gunfire and four radio stations (synthwave, funk, latin, chill) composed note by note in code.
- **Save** — cash, completed missions and your radio station persist in the browser.

## Controls

| Input | Action |
| --- | --- |
| W A S D / arrows | Walk / drive |
| Mouse | Camera (click the game to lock the pointer) |
| Left mouse button | Shoot |
| F or E | Enter / exit vehicle or boat |
| Space | Handbrake (drift) |
| Shift | Sprint on foot / boost in a car |
| 1–4 | Weapons |
| R | Radio station |
| M | Nearest mission info |
| Esc or P | Pause |

## Running it

Serve the `game/` folder with any static file server and open `index.html` in desktop Chrome — for example, from this repository's root:

```sh
node serve.ts        # then open http://localhost:8080
```

`main.ts` is the hand-in program: it copies `game/` and `screenshots/` to `/output` and writes the dossier with the vendored make.fun library, exactly as the bounty kit prescribes. Three.js (MIT) is vendored as `game/vendor/three.min.js`; everything else is hand-written for this entry.

## License

MIT — see `LICENSE`. Three.js is © its authors, MIT licensed.
