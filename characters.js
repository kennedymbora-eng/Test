// characters.js
// The character manager. A "character" is always the same shape regardless of
// where it came from — built-in procedural rig, or an imported GLB:
//   { id, name, root (THREE.Group), bones (name -> THREE.Object3D), parts, headH }
// The motion solver / retargeter only ever talks to `bones`, so swapping the
// character never requires touching tracking or retargeting code.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildProceduralCharacter, BONE_NAMES } from './skeleton.js';

export const PALETTES = {
  human: { name: 'Pip', skin: '#ffc98f', shirt: '#ff5d8f', sleeve: '#ff5d8f', pants: '#3a6bff', pants2: '#3a6bff', shoe: '#fff3d6', hair: '#5a3524', accent: '#ffd23f', earType: 'ear', emblem: true },
  robot: { name: 'Bolt', skin: '#c9d3e6', shirt: '#3ee0cf', sleeve: '#3ee0cf', pants: '#6a5cf0', pants2: '#6a5cf0', shoe: '#ffd23f', hair: '#3ee0cf', accent: '#ff5d8f', earType: 'antenna', emblem: true },
  bunny: { name: 'Bun', skin: '#f6f0ff', shirt: '#ffd23f', sleeve: '#ffd23f', pants: '#7a5cff', pants2: '#7a5cff', shoe: '#ff9ecb', hair: '#ff9ecb', accent: '#ff9ecb', earType: 'long', emblem: true }
};

export function createBuiltins() {
  const out = {};
  for (const [id, palette] of Object.entries(PALETTES)) {
    const c = buildProceduralCharacter(palette);
    out[id] = { id, name: palette.name, root: c.root, bones: c.bones, parts: c.parts, headH: 0.34, kind: 'procedural' };
  }
  return out;
}

// ---- Custom GLB import -----------------------------------------------------
// Best-effort mapping from common exporter bone-naming conventions (Mixamo,
// VRM/Unity Humanoid, generic "mixamorig:" prefixes) onto Mimic's generic
// bone roles. A GLB only needs to satisfy the core arm/leg/spine names to be
// puppetable; fingers and face bones are used opportunistically if present.
const ALIASES = {
  Hips: ['hips', 'pelvis', 'root'],
  Spine: ['spine', 'spine1', 'spine01'],
  Chest: ['spine2', 'chest', 'upperchest', 'spine02'],
  Neck: ['neck'],
  Head: ['head'],
  LeftShoulder: ['leftshoulder', 'lclavicle', 'shoulder_l'],
  LeftUpperArm: ['leftarm', 'leftupperarm', 'upperarm_l'],
  LeftLowerArm: ['leftforearm', 'leftlowerarm', 'lowerarm_l'],
  LeftHand: ['lefthand', 'hand_l'],
  RightShoulder: ['rightshoulder', 'rclavicle', 'shoulder_r'],
  RightUpperArm: ['rightarm', 'rightupperarm', 'upperarm_r'],
  RightLowerArm: ['rightforearm', 'rightlowerarm', 'lowerarm_r'],
  RightHand: ['righthand', 'hand_r'],
  LeftUpperLeg: ['leftupleg', 'leftupperleg', 'upperleg_l'],
  LeftLowerLeg: ['leftleg', 'leftlowerleg', 'lowerleg_l'],
  LeftFoot: ['leftfoot', 'foot_l'],
  LeftToes: ['lefttoebase', 'lefttoes', 'toes_l'],
  RightUpperLeg: ['rightupleg', 'rightupperleg', 'upperleg_r'],
  RightLowerLeg: ['rightleg', 'rightlowerleg', 'lowerleg_r'],
  RightFoot: ['rightfoot', 'foot_r'],
  RightToes: ['righttoebase', 'righttoes', 'toes_r']
};
const norm = s => s.toLowerCase().replace(/^mixamorig:?/, '').replace(/[_\s.]/g, '');

function autoMapBones(root) {
  const found = {};
  root.traverse(o => {
    if (!o.isBone && !o.isObject3D) return;
    const n = norm(o.name || '');
    if (!n) return;
    for (const role of BONE_NAMES) {
      if (found[role]) continue;
      const cands = ALIASES[role] || [norm(role)];
      if (cands.some(c => n === c || n.endsWith(c))) found[role] = o;
    }
  });
  return found;
}

/** Load a user's own GLB/GLTF and try to puppet it with the same rig the
 *  built-ins use. Returns null (caller should show an error) if no
 *  recognizable humanoid skeleton is found. */
export async function loadGLBCharacter(url, name = 'Custom') {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const scene = gltf.scene || gltf.scenes[0];
  const bones = autoMapBones(scene);
  if (!bones.Hips || !bones.Spine || (!bones.LeftUpperArm && !bones.RightUpperArm)) {
    return null; // not a recognizable humanoid — caller decides how to inform the user
  }
  const box = new THREE.Box3().setFromObject(scene);
  const headH = Math.max((box.max.y - box.min.y) / 7.5, 0.05); // ~7.5 heads tall, rough default
  scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { id: 'custom:' + name, name, root: scene, bones, parts: {}, headH, kind: 'glb' };
}

/** Public interface the app builds a character library around. Real characters
 *  are procedural today; loadGLB is already the general path so
 *  "character1.glb, character2.glb, ..." drop in later with no other changes. */
export class CharacterLibrary {
  constructor() { this.items = createBuiltins(); this.order = Object.keys(this.items); }
  list() { return this.order.map(id => this.items[id]); }
  get(id) { return this.items[id]; }
  async addFromFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const ch = await loadGLBCharacter(url, file.name.replace(/\.(glb|gltf)$/i, ''));
      if (!ch) return null;
      this.items[ch.id] = ch; this.order.push(ch.id);
      return ch;
    } finally { /* URL is revoked by caller once the model no longer needs it */ }
  }
}
