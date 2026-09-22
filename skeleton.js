// skeleton.js
// Defines the GENERIC humanoid bone set Mimic understands, and a builder that
// constructs that skeleton procedurally out of primitives (so the app has zero
// external asset dependency out of the box). Real GLB/GLTF characters can be
// dropped in later (see characters.js loadGLBCharacter) as long as their bone
// names can be mapped onto this same list — that mapping is what makes one
// motion solver drive completely different character meshes.
import * as THREE from 'three';

// The canonical bone roles the retargeter knows how to drive. A character
// only needs to provide the bones it actually has; missing bones are skipped.
export const BONE_NAMES = [
  'Hips', 'Spine', 'Chest', 'Neck', 'Head',
  'LeftShoulder', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand',
  'RightShoulder', 'RightUpperArm', 'RightLowerArm', 'RightHand',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToes',
  'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToes',
  // simplified one-joint-per-finger curl bones (root of each finger)
  'LeftThumb', 'LeftIndex', 'LeftMiddle', 'LeftRing', 'LeftPinky',
  'RightThumb', 'RightIndex', 'RightMiddle', 'RightRing', 'RightPinky',
  // fallback face bones, used only if a character has no blendshapes
  'Jaw', 'LeftEyeLid', 'RightEyeLid', 'LeftBrow', 'RightBrow', 'MouthCorner'
];

// Parent map: child -> parent bone name (or null for the root). This is the
// hierarchy every procedural and every auto-mapped GLB character conforms to.
export const BONE_PARENT = {
  Hips: null, Spine: 'Hips', Chest: 'Spine', Neck: 'Chest', Head: 'Neck',
  LeftShoulder: 'Chest', LeftUpperArm: 'LeftShoulder', LeftLowerArm: 'LeftUpperArm', LeftHand: 'LeftLowerArm',
  RightShoulder: 'Chest', RightUpperArm: 'RightShoulder', RightLowerArm: 'RightUpperArm', RightHand: 'RightLowerArm',
  LeftUpperLeg: 'Hips', LeftLowerLeg: 'LeftUpperLeg', LeftFoot: 'LeftLowerLeg', LeftToes: 'LeftFoot',
  RightUpperLeg: 'Hips', RightLowerLeg: 'RightUpperLeg', RightFoot: 'RightLowerLeg', RightToes: 'RightFoot',
  LeftThumb: 'LeftHand', LeftIndex: 'LeftHand', LeftMiddle: 'LeftHand', LeftRing: 'LeftHand', LeftPinky: 'LeftHand',
  RightThumb: 'RightHand', RightIndex: 'RightHand', RightMiddle: 'RightHand', RightRing: 'RightHand', RightPinky: 'RightHand',
  Jaw: 'Head', LeftEyeLid: 'Head', RightEyeLid: 'Head', LeftBrow: 'Head', RightBrow: 'Head', MouthCorner: 'Head'
};

