# $100,000 – opening scene prototype

WebXR draft of the opening: mixed reality, a $100 bill falls from the ceiling, a
seagull flies out of a portal, grabs it and flies back in, then the portal glides
over the player and they end up inside the gaussian-splat world.

- three.js + [Spark 2](https://sparkjs.dev) for splats, vendored in `vendor/` (no build step).
- `assets/room.sog`: room scan decimated from 4.1M to 900k splats, no SH (placeholder world).
- Open the page in Quest Browser and tap **Enter mixed reality**. Pinch to replay.

URL options: `?debug` (fps label in headset), `?yaw=90` (turn the world), `?lod=0`
(disable Spark LoD), `?scan=<url>` (load another .sog/.spz/.ply), `?autostart` (flat preview).

Run locally: `python3 -m http.server` in this folder, open http://localhost:8000.
