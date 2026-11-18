'use strict';

const fs = require('fs');
const path = require('path');

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'exports',
  '.next',
  'target',
  '__pycache__',
]);

const JS_TS_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);
const C_FAMILY_EXTS = new Set(['.java', '.c', '.cpp', '.cc', '.h', '.hpp', '.cs']);
const SFC_EXTS = new Set(['.vue', '.svelte']);
const SUPPORTED_EXTS = new Set([
  ...JS_TS_EXTS,
  '.py',
  '.go',
  '.rs',
  '.md',
  ...C_FAMILY_EXTS,
  ...SFC_EXTS,
]);

const CONTROL_KEYWORDS = new Set([
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'catch',
  'finally',
  'try',
  'with',
  'return',
  'throw',
  'new',
  'typeof',
  'delete',
  'await',
  'yield',
  'sizeof',
]);

const REGEX_PREV_KEYWORDS = new Set([
  'return',
  'throw',
  'case',
  'typeof',
  'void',
  'delete',
  'in',
  'instanceof',
  'new',
  'await',
  'yield',
  'else',
  'do',
  'of',
]);

/**
 * 估算文本的 Token 数量（纯 JS 零依赖，兼顾英文代码与中文字符）
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++;
    }
  }
  const nonCjk = text.length - cjk;
  return Math.max(1, Math.ceil(cjk * 1.5 + nonCjk / 3.8));
}

/**
 * 按行切分文件内容，对齐编辑器行号（忽略末尾单个换行产生的空行）
 * @param {string} content
 * @returns {string[]}
 */
