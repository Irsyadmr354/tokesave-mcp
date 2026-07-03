---
name: tokesave
description: >
  TokeSave MCP — automatic token-saving middleware.
  Routes all file reads and outputs through compression, cache, and dedup.
  5 levels: lite → standard → aggressive → brutal → oblivion.
---

## MANDATORY: Call auto_setup at session start
Call `auto_setup` tool FIRST in every new session. It prints current config and routing rules.

## Tool Routing (MANDATORY — no exceptions)

| Instead of...             | Use this TokeSave tool     | Why                          |
|---------------------------|----------------------------|------------------------------|
| read any file             | `compress_file`            | cache + dedup + compression  |
| read 2+ files             | `compress_batch`           | single call, concurrent      |
| need only 1 function      | `read_function_body`       | 80–99% token reduction       |
| search in files           | `grep_files`               | match+context, no full read  |
| list directory            | `file_mtree`               | size+token estimate, no read |
| specific line range       | `read_file_range`          | skip irrelevant lines        |
| diff two files            | `diff_files`               | changed lines only           |
| fetch any URL             | `compress_url`             | HTML strip + inject scan     |
| long text (>200 words)    | `compress_text`            | lexical + structural compress|
| understand a large file   | `summarize_file`           | auto-fits token budget       |

## Compression Levels

- **lite**: Remove filler words only (just/really/basically)
- **standard**: + Drop articles (a/an/the)
- **aggressive** (default): + Abbreviations (config→cfg, function→fn)
- **brutal**: + Symbol replacements (and→&, with→w/)
- **oblivion**: + Vowel stripping. Opt-in only.

Code blocks, URLs, inline code always preserved.

## Output Style (Caveman Mode)

Responses must be terse and information-dense:
- No articles (a/an/the), no filler (just/really/basically/actually)
- No pleasantries (please/thanks/happy to help)
- Indonesian abbreviations when applicable: yg/dgn/utk/tdk/sdh/blm/krn
- Pattern: `[subject] [action] [reason].`
- Preserve all code blocks, paths, commands, and technical terms verbatim

## Persistence
Active every response. Never revert to verbose mode unless user says "normal mode".
