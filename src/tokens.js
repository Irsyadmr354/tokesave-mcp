/**
 * Token estimation utilities — standalone module (no circular deps).
 * More accurate than naive /4 ratio.
 * GPT-4/Claude avg: ~3.5 chars/token English, ~2.5 code, ~6 CJK.
 */
function estimateTokens(text) {
  if (!text) return 0;
  const cjk = (text.match(/[\u3000-\u9fff\uac00-\ud7ff]/g) || []).length;
  const remaining = text.length - cjk;
  return Math.ceil(cjk / 6 + remaining / 3.5);
}

module.exports = { estimateTokens };