function splitLines(content) {
  if (!content) return [];
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * 词法预处理：剥离注释、字符串字面量、模板字符串内部文本与正则字面量，保留精确的括号与语法骨架
 * @param {string[]} lines
 * @param {'js'|'go'|'rust'|'c'} lang
 */
function preprocessBraceLines(lines, lang) {
  const result = new Array(lines.length);
  let braceDepth = 0;
  let parenDepth = 0;
  let inBlockComment = false;
  let blockCommentNested = 0; // Rust 支持嵌套 /* /* */ */
  let inBacktick = false; // JS 模板字符串 或 Go raw string
  let templateExprBraceStack = []; // JS `${ ... }` 嵌套栈
  let inRustRawString = false;
  let rustRawHashes = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    const len = raw.length;
    const out = [];
    const braceStart = braceDepth;
    const parenStart = parenDepth;

    let inLineComment = false;
    let inStringQuote = null; // '\'' or '"'
    let inRegex = false;
    let inRegexClass = false;
    let prevSigToken = ''; // 上一个显著 token（用于 JS 正则 vs 除法判断）

    for (let i = 0; i < len; i++) {
      const ch = raw[i];
      const next = i + 1 < len ? raw[i + 1] : '';

      if (inLineComment) {
        out.push(' ');
        continue;
      }

      if (inBlockComment) {
        if (lang === 'rust' && ch === '/' && next === '*') {
          blockCommentNested++;
          out.push('  ');
          i++;
          continue;
        }
        if (ch === '*' && next === '/') {
          out.push('  ');
          i++;
          if (lang === 'rust' && blockCommentNested > 0) {
            blockCommentNested--;
          } else {
            inBlockComment = false;
          }
          continue;
        }
        out.push(' ');
        continue;
      }

      if (inRustRawString) {
        if (ch === '"') {
          let hashes = 0;
          while (i + 1 + hashes < len && raw[i + 1 + hashes] === '#' && hashes < rustRawHashes) {
            hashes++;
          }
          if (hashes === rustRawHashes) {
            out.push('"');
            for (let h = 0; h < hashes; h++) out.push('#');
            i += hashes;
            inRustRawString = false;
            prevSigToken = '"';
            continue;
          }
        }
        out.push(' ');
        continue;
      }

      if (inBacktick) {
        if (lang === 'js') {
          if (ch === '\\') {
            out.push('  ');
            i++;
            continue;
          }
          if (ch === '$' && next === '{') {
            templateExprBraceStack.push(braceDepth);
            braceDepth++;
            out.push(' ');
            out.push('{');
            i++;
            inBacktick = false;
            prevSigToken = '{';
            continue;
          }
          if (ch === '`') {
            inBacktick = false;
            out.push('`');
            prevSigToken = '`';
            continue;
          }
          out.push(' ');
          continue;
        } else {
          // Go raw string `...` 无转义
          if (ch === '`') {
            inBacktick = false;
            out.push('`');
            prevSigToken = '`';
          } else {
            out.push(' ');
          }
          continue;
        }
      }

      if (inStringQuote) {
        if (ch === '\\') {
          out.push('  ');
          i++;
          continue;
        }
        if (ch === inStringQuote) {
          out.push(ch);
          inStringQuote = null;
          prevSigToken = ch;
          continue;
        }
        out.push(' ');
        continue;
      }

      if (inRegex) {
        if (ch === '\\') {
          out.push('  ');
          i++;
          continue;
        }
        if (ch === '[') {
          inRegexClass = true;
          out.push(' ');
          continue;
        }
        if (ch === ']' && inRegexClass) {
          inRegexClass = false;
          out.push(' ');
          continue;
        }
        if (ch === '/' && !inRegexClass) {
          inRegex = false;
          out.push('/');
          prevSigToken = '/';
          // 跳过 flags 如 g, i, m, s, u, y, d
          while (i + 1 < len && /[a-z]/i.test(raw[i + 1])) {
            out.push(' ');
            i++;
          }
          continue;
        }
        out.push(' ');
        continue;
      }

      // 注释开始
      if (ch === '/' && next === '/') {
        inLineComment = true;
        out.push('  ');
        i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        blockCommentNested = 0;
        out.push('  ');
        i++;
        continue;
      }

      // Rust raw string r"..." / r#"..."# / br#"..."#
      if (lang === 'rust' && (ch === 'r' || (ch === 'b' && next === 'r'))) {
        let pos = ch === 'b' ? i + 2 : i + 1;
        let hashes = 0;
        while (pos < len && raw[pos] === '#') {
          hashes++;
          pos++;
        }
        if (pos < len && raw[pos] === '"' && (i === 0 || !/[A-Za-z0-9_]/.test(raw[i - 1]))) {
          inRustRawString = true;
          rustRawHashes = hashes;
          for (let k = i; k <= pos; k++) out.push(raw[k]);
          i = pos;
          continue;
        }
      }

      // JS regex 字面量检测
      if (lang === 'js' && ch === '/') {
        const startsRegex =
          prevSigToken === '' ||
          '([{,;:=!?&|^~+-*%<>'.includes(prevSigToken) ||
          REGEX_PREV_KEYWORDS.has(prevSigToken);
        if (startsRegex) {
          inRegex = true;
          inRegexClass = false;
          out.push('/');
          continue;
        }
      }

      // 字符串开始
      if (ch === '"') {
        inStringQuote = '"';
        out.push('"');
        continue;
      }

      if (ch === "'") {
        if (lang === 'rust') {
          // 区分 Rust 字符字面量 ('a', '\n', '\x7f', '\u{1234}') 与生命周期 ('a, 'static)
          const tail = raw.slice(i);
          const charLitMatch = tail.match(/^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F_]+\}|.)|[^'\\])'/);
          if (charLitMatch) {
            out.push("'");
            for (let k = 1; k < charLitMatch[0].length - 1; k++) out.push(' ');
            out.push("'");
            i += charLitMatch[0].length - 1;
            prevSigToken = "'";
            continue;
          }
          // 否则视为 Rust lifetime
          out.push("'");
          prevSigToken = "'";
          continue;
        }
        inStringQuote = "'";
        out.push("'");
        continue;
      }

      if (ch === '`' && (lang === 'js' || lang === 'go')) {
        inBacktick = true;
        out.push('`');
        continue;
      }

      // 括号计数
      if (ch === '{') {
        braceDepth++;
      } else if (ch === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        if (
          lang === 'js' &&
          templateExprBraceStack.length > 0 &&
          braceDepth === templateExprBraceStack[templateExprBraceStack.length - 1]
        ) {
          templateExprBraceStack.pop();
          out.push('}');
          inBacktick = true;
          prevSigToken = '}';
          continue;
        }
      } else if (ch === '(') {
        parenDepth++;
      } else if (ch === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
      }

      out.push(ch);

      // 更新 prevSigToken
      if (!/\s/.test(ch)) {
        if (/[A-Za-z0-9_$]/.test(ch)) {
          if (i > 0 && /[A-Za-z0-9_$]/.test(raw[i - 1]) && /[A-Za-z0-9_$]/.test(prevSigToken)) {
            prevSigToken += ch;
          } else {
            prevSigToken = ch;
          }
        } else {
          prevSigToken = ch;
        }
      }
    }

    result[lineIdx] = {
      raw,
      clean: out.join(''),
      braceStart,
      braceEnd: braceDepth,
      parenStart,
      parenEnd: parenDepth,
    };
  }

  return result;
}

/**
 * 向上/向后查找声明块的精确结束行索引（0-based）
 * @param {Array} analyzed
 * @param {number} startIdx
 * @param {'js'|'go'|'rust'|'c'} lang
 * @returns {{ endIdx: number, headerEndIdx: number, hasBlock: boolean }}
 */
