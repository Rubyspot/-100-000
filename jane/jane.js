// Jane, the host. Listens for the opening scene's events and runs the
// conversation around them:
//   scene:arrived     -> she appears, welcomes the player, offers the video
//   scene:video-start -> she steps out (the conversation is closed)
//   scene:video-end   -> she's back, chats, offers the jetski ride
//
// Live mode talks through an ElevenLabs agent (speech-to-text, LLM and her
// voice, all streamed, so she starts answering the moment you stop talking).
// Without an agent id she runs the scripted lines in persona.js with the
// browser's own speech voice, so the flow can be tested with no keys.
import * as THREE from 'three';
import { createAvatar } from './avatar.js';
import { AGENT_ID, MODE, STAND_DISTANCE, STAND_OFFSET } from './config.js';
import { systemPrompt, FIRST_MESSAGES, SCRIPTED } from './persona.js';
import { makeCaption, makeOrb } from './ui.js';

const JETSKI_URL = './jetski/';

export function createJane(api) {
  const { scene, renderer, camera } = api;
  const avatar = createAvatar();
  const root = new THREE.Group();
  root.add(avatar.object);
  root.visible = false;
  scene.add(root);

  const caption = makeCaption();
  caption.position.set(0, 2.02, 0);
  root.add(caption);

  const jetskiOrb = makeOrb('Ride the jetski', 0x37b6e6);
  jetskiOrb.visible = false;
  scene.add(jetskiOrb);
  jetskiOrb.userData.onPress = () => goJetski('orb');

  const st = {
    phase: 'idle', // idle | welcome | video | after
    shownAt: -1, t: 0, history: [], talking: false, offeredVideo: false,
    conv: null, connecting: false, leaving: false,
  };

  // ---------- placement ----------

  function place() {
    const pose = api.arrivalPose ? api.arrivalPose() : null;
    const head = headWorld();
    const pos = pose ? pose.position.clone() : new THREE.Vector3(head.x, 0, head.z);
    const fwd = pose ? pose.forward.clone() : new THREE.Vector3(0, 0, -1).applyQuaternion(cameraObj().quaternion);
    fwd.y = 0; fwd.normalize();
    const left = new THREE.Vector3(fwd.z, 0, -fwd.x);
    root.position.copy(pos).addScaledVector(fwd, STAND_DISTANCE).addScaledVector(left, STAND_OFFSET);
    root.position.y = 0;
    root.lookAt(head.x, 0, head.z);
    // Jetski orb floats to the player's right, at chest height.
    jetskiOrb.position.copy(pos).addScaledVector(fwd, 0.6).addScaledVector(left, -0.35);
    jetskiOrb.position.y = Math.max(0.9, head.y - 0.35);
  }
  const cameraObj = () => (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera);
  function headWorld() {
    const c = cameraObj();
    c.updateMatrixWorld(true);
    return new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
  }

  // ---------- conversation ----------

  function say(text, who = 'jane') {
    if (!text) return;
    st.history.push(`${who === 'jane' ? 'Jane' : 'Guest'}: ${text}`);
    if (st.history.length > 24) st.history.shift();
    caption.userData.set(who === 'jane' ? text : null, who === 'user' ? text : undefined);
  }

  const tools = {
    play_video: () => {
      setTimeout(() => api.playVideo && api.playVideo(), 2500); // let her finish the sentence
      return 'The video is starting now. Stop talking; you will continue after it ends.';
    },
    show_video_button: () => { api.showPlayBall && api.showPlayBall(true); return 'The play button is floating in front of the guest.'; },
    start_jetski: () => { setTimeout(() => goJetski('agent'), 3500); return 'Loading the jetski race now. Say a quick see-you-on-the-water.'; },
    show_jetski_button: () => { jetskiOrb.visible = true; return 'The jetski button is floating next to the guest.'; },
    gesture: ({ name } = {}) => { avatar.gesture(name, st.t); return 'ok'; },
    set_mood: ({ mood } = {}) => { avatar.setMood(mood); return 'ok'; },
  };

  async function startLive(phase) {
    if (st.conv || st.connecting) return;
    st.connecting = true;
    caption.userData.status('Connecting to Jane…');
    try {
      const { Conversation } = await import('../vendor/elevenlabs-client.js');
      st.conv = await Conversation.startSession({
        agentId: AGENT_ID,
        connectionType: 'webrtc',
        overrides: { agent: { prompt: { prompt: systemPrompt(phase, st.history) }, firstMessage: FIRST_MESSAGES[phase] } },
        clientTools: tools,
        onMessage: ({ source, message }) => say(message, source === 'user' ? 'user' : 'jane'),
        onModeChange: ({ mode }) => {
          st.talking = mode === 'speaking';
          avatar.setListening(mode === 'listening');
          caption.userData.status(mode === 'speaking' ? '' : 'Listening… just talk');
          // Once the welcome is said, the play button shows up as well.
          if (mode === 'listening' && phase === 'welcome' && !st.offeredVideo) {
            st.offeredVideo = true;
            api.showPlayBall && api.showPlayBall(true);
          }
          if (mode === 'listening' && phase === 'after') jetskiOrb.visible = true;
        },
        onError: (message) => console.warn('Jane:', message),
        onDisconnect: () => { st.conv = null; st.talking = false; avatar.setListening(false); },
      });
    } catch (err) {
      console.warn('Jane live mode failed, falling back to scripted:', err);
      caption.userData.status('');
      st.conv = null;
      startScripted(phase);
    } finally {
      st.connecting = false;
    }
  }

  async function stopLive() {
    const c = st.conv;
    st.conv = null;
    if (c) await c.endSession().catch(() => {});
  }

  // Scripted fallback: the same beats, spoken with the browser voice.
  let scriptTimer = 0;
  function speak(line, then) {
    say(line);
    st.talking = true;
    const done = () => { st.talking = false; then && then(); };
    if (!('speechSynthesis' in window)) { setTimeout(done, 1000 + line.length * 55); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(line.replace(/\*[^*]*\*/g, ''));
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((v) => /female|samantha|zira|jenny|aria|google us english/i.test(v.name) && /^en/.test(v.lang))
      || voices.find((v) => /^en/.test(v.lang)) || null;
    u.rate = 1.04; u.pitch = 1.12;
    u.onend = done; u.onerror = done;
    speechSynthesis.speak(u);
    // Some browsers (and Quest when the page isn't focused) never fire onend.
    clearTimeout(scriptTimer);
    scriptTimer = setTimeout(() => { if (st.talking) done(); }, 2500 + line.length * 80);
  }
  function startScripted(phase) {
    const lines = SCRIPTED[phase] || [];
    let i = 0;
    const next = () => {
      if (st.phase !== phase || i >= lines.length) {
        if (phase === 'welcome' && st.phase === 'welcome') api.showPlayBall && api.showPlayBall(true);
        if (phase === 'after' && st.phase === 'after') jetskiOrb.visible = true;
        return;
      }
      const { text, gesture, mood } = lines[i++];
      if (gesture) avatar.gesture(gesture, st.t);
      if (mood) avatar.setMood(mood);
      speak(text, () => setTimeout(next, 450));
    };
    next();
  }

  function begin(phase) {
    st.phase = phase;
    if (MODE === 'off') return;
    place();
    root.visible = true;
    st.shownAt = st.t;
    avatar.gesture('wave', st.t);
    if (MODE === 'live' && AGENT_ID) startLive(phase);
    else startScripted(phase);
  }

  function goJetski(why) {
    if (st.leaving) return;
    st.leaving = true;
    console.info('Jane: off to the jetski via', why);
    stopLive();
    const session = renderer.xr.getSession();
    const go = () => { location.href = JETSKI_URL + '?from=jane'; };
    if (session) session.end().then(go, go); else go();
  }

  // ---------- scene events ----------

  if (MODE !== 'off' && api) api.autoPlayBall = false;
  // Flat preview: click the jetski orb.
  renderer.domElement.addEventListener('click', (e) => {
    if (renderer.xr.isPresenting || !jetskiOrb.visible) return;
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    if (rc.intersectObject(jetskiOrb.userData.ball).length) jetskiOrb.userData.click();
  });
  addEventListener('scene:arrived', () => begin('welcome'));
  addEventListener('scene:video-start', () => {
    st.phase = 'video';
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    stopLive();
    root.visible = false;
    jetskiOrb.visible = false;
  });
  addEventListener('scene:video-end', () => begin('after'));

  // ---------- per frame ----------

  const head = new THREE.Vector3();
  function update(t, dt, frame) {
    st.t = t;
    // The sequence was replayed: step out until the player arrives again.
    if (root.visible && api.state && api.state.running && !api.state.arrived) {
      st.phase = 'idle';
      root.visible = jetskiOrb.visible = false;
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      stopLive();
    }
    if (!root.visible && !jetskiOrb.visible) return;
    head.copy(headWorld());
    avatar.lookAt(head);

    // Mouth: live audio level, or a speech-like flap for the browser voice.
    let level = 0;
    if (st.conv && st.talking) {
      try { level = Math.min(1, st.conv.getOutputVolume() * 3.2); } catch { level = 0; }
    } else if (st.talking) {
      level = 0.35 + 0.35 * Math.sin(t * 17) * Math.sin(t * 6.3 + 1);
    }
    avatar.setMouth(Math.max(0, level));

    // Pop in with a little bounce when she appears.
    const a = Math.min(1, (t - st.shownAt) / 0.7);
    avatar.object.scale.setScalar(a < 1 ? 1 + 2.2 * Math.pow(a - 1, 3) + 1.2 * Math.pow(a - 1, 2) : 1);
    avatar.update(t, dt);
    caption.lookAt(head);
    caption.userData.update(t);

    if (jetskiOrb.visible) jetskiOrb.userData.update(t, head, renderer, frame, api.rig);
  }

  // Ask for the microphone while the page still has focus (from the Enter
  // button), so the permission prompt never pops up inside the headset.
  async function prepareMic() {
    if (MODE !== 'live' || !AGENT_ID || !navigator.mediaDevices) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((tr) => tr.stop());
    } catch (err) {
      console.warn('Jane: no microphone, she will use scripted lines.', err);
    }
  }

  window.__jane = { st, begin, tools, avatar, root };
  return { update, prepareMic };
}
