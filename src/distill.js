// Math-based Text Extractor (TF-IDF sentence scoring)

class DistillationEngine {
  constructor() {
    this.enabled = false;
    this.ratio = 0.3;
  }

  enable() {
    this.enabled = true;
    console.error("TextRank Pre-Distillation Engine Enabled (TF-IDF).");
  }

  setRatio(ratio) {
    this.ratio = ratio;
  }

  _tokenize(sentence) {
    return (sentence.toLowerCase().match(/\b\w+\b/g) || []);
  }

  extract(text) {
    if (!this.enabled || !text || text.length < 500) return text;

    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    if (sentences.length < 5) return text;

    const stopWords = new Set(['the','a','an','and','or','but','is','are','was','were','of','to','in','for','with','on','at','from','by']);
    const totalSentences = sentences.length;

    const sentenceWords = sentences.map(s => this._tokenize(s).filter(w => !stopWords.has(w)));

    const docFreq = {};
    for (const words of sentenceWords) {
      const seen = new Set(words);
      for (const word of seen) {
        docFreq[word] = (docFreq[word] || 0) + 1;
      }
    }

    const tfidf = (word, words) => {
      const tf = words.filter(w => w === word).length;
      if (tf === 0) return 0;
      const df = docFreq[word] || 1;
      const idf = Math.log(totalSentences / df);
      return tf * idf;
    };

    const scoredSentences = sentences.map((sentence, index) => {
      const words = sentenceWords[index];
      let score = 0;
      const uniqueWords = [...new Set(words)];
      for (const word of uniqueWords) {
        score += tfidf(word, words);
      }
      return { sentence, score, index };
    });

    scoredSentences.sort((a, b) => b.score - a.score);
    const topK = Math.max(1, Math.ceil(sentences.length * this.ratio));
    const selected = scoredSentences.slice(0, topK);
    selected.sort((a, b) => a.index - b.index);

    return selected.map(s => s.sentence.trim()).join(' ');
  }
}

module.exports = new DistillationEngine();
