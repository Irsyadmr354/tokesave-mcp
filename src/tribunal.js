const swarm = require('./swarm');

class TribunalEngine {
  constructor() {
    this.enabled = false;
    this.callCount = 0; // Bug #4 fix: unique names per call
  }

  enable() {
    this.enabled = true;
    console.error("The Tribunal Mode (Anti-Hallucination) Enabled.");
  }

  async runQuery(prompt) {
    if (!this.enabled) return "Tribunal is disabled.";
    
    this.callCount++;
    const suffix = this.callCount;

    // Bug #4 fix: Use unique agent names per call to avoid crash
    const names = [
      `Tribunal_Judge_1_${suffix}`,
      `Tribunal_Judge_2_${suffix}`,
      `Tribunal_Judge_3_${suffix}`
    ];

    try {
      for (const name of names) {
        swarm.createAgent(name, "Factual judge. Provide accurate answer.");
        swarm.assignTask(name, prompt);
      }
    } catch (e) {
      return `[TRIBUNAL ERROR] ${e.message}`;
    }

    return `[TRIBUNAL INITIATED] Spawned agents: ${names.join(', ')}. Awaiting consensus...`;
  }
}

module.exports = new TribunalEngine();