function findDeclarationRange(analyzed, startIdx, lang) {
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let blockStarted = false;
  let headerEndIdx = startIdx;

  for (let j = startIdx; j < analyzed.length; j++) {
    const line = analyzed[j].clean;
    for (let k = 0; k < line.length; k++) {
      const ch = line[k];
      if (ch === '(') paren++;
      else if (ch === ')') paren = Math.max(0, paren - 1);
      else if (ch === '[') bracket++;
      else if (ch === ']') bracket = Math.max(0, bracket - 1);
      else if (ch === '{') {
        if (!blockStarted && paren === 0 && bracket === 0) {
          blockStarted = true;
          headerEndIdx = j;
        }
        brace++;
      } else if (ch === '}') {
        brace = Math.max(0, brace - 1);
        if (blockStarted && brace === 0) {
          // 如果同一行后面紧跟着另一个 `{`（例如 TS 返回类型 `{ a: string } {`），继续扫完本行
          const rest = line.slice(k + 1).trim();
          if (rest.startsWith('{') || rest.startsWith('=>')) {
            blockStarted = false;
          } else {
            return { endIdx: j, headerEndIdx, hasBlock: true };
          }
        }
      }
    }

    if (blockStarted && brace === 0) {
      return { endIdx: j, headerEndIdx, hasBlock: true };
    }

    if (!blockStarted && brace === 0 && paren === 0 && bracket === 0) {
      const trimmed = line.trim();
      if (trimmed.endsWith(';')) {
        return { endIdx: j, headerEndIdx: j, hasBlock: false };
      }
      // 如果末尾是延续符号，则继续下一行
      if (
        trimmed.endsWith('=>') ||
        trimmed.endsWith('=') ||
        trimmed.endsWith(':') ||
        trimmed.endsWith(',') ||
        trimmed.endsWith('(') ||
        trimmed.endsWith('|') ||
        trimmed.endsWith('&') ||
        /\b(?:extends|implements|where)\s*$/.test(trimmed)
      ) {
        continue;
      }

      // 偷看下一个非空 clean 行是否以 `{`、`=>`、`|`、`&`、`where` 开头
      let nextTrimmed = '';
      for (let n = j + 1; n < analyzed.length && n <= j + 4; n++) {
        const t = analyzed[n].clean.trim();
        if (t) {
          nextTrimmed = t;
          break;
        }
      }
      if (
        nextTrimmed.startsWith('{') ||
        nextTrimmed.startsWith('=>') ||
        nextTrimmed.startsWith('|') ||
        nextTrimmed.startsWith('&') ||
        (lang === 'rust' && nextTrimmed.startsWith('where'))
      ) {
        continue;
      }

      return { endIdx: j, headerEndIdx: j, hasBlock: false };
    }
  }

  return { endIdx: analyzed.length - 1, headerEndIdx, hasBlock: blockStarted };
}

/**
 * 构建紧凑的单行签名字符串（剥离函数体 `{ ... }` 与多余空白）
 * @param {Array} analyzed
 * @param {number} startIdx
 * @param {number} headerEndIdx
 * @param {boolean} hasBlock
 * @param {number} [maxLen=140]
 * @returns {string}
 */
function buildCompactSignature(analyzed, startIdx, headerEndIdx, hasBlock, maxLen = 140) {
  let sig = '';

  if (hasBlock) {
    let p = 0;
    let b = 0;
    let cutLine = -1;
    let cutCol = -1;

    for (let i = startIdx; i <= headerEndIdx; i++) {
      const cleanLine = analyzed[i].clean;
      for (let k = 0; k < cleanLine.length; k++) {
        const ch = cleanLine[k];
        if (ch === '(') p++;
        else if (ch === ')') p = Math.max(0, p - 1);
        else if (ch === '[') b++;
        else if (ch === ']') b = Math.max(0, b - 1);
        else if (ch === '{' && p === 0 && b === 0) {
          const after = cleanLine.slice(k + 1);
          const closeIdx = after.indexOf('}');
          if (closeIdx !== -1 && after.slice(closeIdx + 1).trim().startsWith('{')) {
            continue;
          }
          cutLine = i;
          cutCol = k;
          break;
        }
      }
      if (cutLine !== -1) break;
    }

    const effectiveEnd = cutLine !== -1 ? cutLine : headerEndIdx;
    const sliceEnd = Math.min(effectiveEnd, startIdx + 5);
    const parts = [];
    for (let i = startIdx; i <= sliceEnd; i++) {
      let rawLine = analyzed[i].raw;
      if (i === cutLine && cutCol !== -1) {
        rawLine = rawLine.slice(0, cutCol);
      }
      const trimmed = rawLine.trim();
      if (trimmed) parts.push(trimmed);
    }
    sig = parts.join(' ').replace(/\s+/g, ' ').trim();
  } else {
    const sliceEnd = Math.min(headerEndIdx, startIdx + 5);
    const parts = [];
    for (let i = startIdx; i <= sliceEnd; i++) {
      const trimmed = analyzed[i].raw.trim();
      if (trimmed) parts.push(trimmed);
    }
    sig = parts.join(' ').replace(/\s+/g, ' ').replace(/;+\s*$/, '').trim();
  }

  if (sig.length > maxLen) {
    sig = sig.slice(0, maxLen - 3).trimEnd() + '...';
  }
  return sig;
}

/**
 * 在范围内判断 clean 文本是否包含 `=>` 或 `function`（在 top-level assignment 中）
 */
