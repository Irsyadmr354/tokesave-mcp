let Jimp;
try {
  Jimp = require('jimp');
} catch (e) {
  Jimp = null;
}

class VisionShrinker {
  constructor() {
    this.enabled = true;
    this.maxSize = 512; // Downscale to 512x512
    this.quality = 50; // 50% JPEG quality
  }

  async processBase64(base64Str) {
    if (!Jimp) return base64Str;
    try {
      // Strip data:image/...;base64,
      const matches = base64Str.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) return base64Str;
      
      const mime = matches[1];
      const data = Buffer.from(matches[2], 'base64');
      
      const image = await Jimp.read(data);
      if (image.bitmap.width > this.maxSize || image.bitmap.height > this.maxSize) {
        image.scaleToFit(this.maxSize, this.maxSize);
      }
      
      image.quality(this.quality);
      
      const newBase64 = await image.getBase64Async(Jimp.MIME_JPEG);
      return newBase64;
    } catch (e) {
      console.error("[VisionShrinker] Error processing image:", e.message);
      return base64Str; // return original on error
    }
  }

  async shrink(text) {
    if (!this.enabled || !text) return text;
    
    // Check if text contains base64 image patterns
    // e.g. data:image/png;base64,iVBORw0KG...
    const b64Regex = /data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g;
    
    if (!b64Regex.test(text)) return text;

    let modifiedText = text;
    // We must use a custom async replacer logic since String.replace is sync
    
    const matches = [...text.matchAll(b64Regex)];
    for (const match of matches) {
      const originalB64 = match[0];
      // Only process large base64 strings to save CPU
      if (originalB64.length > 5000) {
        const compressedB64 = await this.processBase64(originalB64);
        modifiedText = modifiedText.replace(originalB64, compressedB64);
      }
    }

    return modifiedText;
  }
}

module.exports = new VisionShrinker();
