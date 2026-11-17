# $100,000 – opening

WebXR opening of the "$100,000" experience: mixed reality, "Seagulls Love Too"
starts, a portal opens in the room's entrance and a seagull glides out of it and
lands on the bottom of its rim. A $100 bill flutters down from the ceiling to it, the
gull jumps up, catches it, climbs, turns and dives back in (its calls fade as it
goes), then the player flies through the portal into the room scan, which stands on
a tropical beach (a 360 photo all round it). Jane is in the room from the first
moment, in her yoga pose. On arrival she goes through her other poses, 3 s each,
changing through a swirl of particles: surfboard, singing into a microphone, then
the heart pose, where she stays. The gold ball starts the 180° video, and the song
fades out when it starts. After the video she comes back in the jetski pose and
offers the jetski race: a toy jetski floats in front of the player, and touching it
starts the race ([jetski/](jetski/README.md)) in the same session. Leaving the race
comes back to the room, where she reacts to the result, and the video's gold ball
floats beside the jetski to watch it again.

- three.js + [Spark 2](https://sparkjs.dev) for splats, vendored in `vendor/` (no build step).
- `assets/room-400k.sog`: "Room splat" scan decimated from 4.4M to 400k splats, no SH, lifted 7 cm
  so its floor meets the real one. Landmarks (entrance, table, desk) are at the top of `main.js`.
- `assets/seagull/`: Ilia's rigged seagull with its fly loop, and the twisted bill, converted from his
  FBX files by `tools/fbx-to-glb/convert.cjs` (what it changes is in its header). The gull is painted
  with vertex colours (`tools/fbx-to-glb/gull-paint.js`) until its textures (T_Seagull_D/N,
  T_SeagullFeathers_D/N, T_SeagullEye_D) are added. It has no sitting animation, so `foldWings` in
  `main.js` folds its wings in code and it stands on its rest-pose legs on the rim. In flight it
  leans into its turns as far as its speed and the turn's tightness ask (a bird's banked turn),
  flaps hard only to climb or brake and glides between, and flares with its legs down to land.
  Its calls are made in `audio.js`: herring-gull yelps and a laughing series, with the break in
  the voice that makes a gull sound harsh; its wings are heard only on the hard beats.
- `assets/seagull/bill-100.jpg`: the bill's two faces from Ilia's texture (front over back), mapped
  onto the twisted bill's front and back by `mapBillFaces` in `main.js`.
- `assets/outside.jpg`: the 360 view outside the room (2:1 equirectangular). Until Ilia's tropical
  island photo comes it is a view of the race's lagoon from its start beach; replace the file with
  any 2:1 JPEG or PNG (4096×2048 is plenty), or try one first with `?outside=<url>`.
- `jane/splat-jane.js`: Jane's splat scans (150k each) and the particle transformation between them,
  a Spark dyno modifier modelled on Spark's own "Splat Transitions". See "Jane's poses" below.
- Quest settings are Ilia's picks from the Jane splat test: splat budget 500k, 80% resolution, fixed
  foveation 1, fast preset (`?budget`, `?fb`, `?ffr`, `?stddev`, `?lodpx`, `?sortms`, `?clip`,
  `?minpx`, `?maxpx`, `?cone`, `?behind` override them, as on the test page).
- Open the page in Quest Browser and tap **Enter mixed reality**.

