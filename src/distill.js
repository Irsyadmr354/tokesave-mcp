// Math-based Text Extractor (TextRank approximation)
// Extracts the most important sentences without AI (Lossless Extractive)

class DistillationEngine {
  constructor() {
    this.enabled = false;
    this.ratio = 0.3; // Keep top 30% of sentences
  }

  enable() {
    this.enabled = true;
    console.error("TextRank Pre-Distillation Engine Enabled.");
  }

  setRatio(ratio) {
    this.ratio = ratio;
  }

  extract(text) {
    if (!this.enabled || !text || text.length < 500) return text;

    // 1. Split into sentences
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    if (sentences.length < 5) return text;

    // 2. Tokenize and calculate word frequencies (TF)
    const wordFreq = {};
    const stopWords = new Set(['the','a','an','and','or','but','is','are','was','were','of','to','in','for','with','on','at','from','by']);
    
    sentences.forEach(sentence => {
      const words = sentence.toLowerCase().match(/\b\w+\b/g) || [];
      words.forEach(word => {
        if (!stopWords.has(word)) {
          wordFreq[word] = (wordFreq[word] || 0) + 1;
        }
      });
    });

    // 3. Score sentences based on word frequencies
    const scoredSentences = sentences.map((sentence, index) => {
      const words = sentence.toLowerCase().match(/\b\w+\b/g) || [];
      let score = 0;
      words.forEach(word => {
        if (wordFreq[word]) score += wordFreq[word];
      });
      return { sentence, score, index };
    });

    // 4. Sort by score and pick top K
    scoredSentences.sort((a, b) => b.score - a.score);
    const topK = Math.max(1, Math.ceil(sentences.length * this.ratio));
    const selected = scoredSentences.slice(0, topK);

    // 5. Restore original order
    selected.sort((a, b) => a.index - b.index);

    // Return only the distilled text — no prefix injected into the content
    // (prefix would corrupt downstream compression and inflate stats)
    return selected.map(s => s.sentence.trim()).join(' ');
  }
}

module.exports = new DistillationEngine();
