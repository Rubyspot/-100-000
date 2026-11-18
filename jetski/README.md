# Jetski race

One lap of Crispy J's lagoon against Jane, about two minutes, seated, on a Kawasaki STX-15F in yellow and
black. Seagulls fly ahead and drop a trail of $100 bills along the racing line; ride through them and try to
bank the song's $100,000.

The game is a module (`race.js`). It runs in two places:

- **In the opening** (`../main.js`): after the 180 video Jane offers the ride and a toy jetski stands where the
  video's play button first stood (`sceneApi.buttonSpot`). Touching it starts the race in the same session; Back
  (on your right, beside Quit) or BACK on the results board comes back to her room, where the toy jetski is waiting at
  once, with the play button beside it (the two side by side on that spot, 38 cm apart, standing still), while
  she reacts to the result.
- **On its own page**: `https://rubyspot.github.io/-100-000/jetski/`, **Enter VR** in Quest Browser, or the
  flat preview with the keyboard.

## The lap (about 1.85 km)

1. **Lagoon**: start under the arch, the first ramp, a long left-hand bend around a tall rock.
2. **East canal**: fast S-bends between limestone walls, under a rock arch.
3. **North side**: open water, a slalom between rock stacks, the second ramp.
4. **West canal**: narrower, quicker turns, a second arch, and a ramp that throws you out of the rocks back
   into the lagoon for the finish.

The islands, canals and stacks are generated in `world.js`: limestone towers with near-vertical sides and
a jungle crown; the stone broken into blocks and chips that catch the light face by face, with open joints,
pits in patches, a ledge here and there, rain streaks and rust stains, and up close the relief of real
stone (scanned normal maps in `assets/stone`, CC0: a cliff face's runnels and ribs on the sides, rough
stone on top, grit in the sand), darker in its cracks; round leaf clumps with ragged outlines; palms with
ringed trunks and arching fronds that let the sun through; sand beaches; and glossy inflatables in pink
and yellow (the arches, ramps, floats, parasols, buoys), smooth and catching the sky like PVC. The land
is closed everywhere you can look from the water: the canal walls dip under the sea at the canals' mouths
instead of ending in an open cut.

The light is a sunset, as in the first builds (`sky.js`): a peach horizon, a rose band, violet and a deep
blue zenith with clouds lit pink from below, and a low sun ahead and to the left of the start straight.
Far things fade into the colour of the sky low over the horizon in their direction.

The water (`ocean.js`) is open sea, the way the first build drew it: a swell you ride over, a deep body
colour in the wave faces turned toward you, the sky mirrored in the faces turned away (rock and trees
instead of sky inside the canals), a road of sun glitter toward the low sun, light glowing through
the crests, whitecaps, foam along the shore. Its colour comes from the depth: pale sand and dark sea grass
show through the shallows off the beaches, the lagoon runs turquoise to teal, and the open sea is deep
blue. Cliffs throw their shadows on it. Swell calms down in the canals, the same on the GPU and in the
physics.

## Controls (hands first, one hand is enough)

- When the ride starts, the seat is placed from where your head is, sitting or standing, and re-placed if
  you sit down or move before grabbing the bar. The handlebar sits on a riser: the grips are 36 cm below
  and 42 cm ahead of your eyes (`?bar=below,ahead`, `?riser=`).
- **The right hand is the throttle.** Make a fist (or pinch) on the right grip to go. The index finger is
  the lever, as on a real jetski: wrapped around the grip it is full throttle, lifted off it eases off to
  nothing while the other fingers keep hold. Opening the hand lets go. The bar comes to your hand if you
  grab a little off the grip. `?throttle=any` lets either hand do it.
- **Your hands look like hands**: the opening's hand meshes (`../hands.js`), posed from the tracked joints.
  A fist on a grip is drawn closed round it, moving with the bar as the hull pitches, rolls and steers,
  and slides back to where your hand is when you let go. (If the meshes can't load, yellow dots and
  gloves stand in.)
- **One hand is enough to steer**, either one: turn the fist like a dial, like a handlebar, or push the
  grip forward and back around the bar. They add up, and the pose you grab with is the neutral. A left
  hand alone holds and steers; the dash then says which hand makes it go.
- **A small turn of the hand goes a long way**: full lock comes at about 27° of dial (35° divided by the
  steering gain, 1.3). `?steer=1` is the calmer setting from before, `?steer=1.6` is quicker still.
- **Both hands** on the bar steer like a real handlebar.
- The steering goes through a One Euro filter, a small dead zone and a soft curve around the middle, then
  the jetski's own steering lag, so small tremors don't reach the hull. Turn rate is limited by cornering
  grip at speed, and the view never pitches or rolls with the hull.
- A hand that drops out of tracking for under half a second keeps its grip.
- Fallbacks: controllers (right trigger = go; hold a trigger or a grip button and tilt that controller, or
  use the thumbstick, to steer; A/B on the results) and the keyboard in the flat preview (W/↑ go, A/D or ←/→ steer, Space start, R again,
  Esc exit).
