// Jane, the host. Listens for the opening scene's events and runs the
// conversation around them:
//   scene:arrived     -> she appears, welcomes the player, offers the video
//   scene:video-start -> she steps out (the conversation is closed)
//   scene:video-end   -> she's back, chats, offers the jetski ride: a toy
//                        jetski floats in front of the player, touching it starts
//                        the race (api.startJetski, in this same session)
//   scene:jetski-end  -> back in the room, she reacts to the result; the toy
//                        jetski comes back with the video's play ball beside
//                        it, so the guest can ride again or watch again
//
// Live mode talks through an ElevenLabs agent (speech-to-text, LLM and her
// voice, all streamed, so she starts answering the moment you stop talking).
// Without an agent id she runs the scripted lines in persona.js with the
// browser's own speech voice, so the flow can be tested with no keys.
import * as THREE from 'three';
import { createAvatar } from './avatar.js';
import { AGENT_ID, MODE, STAND_DISTANCE, STAND_OFFSET } from './config.js';
import { systemPrompt, FIRST_MESSAGES, SCRIPTED, backLines } from './persona.js';
import { makeCaption, makeJetskiButton } from './ui.js';

const JETSKI_URL = './jetski/';

export function createJane(api) {
  const { scene, renderer, camera } = api;
  const avatar = createAvatar();
  const root = new THREE.Group();
  root.add(avatar.object);
  // With her Gaussian splat in the scene (api.janeSpot), the stand-in figure
  // stays hidden and only the caption shows, above the splat's head.
  if (api.janeSpot) avatar.object.visible = false;
  root.visible = false;
  scene.add(root);

  const caption = makeCaption();
  caption.position.set(0, 2.02, 0);
  root.add(caption);

  // The floating jetski she offers after the video.
  const jetskiBtn = makeJetskiButton('Touch to ride');
  scene.add(jetskiBtn);
  jetskiBtn.userData.onPress = () => goJetski('button');
  // It appears within reach, straight in front of where the player is looking
  // and below eye level (they may have sat down or moved). Straight ahead, so
  // they touch it facing forward: the race seats them the way they face then.
  function showJetski() {
    if (st.leaving || jetskiBtn.visible || (st.phase !== 'after' && st.phase !== 'back')) return;
    const head = headWorld();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraObj().getWorldQuaternion(new THREE.Quaternion())).setY(0);
    // Looking straight up or down: toward Jane instead.
    if (dir.lengthSq() < 0.05) dir.set(root.position.x - head.x, 0, root.position.z - head.z);
    if (dir.lengthSq() < 0.0001) dir.set(0, 0, -1);
    dir.normalize();
    // (On a flat screen it sits further out and higher, to be in the picture.)
    const flat = !renderer.xr.isPresenting;
    jetskiBtn.position.copy(head).addScaledVector(dir, flat ? 0.8 : 0.52);
    jetskiBtn.position.y = Math.max(0.55, head.y - (flat ? 0.14 : 0.3));
    jetskiBtn.userData.show();
    // Back from a ride: the video can be played again from right beside it.
    if (st.phase === 'back') showVideoBall();
  }
  // The play ball: beside the toy jetski when that is up (on its left, Jane
  // stands to the right), otherwise at its own spot ahead of the guest.
  function showVideoBall() {
    if (!api.showPlayBall) return;
    if (!jetskiBtn.visible) { api.showPlayBall(true); return; }
    const head = headWorld();
    const dir = jetskiBtn.position.clone().sub(head).setY(0).normalize();
    const left = new THREE.Vector3(dir.z, 0, -dir.x);
    api.showPlayBall(true, jetskiBtn.position.clone().addScaledVector(left, renderer.xr.isPresenting ? 0.36 : 0.42));
  }

  const st = {
    phase: 'idle', // idle | welcome | video | after | jetski | back
    shownAt: -1, t: 0, history: [], talking: false, offeredVideo: false,
    conv: null, connecting: false, leaving: false, result: null,
  };

  // ---------- placement ----------

  function place() {
    const pose = api.arrivalPose ? api.arrivalPose() : null;
    const head = headWorld();
    const pos = pose ? pose.position.clone() : new THREE.Vector3(head.x, 0, head.z);
    const fwd = pose ? pose.forward.clone() : new THREE.Vector3(0, 0, -1).applyQuaternion(cameraObj().quaternion);
    fwd.y = 0; fwd.normalize();
    const left = new THREE.Vector3(fwd.z, 0, -fwd.x);
    if (api.janeSpot) root.position.copy(api.janeSpot());
    else root.position.copy(pos).addScaledVector(fwd, STAND_DISTANCE).addScaledVector(left, STAND_OFFSET);
    root.position.y = 0;
    root.lookAt(head.x, 0, head.z);
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
    show_video_button: () => { showVideoBall(); return 'The play button is floating in front of the guest.'; },
    start_jetski: () => { setTimeout(() => goJetski('agent'), 3500); return 'Loading the jetski race now. Say a quick see-you-on-the-water.'; },
    show_jetski_button: () => { showJetski(); return 'The little toy jetski is floating in front of the guest. Touching it starts the race.'; },
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
        overrides: {
          agent: {
            prompt: { prompt: systemPrompt(phase, st.history, st.result) },
            firstMessage: typeof FIRST_MESSAGES[phase] === 'function' ? FIRST_MESSAGES[phase](st.result) : FIRST_MESSAGES[phase],
          },
        },
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
          if (mode === 'listening' && (phase === 'after' || phase === 'back')) showJetski();
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
    // Where the browser has no voice the speech ends at once: the caption
    // still stays up long enough to read before the next line.
    const readBy = performance.now() + 1200 + line.length * 45;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      st.talking = false;
      const wait = readBy - performance.now();
      if (!then) return;
      if (wait > 0) setTimeout(then, wait); else then();
    };
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
  let scriptRun = 0;
  function startScripted(phase) {
    const lines = phase === 'back' ? backLines(st.result) : SCRIPTED[phase] || [];
    const run = ++scriptRun;
    let i = 0;
    const next = () => {
      if (run !== scriptRun) return; // a newer script has taken over
      if (st.phase !== phase || i >= lines.length) {
        if (phase === 'welcome' && st.phase === 'welcome') api.showPlayBall && api.showPlayBall(true);
        if (st.phase === phase) showJetski();
        return;
      }
      // The jetski pops up as she starts the line that points at it (her last).
      if (i === lines.length - 1) showJetski();
      const { text, gesture, mood } = lines[i++];
      if (gesture) avatar.gesture(gesture, st.t);
      if (mood) avatar.setMood(mood);
      speak(text, () => setTimeout(next, 450));
    };
    next();
  }

  function begin(phase, result = null) {
    st.phase = phase;
    st.result = result;
    st.leaving = false;
    if (MODE === 'off') {
      // No host: the jetski still shows up after the video and after a ride.
      if (phase === 'after' || phase === 'back') { place(); showJetski(); }
      return;
    }
    place();
    root.visible = true;
    st.shownAt = st.t;
    avatar.gesture('wave', st.t);
    if (MODE === 'live' && AGENT_ID) startLive(phase);
    else startScripted(phase);
  }

  // Off to the race. It runs inside this page and this session
  // (api.startJetski); if the race could not be loaded, its own page opens.
  function goJetski(why) {
    if (st.leaving) return;
    st.leaving = true;
    console.info('Jane: off to the jetski via', why);
    stopLive();
    clearTimeout(scriptTimer);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    st.talking = false;
    jetskiBtn.userData.hide();
    if (api.startJetski && api.startJetski()) {
      st.phase = 'jetski';
      root.visible = false;
      return;
    }
    const session = renderer.xr.getSession();
    const go = () => { location.href = JETSKI_URL + '?from=jane'; };
    if (session) session.end().then(go, go); else go();
  }

  // ---------- scene events ----------

  if (MODE !== 'off' && api) api.autoPlayBall = false;
  // Flat preview: click the jetski.
  renderer.domElement.addEventListener('click', (e) => {
    if (renderer.xr.isPresenting || !jetskiBtn.visible || st.phase === 'jetski') return;
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    if (rc.intersectObject(jetskiBtn.userData.hit).length) jetskiBtn.userData.click();
  });
  addEventListener('scene:arrived', () => begin('welcome'));
  addEventListener('scene:video-start', () => {
    st.phase = 'video';
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    stopLive();
    root.visible = false;
    jetskiBtn.userData.hide();
  });
  addEventListener('scene:video-end', () => begin('after'));
  addEventListener('scene:jetski-end', (e) => begin('back', e.detail || null));

  // ---------- per frame ----------

  const head = new THREE.Vector3();
  function update(t, dt, frame) {
    st.t = t;
    // The sequence was replayed: step out until the player arrives again.
    if ((root.visible || jetskiBtn.visible) && api.state && api.state.running && !api.state.arrived) {
      st.phase = 'idle';
      root.visible = false;
      jetskiBtn.userData.hide();
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      stopLive();
    }
    if (!root.visible && !jetskiBtn.visible) return;
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

    if (jetskiBtn.visible) jetskiBtn.userData.update(t, head, renderer, frame, api.rig);
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

  window.__jane = { st, begin, tools, avatar, root, jetskiBtn, goJetski };
  return { update, prepareMic };
}
