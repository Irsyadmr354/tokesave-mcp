// Chinese particle removal patterns (applied as regex replacements)
module.exports = {
  patterns: [
    { find: /的(?=[^"'`])/g, replace: '' },
    { find: /了(?=[\s,，。])/g, replace: '' },
    { find: /着(?=[\s,，。])/g, replace: '' },
    { find: /呢(?=[\s,，。?？])/g, replace: '' },
    { find: /吧(?=[\s,，。])/g, replace: '' },
    { find: /啊(?=[\s,，。!！])/g, replace: '' },
  ]
};
