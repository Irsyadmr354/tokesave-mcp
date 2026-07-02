const compressor = require('./compress');

const MODES = ['lite', 'standard', 'aggressive', 'brutal', 'oblivion'];

function calcReadability(text, original) {
  const words = text.split(/\s+/).filter(Boolean).length;
  const avgWordLen = words > 0 ? text.replace(/\s/g, '').length / words : 0;
  const vowelRatio = (text.match(/[aeiou]/gi) || []).length / Math.max(text.length, 1);
  const origWords = original.split(/\s+/).filter(Boolean).length;
  return {
    words,
    avgWordLen: avgWordLen.toFixed(1),
    vowelRatio: (vowelRatio * 100).toFixed(1) + '%',
    compressionRatio: words > 0 ? ((1 - words / Math.max(origWords, 1)) * 100).toFixed(1) + '%' : '0%',
  };
}

function calcInfoLoss(original, compressed) {
  const losses = [];
  const origUrls = original.match(/https?:\/\/\S+/gi) || [];
  const compUrls = compressed.match(/https?:\/\/\S+/gi) || [];
  if (origUrls.length > 0 && origUrls.length !== compUrls.length) {
    losses.push(`URLs: ${origUrls.length} -> ${compUrls.length}`);
  }
  const origNums = original.match(/\b\d+\b/g) || [];
  const compNums = compressed.match(/\b\d+\b/g) || [];
  if (origNums.length > 0 && origNums.length !== compNums.length) {
    losses.push(`Numbers: ${origNums.length} -> ${compNums.length}`);
  }
  const origCode = original.match(/`[^`]+`/g) || [];
  const compCode = compressed.match(/`[^`]+`/g) || [];
  if (origCode.length > 0 && origCode.length !== compCode.length) {
    losses.push(`Inline code: ${origCode.length} -> ${compCode.length}`);
  }
  return losses.length > 0 ? losses.join('; ') : 'None';
}

async function runBenchmark(text) {
  const original = text;
  const origChars = original.length;
  const origTokens = Math.ceil(origChars / 4);
  const results = [];

  for (const mode of MODES) {
    compressor.setMode(mode);
    const compressed = await compressor.compressText(original, 'benchmark.txt');
    const compChars = compressed.length;
    const compTokens = Math.ceil(compChars / 4);
    const charSaved = origChars - compChars;
    const tokenSaved = origTokens - compTokens;
    const charPct = ((charSaved / origChars) * 100).toFixed(1);
    const tokenPct = ((tokenSaved / origTokens) * 100).toFixed(1);
    const readability = calcReadability(compressed, original);
    const infoLoss = calcInfoLoss(original, compressed);

    results.push({
      mode,
      compressed: compressed.slice(0, 300) + (compressed.length > 300 ? '...' : ''),
      fullLength: compressed.length,
      stats: {
        chars: `${origChars} -> ${compChars} (${charPct}% saved)`,
        tokens: `${origTokens} -> ${compTokens} (${tokenPct}% saved)`,
        words: readability.compressionRatio,
        avgWordLen: readability.avgWordLen,
        vowelRatio: readability.vowelRatio,
      },
      infoLoss,
      rawSavedPct: parseFloat(charPct),
    });
  }

  const best = [...results].sort((a, b) => b.rawSavedPct - a.rawSavedPct)[0];
  const readable = results.filter(r => {
    const vowelPct = parseFloat(r.stats.vowelRatio);
    return r.infoLoss === 'None' && vowelPct > 4 && r.rawSavedPct > 0;
  });
  const safe = results.filter(r => r.infoLoss === 'None' && r.rawSavedPct > 0);
  const recommended = readable.length > 0
    ? readable.sort((a, b) => b.rawSavedPct - a.rawSavedPct)[0]
    : safe.length > 0
      ? safe.sort((a, b) => b.rawSavedPct - a.rawSavedPct)[0]
      : results[2];

  let output = `╔══════════════════════════════════════╗\n`;
  output += `║     🔬 TokeSave Compression Benchmark   ║\n`;
  output += `╚══════════════════════════════════════╝\n\n`;
  output += `Input: ${origChars} chars / ~${origTokens} tokens\n\n`;

  for (const r of results) {
    output += `─── [${r.mode.toUpperCase()}] ───\n`;
    output += `  Chars:    ${r.stats.chars}\n`;
    output += `  Tokens:   ${r.stats.tokens}\n`;
    output += `  Words:    ${r.stats.words}\n`;
    output += `  Avg word: ${r.stats.avgWordLen} chars\n`;
    output += `  Vowels:   ${r.stats.vowelRatio}\n`;
    output += `  Info loss:${r.infoLoss === 'None' ? ' ✅ None' : ' ⚠ ' + r.infoLoss}\n`;
    output += `  Sample:   ${r.compressed}\n\n`;
  }

  output += `═══════════════════════════════════════\n`;
  output += `🏆 Best savings:     ${best.mode} (${best.stats.tokens})\n`;
  output += `✅ Recommended:      ${recommended.mode} (best balance savings vs safety)\n`;
  output += `⚠  Avoid if critical: ${results.filter(r => r.infoLoss !== 'None').map(r => r.mode).join(', ') || 'None'}\n`;
  output += `═══════════════════════════════════════\n`;

  return output;
}

module.exports = { runBenchmark };
