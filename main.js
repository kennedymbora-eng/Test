// main.js
// APP / UI layer. This is the only file that wires the independent pieces
// together for the live experience:
//   camera -> Tracker (tracking.js) -> MotionSolver (motionSolver.js)
//     -> [Recorder (recorder.js)] -> applyMotionFrame (retarget.js)
//     -> CharacterLibrary's current character (characters.js) -> Three.js render
import * as THREE from 'three';
import { Tracker } from './tracking.js';
import { MotionSolver } from './motionSolver.js';
import { CharacterLibrary } from './characters.js';
import { applyMotionFrame, resetRetarget } from './retarget.js';
import { Recorder } from './recorder.js';

const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem('mimic3d.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mimic3d.' + k, JSON.stringify(v)); } catch {} }
};

/* ---------------------------------------------------------------- scene */
const stage = $('#stage'), video = $('#video'), overlay = $('#overlay'), og = overlay.getContext('2d');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
const renderer = new THREE.WebGLRenderer({ canvas: $('#gl'), antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = false; // stylized flat-shaded puppet; skip shadow cost on low-end phones

const holder = new THREE.Group(); scene.add(holder); // user-facing rotate/scale controls live here
const hemi = new THREE.HemisphereLight('#4c3a94', '#141032', 1.1); scene.add(hemi);
const key = new THREE.DirectionalLight('#fff3d6', 1.15); key.position.set(1.4, 2.4, 1.8); scene.add(key);
const rim = new THREE.DirectionalLight('#3ee0cf', .5); rim.position.set(-1.6, .6, -1.2); scene.add(rim);

const groundGeo = new THREE.CircleGeometry(3, 40);
const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: '#241a3d', roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = 0; ground.visible = store.get('env', true);
scene.add(ground);

let camDist = store.get('camDist', 3.1);
function placeCamera() { camera.position.set(0, 1.15, camDist); camera.lookAt(0, 1.0, 0); }
placeCamera();

function fitCanvas() {
  const r = stage.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(r.height, 1); camera.updateProjectionMatrix();
  overlay.width = r.width * renderer.getPixelRatio(); overlay.height = r.height * renderer.getPixelRatio();
}
new ResizeObserver(fitCanvas).observe(stage);
fitCanvas();

/* ------------------------------------------------------------ pipeline */
const tracker = new Tracker();
const solver = new MotionSolver();
const library = new CharacterLibrary();
const recorder = new Recorder();

const opts = {
  hands: store.get('hands', true), face: store.get('face', true),
  cam: store.get('cam', false), skel: store.get('skel', false),
  mirror: store.get('mirror', true), env: store.get('env', true), transparent: store.get('transparent', false)
};
solver.mirror = opts.mirror;

let current = null;
function selectCharacter(id, { fresh = false } = {}) {
  const ch = library.get(id); if (!ch) return;
  if (current) { holder.remove(current.root); resetRetarget(current); }
  current = ch; holder.add(ch.root);
  if (fresh) solver.calibrated = false; // re-baseline standing pose for a very different rig size
  store.set('char', id);
  document.querySelectorAll('.chip[data-id]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.id === id)));
}

const charsEl = $('#chars');
function addChip(ch) {
  const b = document.createElement('button');
  b.className = 'chip'; b.dataset.id = ch.id; b.setAttribute('role', 'radio');
  b.innerHTML = `<span class="dot" style="background:${swatch(ch)}"></span><span>${ch.name}</span>`;
  b.addEventListener('click', () => selectCharacter(ch.id, { fresh: true }));
  charsEl.insertBefore(b, $('#addCustom'));
}
function swatch(ch) { return { human: '#ff5d8f', robot: '#3ee0cf', bunny: '#ffd23f' }[ch.id] || '#a99fd0'; }
library.list().forEach(addChip);
selectCharacter(store.get('char', 'human'));

/* ---------------------------------------------------------------- UI: toggles */
function applyOpts() {
  video.style.opacity = opts.cam ? .5 : 0;
  ground.visible = opts.env;
  renderer.setClearColor(0x1a1330, opts.transparent ? 0 : 1);
  stage.classList.toggle('transparent-bg', opts.transparent);
  solver.mirror = opts.mirror;
}
document.querySelectorAll('.tg').forEach(b => {
  b.setAttribute('aria-pressed', String(opts[b.dataset.k]));
  b.addEventListener('click', () => {
    const k = b.dataset.k; opts[k] = !opts[k];
    b.setAttribute('aria-pressed', String(opts[k])); store.set(k, opts[k]); applyOpts();
    if (k === 'mirror') solver.calibrated = false;
    if (b.classList.contains('switch')) {
      const labels = { mirror: ['On', 'Off'], env: ['Ground', 'Off'], transparent: ['On', 'Off'] };
      const [on, off] = labels[k] || ['On', 'Off'];
      b.textContent = opts[k] ? on : off;
    }
  });
});
applyOpts();
$('#addCustom').addEventListener('click', () => $('#customFile').click());

const rotSlider = $('#rot'), scaleSlider = $('#scale'), distSlider = $('#dist');
rotSlider.value = store.get('rot', 0); scaleSlider.value = store.get('scale', 100); distSlider.value = camDist * 100;
function applySliders() {
  holder.rotation.y = (+rotSlider.value) * Math.PI / 180;
  const s = (+scaleSlider.value) / 100; holder.scale.setScalar(s);
  camDist = (+distSlider.value) / 100; placeCamera();
}
[rotSlider, scaleSlider, distSlider].forEach(el => el.addEventListener('input', () => {
  store.set('rot', +rotSlider.value); store.set('scale', +scaleSlider.value); store.set('camDist', camDist);
  applySliders();
}));
applySliders();

$('#customFile').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  say('Loading character…');
  try {
    const ch = await library.addFromFile(file);
    if (!ch) { say('That file doesn\u2019t look like a rigged humanoid Mimic can recognize.', true); return; }
    addChip(ch); selectCharacter(ch.id, { fresh: true }); say('');
  } catch (err) { console.error(err); say('Couldn\u2019t load that GLB file.', true); }
  e.target.value = '';
});

/* -------------------------------------------------------------- record/play */
const recBtn = $('#rec'), playBtn = $('#play'), restartBtn = $('#restart'), timeline = $('#timeline'), speed = $('#speed');
function refreshTransportUI() {
  recBtn.setAttribute('aria-pressed', String(recorder.recording));
  recBtn.textContent = recorder.recording ? '■ Stop' : '● Rec';
  playBtn.disabled = !recorder.hasTake;
  playBtn.textContent = recorder.playing ? '⏸ Pause' : '▶ Play';
  restartBtn.disabled = !recorder.hasTake;
  timeline.disabled = !recorder.hasTake;
  timeline.max = String(Math.max(recorder.duration, 0.01));
  if (!scrubbing) timeline.value = String(recorder.playT);
}
let scrubbing = false;
recBtn.addEventListener('click', () => {
  if (recorder.recording) recorder.stopRecording();
  else { recorder.startRecording(); recorder.playing = false; }
  refreshTransportUI();
});
playBtn.addEventListener('click', () => { recorder.playing ? recorder.pause() : recorder.play(); refreshTransportUI(); });
restartBtn.addEventListener('click', () => { recorder.restart(); refreshTransportUI(); });
timeline.addEventListener('input', () => { scrubbing = true; recorder.seek(+timeline.value); recorder.playing = false; refreshTransportUI(); });
timeline.addEventListener('change', () => { scrubbing = false; });
speed.addEventListener('input', () => recorder.setSpeed(+speed.value));
refreshTransportUI();

/* -------------------------------------------------------------- status pill */
const pill = $('#pill'), pillTxt = $('#pillTxt');
function setPill(txt, cls) { pillTxt.textContent = txt; pill.className = cls || ''; }
const msg = $('#msg');
function say(t, err) { msg.textContent = t; msg.className = err ? 'err' : ''; }

/* -------------------------------------------------------------------- loop */
let running = false, lastVT = -1, lastNow = 0, fpsT = 0, detCount = 0, frameParity = 0;
function loop(now) {
  if (!running) return;
  requestAnimationFrame(loop);
  const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.1) : 1 / 60; lastNow = now;

  let liveFrame = null;
  if (video.readyState >= 2 && video.currentTime !== lastVT) {
    lastVT = video.currentTime;
    try {
      const state = tracker.detect(video, now, { hands: opts.hands, face: opts.face });
      liveFrame = solver.solve(state, now / 1000);
      if (liveFrame && recorder.recording) recorder.push(liveFrame);
      detCount++;
    } catch (e) { console.error('Detection error', e); }
  }

  // Advancing the recorder here (rather than just reading it) is what makes
  // playback its own clock, independent of the live camera frame rate.
  recorder.tick(dt);
  const usingPlayback = recorder.playing;
  const activeFrame = usingPlayback ? recorder.frameAt(recorder.playT) : liveFrame;
  const trackingAgeOk = !!liveFrame || usingPlayback;
  applyMotionFrame(current, activeFrame, dt, { trackHands: opts.hands, trackFace: opts.face, confidence: 1 });

  renderer.render(scene, camera);
  if (opts.skel) drawSkeleton();

  if (now - fpsT > 700) {
    const fps = Math.round(detCount * 1000 / (now - fpsT)); detCount = 0; fpsT = now;
    if (usingPlayback) setPill(`Playing take \u00b7 ${recorder.playT.toFixed(1)}s / ${recorder.duration.toFixed(1)}s`, 'live');
    else if (recorder.recording) setPill(`\u25cf Recording \u00b7 ${recorder.frames.length ? recorder.frames[recorder.frames.length - 1].t.toFixed(1) : '0.0'}s`, 'warn');
    else if (!trackingAgeOk) setPill('Can\u2019t see you \u2014 step back so your shoulders are in view', 'warn');
    else setPill(`Tracking \u00b7 ${fps} fps`, 'live');
    refreshTransportUI();
  } else if (usingPlayback) {
    refreshTransportUI();
  }
}