// Rest-pose local offset (from parent bone origin) and the bone's local
// "forward" axis (the direction the bone points at rest, used by the
// retargeter to compute swing rotations). Units are abstract "heads" (h);
// each character scales the whole rig by its own head size.
const Y = new THREE.Vector3(0, 1, 0), NY = new THREE.Vector3(0, -1, 0);
const X = new THREE.Vector3(1, 0, 0), NX = new THREE.Vector3(-1, 0, 0);
export const BONE_REST = {
  Hips: { pos: [0, 3.1, 0], axis: Y },
  Spine: { pos: [0, 0.35, 0], axis: Y },
  Chest: { pos: [0, 0.35, 0], axis: Y },
  Neck: { pos: [0, 0.55, 0], axis: Y },
  Head: { pos: [0, 0.22, 0], axis: Y },
  LeftShoulder: { pos: [0.28, 0.42, 0], axis: X },
  LeftUpperArm: { pos: [0.18, 0, 0], axis: X },
  LeftLowerArm: { pos: [0.9, 0, 0], axis: X },
  LeftHand: { pos: [0.85, 0, 0], axis: X },
  RightShoulder: { pos: [-0.28, 0.42, 0], axis: NX },
  RightUpperArm: { pos: [-0.18, 0, 0], axis: NX },
  RightLowerArm: { pos: [-0.9, 0, 0], axis: NX },
  RightHand: { pos: [-0.85, 0, 0], axis: NX },
  LeftUpperLeg: { pos: [0.17, -0.05, 0], axis: NY },
  LeftLowerLeg: { pos: [0, -1.0, 0], axis: NY },
  LeftFoot: { pos: [0, -0.95, 0], axis: new THREE.Vector3(0, -0.25, 1).normalize() },
  LeftToes: { pos: [0, 0, 0.45], axis: new THREE.Vector3(0, 0, 1) },
  RightUpperLeg: { pos: [-0.17, -0.05, 0], axis: NY },
  RightLowerLeg: { pos: [0, -1.0, 0], axis: NY },
  RightFoot: { pos: [0, -0.95, 0], axis: new THREE.Vector3(0, -0.25, 1).normalize() },
  RightToes: { pos: [0, 0, 0.45], axis: new THREE.Vector3(0, 0, 1) },
  LeftThumb: { pos: [0.2, 0.05, 0.12], axis: X }, LeftIndex: { pos: [0.32, 0, 0.05], axis: X },
  LeftMiddle: { pos: [0.34, 0, 0], axis: X }, LeftRing: { pos: [0.32, 0, -0.05], axis: X }, LeftPinky: { pos: [0.28, 0, -0.1], axis: X },
  RightThumb: { pos: [-0.2, 0.05, 0.12], axis: NX }, RightIndex: { pos: [-0.32, 0, 0.05], axis: NX },
  RightMiddle: { pos: [-0.34, 0, 0], axis: NX }, RightRing: { pos: [-0.32, 0, -0.05], axis: NX }, RightPinky: { pos: [-0.28, 0, -0.1], axis: NX },
  Jaw: { pos: [0, -0.08, 0.06], axis: Y }, LeftEyeLid: { pos: [0.08, 0.04, 0.16], axis: Y },
  RightEyeLid: { pos: [-0.08, 0.04, 0.16], axis: Y }, LeftBrow: { pos: [0.08, 0.12, 0.16], axis: Y },
  RightBrow: { pos: [-0.08, 0.12, 0.16], axis: Y }, MouthCorner: { pos: [0, -0.14, 0.16], axis: Y }
};

/** Build the bone Object3D hierarchy (a THREE.Bone tree) at the given head-unit scale (headH). */
export function buildBoneHierarchy(headH) {
  const bones = {};
  for (const name of Object.keys(BONE_PARENT)) {
    const b = new THREE.Bone(); b.name = name;
    const r = BONE_REST[name];
    b.position.set(r.pos[0] * headH, r.pos[1] * headH, r.pos[2] * headH);
    bones[name] = b;
  }
  for (const name of Object.keys(BONE_PARENT)) {
    const parent = BONE_PARENT[name];
    if (parent) bones[parent].add(bones[name]); 
  }
  bones.Hips.updateMatrixWorld(true);
  return bones;
}

const mat = (color, extra) => new THREE.MeshStandardMaterial({ color, roughness: .6, metalness: .05, ...extra });

/** Attach a rigid primitive "flesh" mesh to a bone, offset so it visually spans
 *  from the bone's origin toward its child along the bone's rest axis. */
function limb(bones, boneName, childName, radius, taper, color) {
  const b = bones[boneName], rest = BONE_REST[boneName];
  const len = childName ? bones[childName].position.length() : radius * 2.2;
  const geo = new THREE.CapsuleGeometry(radius * (taper ?? 1), Math.max(len - radius * 1.6, .01), 4, 6);
  const m = new THREE.Mesh(geo, mat(color));
  m.castShadow = false;
  const dir = rest.axis.clone().normalize();
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  m.position.copy(dir.clone().multiplyScalar(len / 2));
  b.add(m);
  return m;
}
function box(bones, boneName, size, color, offset = [0, 0, 0]) {
  const b = bones[boneName];
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat(color));
  m.position.set(...offset); b.add(m); return m;
}
function sphere(bones, boneName, r, color, offset = [0, 0, 0]) {
  const b = bones[boneName];
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat(color));
  m.position.set(...offset); b.add(m); return m;
}