- **Back**: the 180 video's Back button, the same look, from the start line to the finish. In the headset
  it stands on your right beside Quit, 65° round from the jetski's heading, 55 cm out and 25 cm below the
  eyes, well away from the hands on the grips (Ilia, Nov 18: "move on the right to avoid pressing on it
  while playing"); in the flat preview it sits on the handlebar. Hold a fingertip or a controller on it for
  a second and a half (a yellow ring fills over a white one, as on Quit, and the word turns gold), or hold
  B or Esc, to leave the ride; a click does it in the flat preview. In the opening it goes back to Jane's
  room, on its own page it ends the session.
- **Quit**: the opening's Quit button (`../quit-button.js`, gold with a power sign) rides along at your
  right, 95° round from the jetski's heading, 55 cm out and 25 cm below the eyes, the whole time you are
  in the race. Held for a second and a half it ends the whole experience (the headset session).

## Mechanics

- **Follow the bills.** The flock (Ilia's rigged seagull) flies about 60 m ahead and drops bills every
  10 m along the racing line. A bill is Ilia's `Bill_03_Gentle_Twist` mesh, a thin twisted sheet, drawn
  0.9 m wide (`?bill=`) with the real $100 bill printed on both sides (Ilia's texture, `assets/bill`), lit
  by the sun and turning slowly so the twist shows;
  a golden halo behind each one marks the trail from far away. A bill within 3.4 m flies to you, and from
  up to 5 m while your combo is low, so the money comes to a rider who is struggling.
- **Crispy combo**: each bill in a row is worth $250 more, up to $2,500 at x10. A missed bill costs one
  step, a wall hit three. The combo also adds a little thrust.
- **Things in the water** are solid: the buoys, the pool floats, the gates' floats and the ramps' side
  tubes. Buoys and floats are moored, so a hull knocks them aside (with a hollow bonk and a splash) and
  they swing back; a buoy hit head on goes under the hull and pops up behind. A ramp's side tube is
  smooth, so a hull that comes up a ramp off its middle slides along it. A hard hit costs three combo
  steps like a wall. A jump clears them. The racing line (and the bills on it) runs straight for 30 m
  before each ramp and through the middle of each arch, and Jane aims at the middle of a ramp's lip.
- **Golden bills** hang in the air past each of the four ramps: $10,000 and a boost. Long jumps boost too.
- **$100,000** is meant to come with ease, as in the song: a first lap that takes a bit over half of the
  bills gets there, and a clean lap triples it. Jane cheers at $100,000 and again at $200,000.
- **Jane** (her jetski scan from Nov 18, on a black jetski: feet in the footwells, knees bent, hands on the
  grips) rides the line with a rubber band: she waits when she is ahead and pushes when she is behind. Her
  lines show in a speech bubble. The scan is Ilia's Jetski.sog cut to 75k splats without spherical
  harmonics (`assets/jane/jetski-75k.sog`), sized in the units the room uses for her (1.75 m tall).

## Interface

Hot pink, sunny yellow, cream and plum, set in Fredoka (`assets/fonts`, SIL Open Font License): a dash on
the handlebar (cash and the bar to $100,000, combo pips, place, speed, time, you and Jane on the lap), big
messages ahead, "+$700" pops, confetti, and a results board with two palm-size buttons at arm's reach
(AGAIN, and BACK or EXIT). The Back button (`back-button.js`) takes the video controls' look instead: a
gold button with a white arrow on dark glass. A soft vignette in fast turns (`?vignette=0`).

## Sound

Synthesized at the audio context's own rate (Quest runs at 48 kHz). The engine (`engine-worklet.js`) is
made sample by sample on the audio thread like a real three-cylinder jetski: firing pulses that differ a
little every cycle, through an exhaust pipe and a muffler box of fixed length (their resonances stay put
while the revs sweep through them), a wet exhaust that blubbers with bubbles at low speed and clears when
the hull planes, intake roar under the seat with the throttle, the pump's whine, the limiter cutting in
when the pump leaves the water, and pops off the throttle. Where audio worklets are missing, a firing loop
stands in. Then water rush under the hull, wind, hull slaps, wall scrape and thuds, boost whoosh, a pluck that climbs a pentatonic scale with the combo and a crackle on each bill,
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
  keyboard. `hud.js`: the interface; `back-button.js`: Back. `gulls.js`: flock (banking into
  turns, gliding with bursts of flapping), bills, combo. `effects.js`: wake, spray (sheets off the bow, the
  rooster tail, curtains in hard turns, landing bursts; drops and mist), speed streaks, confetti.
  `sfx.js`: sound; `engine-worklet.js`: the engine. `models.js`: jetski, gloves, Jane. The hands and
  Quit are the opening's own (`../hands.js`, `../quit-button.js`).
- `assets/stone`: the stone and sand relief (CC0, see its README). `assets/bill`: the $100 bill.

## URL options (standalone page)

`?autostart` (straight to the preview), `?autopilot` (rides itself; `=wander` drifts like a first-timer,
`=sloppy` weaves into walls), `?chase`
(`=jane` looks at her), `?map`, `?at=N` (start at control point N), `?debug` (fps on the dash,
`window.simulate(seconds)`), `?bar=0.36,0.42`, `?riser=0.12`, `?steer=1.3` (steering gain),
`?throttle=any` (either hand is the throttle), `?bill=0.9` (width of a bill, metres), `?fb=0.9` (headset resolution scale),
`?music=0`, `?vignette=0`, `?streaks=0`, `?heave=0` (the view keeps its height), `?jane=simple` (no scan),
`?quit=95` (Quit's angle to the right of the heading; `=off` leaves it out), `?back=65` (Back's angle to the
right in the headset; `=bar` puts it on the handlebar).

In the opening: `?bar=`, `?riser=`, `?steer=`, `?throttle=any`, `?vignette=0`, `?streaks=0`, `?heave=0`,
`?music=0`, `?debug` and `?autopilot` work the same way, `?aa=1` turns multisampling on for the session, and `?race=0` leaves the
race out (the floating jetski then opens this page).

## Testing without a headset

Headless Chromium with [IWER](https://github.com/meta-quest/immersive-web-emulation-runtime) as an
emulated Quest 3: tracked hands grab and steer, the audio context forced to 48 kHz, and the opening's flat
preview run end to end (video end, floating jetski, race, back to Jane).
