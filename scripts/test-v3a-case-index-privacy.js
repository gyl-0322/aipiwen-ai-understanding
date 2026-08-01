#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api/generate-report.js'), 'utf8');
const entry = source.match(/pushCaseIndex\(\{([\s\S]*?)\}\);/)?.[1] || '';

assert.match(entry,
  /\bid\b[\s\S]*\btype\b[\s\S]*\bage\b[\s\S]*\bchannel\b[\s\S]*\bbrain\b[\s\S]*\bmType\b[\s\S]*\bplusR\b[\s\S]*\bcreatedAt\b/,
  'cases:index 必须保留非 PII 摘要字段');
assert.doesNotMatch(entry, /\bname\s*:/, 'cases:index 不得新增写入 name');
assert.doesNotMatch(entry, /(?:^|\s)ip\s*(?:,|:)/m, 'cases:index 不得新增写入 ip');

console.log('PASS: cases:index privacy patch (3 checks)');
