// tracking.js
// TRACKING layer only. Talks to MediaPipe Tasks Vision and nothing else — no
// Three.js, no bones, no character knowledge. Emits raw normalized landmark
// data (0..1 image space + MediaPipe's relative z, plus blendshape scores).
// This is deliberately unchanged in spirit from Mimic's original 2D canvas
// version: same models, same delegate fallback, same alternating hand/face
// throttle for low-end phones — only the "draw a 2D puppet" part is gone.
export const CONFIG = {
  libVersions: ['0.10.14', '0.10.3'],
  libBase: v => `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${v}`,
  models: {
    pose: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
  }
};

export class Tracker {
  constructor() {
    this.pose = null; this.hand = null; this.face = null;
    this.state = {
      pose: null, poseAt: -9,
      hands: { Left: null, Right: null }, // each: {pts:[{x,y,z}]*21, at}
      face: null // {lm:[{x,y,z}]*~478, bs:{name:score}, at}
    };
    this._frame = 0;
  }

  async init(onStatus = () => {}) {
    onStatus('Loading tracking library…');
    let mod, wasm, lastErr;
    for (const v of CONFIG.libVersions) {
      try {
        mod = await import(/* webpackIgnore: true */ `${CONFIG.libBase(v)}/vision_bundle.mjs`);
        wasm = `${CONFIG.libBase(v)}/wasm`;
        break;
      } catch (e) { lastErr = e; }
    }
    if (!mod) throw lastErr || new Error('Could not load the tracking library.');
    const fileset = await mod.FilesetResolver.forVisionTasks(wasm);

    const make = async (Cls, url, extra) => {
      let err;
      for (const delegate of ['GPU', 'CPU']) {
        try {
          return await Cls.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: url, delegate },
            runningMode: 'VIDEO', ...extra
          });
        } catch (e) { err = e; console.warn(Cls.name, delegate, e); }
      }
      throw err;
    };

    onStatus('Loading body model…');
    this.pose = await make(mod.PoseLandmarker, CONFIG.models.pose, { numPoses: 1 });
    onStatus('Loading hand model…');
    try { this.hand = await make(mod.HandLandmarker, CONFIG.models.hand, { numHands: 2 }); }
    catch (e) { console.warn('Hands unavailable', e); }
    onStatus('Loading face model…');
    try { this.face = await make(mod.FaceLandmarker, CONFIG.models.face, { numFaces: 1, outputFaceBlendshapes: true }); }
    catch (e) { console.warn('Face unavailable', e); }
    return { hasHands: !!this.hand, hasFace: !!this.face };
  }

  /** Run one detection pass against the current video frame. `opts` toggles
   *  which optional trackers to spend time on this frame (hands/face
   *  alternate with each other to keep total inference cost roughly flat). */
  detect(video, nowMs, opts) {
    const t = nowMs / 1000;
    const poseRes = this.pose.detectForVideo(video, nowMs);
    const lm = poseRes.landmarks && poseRes.landmarks[0];
    if (lm) {
      this.state.pose = lm.map(p => ({ x: p.x, y: p.y, z: p.z, v: p.visibility ?? 1 }));
      this.state.poseAt = t;
    }

    const jobs = [];
    if (opts.hands && this.hand) jobs.push('hand');
    if (opts.face && this.face) jobs.push('face');
    if (jobs.length) {
      const job = jobs[this._frame % jobs.length];
      if (job === 'hand') this._detectHands(video, nowMs, t);
      else this._detectFace(video, nowMs, t);
    }
    this._frame++;
    return this.state;
  }

  _detectHands(video, nowMs, t) {
    const res = this.hand.detectForVideo(video, nowMs);
    const found = res.landmarks || [];
    const handed = res.handedness || res.handednesses || [];
    for (let i = 0; i < found.length; i++) {
      // MediaPipe reports handedness from the (unmirrored) camera's point of
      // view; Mimic mirrors the whole rig in the motion solver, so we keep
      // the raw label here and let the solver decide left/right.
      const label = handed[i] && handed[i][0] && handed[i][0].categoryName; // 'Left' | 'Right'
      if (!label) continue;
      this.state.hands[label] = { pts: found[i].map(p => ({ x: p.x, y: p.y, z: p.z })), at: t };
    }
  }

  _detectFace(video, nowMs, t) {
    const res = this.face.detectForVideo(video, nowMs);
    const lm = res.faceLandmarks && res.faceLandmarks[0];
    if (!lm) return;
    const bs = {};
    const cats = res.faceBlendshapes && res.faceBlendshapes[0] && res.faceBlendshapes[0].categories;
    if (cats) for (const c of cats) bs[c.categoryName] = c.score;
    this.state.face = { lm, bs, at: t };
  }
}
