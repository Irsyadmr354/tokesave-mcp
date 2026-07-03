class HTMLShredder {
  constructor() {
    this.enabled = true;
  }

  shred(text) {
    if (!this.enabled || !text) return text;

    // Detect if text contains HTML tags (naive check)
    if (!text.includes('<') || !text.includes('>')) return text;

    // If it looks like a full HTML document or has block elements
    const htmlIndicators = /<\/?(?:html|body|div|span|p|a|ul|li|table|section|article)\b[^>]*>/i;
    
    if (htmlIndicators.test(text)) {
      let shredded = text;

      // 1. Remove script tags and their content
      shredded = shredded.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      
      // 2. Remove style tags and their content
      shredded = shredded.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
      
      // 3. Remove head tag and its content (title, meta, etc are not usually needed for scraping pure content)
      shredded = shredded.replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, '');

      // 4. Remove SVG and Canvas elements which contain massive paths
      shredded = shredded.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '[SVG_ICON_REMOVED]');
      shredded = shredded.replace(/<canvas\b[^<]*(?:(?!<\/canvas>)<[^<]*)*<\/canvas>/gi, '[CANVAS_REMOVED]');

      // 5. Replace structural tags with newlines to preserve readability before stripping
      shredded = shredded.replace(/<\/?(?:div|p|br|hr|h[1-6]|li|tr)[^>]*>/gi, '\n');

      // 6. Strip all remaining HTML tags
      shredded = shredded.replace(/<[^>]+>/g, '');

      // 7. Decode common HTML entities
      shredded = shredded.replace(/&nbsp;/g, ' ')
                         .replace(/&amp;/g, '&')
                         .replace(/&lt;/g, '<')
                         .replace(/&gt;/g, '>')
                         .replace(/&quot;/g, '"')
                         .replace(/&#39;/g, "'");

      // 8. Compress newlines and spaces
      shredded = shredded.replace(/[ \t]{2,}/g, ' ')
                         .replace(/\n{3,}/g, '\n\n')
                         .trim();
                         
      return shredded;
    }

    return text;
  }
}

module.exports = new HTMLShredder();
