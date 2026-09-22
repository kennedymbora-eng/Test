// retarget.js
// RETARGETING. The only file that touches both a MotionFrame and an actual
// character. Everything upstream (tracking, motion solver, recorder) has no
// idea characters or Three.js bones exist; everything downstream (a
// character's bones) has no idea MediaPipe exists. This is the seam that
// lets one performance drive Robot today and a user-imported GLB tomorrow.
import * as THREE from 'three';

const tmpQ = new THREE.Quaternion();
const BODY_BONES = [
  'Hips', 'Spine', 'Chest', 'LeftShoulder', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand',
  'RightShoulder', 'RightUpperArm', 'RightLowerArm', 'RightHand',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'RightUpperLeg', 'RightLowerLeg', 'RightFoot'
];
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
// simplified single-joint fingers: curl bends the bone toward the palm around
// its local Z; sign differs by hand so "closed fist" looks the same on both.
const CURL_AXIS = new THREE.Vector3(0, 0, 1), CURL_MAX = 1.35;

/** Per-character smoothing memory, keyed by character id so switching
 *  characters mid-session doesn't fight stale filter state. */
const memo = new Map();
function mem(character) {
  let m = memo.get(character.id);
  if (!m) { m = { root: new THREE.Vector3(), yaw: 0, q: {} }; memo.set(character.id, m); }
  return m;
}

function slerpRate(dt, halfLifeMs) { return 1 - Math.pow(0.5, (dt * 1000) / halfLifeMs); }

/**
 * Apply one MotionFrame to `character` for this render tick.
 * @param character   { root, bones, parts, headH } from characters.js
 * @param frame        a MotionFrame from motionSolver.js (or null: idle)
 * @param dt           seconds since last call (for smoothing)
 * @param opts         { trackHands, trackFace, confidence(0..1) }
 */
export function applyMotionFrame(character, frame, dt, opts = {}) {
  const bones = character.bones;
  const m = mem(character);
  const conf = opts.confidence ?? 1;
  const rate = slerpRate(dt, 90);

  if (frame) {
    // root: position + yaw, in character-local "world" units scaled by head size
    const h = character.headH;
    const targetPos = new THREE.Vector3(frame.body.root.x * h * 2, frame.body.root.y * h * 2 + h * 3.1, frame.body.root.z * h * 2);
    m.root.lerp(targetPos, rate);
    character.root.position.copy(m.root);
    m.yaw += (frame.body.root.yaw - m.yaw) * rate;
    character.root.rotation.y = m.yaw;

    for (const name of BODY_BONES) {
      const b = bones[name]; if (!b) continue;
      const j = frame.body.bones[name]; if (!j) continue;
      tmpQ.set(j.x, j.y, j.z, j.w);
      const prev = m.q[name] || (m.q[name] = tmpQ.clone());
      prev.slerp(tmpQ, rate * conf);
      b.quaternion.copy(prev);
    }

    if (opts.trackHands) applyHands(bones, frame, m, rate);
    if (opts.trackFace) applyFace(character, frame.face, m, rate);
    else idleFace(character, m, rate);
  } else {
    idleFace(character, m, rate * 0.3);
  }
}

function applyHands(bones, frame, m, rate) {
  for (const [side, hand] of [['Left', frame.leftHand], ['Right', frame.rightHand]]) {
    if (!hand) continue;
    const sign = side === 'Left' ? 1 : -1;
    for (const f of FINGERS) {
      const bone = bones[`${side}${f}`]; if (!bone) continue;
      const curl = hand.fingers[f] ?? 0;
      const key = `${side}${f}`;
      const target = new THREE.Quaternion().setFromAxisAngle(CURL_AXIS, sign * curl * CURL_MAX);
      const prev = m.q[key] || (m.q[key] = target.clone());
      prev.slerp(target, rate);
      bone.quaternion.copy(prev);
    }
  }
}

function faceTarget(face) {
  return face || { jawOpen: 0, smile: .35, blinkL: 0, blinkR: 0, browUp: 0, browDown: 0, eyeX: 0, eyeY: 0, yaw: 0, pitch: 0, roll: 0 };
}

// Morph-target (blendshape) names commonly used by GLB face rigs; only used
// if a loaded model actually exposes them (ARKit / VRM-ish naming).
const MORPH_MAP = { jawOpen: 'jawOpen', smile: ['mouthSmileLeft', 'mouthSmileRight'], blinkL: 'eyeBlinkLeft', blinkR: 'eyeBlinkRight', browUp: 'browInnerUp' };

function applyFace(character, face, m, rate) {
  const f = faceTarget(face);
  const bones = character.bones;
  if (bones.Head) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(f.pitch, f.yaw, f.roll, 'YXZ'));
    const prev = m.q.Head || (m.q.Head = q.clone());
    prev.slerp(q, rate); bones.Head.quaternion.copy(prev);
  }
  if (bones.Jaw) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -f.jawOpen * .45);
    const prev = m.q.Jaw || (m.q.Jaw = q.clone());
    prev.slerp(q, rate); bones.Jaw.quaternion.copy(prev);
  }
  // blendshape path, if this character's mesh has morph targets
  let usedMorphs = false;
  character.root.traverse(o => {
    if (!o.isMesh || !o.morphTargetDictionary) return;
    usedMorphs = true;
    setMorph(o, MORPH_MAP.jawOpen, f.jawOpen);
    setMorph(o, MORPH_MAP.blinkL, f.blinkL);
    setMorph(o, MORPH_MAP.blinkR, f.blinkR);
    setMorph(o, MORPH_MAP.browUp, f.browUp);
    for (const n of MORPH_MAP.smile) setMorph(o, n, f.smile * .8);
  });
  // fallback: scale/position simple lid & brow meshes procedurally-built characters carry
  const parts = character.parts || {};
  if (!usedMorphs && (parts.lidL || parts.lidR)) {
    const h = character.headH;
    if (parts.lidL) parts.lidL.scale.y = Math.max(0.001, f.blinkL);
    if (parts.lidR) parts.lidR.scale.y = Math.max(0.001, f.blinkR);
    if (parts.lidL) parts.lidL.position.set(0, h * .38 - f.blinkL * h * .085, h * .6);
    if (parts.lidR) parts.lidR.position.set(0, h * .38 - f.blinkR * h * .085, h * .6);
  }
}

function setMorph(mesh, name, value) {
  if (!name) return;
  const idx = mesh.morphTargetDictionary[name];
  if (idx === undefined || !mesh.morphTargetInfluences) return;
  mesh.morphTargetInfluences[idx] = value;
}

function idleFace(character, m, rate) {
  const t = performance.now() / 1000;
  const ph = t % 4.2;
  const blink = ph < .15 ? Math.sin((ph / .15) * Math.PI) : 0;
  applyFace(character, { jawOpen: 0, smile: .35, blinkL: blink, blinkR: blink, browUp: 0, browDown: 0, yaw: 0, pitch: 0, roll: 0 }, m, rate);
}

/** Drop smoothing memory for a character (call when switching characters so
 *  the newly-selected model doesn't inherit another model's filter state). */
export function resetRetarget(character) { memo.delete(character.id); }
