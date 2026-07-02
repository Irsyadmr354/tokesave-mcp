class JSONShredder {
  constructor() {
    this.enabled = true;
    // Long string values in JSON that are worth abbreviating
    this._abbrevCache = new Map();
  }

  generateKeyMap(keys) {
    const map = {};
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let idx = 0;
    for (const key of keys) {
      if (key.length <= 2) {
        map[key] = key;
        continue;
      }
      let newKey = '';
      let tempIdx = idx;
      do {
        newKey = alphabet[tempIdx % alphabet.length] + newKey;
        tempIdx = Math.floor(tempIdx / alphabet.length);
      } while (tempIdx > 0);
      map[key] = newKey;
      idx++;
    }
    return map;
  }

  // Fields that are almost never needed by AI when processing JSON data
  // These are typically metadata/infrastructure fields, not content fields
  static NOISE_FIELDS = new Set([
    'updatedAt', 'updated_at', 'createdAt', 'created_at',
    'deletedAt', 'deleted_at', 'modifiedAt', 'modified_at',
    'href', 'html_url', 'url', 'avatar_url', 'gravatar_url',
    '_links', '__v', '__typename', 'etag', 'x-request-id',
    'comments_url', 'commits_url', 'statuses_url', 'forks_url',
    'keys_url', 'collaborators_url', 'teams_url', 'hooks_url',
    'issue_events_url', 'events_url', 'assignees_url', 'branches_url',
    'tags_url', 'blobs_url', 'git_tags_url', 'git_refs_url',
    'trees_url', 'downloads_url', 'issues_url', 'pulls_url',
    'milestones_url', 'notifications_url', 'labels_url', 'releases_url',
    'deployments_url', 'node_id', 'subscribers_url', 'subscription_url',
    'compare_url', 'merges_url', 'archive_url', 'contents_url',
    'star_gazers_url', 'contributors_url', 'git_commits_url',
  ]);

  pruneNoise(obj) {
    if (Array.isArray(obj)) return obj.map(v => this.pruneNoise(v));
    if (typeof obj !== 'object' || obj === null) return obj;
    const keys = Object.keys(obj);
    const out = {};
    for (const k of keys) {
      if (keys.length > 4 && JSONShredder.NOISE_FIELDS.has(k)) continue;
      out[k] = this.pruneNoise(obj[k]);
    }
    return out;
  }

  // Build a dedup map for repeated long string values
  buildValueMap(parsed) {
    const freq = new Map();
    const traverse = (val) => {
      if (typeof val === 'string' && val.length > 8) {
        freq.set(val, (freq.get(val) || 0) + 1);
      } else if (Array.isArray(val)) {
        val.forEach(traverse);
      } else if (val && typeof val === 'object') {
        Object.values(val).forEach(traverse);
      }
    };
    traverse(parsed);
    // Only deduplicate values that appear 2+ times AND are long enough to be worth it
    const valueMap = {};
    let idx = 0;
    for (const [val, count] of freq.entries()) {
      if (count >= 2 && val.length >= 10) {
        valueMap[val] = `$v${idx++}`;
      }
    }
    return valueMap;
  }

  shred(text) {
    if (!this.enabled || !text) return text;

    const trimmed = text.trim();
    if (!trimmed.startsWith('[{') && !trimmed.startsWith('{') && !trimmed.startsWith('[')) return text;

    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) return text;

      // Step 1: Prune noise fields first — reduces data before key mapping
      const pruned = this.pruneNoise(parsed);

      // Step 2: Collect all unique keys from the PRUNED object
      const uniqueKeys = new Set();
      const collectKeys = (obj) => {
        if (Array.isArray(obj)) { obj.forEach(collectKeys); return; }
        if (typeof obj === 'object' && obj !== null) {
          for (const [k, v] of Object.entries(obj)) { uniqueKeys.add(k); collectKeys(v); }
        }
      };
      collectKeys(pruned);
      if (uniqueKeys.size === 0) return text;

      const keyMap = this.generateKeyMap(Array.from(uniqueKeys));
      const valueMap = this.buildValueMap(pruned);

      // Step 3: Rebuild with shortened keys AND deduped values
      const rebuild = (obj) => {
        if (Array.isArray(obj)) return obj.map(rebuild);
        if (typeof obj === 'object' && obj !== null) {
          const out = {};
          for (const [k, v] of Object.entries(obj)) {
            out[keyMap[k] || k] = rebuild(v);
          }
          return out;
        }
        if (typeof obj === 'string' && valueMap[obj]) return valueMap[obj];
        return obj;
      };

      const shredded = rebuild(pruned);

      // Build key map header
      const keyMapStr = Object.entries(keyMap)
        .filter(([k, v]) => k !== v)
        .map(([k, v]) => `${v}=${k}`)
        .join(' ');

      // Build value map header
      const valMapStr = Object.entries(valueMap)
        .map(([v, alias]) => `${alias}=${JSON.stringify(v)}`)
        .join(' ');

      const header = [
        keyMapStr ? `[K:${keyMapStr}]` : '',
        valMapStr ? `[V:${valMapStr}]` : '',
      ].filter(Boolean).join(' ');

      const compactJson = JSON.stringify(shredded);
      const result = header ? `${header}\n${compactJson}` : compactJson;

      // Only return shredded version if it's actually shorter
      return result.length < text.length ? result : text;

    } catch (e) {
      return text;
    }
  }
}

module.exports = new JSONShredder();
