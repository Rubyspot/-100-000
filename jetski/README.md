# Jetski race

Seated WebXR race at sunset against Jane, on a Kawasaki STX-15F. Self-contained page; it shares only
`../vendor/` (three.js and its GLTFLoader) and the seagull voices in `../audio.js` with the opening scene.

Open `https://rubyspot.github.io/-100-000/jetski/` in Quest Browser and tap **Enter VR**.

## Controls (hands first)

- The handlebar is placed from your head position when VR starts (Quest's recenter re-places it).
- **Right hand:** make a fist on the right grip. That is the throttle; squeeze harder for more, open the hand to slow.
  Push the hand forward to turn left, pull it back to turn right (the bar turns around its centre).
- **Left hand:** free to catch the $100 bills the seagulls drop. It can also hold the left grip to help steer.
- Grabbing the bar starts the countdown. After the finish, let go and grab again to race again.
- Fallbacks for testing: controllers (right trigger throttle, thumbstick steer) and keyboard in the flat preview
  (W/↑ throttle, A/D or ←/→ steer, Space start). In the preview, bills near the seat are caught automatically.

## Files

- `main.js`: race flow, hands, input, HUD, frame loop.
- `sky.js`: sunset sky with pink clouds, baked once into a texture that the dome, the water and the paint reflections share.
- `ocean.js`: Gerstner swell (7 waves) on a camera-following grid, two scrolling tileable normal maps, sky reflection,
  sun glitter, light through crests, crest and shore foam, turquoise shallows near land. The CPU runs the same waves.
- `craft.js`: jetski physics. Hull probes float on the water with planing lift, so the hull pitches over swells, leaves
  the water off sharp crests and trampolines, and noses down in the air. The jet only pushes (and steers) while the
  intake is wet; in the air the engine unloads and revs up.
- `track.js`: ~1.7 km loop, 16 gates, a canal through a cliff island, rocks, 3 trampolines, islands with palms, and a
  distance-to-land map for the water.
- `gulls.js`: gulls fly ahead and drop bills that flutter down to the left of the seat; every 3 caught adds a gull (max 8).
- `dolphins.js`: a pod that leaps alongside on two stretches.
- `sfx.js`: synthesized engine (4-cylinder firing loop, impeller whine, water rush), ocean, splashes, cash sound, and
  the Crispy J playlist (`audio/`). Recorded `engine.mp3`, `ocean.mp3` or `splash.mp3` placed in `audio/` and listed in
  `audio/sounds.json` replace the synthesized ones.
- `models.js` + `assets/kawasaki-st15f.glb`: the jetski (converted from the FBX and simplified to 13k triangles),
  painted yellow for the player and pink for Jane, and Jane as simple shapes.

## URL options

`?laps=N` (1–5), `?music=0`, `?vignette=0`, `?heave=0` (view doesn't follow the hull up and down), `?debug` (fps on the
dash), `?autostart` (flat preview), `?chase` (preview camera behind), `?map` (preview from above), `?autopilot`.
