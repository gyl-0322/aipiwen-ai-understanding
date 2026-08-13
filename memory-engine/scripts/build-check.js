'use strict';

const foundation = require('../src');

const requiredExports = [
  'CONTRACTS',
  'validateContract',
  'assertAuthorized',
  'assertPrivacySafe',
  'assertMemoryTransition',
  'createAuditEvent',
  'createV3Reader'
];

const missing = requiredExports.filter((name) => typeof foundation[name] === 'undefined');
if (missing.length > 0) throw new Error(`Missing foundation exports: ${missing.join(', ')}`);

console.log('PASS: Memory Engine foundation build check');
