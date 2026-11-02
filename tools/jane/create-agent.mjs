#!/usr/bin/env node
// Creates (or updates) the ElevenLabs agent behind live Jane, and optionally
// her instant voice clone. Node 22+, no dependencies.
//
//   ELEVENLABS_API_KEY=... node tools/jane/create-agent.mjs                 create the agent with a stock voice
//   ELEVENLABS_API_KEY=... node tools/jane/create-agent.mjs --voice <id>    use a voice id (e.g. Jane's PVC shared to you)
//   ELEVENLABS_API_KEY=... node tools/jane/create-agent.mjs --clone <dir>   instant-clone Jane's voice from the clips in <dir>
//                                                                           (only with Jane's consent), then use it
//   ELEVENLABS_API_KEY=... node tools/jane/create-agent.mjs --update <agent id> [--voice <id>]
//
// Prints the agent id: put it in jane/config.js (AGENT_ID) or open the page with ?agent=<id>.
// The agent is public (the static page talks to it directly), so it gets a
// daily call limit and a 10-minute cap per conversation.
import { readdir, readFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { BASE_PROMPT, FIRST_MESSAGES, TOOL_SPECS } from '../../jane/persona.js';

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error('Set ELEVENLABS_API_KEY.'); process.exit(1); }
const API = 'https://api.elevenlabs.io';
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

// Stand-in until Jane's own voice exists: a warm, upbeat young female stock voice.
const STOCK_VOICE = 'cgSgspJ2msm6clMCkdW9'; // "Jessica" (ElevenLabs premade)

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body instanceof FormData ? { 'xi-api-key': KEY } : { 'xi-api-key': KEY, 'content-type': 'application/json' },
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function cloneVoice(dir) {
  const form = new FormData();
  form.append('name', 'Crispy J (instant clone, testing)');
  form.append('description', 'Instant clone of Crispy J for the $100,000 VR experience. Made with her consent; replace with her Professional Voice Clone.');
  form.append('remove_background_noise', 'true');
  const files = (await readdir(dir)).filter((f) => ['.mp3', '.wav', '.m4a'].includes(extname(f).toLowerCase()));
  if (!files.length) throw new Error(`No audio clips in ${dir}`);
  for (const f of files) form.append('files', new Blob([await readFile(join(dir, f))]), basename(f));
  const { voice_id } = await call('POST', '/v1/voices/add', form);
  console.log(`Voice clone created from ${files.length} clips: ${voice_id}`);
  return voice_id;
}

function agentBody(voiceId) {
  return {
    name: 'AI Jane ($100,000)',
    tags: ['100000', 'jane'],
    conversation_config: {
      agent: {
        first_message: FIRST_MESSAGES.welcome,
        language: 'en',
        prompt: {
          prompt: BASE_PROMPT,
          llm: 'claude-haiku-5-5', // fast first token, holds a character well
          temperature: 0.85,
          max_tokens: 220,         // short spoken replies
          tools: TOOL_SPECS.map((t) => ({
            type: 'client',
            name: t.name,
            description: t.description,
            expects_response: t.expectsResponse ?? false,
            response_timeout_secs: 3,
            parameters: {
              type: 'object',
              required: Object.keys(t.params || {}),
              properties: Object.fromEntries(Object.entries(t.params || {}).map(([k, v]) => [k, { type: 'string', description: v.description, enum: v.enum }])),
            },
          })),
        },
      },
      tts: {
        voice_id: voiceId,
        model_id: 'eleven_v4_turbo', // lowest-latency v4; eleven_flash_v2_5 is the fallback
        stability: 0.4,
        similarity_boost: 0.85,
        speed: 1.05,
      },
      // Answer as soon as the guest stops; a speculative reply starts while
      // the turn detector is still deciding, and is dropped if they go on.
      turn: { turn_eagerness: 'eager', speculative_turn: true, turn_timeout: 8 },
      conversation: { max_duration_seconds: 600 },
    },
    platform_settings: {
      // The page sends the prompt for each part of the experience and the
      // matching first line, so those must be overridable.
      overrides: {
        conversation_config_override: {
          agent: { first_message: true, prompt: { prompt: true } },
          tts: { voice_id: true },
        },
      },
      call_limits: { agent_concurrency_limit: 5, daily_limit: 200 },
    },
  };
}

const clipDir = arg('--clone');
const voiceId = arg('--voice') || (clipDir ? await cloneVoice(clipDir) : STOCK_VOICE);
const existing = arg('--update');
if (existing) {
  await call('PATCH', `/v1/convai/agents/${existing}`, agentBody(voiceId));
  console.log(`Updated agent ${existing} (voice ${voiceId}).`);
} else {
  const { agent_id } = await call('POST', '/v1/convai/agents/create', agentBody(voiceId));
  console.log(`Created agent ${agent_id} (voice ${voiceId}).`);
  console.log(`Test: https://rubyspot.github.io/-100-000/?agent=${agent_id}`);
}
