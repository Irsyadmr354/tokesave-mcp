const idDict = require('./id');
const jaDict = require('./ja');
const zhDict = require('./zh');
const enDict = require('./en');

function detectLanguage(text) {
  const sample = text.slice(0, 500);
  const cjkChars = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  const jpChars = (sample.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
  const idWords = (sample.match(/\b(?:yang|dengan|untuk|tidak|sudah|adalah|dalam|dari)\b/gi) || []).length;

  if (jpChars > 5) return 'ja';
  if (cjkChars > 10) return 'zh';
  if (idWords >= 3) return 'id';
  return 'en';
}

function compressMultiLang(text) {
  const lang = detectLanguage(text);
  let result = text;

  if (lang === 'id') {
    for (const [word, abbr] of Object.entries(idDict)) {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      result = result.replace(regex, abbr);
    }
  } else if (lang === 'ja') {
    for (const [word, abbr] of Object.entries(jaDict)) {
      result = result.split(word).join(abbr);
    }
  } else if (lang === 'zh') {
    for (const pat of zhDict.patterns) {
      result = result.replace(pat.find, pat.replace);
    }
  } else if (lang === 'en') {
    for (const [word, abbr] of Object.entries(enDict)) {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      result = result.replace(regex, abbr);
    }
  }

  return result;
}

module.exports = { detectLanguage, compressMultiLang };
