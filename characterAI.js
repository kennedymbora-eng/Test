// characterAI.js
// Interface stub for AI-assisted character creation. Deliberately NOT wired
// to any API key or backend here — a frontend-only app must never hold a key
// that can generate billable 3D assets. When this is built out, `generate`
// should call your own backend endpoint (which holds the key), and that
// endpoint returns a GLB URL this module hands to characters.loadGLBCharacter.
//
// This file has no dependency on tracking.js, motionSolver.js or retarget.js
// on purpose: character creation and real-time puppeteering are separate
// concerns, and either can change without touching the other.
export const CharacterAI = {
  /**
   * Generate a new character mesh from a text prompt.
   * @param {string} prompt
   * @returns {Promise<{glbUrl: string, previewUrl?: string}>}
   */
  async generateCharacter(prompt) {
    throw new Error(
      'AI character generation isn\u2019t connected yet. Wire generateCharacter() ' +
      'to a backend endpoint that holds your model-generation API key and ' +
      'returns a GLB URL — never call a generation API directly from the browser.'
    );
  },

  /**
   * Auto-rig a generated (or user-uploaded) mesh with Mimic's generic
   * humanoid bone set. In production this also calls a backend service;
   * characters.js's autoMapBones() already does the *matching* half of this
   * for any GLB that already ships bones under common naming conventions.
   * @param {string} modelUrl
   * @returns {Promise<{glbUrl: string}>}
   */
  async rigCharacter(modelUrl) {
    throw new Error('Automatic rigging isn\u2019t connected yet.');
  },

  /**
   * Run any final prep a generated character needs before it can join the
   * library — decimation, texture compression, humanoid bone validation —
   * so everything handed to characters.js is already Mimic-ready.
   * @param {string} modelUrl
   * @returns {Promise<{glbUrl: string, valid: boolean, issues?: string[]}>}
   */
  async prepareCharacter(modelUrl) {
    throw new Error('Character preparation isn\u2019t connected yet.');
  }
};
