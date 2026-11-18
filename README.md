# $100,000 – opening

WebXR opening of the "$100,000" experience: mixed reality, "Seagulls Love Too"
starts, a portal opens 1.05 m straight ahead of the player (every time, however
the session before ended) onto the room's entrance, and a seagull glides out of it and
lands on the bottom of its rim. A $100 bill flutters down from the ceiling to it, the
gull jumps up, catches it, makes a level U-turn in front of the portal and flies
back in (Ilia, Nov 18: "shouldn't fly up"; its calls fade as it goes). Then the
player flies slowly through the portal into the room scan (2.4 m at 0.3 m/s,
from just inside the doorway), with Ilia's 360 render all round it. Jane is in
the room from the first moment, singing into a microphone. On arrival she changes through a swirl of particles into her
surfboard pose and, 3 s later, into the heart pose, where she stays. The video's
play button comes up as she changes into that last pose; it starts the 180°
video, and the song fades out when it starts. After the video she comes back in
the heart pose (her jetski pose is the race's) and offers the jetski race, while "On My
Own" plays quietly: a toy jetski stands where the play button was, and touching
it starts the race ([jetski/](jetski/README.md)) in the same session. Leaving the
race comes back to the room and to "On My Own", where she reacts to the result,
and the play button and the jetski stand side by side on that spot to watch the
video again or ride again.

The buttons stand still (Ilia, Nov 18: "keep it at the same spot"): the play
button and the toy jetski have one spot, 0.62 m beyond where the flight ends
and 0.2 m below the eyes (0.8 m and 0.12 m on a flat screen, to be in the
picture), turned once to face the player; after a race they
stand 0.19 m either side of it, the play button on the left.

All through the session a **Quit** button stands at the player's right
(`quit-button.js`), 95° round from the way the flight faces, just past the right
edge of the 180 picture, 0.55 m out and 0.25 m below the eyes. It is put there
when the experience starts and travels with the player, and nothing moves it
after that, the video included: a fingertip or a
controller on it, or the trigger while pointing at it, held for 1.5 s while a
yellow ring fills over a white one, ends the session (`?quit=95` sets the angle, `?quit=off` leaves
it out). In the room and during the video the player's hands are drawn as
real hands (`hands.js`: the WebXR Input Profiles generic hand meshes in
`vendor/hands/`, MIT, posed from the tracked joints); in mixed reality the real
hands show.

- three.js + [Spark 2](https://sparkjs.dev) for splats, vendored in `vendor/` (no build step).
- `assets/room-400k.sog`: the world past the portal, Ilia's "Room splat" scan (Nov 16; Nov 18: "back
  to room splat") decimated from 4.4M to 400k splats, no SH, lifted 7 cm so its floor meets the real
  one. Jane stands right of the coffee table; the landmarks (entrance, table, desk) are at the top of
  `main.js`. The 200k, 300k and full scans are for the Jane splat test page.
- `assets/stage-400k.sog` (`?world=stage`): Ilia's "Home outside PLY.sog" (Nov 18; the same splat
  as his "Room splat.html"): two bamboo huts with an opening between them, a deck in front, a flower
  garden and palms. Cut from 3.7M to 2M splats evenly and then to 400k by local error
  (`splat-transform -t 0,0.035,0 -H 0 -d 2000000`, then `--decimate-adaptive 400000`, then
  `--sog-version 2`), no SH, shifted 3.5 cm so the deck is at the real floor. Its origin is where
  Jane stands (Ilia: "Jane position 0,0,0"), and the flight comes in over the flowers and stops
  0.35 m short of the deck's rail.
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
- `assets/outside.jpg`: the 360 view all round the world, Ilia's render ("Mono_NewLevelSequence1",
  16000 px square equirectangular) of the place the stage splat shows, at 6144×3072, turned with the
  world so the middle of the picture lies ahead along the flight (on the stage its palms and sky carry
  on from the splats). `assets/outside-8k.jpg` is the same at 8192×4096
  (`?outside=./assets/outside-8k.jpg`; 128 MB of graphics memory against 72 MB). Replace the file with
  any equirectangular JPEG or PNG, or try one first with `?outside=<url>`.
- `jane/splat-jane.js`: Jane's splat scans (150k each) and the particle transformation between them,
  a Spark dyno modifier modelled on Spark's own "Splat Transitions". See "Jane's poses" below.