function hasFunctionRhs(analyzed, startIdx, headerEndIdx) {
  let text = '';
  for (let i = startIdx; i <= Math.min(headerEndIdx, startIdx + 5); i++) {
    text += ' ' + analyzed[i].clean;
  }
  return /=>/.test(text) || /=\s*(?:async\s+)?function\b/.test(text);
}

/**
 * 解析 JS / TS / JSX / TSX / MJS / CJS 文件
 */
function parseJsTs(lines, lineOffset = 0) {
  const analyzed = preprocessBraceLines(lines, 'js');
  const items = [];
  let activeClassEnd = -1;
  let activeClassBodyDepth = -1;

  for (let i = 0; i < analyzed.length; i++) {
    const info = analyzed[i];
    const trimmed = info.clean.trim();
    if (!trimmed) continue;

    if (activeClassEnd !== -1 && i > activeClassEnd) {
      activeClassEnd = -1;
      activeClassBodyDepth = -1;
    }

    const inClassBody =
      activeClassEnd !== -1 &&
      i <= activeClassEnd &&
      info.braceStart === activeClassBodyDepth;

    // 1. 顶层声明 (braceStart === 0)
    if (info.braceStart === 0) {
      let kind = null;
      let name = '';

      let m;
      if (
        (m = trimmed.match(
          /^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/
        )) ||
        (m = trimmed.match(/^(?:module\.)?exports\s*=\s*(?:abstract\s+)?class\s*([A-Za-z_$][\w$]*)?/))
      ) {
        kind = 'class';
        name = m[1] || 'default';
      } else if (
        (m = trimmed.match(
          /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/
        ))
      ) {
        kind = 'interface';
        name = m[1];
      } else if (
        (m = trimmed.match(
          /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\b/
        ))
      ) {
        kind = 'type';
        name = m[1];
      } else if (
        (m = trimmed.match(
          /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/
        ))
      ) {
        kind = 'enum';
        name = m[1];
      } else if (
        (m = trimmed.match(
          /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?namespace\s+([A-Za-z_$][\w$]*)/
        ))
      ) {
        kind = 'namespace';
        name = m[1];
      } else if (
        (m = trimmed.match(
          /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*(?:<[^>]*>)?\s*\(/
        ))
      ) {
        kind = 'function';
        name = m[1] || 'default';
      } else if (
        (m = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/))
      ) {
        const rangeProbe = findDeclarationRange(analyzed, i, 'js');
        if (hasFunctionRhs(analyzed, i, rangeProbe.headerEndIdx)) {
          kind = 'function';
          name = m[1];
        } else if (/=\s*(?:abstract\s+)?class\b/.test(trimmed)) {
          kind = 'class';
          name = m[1];
        }
      } else if (
        (m = trimmed.match(/^(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/))
      ) {
        const rangeProbe = findDeclarationRange(analyzed, i, 'js');
        if (hasFunctionRhs(analyzed, i, rangeProbe.headerEndIdx)) {
          kind = 'function';
          name = m[1];
        }
      } else if (/^module\.exports\s*=\s*\{/.test(trimmed)) {
        kind = 'export';
        name = 'module.exports';
      } else if (/^export\s+default\s+(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(trimmed)) {
        kind = 'function';
        name = 'default';
      } else if (/^export\s+default\s+(?:async\s+)?function\b/.test(trimmed)) {
        kind = 'function';
        name = 'default';
      }

      if (kind) {
        const range = findDeclarationRange(analyzed, i, 'js');
        let signature = buildCompactSignature(analyzed, i, range.headerEndIdx, range.hasBlock);
        if (kind === 'export' && name === 'module.exports') {
          // 对 module.exports = { a, b, c } 做紧凑汇总
          const exportNames = [];
          for (let k = i; k <= range.endIdx; k++) {
            const lineClean = analyzed[k].clean.replace(/^module\.exports\s*=\s*\{?/, '').replace(/\}?;?\s*$/, '');
            for (const token of lineClean.split(',')) {
              const keyMatch = token.trim().match(/^([A-Za-z_$][\w$]*)/);
              if (keyMatch) exportNames.push(keyMatch[1]);
            }
          }
          if (exportNames.length > 0) {
            const joined = exportNames.join(', ');
            signature =
              joined.length > 100
                ? `module.exports = { ${joined.slice(0, 97)}... }`
                : `module.exports = { ${joined} }`;
          }
        }

        items.push({
          kind,
          name,
          signature,
          startLine: i + 1 + lineOffset,
          endLine: range.endIdx + 1 + lineOffset,
          depth: 0,
        });

        if (kind === 'class' && range.hasBlock) {
          activeClassEnd = range.endIdx;
          activeClassBodyDepth = 1;
          i = range.headerEndIdx; // 继续扫描 class 内部方法
        } else {
          i = range.endIdx;
        }
        continue;
      }
    }

    // 2. Class 内部方法与箭头字段
    if (inClassBody) {
      let methodMatch = trimmed.match(
        /^(?:(?:public|private|protected|static|async|readonly|override|abstract|get|set)\s+)*\*?\s*(#?[A-Za-z_$][\w$]*|\[[^\]]+\])\s*(?:<[^>]*>)?\s*\(/
      );
      let isArrowField = false;
      if (!methodMatch) {
        methodMatch = trimmed.match(
          /^(?:(?:public|private|protected|static|readonly|override)\s+)*(#?[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/
        );
        if (methodMatch) isArrowField = true;
      }

      if (methodMatch) {
        const methodName = methodMatch[1];
        if (!CONTROL_KEYWORDS.has(methodName)) {
          const range = findDeclarationRange(analyzed, i, 'js');
          if (range.hasBlock || isArrowField || trimmed.endsWith(';')) {
            const signature = buildCompactSignature(
              analyzed,
              i,
              range.headerEndIdx,
              range.hasBlock
            );
            items.push({
              kind: 'method',
              name: methodName,
              signature,
              startLine: i + 1 + lineOffset,
              endLine: range.endIdx + 1 + lineOffset,
              depth: 1,
            });
            i = range.endIdx;
            continue;
          }
        }
      }
    }
  }

  return items;
}

/**
 * 解析 Go 文件
 */
function parseGo(lines) {
  const analyzed = preprocessBraceLines(lines, 'go');
  const items = [];

  for (let i = 0; i < analyzed.length; i++) {
    const info = analyzed[i];
    if (info.braceStart !== 0) continue;
    const trimmed = info.clean.trim();
    if (!trimmed) continue;

    let kind = null;
    let name = '';
    let m;

    if ((m = trimmed.match(/^func\s+(?:\([^)]+\)\s+)?([A-Za-z_]\w*)\b/))) {
      kind = 'func';
      name = m[1];
    } else if ((m = trimmed.match(/^type\s+([A-Za-z_]\w*)\s+struct\b/))) {
      kind = 'struct';
      name = m[1];
    } else if ((m = trimmed.match(/^type\s+([A-Za-z_]\w*)\s+interface\b/))) {
      kind = 'interface';
      name = m[1];
    } else if ((m = trimmed.match(/^type\s+([A-Za-z_]\w*)\b/))) {
      kind = 'type';
      name = m[1];
    }

    if (kind) {
      const range = findDeclarationRange(analyzed, i, 'go');
      const signature = buildCompactSignature(analyzed, i, range.headerEndIdx, range.hasBlock);
      items.push({
        kind,
        name,
        signature,
        startLine: i + 1,
        endLine: range.endIdx + 1,
        depth: 0,
      });
      i = range.endIdx;
    }
  }

  return items;
}

/**
 * 解析 Rust 文件
 */
function parseRust(lines) {
  const analyzed = preprocessBraceLines(lines, 'rust');
  const items = [];
  let containerEnd = -1;
  let containerBodyDepth = -1;

  for (let i = 0; i < analyzed.length; i++) {
    const info = analyzed[i];
    const trimmed = info.clean.trim();
    if (!trimmed) continue;

    if (containerEnd !== -1 && i > containerEnd) {
      containerEnd = -1;
      containerBodyDepth = -1;
    }

    const inContainer =
      containerEnd !== -1 && i <= containerEnd && info.braceStart === containerBodyDepth;

    if (info.braceStart !== 0 && !inContainer) continue;

    let kind = null;
    let name = '';
    let m;

    if (
      (m = trimmed.match(
        /^(?:pub(?:\([^)]+\))?\s+)?(?:default\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+(?:"[^"]+"\s+)?)?fn\s+([A-Za-z_]\w*)/
      ))
    ) {
      kind = 'fn';
      name = m[1];
    } else if ((m = trimmed.match(/^(?:pub(?:\([^)]+\))?\s+)?struct\s+([A-Za-z_]\w*)/))) {
      kind = 'struct';
      name = m[1];
    } else if ((m = trimmed.match(/^(?:pub(?:\([^)]+\))?\s+)?enum\s+([A-Za-z_]\w*)/))) {
      kind = 'enum';
      name = m[1];
    } else if ((m = trimmed.match(/^(?:pub(?:\([^)]+\))?\s+)?trait\s+([A-Za-z_]\w*)/))) {
      kind = 'trait';
      name = m[1];
    } else if ((m = trimmed.match(/^(?:unsafe\s+)?impl\b(.*)$/))) {
      kind = 'impl';
      name = m[1].replace(/\{.*$/, '').trim() || 'impl';
    } else if ((m = trimmed.match(/^(?:pub(?:\([^)]+\))?\s+)?mod\s+([A-Za-z_]\w*)/))) {
      kind = 'mod';
      name = m[1];
    } else if ((m = trimmed.match(/^(?:pub(?:\([^)]+\))?\s+)?type\s+([A-Za-z_]\w*)/))) {
      kind = 'type';
      name = m[1];
    } else if ((m = trimmed.match(/^(?:pub(?:\([^)]+\))?\s+)?macro_rules!\s+([A-Za-z_]\w*)/))) {
      kind = 'macro';
      name = m[1];
    }

    if (kind) {
      const range = findDeclarationRange(analyzed, i, 'rust');
      const signature = buildCompactSignature(analyzed, i, range.headerEndIdx, range.hasBlock);
      const depth = inContainer ? 1 : 0;
      items.push({
        kind,
        name,
        signature,
        startLine: i + 1,
        endLine: range.endIdx + 1,
        depth,
      });

      if (
        !inContainer &&
        (kind === 'impl' || kind === 'trait' || kind === 'mod') &&
        range.hasBlock
      ) {
        containerEnd = range.endIdx;
        containerBodyDepth = 1;
        i = range.headerEndIdx;
      } else {
        i = range.endIdx;
      }
    }
  }

  return items;
}

