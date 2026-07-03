# TokeSave MCP — Agent Improvement Prompt

## Konteks Proyek

TokeSave adalah MCP server token-saving middleware yang sudah dipublish di npm sebagai `tokesave-mcp@1.0.4`.
Repository: https://github.com/Irsyadmr354/tokesave-mcp
Stack: Node.js >=18, CommonJS, @modelcontextprotocol/sdk

### Kondisi sekarang (sudah solid, jangan diubah):
- Compression pipeline 5-level (lite→standard→aggressive→brutal→oblivion) dengan protected blocks
- Cache LRU-100 dengan SHA-256 full-content key
- Dedup O(1) exact hash + Jaccard near-duplicate
- Injection shield untuk URL fetching
- Skeleton extractor JS/TS/Python/Go/Rust/Swift
- Zero-config install (auto-apply defaults jika tidak ada config)
- Token estimasi akurat via `src/tokens.js` (3.5ch/tok EN, 6ch/tok CJK)
- All bugs fixed: shell injection, redirect loop, buffer overflow, regex lastIndex, cache key mismatch

### Masalah utama yang perlu diselesaikan:

---

## TASK 1 — Auto-Proxy Setup Generator (PRIORITAS TINGGI)

**Masalah:** Auto-proxy (transparent wrapping MCP server lain) butuh user edit `tokesave.config.json` manual dengan `servers: {}`. User tidak tahu format yang benar.

**Yang diinginkan:** Tool `generate_proxy_config` yang:
1. Detect MCP servers yang sudah ada di sistem user (baca `~/.config/Claude/claude_desktop_config.json`, `~/.cursor/mcp.json`, `%APPDATA%\Claude\claude_desktop_config.json`, `~/.kiro/settings/mcp.json`)
2. Parse existing server entries
3. Generate `tokesave.config.json` dengan `servers: {}` terisi otomatis
4. Print instruksi: "Ganti entry server X di mcp.json dengan tokesave yang sudah wrap X"
5. Optionally: langsung tulis config

**File yang perlu dibuat/diubah:**
- Tambah tool `generate_proxy_config` di `src/index.js`
- Buat `src/config_generator.js` untuk logic deteksi

---

## TASK 2 — Transparent Proxy Mode yang lebih kuat (PRIORITAS TINGGI)

**Masalah saat ini di `src/proxy.js`:**
- Hanya compress response content, tidak compress request arguments
- Tidak ada stats per-upstream-server
- Buffer overflow protection ada tapi tidak ada backpressure handling
- Jika upstream crash, proxy crash juga tanpa clean error ke client

**Yang diinginkan:**
1. Request arguments compression: kalau AI kirim teks panjang sebagai argument, compress dulu sebelum dikirim ke upstream (reverse compression)
2. Per-server stats: berapa token saved dari wrapping server X vs server Y
3. Proper backpressure: jika upstream lambat, jangan accumulate buffer tanpa batas
4. Graceful upstream crash: return proper MCP error response ke client, jangan crash proxy

**File:** `src/proxy.js`

---

## TASK 3 — Smart Context Window Manager (PRIORITAS TINGGI)

**Masalah:** TokeSave tidak tahu seberapa penuh context window AI. Kadang compress terlalu sedikit (buang token), kadang tidak perlu compress sama sekali.

**Yang diinginkan:** Tool `check_context_pressure` yang:
1. Track total token yang sudah diproses session ini (sudah ada di `compressor.totalInputTokens`)
2. Hitung persentase "pressure" berdasarkan threshold yang bisa dikonfigurasi (default: alert di 50k, critical di 80k tokens)
3. Recommend mode berdasarkan pressure: rendah→lite, sedang→aggressive, tinggi→brutal
4. Auto-escalate mode ketika pressure tinggi (sudah ada adaptive tapi tidak ada threshold pressure)

**File:** `src/adaptive.js`, `src/index.js`

---

## TASK 4 — Output Compression untuk Respons AI (PRIORITAS SEDANG)

**Masalah:** TokeSave hanya compress INPUT (file yang dibaca AI). Tapi OUTPUT AI (respons panjang) tidak di-compress sebelum masuk context berikutnya.

