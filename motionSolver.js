// motionSolver.js
// MOTION SOLVER. Converts raw landmarks into a generic humanoid MotionFrame —
// bone *rotations*, joint angles and finger curls, never raw coordinates
// assigned straight to a mesh. A MotionFrame is plain, JSON-serializable data
// (quaternions as {x,y,z,w}), which is what lets the recorder capture a
// performance once and replay it later on any character (see recorder.js).
import * as THREE from 'three';
import { BONE_REST } from './skeleton.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const qToJSON = q => ({ x: q.x, y: q.y, z: q.z, w: q.w });

// Landmark indices, MediaPipe Pose (33-point) — labels are the subject's own
// anatomical left/right, independent of how the image is mirrored on screen.
const PI = {
  nose: 0, earL: 7, earR: 8,
  shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16,
  hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankL: 27, ankR: 28, toeL: 31, toeR: 32
};

function toV3(p, mirror) {
  const x = mirror ? (1 - p.x) : p.x;
  return V((x - 0.5) * 2, (0.5 - p.y) * 2, -(p.z || 0) * 2.2);
}

/** Rotation (as a quaternion) that points a bone's *rest* axis at `dirWorld`,
 *  expressed in the given parent's accumulated world rotation — i.e. a local
 *  bone rotation, computed without ever touching THREE's actual scene graph. */
function swing(restAxis, dirWorld, parentWorldQuat) {
  const local = dirWorld.clone().applyQuaternion(parentWorldQuat.clone().invert()).normalize();
  if (local.lengthSq() < 1e-6) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromUnitVectors(restAxis, local);
}

const FINGER_CHAINS = {
  Thumb: [1, 2, 3, 4], Index: [5, 6, 7, 8], Middle: [9, 10, 11, 12], Ring: [13, 14, 15, 16], Pinky: [17, 18, 19, 20]
};

function fingerCurls(pts) {
  const wrist = pts[0];
  const out = {};
  for (const [name, chain] of Object.entries(FINGER_CHAINS)) {
    const mcp = pts[chain[0]], tip = pts[chain[chain.length - 1]];
    const straight = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y, mcp.z - wrist.z) * 3.1; // rough fully-extended length
    const cur = Math.hypot(tip.x - wrist.x, tip.y - wrist.y, tip.z - wrist.z);
    out[name] = clamp(1 - cur / Math.max(straight, 1e-4), 0, 1);
  }
  return out;
}

export class MotionSolver {
  constructor() {
    this.mirror = true;
    this.calibrated = false;
    this.baseShoulderY = 0; this.baseHipX = 0; this.baseShoulderW = 0.4;
  }

  /** Recompute the "neutral standing" reference so root translation (crouch,
   *  step side to side) is relative to how the user is actually standing. */
  calibrate(pose) {
    if (!pose) return;
    const shL = toV3(pose[PI.shL], this.mirror), shR = toV3(pose[PI.shR], this.mirror);
    this.baseShoulderY = (shL.y + shR.y) / 2;
    this.baseHipX = (toV3(pose[PI.hipL], this.mirror).x + toV3(pose[PI.hipR], this.mirror).x) / 2;
    this.baseShoulderW = Math.max(shL.distanceTo(shR), 0.15);
    this.calibrated = true;
  }

