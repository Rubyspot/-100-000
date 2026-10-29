# Jetski race prototype

Seated WebXR race around the island against Jane. Self-contained page; it only
shares `../vendor/three.module.js` with the opening scene.

Open `https://rubyspot.github.io/-100-000/jetski/` in Quest Browser and tap **Enter VR**.

## Controls (hands first)

- A handlebar floats in front of you, placed from your head position when VR starts
  (Quest's recenter re-places it).
- Make a fist on a grip to hold it. Holding the right grip is the throttle; open the right hand to slow down.
- Turn the bar to steer: push one hand forward and pull the other back. One hand alone steers by moving sideways.
- Grabbing the bar starts the 3-2-1 countdown. After the finish, let go and grab again to race again.
- Fallbacks for testing: controllers (right trigger throttle, thumbstick steer) and keyboard in the flat preview
  (W/↑ throttle, A/D or ←/→ steer, Space start).

## What's in it

- Ocean: custom Gerstner swell (5 waves) on a camera-following polar grid, with per-pixel ripples, sky
  reflection, sun glitter, crest and shore foam. The same wave sum runs on the CPU so the jetskis, wakes and
  spray float on the drawn surface. Waves fade with distance so the horizon stays still.
- Track: 10 buoy gates on a ~1 km loop around the island, 2 laps by default. Gates must be taken in order;
  the dash arrow and the green chevron point at the next one.
- Jane: follows the racing line with rubber-banding (slows when far ahead, pushes when behind), weaves,
  keeps clear of the player, and has a few lines at the start, on overtakes, on the final lap and at the finish.
- Comfort: horizon never rolls or pitches with the jetski, head follows only part of the swell, and a
  vignette darkens the edges while turning. Everything is within arm's reach while seated.
- Placeholder art: procedural jetskis, Jane as simple shapes, low-poly island and palms, synthesized engine sound.

## URL options

`?laps=N` (1–5), `?vignette=0`, `?heave=0` (no swell under the rider), `?debug` (fps on the dash),
`?autostart` (flat preview), `?chase` (preview camera behind the jetski), `?autopilot` (drives itself, for testing).
