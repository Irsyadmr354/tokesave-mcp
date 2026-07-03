const stats = require('./stats');

const MODES = ['lite', 'standard', 'aggressive', 'brutal', 'oblivion'];

class AdaptiveEngine {
  constructor() {
    this.checkInterval = 10;
    this.callCount = 0;
    this.maxLevel = 'brutal';
    this.minLevel = 'lite';
    this.alertThreshold = 50000;
    this.criticalThreshold = 80000;
  }

  setMaxLevel(level) {
    if (MODES.includes(level)) this.maxLevel = level;
  }

  setMinLevel(level) {
    if (MODES.includes(level)) this.minLevel = level;
  }

  setPressureThresholds(alert, critical) {
    if (typeof alert === 'number' && alert > 0) this.alertThreshold = alert;
    if (typeof critical === 'number' && critical > 0) this.criticalThreshold = critical;
  }

  checkContextPressure(totalInputTokens) {
    const tokens = totalInputTokens || 0;
    const alertPct = Math.min(100, (tokens / this.alertThreshold) * 100);
    const criticalPct = Math.min(100, (tokens / this.criticalThreshold) * 100);

    let level = 'normal';
    let recommendedMode = 'lite';
    if (tokens >= this.criticalThreshold) {
      level = 'critical';
      recommendedMode = 'brutal';
    } else if (tokens >= this.alertThreshold) {
      level = 'elevated';
      recommendedMode = 'aggressive';
    } else if (tokens >= this.alertThreshold * 0.5) {
      level = 'moderate';
      recommendedMode = 'standard';
    } else {
      level = 'low';
      recommendedMode = 'lite';
    }

    return {
      totalInputTokens: tokens,
      alertThreshold: this.alertThreshold,
      criticalThreshold: this.criticalThreshold,
      pressureLevel: level,
      alertPercent: alertPct.toFixed(1),
      criticalPercent: criticalPct.toFixed(1),
      recommendedMode,
    };
  }

  evaluate(compressor) {
    this.callCount++;
    if (this.callCount % this.checkInterval !== 0) return;

    const pressure = this.checkContextPressure(compressor.totalInputTokens);
    const currentIdx = MODES.indexOf(compressor.mode);
    const maxIdx = MODES.indexOf(this.maxLevel);
    const minIdx = MODES.indexOf(this.minLevel);
    const recommendedIdx = MODES.indexOf(pressure.recommendedMode);

    if (pressure.pressureLevel === 'critical' || pressure.pressureLevel === 'elevated') {
      const targetIdx = Math.min(recommendedIdx, maxIdx);
      if (targetIdx > currentIdx) {
        compressor.setMode(MODES[targetIdx]);
        console.error(`[Adaptive] Context pressure ${pressure.pressureLevel} (${pressure.totalInputTokens} tokens). Escalated to ${compressor.mode}`);
        return;
      }
    }

    const currentStats = stats.getSessionRatio();

    if (currentStats < 20 && currentIdx < maxIdx) {
      compressor.setMode(MODES[currentIdx + 1]);
      console.error(`[Adaptive] Low savings (${currentStats}%). Escalated to ${compressor.mode}`);
    } else if (currentStats > 60 && currentIdx > minIdx) {
      compressor.setMode(MODES[currentIdx - 1]);
      console.error(`[Adaptive] High savings (${currentStats}%). Relaxed to ${compressor.mode}`);
    }
  }
}

module.exports = new AdaptiveEngine();
