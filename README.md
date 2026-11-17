# $100,000 – opening

WebXR opening of the "$100,000" experience: mixed reality, "Seagulls Love Too"
starts, a portal opens in the room's entrance and a seagull comes out and lands
on top of its rim. A $100 bill flutters down from the ceiling, the gull snatches
it out of the air and flies back in (its sounds fade as it goes), then the player
flies through the portal into the room scan. Jane's splat forms there out of
particles and goes through her three poses, 10 s each, changing through a swirl
of particles: surfboard, shaka, then singing into a microphone, where she stays.
The gold ball starts the 180° video, and the song fades out when it starts. After
the video she comes back in the shaka pose.

- three.js + [Spark 2](https://sparkjs.dev) for splats, vendored in `vendor/` (no build step).
- `assets/room-400k.sog`: "Room splat" scan decimated from 4.4M to 400k splats, no SH, lifted 7 cm
  so its floor meets the real one. Landmarks (entrance, table, desk) are at the top of `main.js`.
- `assets/seagull/`: Ilia's rigged seagull with its fly loop, and the twisted bill, converted from his
  FBX files by `tools/fbx-to-glb/convert.cjs` (what it changes is in its header). The gull is painted
  with vertex colours (`tools/fbx-to-glb/gull-paint.js`) until its textures (T_Seagull_D/N,
  T_SeagullFeathers_D/N, T_SeagullEye_D) are added. It has no sitting animation, so `foldWings` in
  `main.js` folds its wings in code and it stands on its rest-pose legs on the rim.
- `jane/splat-jane.js`: Jane's three splat scans (surfboard, NEW and Sing; 150k each) and the particle
  transformation between them, a Spark dyno modifier modelled on Spark's own "Splat Transitions".
- Quest settings are Ilia's picks from the Jane splat test: splat budget 500k, 80% resolution, fixed
  foveation 1, fast preset (`?budget`, `?fb`, `?ffr`, `?stddev`, `?lodpx`, `?sortms`, `?clip`,
  `?minpx`, `?maxpx`, `?cone`, `?behind` override them, as on the test page).
- Open the page in Quest Browser and tap **Enter mixed reality**.

URL options: `?debug` (fps and video source label in headset), `?to=desk` (fly to the desk instead of the coffee table), `?lod=0`
(disable Spark LoD), `?scan=<url>` (load another .sog/.spz/.ply), `?floor=0.07` (lift the room scan, metres),
`?spot=-0.68,-1.93` (where Jane stands, room-scan x,z), `?height=1.75` (Jane's height), `?sparks=0.35`
(share of her splats that fly as sparks when she transforms, 1 = all), `?poses=surf,new,sing` (her poses
and their order), `?hold=10` (seconds on each pose), `?music=0.55`
(song volume, 0 mutes), `?jane=off` (no Jane), `?autostart` (flat preview).

Run locally: `python3 -m http.server` in this folder, open http://localhost:8000.

## 180° video

After the flight a gold ball floats in front of the player: touch it (or pinch
while pointing at it) to play the 180° side-by-side video. On Quest it plays on
a WebXR equirect media layer (sharp, nearly free on the GPU); elsewhere it falls
back to a textured half sphere.

While it plays, three palm-sized buttons (8.4 cm) wait within reach about 30°
below eye level (`video-controls.js`): back 10 s, pause / play and close, with
the playing time and the source's tag (8K or 4K) above them. Press one with a fingertip, or point a controller
(or a pinching hand) at it and pull the trigger (pinch); on a flat screen,
click. The plate dims while you aren't looking at it or reaching for it. Close
goes back to the room and Jane. Skipping back re-fetches segments if needed.

Two copies of the video:

- **Original, 8K** (`ORIGINAL_SRC` in `main.js`): the master's 8000×4000,
  60 fps HEVC picture copied bit for bit, cut into 2 s fMP4 segments by
  `tools/segment-original.sh master.mov out_dir`. About 1 GB per minute, more
  than GitHub Pages allows a site, so it is committed to the `video-8k` branch
  (never merged; its README says how to replace the video) and streamed from
  `https://raw.githubusercontent.com/Rubyspot/-100-000/video-8k/`.
- **Copy, 4K** (`video/` in this repo): 4096×2048 H.264 at the source frame
  rate, `tools/encode-video.sh master.mov video 30M`.

Both are streamed with Media Source Extensions from `manifest.json`, so no file
exceeds GitHub's 100 MB limit. In the headset the 8K original plays, and the
4K copy takes over when the browser can't decode HEVC, when the connection is
too slow for it (it needs about 130 Mbit/s; the first segments are timed while
the page loads), or if it stops decoding part-way, at the same moment in the
video. A flat screen or a phone gets the 4K copy. The controls show which one
is playing ("8K" or "4K"), and `?debug` adds why the other was passed over.
`?video=8k` or `?video=4k` forces one (no fallback then), and
`?video=<folder>/,<folder>/` plays other copies, tried in that order.

Straight from Google Drive (file shared as "Anyone with the link"):
`tools/fetch-drive.sh <drive share url> master.mov` downloads with resume;
`tools/drive-to-video.sh <drive share url> video 30M` downloads, encodes the
fallback and cleans up. Needs drive.usercontent.google.com allowed on the network.

Other options: `?speed=0.4` sets the flight speed in m/s (constant).

## Scene hooks

`window.sceneApi` exposes the scene to other modules (the Jane avatar):
`scene`, `renderer`, `camera`, `rig` (camera parent; the flight moves it),
`anchor`, `listener`, `showPlayBall(on)`, `playVideo()`, `arrivalPose()`, and
`autoPlayBall` (set false to control when the play ball shows). Window events:
`scene:arrived`, `scene:video-start`, `scene:video-end`.

## Jane

Jane (placeholder figure until her MetaHuman) welcomes the player on arrival,
offers the video, chats after it and sends them to `/jetski/`. Live
conversation needs an ElevenLabs agent id (`?agent=<id>` or `jane/config.js`);
without one she runs scripted lines with the browser voice. `?jane=off` hides
her. Details and setup: [jane/README.md](jane/README.md).

## Jane splat test (`/jane-splat/`)

Performance test for a splat Jane: her 315k-splat scan standing in the room
scan, with a live readout in the headset (fps against the headset's rate,
frame time and worst frame, slow frames, splats drawn, decode time and the
hitch when a pose swaps). Poses swap every 5 s over the scripted host lines in
the browser voice, like an old adventure game. Only one pose scan exists, so
the extra poses are the same scan turned a few degrees.

- **Enter VR** puts you in the room scan; **Enter MR** shows Jane alone in passthrough.
- Left pinch hides or shows the room, right pinch jumps to the next pose.
- Defaults (Ilia's Quest picks): room 400k lifted 7 cm (`?roomq=`, `?floor=`), Jane 150k standing at
  `?spot=-0.68,-1.93`, budget 500k, resolution 0.8, fast preset, foveation 1.
- `?q=315k|315k-sh0|200k|150k|75k` picks the Jane file (`assets/jane/`), `?mode=preload|stream`
  (all poses decoded up front, or each decoded at swap time), `?poses=1..6`, `?every=5`,
  `?fade=0.3` (cross-fade), `?urls=a.sog,b.sog` (real pose files), `?height=1.65`, `?hz=90`, `?vo=0`.
- `?set=surf` or `?set=sing` shows only the surfboard or the singing scan; `?q=` then picks its file
  (surf: 900k SH3, 900k-sh0, 500k, 300k, 200k, 150k, 100k; sing: 677k SH3, 677k-sh0, 300k, 200k, 150k, 100k).
- Performance knobs: `?budget=250` (Spark LoD splat budget in thousands; Spark uses 500 on Quest),
  `?janelod=1` (Jane shares that budget), `?fb=0.7` (render resolution scale), `?stddev=2` (smaller splat footprint).
