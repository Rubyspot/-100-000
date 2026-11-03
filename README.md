# $100,000 – opening scene prototype

WebXR draft of the opening: mixed reality, a $100 bill falls from the ceiling, a
seagull flies out of a portal standing in the room's entrance, grabs it and flies
back in, then the player flies through the portal and on toward the coffee table.

- three.js + [Spark 2](https://sparkjs.dev) for splats, vendored in `vendor/` (no build step).
- `assets/room.sog`: "Room splat" scan decimated from 4.4M to 900k splats, no SH. Landmarks (entrance, table, desk) are at the top of `main.js`.
- Open the page in Quest Browser and tap **Enter mixed reality**. Pinch to replay.

URL options: `?debug` (fps label in headset), `?to=desk` (fly to the desk instead of the coffee table), `?lod=0`
(disable Spark LoD), `?scan=<url>` (load another .sog/.spz/.ply), `?autostart` (flat preview).

Run locally: `python3 -m http.server` in this folder, open http://localhost:8000.

## 180° video

After the flight a gold ball floats in front of the player: touch it (or pinch
while pointing at it) to play the 180° side-by-side video. On Quest it plays on
a WebXR equirect media layer (sharp, nearly free on the GPU); elsewhere it falls
back to a textured half sphere.

Two copies, tried in order (first one the browser can decode plays):

- **Original** (`ORIGINAL_SRC` in `main.js`): the master's HEVC picture copied
  bit for bit, cut into 2 s fMP4 segments by
  `tools/segment-original.sh master.mov out_dir`. About 1 GB per minute, so it
  lives on an external host (needs CORS allowing the Pages origin), not in git.
- **Fallback** (`video/` in this repo): 4096×2048 H.264 at the source frame
  rate, `tools/encode-video.sh master.mov video 30M`.

Both are streamed with Media Source Extensions from `manifest.json`, so no file
exceeds GitHub's 100 MB limit. `?video=<folder>/` forces one source.

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
- `?q=315k|315k-sh0|150k|75k` picks the Jane file (`assets/jane/`), `?mode=preload|stream`
  (all poses decoded up front, or each decoded at swap time), `?poses=1..6`, `?every=5`,
  `?fade=0.3` (cross-fade), `?urls=a.sog,b.sog` (real pose files), `?height=1.65`, `?hz=90`, `?vo=0`.
