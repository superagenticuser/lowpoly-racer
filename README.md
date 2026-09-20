# 🏎️ Neon Racer

A cyberpunk 3D night-city time-trial racing game in the browser — built with Three.js (bundled locally, no CDN needed), plain CSS, and vanilla JavaScript.

## Play

**Live:** https://superagenticuser.github.io/lowpoly-racer/

Works on phone and desktop.

## Features

- Night-city street circuit: glowing skyscrapers, neon billboards, street lamps, rooftop beacons
- Neon tunnel district with light arches, glowing lane lines, wet-look asphalt
- Player car with neon underglow, working headlights, and light trails
- Ambient city traffic to dodge (GTA style)
- Arcade drift physics, lap timing with checkpoint validation, wrong-way warning
- **Ghost car** — your best lap replayed as a translucent rival
- Best lap saved in your browser
- High-resolution rendering: up to 3x pixel density, ACES tone mapping, soft shadows
- Adaptive quality: steps down resolution/shadows if the frame rate dips
- Touch controls on phones (steer / brake / drift), keyboard on desktop
  - Desktop: ← → or A/D steer, ↓ or S brake, Space drift (auto-gas)

## Run locally

Serve the folder over HTTP (ES modules don't work from `file://`):

```bash
npx serve .
```

## Files

- `index.html` — page, HUD, touch controls, overlays
- `styles.css` — neon HUD and menu styling, responsive + safe-area support
- `game.js` — city generation, physics, laps, ghost, traffic, audio, game loop (ES module)
- `three.module.min.js` — Three.js r160, bundled locally

Deployed with GitHub Pages from the `main` branch.
