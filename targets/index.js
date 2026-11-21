'use strict';

const antigravity = require('./antigravity');
const claudeCode = require('./claude-code');
const codex = require('./codex');

// Community PR extension point: register single-file host adapters (e.g. Cursor, Windsurf, Cline, OpenCode) here.
const TARGET_ADAPTERS = [antigravity, claudeCode, codex];

function listTargets() {
  return TARGET_ADAPTERS.slice();
}

function resolveTargetAdapter(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return null;
  for (const adapter of TARGET_ADAPTERS) {
    if (adapter.id === normalized || (Array.isArray(adapter.aliases) && adapter.aliases.includes(normalized))) {
      return adapter;
    }
  }
  return null;
}

function resolveTargets(targetSpec, options = {}) {
  const mode = options.mode || 'auto';
  if (targetSpec) {
    const rawParts = String(targetSpec)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (rawParts.includes('all')) {
      return listTargets();
    }

    const selected = [];
    const seen = new Set();
    for (const part of rawParts) {
      const adapter = resolveTargetAdapter(part);
      if (!adapter) {
        const supported = TARGET_ADAPTERS.map((a) => a.aliases[0]).concat(['all']).join(', ');
        throw new Error(`未知宿主目标 "${part}"。可选值: ${supported}`);
      }
      if (!seen.has(adapter.id)) {
        seen.add(adapter.id);
        selected.push(adapter);
      }
    }
    return selected;
  }

  if (mode === 'antigravity-only') {
    return [antigravity];
  }

  const detected = [antigravity];
  for (const adapter of TARGET_ADAPTERS) {
    if (adapter.id === 'antigravity') continue;
    if (typeof adapter.detect === 'function' && adapter.detect(options)) {
      detected.push(adapter);
    }
  }
  return detected;
}

module.exports = {
  TARGET_ADAPTERS,
  listTargets,
  resolveTargetAdapter,
  resolveTargets,
  antigravity,
  claudeCode,
  codex,
};