  /** state: Tracker.state (raw landmarks). Returns a MotionFrame or null if
   *  there is no current body detection to build one from. */
  solve(state, nowSec) {
    if (!state.pose) return null;
    if (!this.calibrated) this.calibrate(state.pose);
    const P = state.pose, mirror = this.mirror;
    const L = mirror
      ? { sh: PI.shL, el: PI.elL, wr: PI.wrL, hip: PI.hipL, knee: PI.kneeL, ank: PI.ankL, toe: PI.toeL }
      : { sh: PI.shR, el: PI.elR, wr: PI.wrR, hip: PI.hipR, knee: PI.kneeR, ank: PI.ankR, toe: PI.toeR };
    const R = mirror
      ? { sh: PI.shR, el: PI.elR, wr: PI.wrR, hip: PI.hipR, knee: PI.kneeR, ank: PI.ankR, toe: PI.toeR }
      : { sh: PI.shL, el: PI.elL, wr: PI.wrL, hip: PI.hipL, knee: PI.kneeL, ank: PI.ankL, toe: PI.toeL };
    const v = i => toV3(P[i], mirror);

    const shL = v(L.sh), shR = v(R.sh), hipL = v(L.hip), hipR = v(R.hip);
    const shMid = shL.clone().add(shR).multiplyScalar(.5);
    const hipMid = hipL.clone().add(hipR).multiplyScalar(.5);
    const shoulderW = Math.max(shL.distanceTo(shR), 0.1);
    const scale = this.baseShoulderW / shoulderW; // rough distance-from-camera compensation

    // ---- root: translate with the user (crouch, lean, step), rotate with torso yaw
    const root = {
      x: clamp((hipMid.x - this.baseHipX) * 0.9, -1.4, 1.4),
      y: clamp((shMid.y - this.baseShoulderY) * 0.9, -0.9, 0.5),
      z: 0,
      yaw: clamp(Math.atan2((mirror ? -1 : 1) * (shR.z - shL.z), shoulderW), -1.1, 1.1)
    };

    // ---- torso direction (hips -> shoulders) drives Spine/Chest together
    const torsoDir = shMid.clone().sub(hipMid).normalize();
    const worldQ = { Hips: new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), root.yaw) };
    const bones = {};
    const setBone = (name, parentName, dir) => {
      const q = swing(BONE_REST[name].axis, dir, worldQ[parentName]);
      bones[name] = qToJSON(q);
      worldQ[name] = worldQ[parentName].clone().multiply(q);
    };
    setBone('Spine', 'Hips', torsoDir);
    setBone('Chest', 'Spine', torsoDir);
    // shoulders stay at rest (identity) — only upper/lower arm swing, which reads
    // clearly on a stylized puppet without needing clavicle motion
    worldQ.LeftShoulder = worldQ.Chest; worldQ.RightShoulder = worldQ.Chest;
    bones.LeftShoulder = qToJSON(new THREE.Quaternion());
    bones.RightShoulder = qToJSON(new THREE.Quaternion());

    setBone('LeftUpperArm', 'LeftShoulder', v(L.el).sub(shL).normalize());
    setBone('LeftLowerArm', 'LeftUpperArm', v(L.wr).sub(v(L.el)).normalize());
    setBone('RightUpperArm', 'RightShoulder', v(R.el).sub(shR).normalize());
    setBone('RightLowerArm', 'RightUpperArm', v(R.wr).sub(v(R.el)).normalize());
    // hand orientation follows the forearm unless real hand landmarks override it later
    bones.LeftHand = qToJSON(new THREE.Quaternion());
    bones.RightHand = qToJSON(new THREE.Quaternion());
    worldQ.LeftHand = worldQ.LeftLowerArm; worldQ.RightHand = worldQ.RightLowerArm;

    setBone('LeftUpperLeg', 'Hips', v(L.knee).sub(hipL).normalize());
    setBone('LeftLowerLeg', 'LeftUpperLeg', v(L.ank).sub(v(L.knee)).normalize());
    setBone('LeftFoot', 'LeftLowerLeg', v(L.toe).sub(v(L.ank)).normalize());
    setBone('RightUpperLeg', 'Hips', v(R.knee).sub(hipR).normalize());
    setBone('RightLowerLeg', 'RightUpperLeg', v(R.ank).sub(v(R.knee)).normalize());
    setBone('RightFoot', 'RightLowerLeg', v(R.toe).sub(v(R.ank)).normalize());
    bones.Hips = qToJSON(worldQ.Hips);

    // ---- head: prefer face-derived orientation (below); pose-only fallback
    const earL = v(PI.earL), earR = v(PI.earR), nose = v(PI.nose);
    const poseYaw = clamp((nose.x - (earL.x + earR.x) / 2) / Math.max(earL.distanceTo(earR), .05) * .9, -.8, .8);
    const poseRoll = -Math.atan2(earR.y - earL.y, earR.x - earL.x || 1e-4);

    const frame = {
      time: nowSec, scale,
      body: { root, bones },
      // MediaPipe's hand "Left"/"Right" is anatomical, same convention as the
      // pose landmarks above — so it needs the same mirror-driven swap as L/R did.
      leftHand: this._hand(state.hands[mirror ? 'Left' : 'Right'], mirror),
      rightHand: this._hand(state.hands[mirror ? 'Right' : 'Left'], mirror),
      face: this._face(state.face, nowSec, poseYaw, poseRoll)
    };
    return frame;
  }

  _hand(h, mirror) {
    if (!h) return null;
    return { fingers: fingerCurls(h.pts), at: h.at };
  }

  _face(f, nowSec, poseYaw, poseRoll) {
    if (!f || nowSec - f.at > 0.5) return null;
    const bs = f.bs || {};
    const g = n => bs[n] || 0;
    const lm = f.lm;
    let yaw = poseYaw, pitch = 0, roll = poseRoll;
    if (lm && lm[234] && lm[454]) {
      const l = lm[234], r = lm[454], nose = lm[1], top = lm[10], chin = lm[152];
      yaw = clamp(-((nose.x - (l.x + r.x) / 2) / Math.max(r.x - l.x, 1e-3)) * 1.3, -.8, .8);
      pitch = clamp(((nose.y - top.y) / Math.max(chin.y - top.y, 1e-3) - 0.6) * 2, -.7, .7);
      roll = -Math.atan2(r.y - l.y, r.x - l.x);
    }
    return {
      jawOpen: clamp(g('jawOpen') * 1.5, 0, 1),
      smile: clamp((g('mouthSmileLeft') + g('mouthSmileRight')) * .7, 0, 1),
      blinkL: clamp((g('eyeBlinkLeft') - .15) / .55, 0, 1),
      blinkR: clamp((g('eyeBlinkRight') - .15) / .55, 0, 1),
      browUp: clamp(g('browInnerUp') * 1.4, 0, 1),
      browDown: clamp((g('browDownLeft') + g('browDownRight')) * .7, 0, 1),
      eyeX: clamp((g('eyeLookOutLeft') + g('eyeLookInRight') - g('eyeLookInLeft') - g('eyeLookOutRight')) * .5, -1, 1),
      eyeY: clamp((g('eyeLookUpLeft') + g('eyeLookUpRight') - g('eyeLookDownLeft') - g('eyeLookDownRight')) * .5, -1, 1),
      yaw, pitch, roll
    };
  }
}
