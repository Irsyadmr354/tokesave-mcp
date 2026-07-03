class SwarmManager {
  constructor() {
    this.agents = new Map();
  }

  createAgent(name, role) {
    if (this.agents.has(name)) {
      throw new Error(`Agent ${name} already exists.`);
    }
    this.agents.set(name, {
      role: role,
      status: 'IDLE',
      currentTask: null,
      history: []
    });
    return `Agent ${name} (${role}) created successfully.`;
  }

  assignTask(name, task) {
    const agent = this.agents.get(name);
    if (!agent) {
      throw new Error(`Agent ${name} not found.`);
    }
    agent.status = 'BUSY';
    agent.currentTask = task;
    agent.history.push({ task, timestamp: new Date().toISOString() });
    return `Task assigned to ${name}. AI client should now switch persona and execute it.`;
  }

  getStatus() {
    if (this.agents.size === 0) return "Swarm is empty. No agents created.";
    
    let out = "🐝 SWARM STATUS 🐝\n\n";
    for (const [name, data] of this.agents.entries()) {
      out += `[${name} | Role: ${data.role}] - Status: ${data.status}\n`;
      if (data.currentTask) out += `  Current Task: ${data.currentTask}\n`;
    }
    return out;
  }
}

module.exports = new SwarmManager();
