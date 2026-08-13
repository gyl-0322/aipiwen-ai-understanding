'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { RESOURCE_CONTRACTS, V3_READ_BASE_PATH } = require('../src/v3-reader');

const root = path.resolve(__dirname, '..');
const srcRoot = path.join(root, 'src');
const sourceFiles = fs.readdirSync(srcRoot)
  .filter((name) => name.endsWith('.js'))
  .map((name) => path.join(srcRoot, name));

const forbiddenPatterns = [
  { label: 'Supabase/database adapter', expression: /@supabase|\bpostgres(?:ql)?\b|\bupstash\b|KV_REST_API/i },
  { label: 'V3.0 core module dependency', expression: /(?:\.\.\/)+(?:api|static|server|supabase)\// },
  { label: 'forbidden V3.0 endpoint', expression: /\/api\/(?:auth|v3a-session|generate-report|report-store|v3a-attribution)\b/ }
];

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const check of forbiddenPatterns) {
    if (check.expression.test(source)) throw new Error(`${check.label} found in ${path.basename(file)}`);
  }

  const requires = source.matchAll(/require\(['"]([^'"]+)['"]\)/g);
  for (const match of requires) {
    if (!match[1].startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(file), match[1]);
    if (!resolved.startsWith(srcRoot)) throw new Error(`Module import escapes Memory Engine: ${match[1]}`);
  }

  if (file !== path.join(srcRoot, 'v3-reader.js') && /\bfetch\s*\(/.test(source)) {
    throw new Error(`Network access is outside the V3 reader: ${path.basename(file)}`);
  }
}

if (V3_READ_BASE_PATH !== '/api/v3/memory-source/v1') throw new Error('Unexpected V3 integration base path');
if (Object.keys(RESOURCE_CONTRACTS).sort().join(',') !== 'advisor,client,report') {
  throw new Error('V3 integration may read only advisor, client and report projections');
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (packageJson.dependencies || packageJson.devDependencies) {
  throw new Error('Sprint 0 foundation must not add runtime or development dependencies');
}

console.log('PASS: Memory Engine architecture boundary check');
