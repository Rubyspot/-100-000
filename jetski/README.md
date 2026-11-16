# Jetski race

Seated WebXR race at sunset against Jane, on a Kawasaki STX-15F. Self-contained page; it shares only
`../vendor/` (three.js and its GLTFLoader) and the seagull voices in `../audio.js` with the opening scene.

Open `https://rubyspot.github.io/-100-000/jetski/` in Quest Browser and tap **Enter VR**.

## The course (~2.1 km, two laps, about 3 minutes)

1. **Open sea**: start/finish arch, a buoy-lined sweeper and a trampoline.
2. **Lighthouse hairpin**: a tight left around the lighthouse rock (rotating beam).
3. **The gorge**: a 14 m wide sandstone canyon with S-bends. A waterfall pours off a rock arch across the
   channel and you ride straight through it (drenched view, roar, echo off the walls).
4. **The lagoon**: wide turquoise water, a trampoline and a row of cash rings.
5. **Canal town**: 12 m canals between pastel houses with lit windows, bridges, string lights and
   chevron boards on the outside of the corners, back out to the start.

Swell calms down in narrow water and near shores (the same on the GPU and in the physics).

## Controls (hands first, one hand)

- The handlebar is placed from your head position when VR starts (Quest's recenter re-places it).
- **Either hand** makes a fist on its grip; the first hand on the bar rides. Holding it is full throttle;
  open the hand to coast.
- **Steer by tilting the fist** in front of you, like turning a dial: counter-clockwise turns left,
  clockwise turns right (32° for full lock). Pushing or pulling the fist around the bar also steers.
  The pose you grab with is the neutral, so there's nothing to calibrate.
- **The other hand** is free: the gulls drop bills on that side.
- With both hands on the bar, the steering averages.
- Fallbacks for testing: controllers (trigger or grip = go, tilt the controller or use the thumbstick to
  steer) and keyboard in the flat preview (W/↑ throttle, A/D or ←/→ steer, Space start). In the preview,
  bills near the seat are caught automatically.

## Mechanics

- **Hype** (x1 to x5 shown as pips on the dash): every gate cleared without touching a wall adds one. Each
  level adds 6% thrust and makes a caught bill worth $100 more ($600 at max). A wall hit resets it.
- **Cash rings**: gold rings give a 2.2 s boost and $2,500. Jane uses them too.
- **Jumps**: hang time over ~0.9 s gives a short boost on landing.
- **$100,000**: the dash bar fills toward it. A clean, catch-everything run gets there in two laps.
- Jane rides the line with a rubber band (eases off when well ahead, pushes when behind).

## Sound

All synthesized (no sample files needed): engine (4-cylinder firing loop, impeller whine, water rush),
wind that builds with speed and in the air, hull slaps, wall scrape and thuds, boost whoosh, gate chimes
that climb a pentatonic scale with Hype, Hype-lost tones, countdown beeps, lap bell, finish fanfare, and
the waterfall's roar. A reverb send and a slap-back echo (delay set by the distance to the walls) make the
gorge, canals and bridges sound enclosed. Jane's engine gets an exaggerated Doppler shift as she passes.
Recorded `engine.mp3`, `ocean.mp3` or `splash.mp3` in `audio/`, listed in `audio/sounds.json`, replace the
synthesized ones. The Crispy J playlist plays on top.

## Files

- `main.js`: race flow, hands and one-handed steering, mechanics, HUD, frame loop.
- `track.js`: the course: centreline with per-sample width, gorge cliffs and town quays built from it,
  houses, bridges, string lights, rock arch and waterfall, lighthouse, chevron boards, gates (glowing
  arches), cash rings, trampolines, buoys, collisions (wall slide), and the distance-to-land map.
- `sky.js`: sunset sky baked once into a texture shared by the dome, the water and the paint.
- `ocean.js`: Gerstner swell on a camera-following grid, calmed by the land map; the CPU runs the same waves.
- `craft.js`: jetski physics (hull probes, planing, jumps, jet steering, boost).
- `effects.js`: wake ribbon (gold while boosting), spray, speed streaks.
- `gulls.js`, `dolphins.js`, `sfx.js`, `models.js` + `assets/kawasaki-st15f.glb`.

## URL options

`?laps=N` (1–5), `?music=0`, `?vignette=0`, `?streaks=0`, `?heave=0` (view doesn't follow the hull up and
down), `?steer=twist|bar|sway|mix` (default mix = tilt + bar push), `?twist=32` (degrees of tilt for full
lock), `?squeeze` (old squeeze-for-throttle), `?debug` (fps on the dash), `?autostart` (flat preview),
`?chase` (preview camera behind), `?map` or `?map=420` (course from above), `?autopilot`, `?at=N` (preview:
start at control point N, e.g. `?at=15` the gorge, `?at=26` the town).
