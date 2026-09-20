# 🏎️ Lowpoly Racer

A 3D time-trial racing game that runs in the browser — built with Three.js (bundled locally, no CDN needed), plain CSS, and vanilla JavaScript.

## Play

**Live:** https://superagenticuser.github.io/lowpoly-racer/

Works on phone and desktop.

## Features

- Low-poly 3D track with trees, mountains, curbs, and a checkered start line
- Arcade car physics with **drift** (handbrake slides the rear out)
- Time-trial laps with checkpoint validation, wrong-way warning, and live timing
- **Ghost car** — your best lap is recorded and replayed as a translucent rival
- Best lap saved in your browser
- Chase camera, engine sound that follows your speed, countdown start
- Touch controls on phones (steer / brake / drift), keyboard on desktop
  - Desktop: ← → or A/D steer, ↓ or S brake, Space drift (auto-gas)

## Run locally

Serve the folder over HTTP (ES modules don't work from `file://`):

```bash
npx serve .
```

## Files

- `index.html` — page, HUD, touch controls, overlays
- `styles.css` — HUD and menu styling, responsive + safe-area support
- `game.js` — track generation, physics, laps, ghost, audio, game loop (ES module)
- `three.module.min.js` — Three.js r160, bundled locally

Deployed with GitHub Pages from the `main` branch.