/**
 * Build one complete procedural character: bone hierarchy + attached primitive
 * meshes ("puppet" style rigging — segments parented to bones rather than a
 * skinned mesh, which is cheap on low-end GPUs and needs no vertex weights).
 * `palette` and `proportions` are what make Human / Robot / Bunny visually
 * distinct while sharing the exact same bone graph and retargeting code.
 */
export function buildProceduralCharacter(palette, headH = 0.34) {
  const bones = buildBoneHierarchy(headH);
  const root = new THREE.Group(); root.add(bones.Hips);
  const parts = {};

  // torso
  parts.spine = box(bones, 'Spine', [headH * .9, headH * .5, headH * .5], palette.pants, [0, headH * .25, 0]);
  parts.chest = box(bones, 'Chest', [headH * .95, headH * .55, headH * .55], palette.shirt, [0, headH * .28, 0]);
  parts.neck = limb(bones, 'Neck', 'Head', headH * .16, 1, palette.skin);

  // head + face bits (fallback bone-driven face)
  parts.head = sphere(bones, 'Head', headH * .62, palette.skin, [0, headH * .35, headH * .04]);
  if (palette.earType === 'long') {
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CapsuleGeometry(headH * .1, headH * .75, 4, 6), mat(palette.skin));
      ear.position.set(s * headH * .22, headH * .95, headH * .05);
      ear.rotation.z = s * .18;
      bones.Head.add(ear);
    }
  } else if (palette.earType === 'round') {
    for (const s of [-1, 1]) sphere(bones, 'Head', headH * .16, palette.skin, [s * headH * .52, headH * .55, 0]);
  } else {
    for (const s of [-1, 1]) sphere(bones, 'Head', headH * .09, palette.accent, [s * headH * .6, headH * .3, headH * .1]);
  }
  const eyeGeo = new THREE.SphereGeometry(headH * .07, 10, 8);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, mat('#241a3d', { roughness: .3 }));
    eye.position.set(s * headH * .24, headH * .38, headH * .58);
    bones.Head.add(eye);
  }
  const lidGeo = new THREE.BoxGeometry(headH * .17, headH * .17, headH * .04);
  for (const s of [-1, 1]) {
    const lid = new THREE.Mesh(lidGeo, mat(palette.skin));
    lid.position.set(0, 0, 0);
    lid.scale.y = 0.001; // hidden until blink drives it
    bones[s < 0 ? 'LeftEyeLid' : 'RightEyeLid'].add(lid);
    parts[s < 0 ? 'lidL' : 'lidR'] = lid;
  }
  const jawGeo = new THREE.BoxGeometry(headH * .34, headH * .16, headH * .18);
  const jaw = new THREE.Mesh(jawGeo, mat('#4a1730'));
  bones.Jaw.add(jaw); parts.jaw = jaw;
  for (const s of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(headH * .2, headH * .05, headH * .04), mat(palette.hair || '#241a3d'));
    bones[s < 0 ? 'LeftBrow' : 'RightBrow'].add(brow);
  }

  // arms
  for (const [S, side] of [['Left', 1], ['Right', -1]]) {
    limb(bones, `${S}Shoulder`, `${S}UpperArm`, headH * .16, 1, palette.skin);
    limb(bones, `${S}UpperArm`, `${S}LowerArm`, headH * .17, 1, palette.sleeve);
    limb(bones, `${S}LowerArm`, `${S}Hand`, headH * .14, .9, palette.skin);
    sphere(bones, `${S}Hand`, headH * .16, palette.skin, [side * headH * .1, 0, 0]);
    for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
      limb(bones, `${S}${f}`, null, headH * .045, 1, palette.skin);
    }
  }

  // legs
  for (const S of ['Left', 'Right']) {
    limb(bones, `${S}UpperLeg`, `${S}LowerLeg`, headH * .2, 1, palette.pants);
    limb(bones, `${S}LowerLeg`, `${S}Foot`, headH * .17, .85, palette.pants2 || palette.pants);
    box(bones, `${S}Foot`, [headH * .22, headH * .16, headH * .5], palette.shoe, [0, -headH * .05, headH * .18]);
  }

  // emblem
  if (palette.emblem) {
    const em = new THREE.Mesh(new THREE.CircleGeometry(headH * .2, 5), mat(palette.accent));
    em.position.set(0, headH * .15, headH * .28); em.rotation.x = -0.15;
    bones.Chest.add(em);
  }

  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, bones, parts };
}
