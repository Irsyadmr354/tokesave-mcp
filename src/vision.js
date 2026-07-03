let Jimp;
try {
  Jimp = require('jimp');
} catch (e) {
  Jimp = null;
}

class VisionShrinker {
  constructor() {
    this.enabled = true;
    this.maxSize = 512;
    this.quality = 50;
  }

  async processBase64(base64Str) {
    if (!Jimp) return base64Str;
    try {
      const matches = base64Str.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) return base64Str;

      const data = Buffer.from(matches[2], 'base64');
      const image = await Jimp.read(data);

      if (image.bitmap.width > this.maxSize || image.bitmap.height > this.maxSize) {
        image.scaleToFit(this.maxSize, this.maxSize);
      }
      image.quality(this.quality);

      const newBase64 = await image.getBase64Async(Jimp.MIME_JPEG);
      return newBase64;
    } catch (e) {
      return base64Str;
    }
  }

  async shrink(text) {
    if (!this.enabled || !text) return text;

    // BUG FIX #9: create a fresh regex (no lastIndex state pollution)
    // Do NOT reuse a stateful regex across .test() and .matchAll()
    const B64_PATTERN = /data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g;

    // Collect all matches first (fresh regex, no stale lastIndex)
    const matches = [...text.matchAll(B64_PATTERN)];
    if (matches.length === 0) return text;

    let modifiedText = text;
    for (const match of matches) {
      const originalB64 = match[0];
      if (originalB64.length > 5000) {
        const compressedB64 = await this.processBase64(originalB64);
        // Only replace if actually smaller
        if (compressedB64.length < originalB64.length) {
          modifiedText = modifiedText.replace(originalB64, compressedB64);
        }
      }
    }

    return modifiedText;
  }
}

module.exports = new VisionShrinker();
