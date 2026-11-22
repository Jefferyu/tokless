'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { generateFileSkeleton } = require('../tools/repo-skeleton/lib/skeleton');

function withTempFile(fileName, content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokless-skel-'));
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, content, 'utf8');
  try {
    return fn(filePath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('parseCFamily keeps outer class methods after nested static class and supports dotted/generic Java return types', () => {
  const javaCode = [
    'package com.example.demo;',
    '',
    'public class OrderService {',
    '    private final Runnable task = new Runnable() {',
    '        @Override',
    '        public void run() {',
    '            System.out.println("noop");',
    '        }',
    '    };',
    '',
    '    public Result.Obj<Resp.CreateOrder> createOrder(Req.CreateOrder req) {',
    '        return null;',
    '    }',
    '',
    '    private static class HelperItem {',
    '        private String id;',
    '        public String getId() {',
    '            return id;',
    '        }',
    '    }',
    '',
    '    public Map<String, Object> querySummary(String id)',
    '            throws java.io.IOException {',
    '        return null;',
    '    }',
    '',
    '    @Override public Result<?> cancelOrder(String id) {',
    '        return null;',
    '    }',
    '}',
  ].join('\n');

  withTempFile('OrderService.java', javaCode, (filePath) => {
    const res = generateFileSkeleton(filePath);
    const names = res.items.map((it) => `${it.kind}:${it.name}:d${it.depth}`);

    assert.ok(names.includes('class:OrderService:d0'), `missing outer class: ${names}`);
    assert.ok(names.includes('method:createOrder:d1'), `missing dotted generic method: ${names}`);
    assert.ok(names.includes('class:HelperItem:d1'), `missing nested static class: ${names}`);
    assert.ok(names.includes('method:getId:d2'), `missing nested class method: ${names}`);
    assert.ok(names.includes('method:querySummary:d1'), `missing method after inner class: ${names}`);
    assert.ok(names.includes('method:cancelOrder:d1'), `missing wildcard/inline-annotated method: ${names}`);
    assert.ok(!names.some((n) => n.includes('Runnable')), `should not treat anonymous field assignment as method: ${names}`);
  });
});

test('parseJsTs extracts functions and classes inside top-level IIFE wrappers without affecting plain top-level functions', () => {
  const iifeJs = [
    '(function (global) {',
    "    'use strict';",
    '',
    '    function apiBase() {',
    '        return "";',
    '    }',
    '',
    '    async function postJson(url, payload) {',
    '        return fetch(url, { body: JSON.stringify(payload) });',
    '    }',
    '',
    '    const formatName = (name) => {',
    '        return String(name || "").trim();',
    '    };',
    '',
    '    class LocalCache {',
    '        get(key) {',
    '            return key;',
    '        }',
    '    }',
    '',
    '    global.Demo = { apiBase, postJson, formatName, LocalCache };',
    '})(window);',
  ].join('\n');

  withTempFile('legacy-common.js', iifeJs, (filePath) => {
    const res = generateFileSkeleton(filePath);
    const names = res.items.map((it) => `${it.kind}:${it.name}`);

    assert.ok(names.includes('function:apiBase'), `missing apiBase: ${names}`);
    assert.ok(names.includes('function:postJson'), `missing postJson: ${names}`);
    assert.ok(names.includes('function:formatName'), `missing formatName: ${names}`);
    assert.ok(names.includes('class:LocalCache'), `missing LocalCache: ${names}`);
    assert.ok(names.includes('method:get'), `missing LocalCache.get: ${names}`);
  });

  const arrowIifeJs = [
    '(() => {',
    '    function initWidget() {',
    '        return 1;',
    '    }',
    '})();',
  ].join('\n');

  withTempFile('arrow-iife.js', arrowIifeJs, (filePath) => {
    const res = generateFileSkeleton(filePath);
    assert.ok(
      res.items.some((it) => it.kind === 'function' && it.name === 'initWidget'),
      'should extract function inside arrow IIFE'
    );
  });
});