/**
 * 解析 Java / C / C++ / C# 文件
 */
function parseCFamily(lines) {
  const analyzed = preprocessBraceLines(lines, 'c');
  const items = [];
  let classEnd = -1;
  let classDepth = -1;

  for (let i = 0; i < analyzed.length; i++) {
    const info = analyzed[i];
    const trimmed = info.clean.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (classEnd !== -1 && i > classEnd) {
      classEnd = -1;
      classDepth = -1;
    }

    const inClass = classEnd !== -1 && i <= classEnd && info.braceStart === classDepth;
    if (info.braceStart !== 0 && !inClass) continue;

    let kind = null;
    let name = '';
    let m;

    if (
      (m = trimmed.match(
        /^(?:(?:public|private|protected|internal|abstract|final|static|sealed|partial|export)\s+)*(class|interface|struct|enum|namespace)\s+([A-Za-z_]\w*)/
      ))
    ) {
      kind = m[1];
      name = m[2];
    } else if (
      (m = trimmed.match(/^(?:[\w:<>&*\[\]\s]+?\s+)?([A-Za-z_~]\w*)\s*\([^;]*$/))
    ) {
      const candidate = m[1];
      if (!CONTROL_KEYWORDS.has(candidate)) {
        const rangeProbe = findDeclarationRange(analyzed, i, 'c');
        if (rangeProbe.hasBlock) {
          kind = inClass ? 'method' : 'function';
          name = candidate;
        }
      }
    }

    if (kind) {
      const range = findDeclarationRange(analyzed, i, 'c');
      const signature = buildCompactSignature(analyzed, i, range.headerEndIdx, range.hasBlock);
      items.push({
        kind,
        name,
        signature,
        startLine: i + 1,
        endLine: range.endIdx + 1,
        depth: inClass ? 1 : 0,
      });

      if (
        (kind === 'class' || kind === 'interface' || kind === 'struct' || kind === 'namespace') &&
        range.hasBlock
      ) {
        classEnd = range.endIdx;
        classDepth = info.braceStart + 1;
        i = range.headerEndIdx;
      } else {
        i = range.endIdx;
      }
    }
  }

  return items;
}

/**
 * 预处理 Python 行（识别三引号字符串与注释，避免 docstring 内的 def/class 误判）
 */
function preprocessPythonLines(lines) {
  const result = new Array(lines.length);
  let tripleQuote = null; // '"""' or "'''"

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const startedInTriple = tripleQuote !== null;
    let inSingle = false;
    let inDouble = false;
    const out = [];

    for (let k = 0; k < raw.length; k++) {
      const ch = raw[k];
      if (tripleQuote) {
        if (raw.slice(k, k + 3) === tripleQuote) {
          tripleQuote = null;
          out.push('   ');
          k += 2;
        } else {
          out.push(' ');
        }
        continue;
      }
      if (inSingle) {
        if (ch === '\\') {
          out.push('  ');
          k++;
          continue;
        }
        if (ch === "'") inSingle = false;
        out.push(' ');
        continue;
      }
      if (inDouble) {
        if (ch === '\\') {
          out.push('  ');
          k++;
          continue;
        }
        if (ch === '"') inDouble = false;
        out.push(' ');
        continue;
      }

      if (ch === '#') {
        while (k < raw.length) {
          out.push(' ');
          k++;
        }
        break;
      }
      if (raw.slice(k, k + 3) === '"""' || raw.slice(k, k + 3) === "'''") {
        tripleQuote = raw.slice(k, k + 3);
        out.push('   ');
        k += 2;
        continue;
      }
      if (ch === "'") {
        inSingle = true;
        out.push("'");
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        out.push('"');
        continue;
      }
      out.push(ch);
    }

    const expanded = raw.replace(/^\t+/, (m) => '    '.repeat(m.length));
    const indent = expanded.length - expanded.trimStart().length;

    result[i] = {
      raw,
      clean: out.join(''),
      indent,
      startedInTriple,
      endedInTriple: tripleQuote !== null,
    };
  }

  return result;
}

