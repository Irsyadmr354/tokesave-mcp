const stats = require('./stats');

const MODES = ['lite', 'standard', 'aggressive', 'brutal', 'oblivion'];

class AdaptiveEngine {
  constructor() {
    this.checkInterval = 10;
    this.callCount = 0;
    this.maxLevel = 'brutal';
    this.minLevel = 'lite'; // BUG FIX #13: floor — adaptive cannot go below configured mode
  }

  setMaxLevel(level) {
    if (MODES.includes(level)) this.maxLevel = level;
  }

  // BUG FIX #13: expose setMinLevel so config can pin floor
  setMinLevel(level) {
    if (MODES.includes(level)) this.minLevel = level;
  }

  evaluate(compressor) {
    this.callCount++;
    if (this.callCount % this.checkInterval !== 0) return;

    const currentStats = stats.getSessionRatio();
    const currentIdx = MODES.indexOf(compressor.mode);
    const maxIdx = MODES.indexOf(this.maxLevel);
    const minIdx = MODES.indexOf(this.minLevel);

    if (currentStats < 20 && currentIdx < maxIdx) {
      compressor.setMode(MODES[currentIdx + 1]);
      console.error(`[Adaptive] Low savings (${currentStats}%). Escalated to ${compressor.mode}`);
    } else if (currentStats > 60 && currentIdx > minIdx) {
      // BUG FIX #13: only de-escalate down to minLevel, not below
      compressor.setMode(MODES[currentIdx - 1]);
      console.error(`[Adaptive] High savings (${currentStats}%). Relaxed to ${compressor.mode}`);
    }
  }
}

module.exports = new AdaptiveEngine();
