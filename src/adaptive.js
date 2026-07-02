const stats = require('./stats');

const MODES = ['lite', 'standard', 'aggressive', 'brutal', 'oblivion'];

class AdaptiveEngine {
  constructor() {
    this.checkInterval = 10;
    this.callCount = 0;
    this.maxLevel = 'brutal';
  }

  /**
   * Set the maximum mode the adaptive engine is allowed to escalate to.
   * Prevents auto-escalation into destructive modes like oblivion.
   */
  setMaxLevel(level) {
    if (MODES.includes(level)) {
      this.maxLevel = level;
    }
  }

  evaluate(compressor) {
    this.callCount++;
    if (this.callCount % this.checkInterval !== 0) return;

    const currentStats = stats.getSessionRatio();
    const currentIdx = MODES.indexOf(compressor.mode);
    const maxIdx = MODES.indexOf(this.maxLevel);

    if (currentStats < 20 && currentIdx < maxIdx) {
      compressor.setMode(MODES[currentIdx + 1]);
      console.error(`[Adaptive] Low savings (${currentStats}%). Escalated to ${compressor.mode}`);
    } else if (currentStats > 60 && currentIdx > 0) {
      compressor.setMode(MODES[currentIdx - 1]);
      console.error(`[Adaptive] High savings (${currentStats}%). Relaxed to ${compressor.mode}`);
    }
  }
}

module.exports = new AdaptiveEngine();