/**
 * 解析 Python 文件
 */
function parsePython(lines) {
  const analyzed = preprocessPythonLines(lines);
  const items = [];
  const classStack = []; // [{ indent, endIdx }]

  for (let i = 0; i < analyzed.length; i++) {
    const info = analyzed[i];
    if (info.startedInTriple) continue;

    const trimmed = info.clean.trim();
    if (!trimmed) continue;

    while (classStack.length > 0 && info.indent <= classStack[classStack.length - 1].indent) {
      classStack.pop();
    }

    const m = trimmed.match(/^(class|async\s+def|def)\s+([A-Za-z_]\w*)\b/);
    if (!m) continue;

    const rawKind = m[1];
    const name = m[2];
    const isClass = rawKind === 'class';
    const headerIndent = info.indent;

    // 仅采集顶层 def/class 与 class 内部方法（跳过函数体内的局部嵌套 def，保持骨架紧凑）
    if (headerIndent > 0 && classStack.length === 0) continue;
    if (classStack.length > 1) continue;

    // 查找多行签名结尾的 `:`
    let headerEndIdx = i;
    let paren = 0;
    for (let j = i; j < analyzed.length && j <= i + 10; j++) {
      const c = analyzed[j].clean;
      for (let k = 0; k < c.length; k++) {
        if (c[k] === '(') paren++;
        else if (c[k] === ')') paren = Math.max(0, paren - 1);
      }
      if (paren === 0 && c.trimEnd().endsWith(':')) {
        headerEndIdx = j;
        break;
      }
    }

    // 向下查找缩进块结束行
    let lastContentIdx = headerEndIdx;
    for (let j = headerEndIdx + 1; j < analyzed.length; j++) {
      const nextInfo = analyzed[j];
      if (nextInfo.startedInTriple || nextInfo.endedInTriple) {
        lastContentIdx = j;
        continue;
      }
      const nextTrimmed = nextInfo.clean.trim();
      if (!nextTrimmed) continue; // 忽略空行与纯注释行
      if (nextInfo.indent <= headerIndent) {
        break;
      }
      lastContentIdx = j;
    }

    // 构造紧凑签名
    const sigParts = [];
    for (let j = i; j <= headerEndIdx; j++) {
      const t = analyzed[j].raw.trim();
      if (t) sigParts.push(t);
    }
    let signature = sigParts.join(' ').replace(/\s+/g, ' ').replace(/:\s*$/, '').trim();
    if (signature.length > 140) {
      signature = signature.slice(0, 137).trimEnd() + '...';
    }

    const depth = classStack.length > 0 ? 1 : 0;
    items.push({
      kind: isClass ? 'class' : depth === 1 ? 'method' : 'def',
      name,
      signature,
      startLine: i + 1,
      endLine: lastContentIdx + 1,
      depth,
    });

    if (isClass) {
      classStack.push({ indent: headerIndent, endIdx: lastContentIdx });
      i = headerEndIdx;
    } else {
      i = lastContentIdx;
    }
  }

  return items;
}

