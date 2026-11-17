# Jetski race

One lap of Crispy J's lagoon against Jane, about two minutes, seated, on a Kawasaki STX-15F in yellow and
pink. Seagulls fly ahead and drop a trail of $100 bills along the racing line; ride through them and try to
bank the song's $100,000.

The game is a module (`race.js`). It runs in two places:

- **In the opening** (`../main.js`): after the 180 video Jane offers the ride and a toy jetski floats in front
  of the player. Touching it starts the race in the same session; JANE on the results board comes back to
  her room, where she reacts to the result and offers another lap.
- **On its own page**: `https://rubyspot.github.io/-100-000/jetski/`, **Enter VR** in Quest Browser, or the
  flat preview with the keyboard.

## The lap (about 1.85 km)

1. **Lagoon**: start under the arch, the first ramp, a long left-hand bend around a tall rock.
2. **East canal**: fast S-bends between limestone walls, under a rock arch.
3. **North side**: open water, a slalom between rock stacks, the second ramp.
4. **West canal**: narrower, quicker turns, a second arch, and a ramp that throws you out of the rocks back
   into the lagoon for the finish.

The islands, canals and stacks are generated in `world.js` (limestone with strata and stains, bushes and
palms on top, sand beaches, inflatable ramps, buoys and bunting in pink and yellow). The water is clear:
you see the sand bed and sea grass through it, pale in the shallows and deep blue outside the lagoon, with
foam at the waterline, cliff shadows and sun glitter. Swell calms down in the canals, the same on the GPU
and in the physics.

## Controls (hands first, one hand is enough)

- When the ride starts, the seat is placed from where your head is, sitting or standing, and re-placed if
  you sit down or move before grabbing the bar. The handlebar sits on a riser: the grips are 36 cm below
  and 42 cm ahead of your eyes (`?bar=below,ahead`, `?riser=`).
- **Make a fist (or pinch) on a grip** to go: full throttle while you hold it, open the hand to coast. The
  bar comes to your hand if you grab a little off the grip. A glove shows while you hold on.
- **Steer by turning the fist**: like a dial (35° is full lock), like a handlebar (45°), or by pushing the
  grip forward and back around the bar. They add up. The pose you grab with is the neutral.
- **Both hands** on the bar steer like a real handlebar.
- The steering goes through a One Euro filter, a small dead zone and a soft curve around the middle, then
  the jetski's own steering lag, so small tremors don't reach the hull. Turn rate is limited by cornering
  grip at speed, and the view never pitches or rolls with the hull.
- A hand that drops out of tracking for under half a second keeps its grip.
- Fallbacks: controllers (trigger or grip = go, tilt the controller or use the thumbstick to steer, A/B on
  the results) and the keyboard in the flat preview (W/↑ go, A/D or ←/→ steer, Space start, R again,
  Esc exit).

## Mechanics

- **Follow the bills.** The flock (Ilia's rigged seagull) flies about 60 m ahead and drops bills (Ilia's
  bill mesh) every 10 m along the racing line. A bill within 3.4 m flies to you, and from up to 5 m while
  your combo is low, so the money comes to a rider who is struggling.
- **Crispy combo**: each bill in a row is worth $250 more, up to $2,500 at x10. A missed bill costs one
  step, a wall hit three. The combo also adds a little thrust.
- **Golden bills** hang in the air past each of the four ramps: $10,000 and a boost. Long jumps boost too.
- **$100,000** is meant to come with ease, as in the song: a first lap that takes a bit over half of the
  bills gets there, and a clean lap triples it. Jane cheers at $100,000 and again at $200,000.
- **Jane** (her first 3D scan, standing on a pink jetski) rides the line with a rubber band: she waits
  when she is ahead and pushes when she is behind. Her lines show in a speech bubble.

## Interface

Hot pink, sunny yellow, cream and plum, set in Fredoka (`assets/fonts`, SIL Open Font License): a dash on
the handlebar (cash and the bar to $100,000, combo pips, place, speed, time, you and Jane on the lap), big
messages ahead, "+$700" pops, confetti, and a results board with two palm-size buttons at arm's reach
(AGAIN, and EXIT or JANE). A soft vignette in fast turns (`?vignette=0`).

## Sound

Synthesized at the audio context's own rate (Quest runs at 48 kHz): engine, wind, hull slaps, wall scrape
and thuds, boost whoosh, a pluck that climbs a pentatonic scale with the combo and a crackle on each bill,
gate chimes, a boing off the ramps, countdown, fanfare. Reverb and a slap-back echo make the canals sound
enclosed. Jane's engine and the gulls are positioned in space. The Crispy J playlist plays on top
(`?music=0`). Recorded `engine.mp3`, `ocean.mp3` or `splash.mp3` in `audio/`, listed in
`audio/sounds.json`, replace the synthesized ones.

## Files

- `race.js`: the game as a module: `createRace({ renderer, embedded, onExit, options })`, then
  `await race.ready`, `race.start()`, and `race.frame(time, xrFrame)` every frame. It has its own scene,
  camera and audio listener and reads hands and head straight from the XR frame, so it runs inside any
  session.
- `main.js`, `index.html`: the standalone page (start card, Enter VR, preview).
- `world.js`: course, islands, canals, props, collisions, and the baked maps (distance to land, depth,
  light on the water, sun and sky on every rock vertex).
- `ocean.js`, `sky.js`: water and sky. `craft.js`: jetski physics. `controls.js`: hands, controllers,
  keyboard. `hud.js`: the interface. `gulls.js`: flock, bills, combo. `effects.js`: wake, spray, speed
  streaks, confetti. `sfx.js`: sound. `models.js`: jetski, gloves, Jane.

## URL options (standalone page)

`?autostart` (straight to the preview), `?autopilot` (rides itself; `=wander` drifts like a first-timer,
`=sloppy` weaves into walls), `?chase`
(`=jane` looks at her), `?map`, `?at=N` (start at control point N), `?debug` (fps on the dash,
`window.simulate(seconds)`), `?bar=0.36,0.42`, `?riser=0.12`, `?fb=0.9` (headset resolution scale),
`?music=0`, `?vignette=0`, `?streaks=0`, `?heave=0` (the view keeps its height), `?jane=simple` (no scan).

In the opening: `?bar=`, `?riser=`, `?vignette=0`, `?streaks=0`, `?heave=0`, `?music=0`, `?debug` and
`?autopilot` work the same way, `?aa=1` turns multisampling on for the session, and `?race=0` leaves the
race out (the floating jetski then opens this page).

## Testing without a headset

Headless Chromium with [IWER](https://github.com/meta-quest/immersive-web-emulation-runtime) as an
emulated Quest 3: tracked hands grab and steer, the audio context forced to 48 kHz, and the opening's flat
preview run end to end (video end, floating jetski, race, back to Jane).
