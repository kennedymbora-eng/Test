// recorder.js
// Records the MotionFrame stream itself (not pixels, not a specific
// character) — { time, body, leftHand, rightHand, face } per frame — so a
// captured performance can be replayed through the retargeter onto whichever
// character is selected afterwards, per Mimic's "record once, play on
// anything" requirement.
export class Recorder {
  constructor() {
    this.frames = [];
    this.recording = false;
    this.playing = false;
    this.epoch = null;
    this.playT = 0;
    this.speed = 1;
  }

  get duration() { return this.frames.length ? this.frames[this.frames.length - 1].t : 0; }
  get hasTake() { return this.frames.length > 1; }

  startRecording() { this.frames = []; this.recording = true; this.epoch = null; this.playing = false; }
  stopRecording() { this.recording = false; }

  /** Call once per solved MotionFrame while recording is active. */
  push(frame) {
    if (!this.recording) return;
    if (this.epoch === null) this.epoch = frame.time;
    this.frames.push({ ...frame, t: frame.time - this.epoch });
  }

  play() { if (this.hasTake) this.playing = true; }
  pause() { this.playing = false; }
  restart() { this.playT = 0; }
  stopPlayback() { this.playing = false; this.playT = 0; }
  seek(t) { this.playT = Math.max(0, Math.min(this.duration, t)); }
  setSpeed(s) { this.speed = Math.max(0.1, Math.min(3, s)); }

  /** Advance playback by dt seconds; returns the frame to render this tick,
   *  or null if there's nothing recorded / playback has stopped. */
  tick(dt) {
    if (!this.playing || !this.hasTake) return null;
    this.playT += dt * this.speed;
    if (this.playT >= this.duration) { this.playT = this.duration; this.playing = false; }
    return this.frameAt(this.playT);
  }

  /** Nearest recorded frame at or before time t (binary search). */
  frameAt(t) {
    const f = this.frames;
    if (!f.length) return null;
    let lo = 0, hi = f.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (f[mid].t <= t) lo = mid; else hi = mid - 1;
    }
    return f[lo];
  }

  toJSON() { return { frames: this.frames }; }
  static fromJSON(data) {
    const r = new Recorder();
    r.frames = data.frames || [];
    return r;
  }
}
