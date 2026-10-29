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