**Yang diinginkan:**
- Tool `compress_output` yang menerima teks respons AI panjang, kompres untuk disimpan/direferensikan
- Ini berguna untuk multi-turn conversation: simpan summary respons lama, bukan full text
- Integrate dengan `memory.js` yang sudah ada (store compressed summary, recall by query)

**File:** `src/index.js` (tambah tool), `src/memory.js` (tambah `summarize_and_store`)

---

## TASK 5 — Fix `distill.js` dari TF ke TF-IDF yang benar (PRIORITAS SEDANG)

**Masalah:** `distill.js` mengklaim "TextRank" tapi implementasinya hanya TF (term frequency). Kalimat dengan kata umum yang sering muncul dapat skor tinggi, bukan kalimat yang paling informatif.

**Yang diinginkan:** Implementasi TF-IDF yang benar:
- IDF: log(total_sentences / sentences_containing_word)
- Score = sum(TF-IDF per kata dalam kalimat)
- Masih pure JS, zero dependencies
- Benchmark: harus lebih baik dari pure TF untuk dokumen >1000 kata

**File:** `src/distill.js`

---

## TASK 6 — Shield yang lebih kuat dengan Unicode normalization (PRIORITAS SEDANG)

**Masalah:** `src/shield.js` hanya cek ASCII patterns. Adversarial injection bisa pakai:
- Unicode lookalikes: `ｉｇｎｏｒｅ` (fullwidth) → lolos dari pattern matching
- Zero-width characters sebagai separator: `i​g​n​o​r​e` → tidak ter-detect
- Base64/ROT13 encoded instructions (walau ini sudah di-handle sebagian oleh `stripBase64`)

**Yang diinginkan:**
1. Unicode normalization (NFKC) sebelum pattern matching
2. Zero-width character stripping (`\u200b`, `\u200c`, `\u200d`, `\uFEFF`, dll)
3. Fullwidth to ASCII normalization
4. Tetap backward compatible, tidak break existing behavior

**File:** `src/shield.js`

---

## TASK 7 — Persistent Session State (PRIORITAS RENDAH)

**Masalah:** Setiap restart server, semua cache hilang. File history dedup hilang. AI harus baca ulang semua file dari scratch.

**Yang diinginkan:**
- Optional: persist LRU cache ke disk (`~/.tokesave-cache.json`) pada shutdown
- Load cache dari disk pada startup
- Configurable via `persistCache: true` di config
- Size limit: max 10MB file cache

**File:** `src/cache.js`, `src/index.js`

---

## Constraints yang WAJIB diikuti:

1. **Jangan ubah interface yang sudah ada** — tool names, parameter names, return format harus backward compatible
2. **Zero halusinasi policy** — jangan compress kode di dalam protected blocks (```), jangan mangle variable names
3. **Graceful degradation** — semua fitur baru harus optional, server tetap jalan sempurna tanpa fitur baru
4. **No new required dependencies** — boleh optional deps, tapi `dependencies` di package.json hanya boleh `@modelcontextprotocol/sdk` dan `terser`
5. **CommonJS only** — jangan pakai ES module syntax (`import`/`export`) di file baru kecuali dynamic `await import()` untuk optional deps
6. **Test setiap perubahan** dengan `node --check src/[file].js`
7. **Setelah selesai:** bump version, `npm publish --access public`, `git push origin main`

## File Structure:
```
src/
  index.js        ← entry point, tool registry, handlers
  compress.js     ← core compression pipeline
  cache.js        ← LRU cache + optional Redis
  dedup.js        ← exact + Jaccard dedup
  proxy.js        ← transparent proxy mode
  router.js       ← multi-server router
  shield.js       ← injection detection
  skeleton.js     ← AST skeleton + function extractor
  smart_read.js   ← grep, file range, mtree
  adaptive.js     ← auto mode escalation
  distill.js      ← sentence extraction
  tokens.js       ← token estimation utilities
  stats.js        ← session + lifetime stats
  ...
tokesave.config.json  ← default config (mode, maxAdaptiveLevel, dll)
SKILL.md              ← tool routing rules dibaca AI sebagai resource
package.json          ← version 1.0.4
```

## Cara test setelah selesai:
```bash
node --check src/index.js   # syntax check
node src/index.js           # harus print: TokeSave MCP server running on stdio
npm view tokesave-mcp version  # verifikasi publish berhasil
```