- Quest settings are Ilia's picks from the Jane splat test: splat budget 500k, 80% resolution, fixed
  foveation 1, fast preset (`?budget`, `?fb`, `?ffr`, `?stddev`, `?lodpx`, `?sortms`, `?clip`,
  `?minpx`, `?maxpx`, `?cone`, `?behind` override them, as on the test page).
- Open the page in Quest Browser and tap **Enter VR** (the experience opens in mixed reality). The
  start card is in the jetski race's style over Ilia's picture of the room with Jane
  (`assets/start.jpg`, Nov 18: "keep it simple, just $100,000 musical experience and button enter
  VR"). Where the browser can't start an immersive session, the same button reads **Preview on this
  screen** and plays the opening on the page.

URL options: `?debug` (fps and video source label in headset), `?lod=0`
(disable Spark LoD), `?world=stage` (Ilia's bamboo huts and deck instead of the room), `?scan=<url>`
(load another .sog/.spz/.ply), `?floor=0.07` (lift the world, metres; 0 on the stage), `?solid=2` (room splats' opacity times this; off by default), `?room=1` (the first room scan, assets/room-400k.sog, instead of Ilia's Room splat 2, assets/room2-400k.sog),
`?spot=-0.68,-1.93` (where Jane stands, the scan's own x,z; 0,0 on the stage), `?to=desk` (fly toward
the room's desk instead of its coffee table), `?arrive=x,z` (where the flight ends, the scan's own
x,z), `?height=1.75` (Jane's height), `?sparks=0.35`
(share of her splats that fly as sparks when she transforms, 1 = all), `?poses=sing,surf,heart` (her
poses before the video, in order), `?after=<pose>` (a pose after it; none by default), `?hold=3` (seconds on each pose),
`?morph=2` (seconds each change takes), `?outside=<url>` (another 360 image all round; `off` keeps
a plain sky), `?outsideturn=90` (turns it, degrees), `?controls=0.4,0.32,45` (the video controls this far
below the eyes and out from them, metres, and this far round to the right, degrees), `?fly=2.4` and `?speed=0.3` (the flight through the portal:
metres and m/s), `?quit=95` (the quit button's angle to the right; `off` hides it), `?music=0.55`
(song volume, 0 mutes), `?between=0.5` ("On My Own" after the video and the race, as a part of that
volume; 0 leaves it out), `?jane=off` (no Jane), `?autostart` (flat preview), `?race=0` (leave the jetski
race out; the floating jetski then opens `/jetski/`), `?aa=1` (multisampling for the whole session: off
by default because it costs frame rate with splats, but the race's edges are smoother with it),
`?steer=1.3` and `?throttle=any` (the race's steering gain and which hand is the throttle, see
[jetski/README.md](jetski/README.md)).

Run locally: `python3 -m http.server` in this folder, open http://localhost:8000.

## 180° video

When Jane changes into her last pose, the play button comes up in front of the
player (`play-button.js`: a 20 cm gold button with a white arrow on a teal face,
a glow that breathes and a ring that ripples out, over a plate saying "Play the
video"; it lights up as a hand comes near, and it stands still). Touch it (or point a controller at
it and pull the trigger) to play the 180° side-by-side video. On Quest it plays on
a WebXR equirect media layer (sharp, nearly free on the GPU); elsewhere it falls
back to a textured half sphere. Around the picture is a dark surround that
follows the head and reaches 6° into the picture's rim with a soft border, so the
room never shows between the two (`?edge=6` sets how far). While the video plays,
the headset is asked for a display refresh rate that the video's frame rate
divides (120 Hz for 60 fps), so frames step evenly; `?hz=90` asks for another
rate and `?hz=0` leaves it alone.

While it plays, three palm-sized buttons (8.4 cm) sit low at the player's right,
within reach (`video-controls.js`): back 10 s, pause / play and close, with the
playing time and the source's tag (8K+, 8K or 4K) above them. They stay on the
whole time (Ilia, Nov 17), placed when the video starts 45° round to the right of
the middle of the picture, 0.4 m under the eyes and 0.32 m out, turned to face
the player (Ilia, Nov 18: "lower and on the right side 45 degrees";
`?controls=0.4,0.32,45`).
Press one with a fingertip, or point a controller (or a pinching hand) at it and
pull the trigger (pinch); on a flat screen, click. Close goes back to the room
and Jane.

The video is Ilia's full 2:34 cut ("$100,000 Quest.mov", Nov 18), in three
copies:

- **Original, "8K+"** (`ORIGINAL_SRC` in `main.js`): the master's 8000×4000,
  60 fps HEVC picture copied bit for bit, about 130 Mbit/s (2.5 GB), cut into
  fMP4 segments by `tools/segment-original.sh master.mov out_dir`.
- **Light, "8K"** (`LIGHT_SRC`): the same size and frame rate at about
  60 Mbit/s (1.2 GB), `tools/encode-8k-light.sh master.mov out_dir` (slow:
  about 2 frames a second on 4 cores, so over an hour for the full cut).
- **Copy, "4K"** (`video/` in this repo): 4096×2048 H.264 at the source frame
  rate (30 Mbit/s, 0.6 GB), `tools/encode-video.sh master.mov video 30M`.

The two 8K ones take about 1 GB and 0.5 GB per minute, more than GitHub Pages
allows a site, so they are committed to the `video-8k` branch (never merged; its
README says how to replace the video) and streamed from
`https://raw.githubusercontent.com/Rubyspot/-100-000/video-8k/full/` and its
`light/` folder (the branch's root and its own `light/` hold the earlier 66 s
demo). All three are streamed with Media Source Extensions from `manifest.json`
(`tools/manifest.py` writes it), so no file exceeds GitHub's 100 MB limit. A
copy that is missing or can't be reached is skipped, and the next one plays.

How the headset keeps the picture smooth (`video.js`):

- **It loads ahead.** As soon as the opening itself is loaded, well before the
  ball is touched, the video starts downloading: the best copy that would be
  ready to play through within about 40 s on this connection, otherwise the
  lighter 8K. The 8K copies are kept on disk (Cache API), so the next visit
  streams little or nothing, and what was kept for an older video in another
  folder is deleted. `?preload=0` turns loading ahead off, and `?disk=700` sets
  the size in MB from which a copy is kept on disk (the 4K copy, 0.6 GB, stays
  under it, so a flat screen loads at most 120 MB ahead).
- **It picks when play is pressed.** The best copy that can play to the end
  without stalling is chosen from what is on hand and the measured speed of the
  connection.
- **It steps down instead of stalling.** If the master stalls anyway (once for
  over 1.5 s, or twice within 12 s), can't be decoded or won't start, the
  lighter 8K takes over at the same moment.
- **It stays on 8K** (Ilia, Nov 18: "video always 8k"). On a connection too
  slow even for the lighter 8K, that one plays anyway and waits for what it
  needs, instead of dropping to 4K. The 4K copy is the headset's last resort:
  only if it can't decode the 8K at all, or its decoder gives up on both.

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

Other options: `?speed=0.3` sets the flight speed in m/s (constant), `?fly=2.4` its length in metres.

## Scene hooks

`window.sceneApi` exposes the scene to other modules (the Jane avatar):
`scene`, `renderer`, `camera`, `rig` (camera parent; the flight moves it),
`anchor`, `listener`, `showPlayBall(on, at)` (`at`: a world position, or its
usual spot; without `at`, before the video it waits for Jane's last pose),
`buttonSpot(offset)` (the buttons' spot in world space, `offset` metres to its
right, negative to its left: `{ position, eyes, gap }`, where `eyes` is the point
a button there faces and `gap` is 0.19, how far either side of the spot the play
button and the jetski stand after a race), `playVideo()`, `arrivalPose()`,
`startJetski()` (starts the race in this session; false if it isn't loaded) and
`autoPlayBall` (set false to control when the play ball shows). Window events:
`scene:arrived`, `scene:video-start`, `scene:video-end`, `scene:jetski-end` (back
from the race; `detail` is its result: money, time, won, bills, total, finished),
`scene:session-end` (the session ended: Quit, or the headset's own way out).

## Jane's poses

Ilia's order (Nov 18): sing (in the room before the player comes in), surf, then
heart with the play button; she stays in heart after the video, and her jetski
pose is only in the race. Yoga is no longer in the chain. Each is a 150k-splat SOG
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
