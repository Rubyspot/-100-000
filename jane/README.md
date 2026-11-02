# Jane (AI host)

Jane greets the player after the portal flight, offers the 180° video, chats
after it, and sends the player to the jetski race. The figure is a placeholder
(`avatar.js`) until her MetaHuman is exported; the replacement only has to
implement `setMouth`, `setMood`, `gesture`, `setListening` and `lookAt`.

| File | What |
| --- | --- |
| `jane.js` | Flow (listens to `scene:arrived`, `scene:video-start`, `scene:video-end` from `main.js`), live conversation, scripted fallback, lip flap |
| `persona.js` | Her identity: base prompt, per-phase prompts, first lines, tool list, scripted lines |
| `avatar.js` | Placeholder figure with mouth, blinks, eye contact, moods and gestures |
| `ui.js` | Caption panel over her head and the pokeable jetski orb |
| `config.js` | `AGENT_ID` and placement |
| `../vendor/elevenlabs-client.js` | `@elevenlabs/client` bundled as one ES module |
| `../tools/jane/create-agent.mjs` | Creates or updates the ElevenLabs agent (and an optional instant voice clone) |

## Modes

- **Live** (an agent id in `config.js`, or `?agent=<id>`): talks through an
  ElevenLabs agent over WebRTC. Speech-to-text, turn detection, the LLM
  (Claude Haiku 5.5) and her voice (Eleven v4 Turbo) all stream, and the turn
  detector is set to `eager` with speculative replies, so she starts answering
  as soon as you stop talking instead of waiting for the full reply. You can
  interrupt her. The mouth follows her real output level.
- **Scripted** (no agent id, `?jane=scripted`, or the connection fails): the
  same beats as fixed lines with the browser's speech voice. Use it to test the
  flow without keys.
- `?jane=off` hides her and leaves the scene's own play ball behaviour.

## Setting up live Jane

1. Get an ElevenLabs API key (Creator plan or above for a Professional Voice Clone).
2. `ELEVENLABS_API_KEY=... node tools/jane/create-agent.mjs` (Node 22+). It prints the agent id.
3. Put the id in `jane/config.js` (it is public by design: the page is static
   and connects straight to ElevenLabs; the key is never in the page), or open
   `https://rubyspot.github.io/-100-000/?agent=<id>`.
4. The agent has a daily limit of 200 conversations and 10 minutes each; change
   `call_limits` in the script if needed.

## Her voice

Best available today for an exact, real-time voice: an ElevenLabs
**Professional Voice Clone**. ElevenLabs only lets a person clone their own
voice, so Jane makes it herself:

1. Jane records 60 to 90 minutes of talking (not singing): one speaker, quiet
   room, same mic, MP3 192 kbps or better, covering the moods she uses here
   (hyped hello, laid-back chat, teasing, guiding a breath, cheering).
2. On her own ElevenLabs account (Creator plan or above): Voices → Professional
   Voice Clone, upload, read the verification lines. Training takes 3 to 6 hours.
3. She shares the voice with the project account; run
   `node tools/jane/create-agent.mjs --update <agent id> --voice <voice id>`.

For testing sooner, with Jane's OK: put 1 to 3 minutes of clean clips of her
talking (no music, no other voices) in a folder and run with `--clone <folder>`
to make an instant clone. The TikToks have music and other people over her
voice, so they don't make a clean clone.

## Where the persona comes from

Transcribed (Whisper) from the 8 songs and 8 TikToks Ilia shared:

- **Songs**: "$100,000" (ask the universe, it happens with ease, spreading
  crispy), "Feeling Crispy" (blissed out on life, flow in gratitude, ride the
  wave), "Indecision (Let That Go)" (you know where to go when you're in the
  flow; smile, don't pout, abundance will never dry out), "Meditate and
  Levitate" (breath, lotus pose, feel like a pure child again), "IRL" (put the
  phone away, dance), "On My Own" (follow your intuition, the child is free),
  "Seagulls Love Too" (a seagull's beach paradise), "No Malice in Your Heart"
  (thank you for being born, receive).
- **TikToks**: the Crispy J Show ("Greetings, magical beings!", presented by vibes), ocean therapy to align with the abundance of
  the universe, surfing the Pacific blue and rock balancing, smoothies and vans
  and beach balls, surf teacher and mermaid for almost nine years ("the ocean
  connects everyone"), the wetsuit as a present-moment metaphor, and her
  no-judgment, little-child-essence philosophy that good vibes ripple out.