/**
 * 解析 Markdown 文件（按标题层级计算起止行号，自动跳过代码块内的 # 注释）
 */
function parseMarkdown(lines) {
  const headings = [];
  let inFence = false;
  let fenceChar = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
      } else if (marker === fenceChar) {
        inFence = false;
        fenceChar = '';
      }
      continue;
    }
    if (inFence) continue;

    const hMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (hMatch) {
      headings.push({
        level: hMatch[1].length,
        signature: `${hMatch[1]} ${hMatch[2].trim()}`,
        name: hMatch[2].trim(),
        startIdx: i,
      });
    }
  }

  if (headings.length === 0) return [];
  const minLevel = Math.min(...headings.map((h) => h.level));

  return headings.map((h, idx) => {
    let endIdx = lines.length - 1;
    for (let next = idx + 1; next < headings.length; next++) {
      if (headings[next].level <= h.level) {
        endIdx = headings[next].startIdx - 1;
        break;
      }
    }
    // 回退跳过结尾空行
    while (endIdx > h.startIdx && !lines[endIdx].trim()) {
      endIdx--;
    }
    return {
      kind: 'heading',
      name: h.name,
      signature: h.signature,
      startLine: h.startIdx + 1,
      endLine: endIdx + 1,
      depth: h.level - minLevel,
      level: h.level,
    };
  });
}

/**
 * 解析 Vue / Svelte 单文件组件
 */
function parseSfc(lines) {
  const items = [];
  const blockRegex = /^<(template|script|style)(\b[^>]*)?>/i;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const m = trimmed.match(blockRegex);
    if (!m) continue;

    const tag = m[1].toLowerCase();
    const closeTag = `</${tag}>`;
    let endIdx = i;
    for (let j = i; j < lines.length; j++) {
      if (lines[j].toLowerCase().includes(closeTag)) {
        endIdx = j;
        break;
      }
    }

    items.push({
      kind: 'section',
      name: tag,
      signature: trimmed.replace(/>.*$/, '>'),
      startLine: i + 1,
      endLine: endIdx + 1,
      depth: 0,
    });

    if (tag === 'script' && endIdx > i + 1) {
      const innerLines = lines.slice(i + 1, endIdx);
      const scriptItems = parseJsTs(innerLines, i + 1);
      for (const si of scriptItems) {
        items.push({ ...si, depth: si.depth + 1 });
      }
    }

    i = endIdx;
  }

  return items;
}

