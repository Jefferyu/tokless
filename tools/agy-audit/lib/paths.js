const path = require('path');
const os = require('os');
const fs = require('fs');

function getAntigravityDir() {
  const home = os.homedir();
  const dir = path.join(home, '.gemini', 'antigravity');
  if (!fs.existsSync(dir)) {
    throw new Error(`Antigravity directory not found at: ${dir}`);
  }
  return dir;
}

function getSummariesDbPath() {
  const agyDir = getAntigravityDir();
  return path.join(agyDir, 'conversation_summaries.db');
}

function isSafeSingleDirName(name) {
  if (!name || name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return false;
  return path.basename(name) === name;
}

function getConversationBrainDir(conversationId) {
  if (typeof conversationId !== 'string' || !isSafeSingleDirName(conversationId.trim())) {
    throw new Error(`Invalid conversation ID: "${conversationId}"`);
  }
  const brainRoot = path.resolve(getAntigravityDir(), 'brain');
  const resolved = path.resolve(brainRoot, conversationId.trim());
  if (path.dirname(resolved) !== brainRoot) {
    throw new Error(`Conversation path escapes brain directory: "${conversationId}"`);
  }
  return resolved;
}

function resolveConversationId(idOrPrefix) {
  if (!idOrPrefix || typeof idOrPrefix !== 'string') {
    throw new Error('Conversation ID or prefix is required.');
  }
  const trimmed = idOrPrefix.trim();
  const query = trimmed.toLowerCase();
  if (!query) {
    throw new Error('Conversation ID or prefix is empty.');
  }
  if (!isSafeSingleDirName(trimmed)) {
    throw new Error(`Invalid conversation ID or prefix: "${idOrPrefix}"`);
  }

  const brainRoot = path.join(getAntigravityDir(), 'brain');
  const resolvedBrainRoot = path.resolve(brainRoot);
  for (const candidate of new Set([trimmed, query])) {
    const directDir = path.resolve(resolvedBrainRoot, candidate);
    if (path.dirname(directDir) !== resolvedBrainRoot) continue;
    try {
      if (fs.existsSync(directDir) && fs.statSync(directDir).isDirectory()) {
        return candidate;
      }
    } catch (_) {
      // Fall back to scanning brainRoot below
    }
  }
  if (fs.existsSync(brainRoot)) {
    const entries = fs.readdirSync(brainRoot, { withFileTypes: true });
    const exact = entries.find(e => e.isDirectory() && e.name.toLowerCase() === query);
    if (exact) return exact.name;

    const matches = entries
      .filter(e => e.isDirectory() && e.name.toLowerCase().startsWith(query))
      .map(e => e.name);

    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(`Ambiguous conversation ID prefix "${idOrPrefix}" (${matches.length} matches): ${matches.slice(0, 5).join(', ')}`);
    }
  }

  // Fallback to SQLite summaries DB if available
  const dbPath = getSummariesDbPath();
  if (fs.existsSync(dbPath)) {
    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      const rows = db.prepare(
        `SELECT conversation_id FROM conversation_summaries WHERE conversation_id = ? OR conversation_id LIKE ? LIMIT 10`
      ).all(idOrPrefix, `${idOrPrefix}%`);
      db.close();
      if (rows.length === 1) return rows[0].conversation_id;
      if (rows.length > 1) {
        const ids = rows.map(r => r.conversation_id);
        throw new Error(`Ambiguous conversation ID prefix "${idOrPrefix}" in DB: ${ids.slice(0, 5).join(', ')}`);
      }
    } catch (e) {
      if (e.message.startsWith('Ambiguous conversation ID')) throw e;
    }
  }

  return idOrPrefix;
}

function getTranscriptInfo(conversationId) {
  const brainDir = getConversationBrainDir(conversationId);
  const fullLog = path.join(brainDir, '.system_generated', 'logs', 'transcript_full.jsonl');
  if (fs.existsSync(fullLog)) {
    return { filePath: fullLog, logType: 'transcript_full.jsonl', bytes: fs.statSync(fullLog).size };
  }
  const compactLog = path.join(brainDir, '.system_generated', 'logs', 'transcript.jsonl');
  if (fs.existsSync(compactLog)) {
    return { filePath: compactLog, logType: 'transcript.jsonl', bytes: fs.statSync(compactLog).size };
  }
  return null;
}

function getConversationMeta(conversationId) {
  const dbPath = getSummariesDbPath();
  if (!fs.existsSync(dbPath)) return null;
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare(
      `SELECT conversation_id, title, step_count, last_modified_time, workspace_uris, status
       FROM conversation_summaries WHERE conversation_id = ? LIMIT 1`
    ).get(conversationId);
    db.close();
    if (!row) return null;

    let workspace = '';
    if (row.workspace_uris) {
      try {
        const list = JSON.parse(row.workspace_uris);
        if (Array.isArray(list)) {
          workspace = list.map(u => decodeURIComponent(u).replace(/^file:\/\/\/?/, '')).join(', ');
        }
      } catch {
        workspace = decodeURIComponent(row.workspace_uris).replace(/^file:\/\/\/?/, '');
      }
    }
    return {
      conversationId: row.conversation_id,
      title: row.title || 'Untitled Session',
      workspace,
      lastModifiedTime: row.last_modified_time,
      stepCount: row.step_count || 0,
      status: row.status
    };
  } catch {
    return null;
  }
}

module.exports = {
  getAntigravityDir,
  getSummariesDbPath,
  getConversationBrainDir,
  resolveConversationId,
  getTranscriptInfo,
  getConversationMeta
};