URL options: `?debug` (fps and video source label in headset), `?to=desk` (fly to the desk instead of the coffee table), `?lod=0`
(disable Spark LoD), `?scan=<url>` (load another .sog/.spz/.ply), `?floor=0.07` (lift the room scan, metres),
`?spot=-0.68,-1.93` (where Jane stands, room-scan x,z), `?height=1.75` (Jane's height), `?sparks=0.35`
(share of her splats that fly as sparks when she transforms, 1 = all), `?poses=yoga,surf,sing,heart` (her
poses before the video, in order), `?after=jetski` (her pose after it), `?hold=3` (seconds on each pose),
`?morph=2` (seconds each change takes), `?outside=<url>` (another 360 image outside the room; `off` keeps
a plain sky), `?outsideturn=90` (turns it, degrees), `?controls=0.3,0.43` (the video controls this far
below the eyes and out from them, metres), `?music=0.55`
(song volume, 0 mutes), `?jane=off` (no Jane), `?autostart` (flat preview), `?race=0` (leave the jetski
race out; the floating jetski then opens `/jetski/`), `?aa=1` (multisampling for the whole session: off
by default because it costs frame rate with splats, but the race's edges are smoother with it),
`?steer=1.3` and `?throttle=any` (the race's steering gain and which hand is the throttle, see
[jetski/README.md](jetski/README.md)).

Run locally: `python3 -m http.server` in this folder, open http://localhost:8000.

## 180° video

After the flight a gold ball floats in front of the player: touch it (or pinch
while pointing at it) to play the 180° side-by-side video. On Quest it plays on
a WebXR equirect media layer (sharp, nearly free on the GPU); elsewhere it falls
back to a textured half sphere. Around the picture is a dark surround that
follows the head and reaches 6° into the picture's rim with a soft border, so the
room never shows between the two (`?edge=6` sets how far). While the video plays,
the headset is asked for a display refresh rate that the video's frame rate
divides (120 Hz for 60 fps), so frames step evenly; `?hz=90` asks for another
rate and `?hz=0` leaves it alone.

While it plays, three palm-sized buttons (8.4 cm) sit at the lower edge of the
picture, within reach (`video-controls.js`): back 10 s, pause / play and close,
with the playing time and the source's tag (8K+, 8K or 4K) above them. They stay
on the whole time (Ilia, Nov 17), placed when the video starts 0.3 m under the
eyes and 0.43 m out toward the middle of the picture (`?controls=0.3,0.43`).
Press one with a fingertip, or point a controller (or a pinching hand) at it and
pull the trigger (pinch); on a flat screen, click. Close goes back to the room
and Jane.

Three copies of the video:

- **Original, "8K+"** (`ORIGINAL_SRC` in `main.js`): the master's 8000×4000,
  60 fps HEVC picture copied bit for bit, about 130 Mbit/s, cut into fMP4
  segments by `tools/segment-original.sh master.mov out_dir`.
- **Light, "8K"** (`LIGHT_SRC`): the same size and frame rate at about
  60 Mbit/s, `tools/encode-8k-light.sh master.mov out_dir` (slow: about 2 frames
  a second on 4 cores).
- **Copy, "4K"** (`video/` in this repo): 4096×2048 H.264 at the source frame
  rate, `tools/encode-video.sh master.mov video 30M`.

The two 8K ones take about 1 GB and 0.5 GB per minute, more than GitHub Pages
allows a site, so they are committed to the `video-8k` branch (never merged; its
README says how to replace the video) and streamed from
`https://raw.githubusercontent.com/Rubyspot/-100-000/video-8k/` and its `light/`
folder. All three are streamed with Media Source Extensions from `manifest.json`
(`tools/manifest.py` writes it), so no file exceeds GitHub's 100 MB limit.

How the headset keeps the picture smooth (`video.js`):

- **It loads ahead.** As soon as the opening itself is loaded, well before the
  ball is touched, the video starts downloading: the best copy that would be
  ready to play through within about 40 s on this connection, otherwise a
  lighter one. The 8K copies are kept on disk (Cache API), so the next visit
  streams little or nothing. `?preload=0` turns loading ahead off, and
  `?disk=300` sets the size in MB from which a copy is kept on disk.
- **It picks when play is pressed.** The best copy that can play to the end
  without stalling is chosen from what is on hand and the measured speed of the
  connection.
- **It steps down instead of stalling.** If the video stalls anyway (once for
  over 1.5 s, or twice within 12 s), can't be decoded or won't start, a lighter
  copy that the connection can keep up with takes over at the same moment.

A flat screen or a phone gets the 4K copy. The controls show which copy is
playing, and `?debug` adds why others were passed over, plus a second line: how
the video is shown (`layer` or `texture`) and at what display rate, the seconds
buffered in the player and on hand, the connection's speed, dropped frames and
the number of stalls. `?video=original`, `?video=light`, `?video=8k` (both 8K
copies) or `?video=4k` narrows the choice, and `?video=<folder>/,<folder>/`
plays other copies, best first.

Straight from Google Drive (file shared as "Anyone with the link"):
`tools/fetch-drive.sh <drive share url> master.mov` downloads with resume;
`tools/drive-to-video.sh <drive share url> video 30M` downloads, encodes the
fallback and cleans up. Needs drive.usercontent.google.com allowed on the network.

Other options: `?speed=0.4` sets the flight speed in m/s (constant).

## Scene hooks

`window.sceneApi` exposes the scene to other modules (the Jane avatar):
`scene`, `renderer`, `camera`, `rig` (camera parent; the flight moves it),
`anchor`, `listener`, `showPlayBall(on, at)` (`at`: a world position, or its
usual spot), `playVideo()`, `arrivalPose()`,
`startJetski()` (starts the race in this session; false if it isn't loaded) and
`autoPlayBall` (set false to control when the play ball shows). Window events:
`scene:arrived`, `scene:video-start`, `scene:video-end`, `scene:jetski-end` (back
from the race; `detail` is its result: money, time, won, bills, total, finished).

## Jane's poses

Ilia's five poses (Nov 17): yoga (in the room before the player comes in), surf,
sing and heart before the video, and jetski after it. Each is a 150k-splat SOG
named after it in `assets/jane/` (`yoga-150k.sog` and so on); a pose whose file
isn't there yet is skipped, so the chain runs with what is in. To add one from a
Postshot scan:

    tools/jane-pose.sh scan.ply yoga

It turns spherical harmonics off, cuts the scan to 150k splats with the adaptive
decimator and writes SOG v2, then prints the pose's line for `JANE_SCANS` in
`jane/splat-jane.js`: where her feet are and the axis she turns around in the
transformation. Its height fits a standing pose only; for a seated or bent one
keep 1.634 (surf's, from the same capture rig).

## Jane

Jane (placeholder figure until her MetaHuman) welcomes the player on arrival,
offers the video, chats after it, floats a toy jetski in front of them that
starts the race, and reacts to the result when they come back. Live
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