function drawSkeleton() {
  const dpr = renderer.getPixelRatio(); const w = overlay.width, h = overlay.height;
  og.clearRect(0, 0, w, h);
  const st = tracker.state.pose; if (!st) return;
  const mirror = opts.mirror;
  og.lineWidth = 2 * dpr; og.strokeStyle = 'rgba(62,224,207,.85)'; og.fillStyle = '#3ee0cf';
  const P = i => { const p = st[i]; const x = mirror ? 1 - p.x : p.x; return [x * w, p.y * h]; };
  const LINES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
  for (const [a, b] of LINES) {
    if (st[a].v < .4 || st[b].v < .4) continue;
    const [ax, ay] = P(a), [bx, by] = P(b);
    og.beginPath(); og.moveTo(ax, ay); og.lineTo(bx, by); og.stroke();
  }
  for (let i = 0; i < 33; i++) if (st[i].v > .4) { const [x, y] = P(i); og.beginPath(); og.arc(x, y, 3 * dpr, 0, Math.PI * 2); og.fill(); }
}

/* ------------------------------------------------------------------ start */
const startBtn = $('#start'), intro = $('#intro');
startBtn.addEventListener('click', async () => {
  startBtn.disabled = true; say('');
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.isSecureContext) {
      throw Object.assign(new Error('The camera only works on https:// or localhost. Host this on GitHub Pages / Vercel, or open it from localhost.'), { plain: true });
    }
    say('Starting camera\u2026');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    video.srcObject = stream; await video.play();

    const { hasHands, hasFace } = await tracker.init(t => say(t));
    document.querySelector('[data-k="hands"]').disabled = !hasHands;
    document.querySelector('[data-k="face"]').disabled = !hasFace;
    if (!hasHands || !hasFace) setPill(`${!hasHands ? 'Hands' : 'Face'} tracking unavailable on this device`, 'warn');

    intro.hidden = true; running = true; fpsT = performance.now();
    requestAnimationFrame(loop);
  } catch (e) {
    console.error(e);
    let text = e.message || 'Something went wrong.';
    if (e.name === 'NotAllowedError') text = 'Camera access was blocked. Allow the camera for this site, then try again.';
    else if (e.name === 'NotFoundError') text = 'No camera found on this device.';
    else if (e.name === 'NotReadableError') text = 'The camera is busy. Close other apps using it and try again.';
    else if (!e.plain) text = 'Couldn\u2019t load the tracking models. Check your connection and try again. (' + text + ')';
    say(text, true);
    startBtn.disabled = false; startBtn.textContent = 'Try again';
  }
});