/**
 * 将提取的结构项格式化为紧凑的 `[L起-L止] 签名` 文本
 * @param {object} result
 * @param {object} [options]
 * @returns {string}
 */
function formatSkeletonItems(result, options = {}) {
  const { includeHeader = false } = options;
  const lines = [];

  if (includeHeader) {
    lines.push(
      `📄 ${result.filePath} (${result.totalLines} lines | ~${result.rawTokens} → ~${result.skeletonTokens} tokens, -${result.savedPercent}%)`
    );
  }

  if (result.items.length === 0) {
    lines.push(`(未识别到函数/类/接口签名，全文件共 ${result.totalLines} 行)`);
  } else {
    for (const item of result.items) {
      const indent = '  '.repeat(item.depth || 0);
      lines.push(`${indent}[L${item.startLine}-L${item.endLine}] ${item.signature}`);
    }
  }

  return lines.join('\n');
}

/**
 * 生成单个文件的紧凑语法骨架
 * @param {string} filePath
 * @param {object} [options]
 * @param {boolean} [options.includeHeader=false]
 * @returns {object}
 */
function generateFileSkeleton(filePath, options = {}) {
  const resolved = path.resolve(filePath);
  const content = fs.readFileSync(resolved, 'utf8');
  const ext = path.extname(resolved).toLowerCase();
  const lines = splitLines(content);
  const totalLines = lines.length;

  let items = [];
  if (JS_TS_EXTS.has(ext)) {
    items = parseJsTs(lines);
  } else if (ext === '.py') {
    items = parsePython(lines);
  } else if (ext === '.go') {
    items = parseGo(lines);
  } else if (ext === '.rs') {
    items = parseRust(lines);
  } else if (ext === '.md') {
    items = parseMarkdown(lines);
  } else if (C_FAMILY_EXTS.has(ext)) {
    items = parseCFamily(lines);
  } else if (SFC_EXTS.has(ext)) {
    items = parseSfc(lines);
  }

  const rawTokens = estimateTokens(content);
  const bodyOnly = formatSkeletonItems({ filePath: resolved, totalLines, items }, { includeHeader: false });
  const skeletonTokens = estimateTokens(bodyOnly);
  const savedTokens = Math.max(0, rawTokens - skeletonTokens);
  const savedPercent = rawTokens > 0 ? Number(((savedTokens / rawTokens) * 100).toFixed(1)) : 0;

  const result = {
    filePath: resolved,
    ext,
    totalLines,
    rawChars: content.length,
    rawTokens,
    skeletonLines: bodyOnly.split('\n').length,
    skeletonChars: bodyOnly.length,
    skeletonTokens,
    savedTokens,
    savedPercent,
    items,
  };

  result.formatted = formatSkeletonItems(result, options);
  return result;
}

/**
 * 扫描目录生成浓缩代码地图（排除 node_modules/.git/dist/build/exports/.next/target/__pycache__）
 * @param {string} dirPath
 * @param {object} [options]
 * @param {number} [options.depth=2]
 * @returns {object}
 */
function scanDirectorySkeleton(dirPath, options = {}) {
  const maxDepth = Number.isInteger(options.depth) && options.depth >= 0 ? options.depth : 2;
  const root = path.resolve(dirPath);
  const files = [];

  function walk(currentDir, currentDepth) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (currentDepth < maxDepth) {
          walk(path.join(currentDir, entry.name), currentDepth + 1);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_EXTS.has(ext)) continue;
        const fullPath = path.join(currentDir, entry.name);
        try {
          const skel = generateFileSkeleton(fullPath, { includeHeader: false });
          const relPath = path.relative(root, fullPath).replace(/\\/g, '/');
          files.push({
            relPath,
            ...skel,
          });
        } catch (_) {
          // 跳过无法读取的文件
        }
      }
    }
  }

  walk(root, 0);

  let totalLines = 0;
  let totalRawTokens = 0;
  let totalSkeletonTokens = 0;
  for (const f of files) {
    totalLines += f.totalLines;
    totalRawTokens += f.rawTokens;
    totalSkeletonTokens += f.skeletonTokens;
  }
  const totalSavedTokens = Math.max(0, totalRawTokens - totalSkeletonTokens);
  const totalSavedPercent =
    totalRawTokens > 0 ? Number(((totalSavedTokens / totalRawTokens) * 100).toFixed(1)) : 0;

  return {
    root,
    depth: maxDepth,
    fileCount: files.length,
    totalLines,
    totalRawTokens,
    totalSkeletonTokens,
    totalSavedTokens,
    totalSavedPercent,
    files,
  };
}

module.exports = {
  IGNORED_DIRS,
  SUPPORTED_EXTS,
  estimateTokens,
  generateFileSkeleton,
  scanDirectorySkeleton,
  formatSkeletonItems,
};
