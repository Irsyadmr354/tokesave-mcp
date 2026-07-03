// A pure JS Infinite Memory (RAG) module using @xenova/transformers

const MAX_VECTORS = 300; // Bug #15 fix: limit memory size

class InfiniteMemoryDB {
  constructor() {
    this.enabled = false;
    this.extractor = null;
    this.db = []; // Array of { text, vector }
  }

  async enable() {
    this.enabled = true;
    console.error("Infinite Memory RAG DB Enabled. Initializing Xenova Transformers...");
    try {
      // Dynamic import to avoid loading transformers if not used
      const { pipeline, env } = await import('@xenova/transformers');
      // Disable local model check to allow downloading if not present
      env.allowLocalModels = false; 
      
      this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: true // Keeps the model tiny (~22MB)
      });
      console.error("Xenova Vector Model loaded.");
    } catch (e) {
      console.error("Failed to load Xenova Vector Model:", e.message);
      this.enabled = false;
    }
  }

  async embed(text) {
    if (!this.extractor) return null;
    const output = await this.extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  cosineSimilarity(vecA, vecB) {
    let dotProduct = 0.0;
    let normA = 0.0;
    let normB = 0.0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async store(text) {
    if (!this.enabled || !text) return;
    // Don't embed tiny chunks
    if (text.length < 50) return;
    
    const vector = await this.embed(text);
    if (vector) {
      // Bug #15 fix: evict oldest if over limit
      if (this.db.length >= MAX_VECTORS) {
        this.db.shift();
      }
      this.db.push({ text, vector });
    }
  }

  async recall(queryText, topK = 1) {
    if (!this.enabled || this.db.length === 0) return "Memory is empty.";
    
    const queryVector = await this.embed(queryText);
    if (!queryVector) return "Failed to generate query vector.";

    const scored = this.db.map(entry => ({
      text: entry.text,
      score: this.cosineSimilarity(queryVector, entry.vector)
    }));

    scored.sort((a, b) => b.score - a.score);
    
    const results = scored.slice(0, topK);
    return results.map(r => `[Similarity: ${(r.score * 100).toFixed(1)}%] ${r.text}`).join('\n\n');
  }
}

module.exports = new InfiniteMemoryDB();
