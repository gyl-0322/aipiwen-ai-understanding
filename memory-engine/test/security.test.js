'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTIONS,
  assertAuthorized,
  assertMemoryTransition,
  assertPrivacySafe,
  createAuditEvent
} = require('../src');

test('advisor access is isolated by advisor_ref', () => {
  const principal = { role: 'advisor', advisor_ref: 'advisor-1' };
  assert.equal(assertAuthorized(principal, ACTIONS.MODIFY, { advisor_ref: 'advisor-1' }), true);
  assert.throws(
    () => assertAuthorized(principal, ACTIONS.MODIFY, { advisor_ref: 'advisor-2' }),
    /advisor resource isolation/
  );
});

test('family is closed in Alpha and admin is audit-only', () => {
  assert.throws(
    () => assertAuthorized({ role: 'family' }, ACTIONS.CREATE, { advisor_ref: 'advisor-1' }),
    /reserved in Alpha/
  );
  assert.equal(
    assertAuthorized({ role: 'admin' }, ACTIONS.AUDIT_READ, { kind: 'audit_event' }),
    true
  );
  assert.throws(
    () => assertAuthorized({ role: 'admin' }, ACTIONS.MODIFY, { advisor_ref: 'advisor-1' }),
    /limited to system audit/
  );
});

test('privacy boundary rejects direct identifiers, report bodies and credentials', () => {
  assert.equal(assertPrivacySafe({ advisor_ref: 'advisor-1', summary: '偏好需要复核' }).summary, '偏好需要复核');
  assert.throws(() => assertPrivacySafe({ phone: 'blocked' }), /sensitive field/);
  assert.throws(() => assertPrivacySafe({ contact_phone_number: 'blocked' }), /sensitive field/);
  assert.throws(() => assertPrivacySafe({ fingerprint_asset_ref: 'blocked' }), /sensitive field/);
  assert.throws(() => assertPrivacySafe({ content: { raw_report: 'blocked' } }), /sensitive field/);
  assert.throws(() => assertPrivacySafe({ note: '联系邮箱 demo@example.invalid' }), /sensitive email value/);
  assert.throws(() => assertPrivacySafe({ note: '凭证 Bearer TEST_ONLY_CREDENTIAL' }), /sensitive credential value/);
});

test('AI can request review but cannot confirm or write permanent memory', () => {
  const ownerAdvisorRef = 'advisor-1';
  const ai = { kind: 'ai', actor_ref: 'ai-foundation' };
  const advisor = { kind: 'human', role: 'advisor', advisor_ref: ownerAdvisorRef };
  const system = { kind: 'system', actor_ref: 'memory-writeback' };

  assert.equal(
    assertMemoryTransition({ from: 'draft', to: 'review_pending', actor: ai, ownerAdvisorRef }),
    true
  );
  assert.throws(
    () => assertMemoryTransition({ from: 'review_pending', to: 'confirmed', actor: ai, ownerAdvisorRef }),
    /AI cannot confirm/
  );
  assert.equal(
    assertMemoryTransition({ from: 'review_pending', to: 'confirmed', actor: advisor, ownerAdvisorRef }),
    true
  );
  assert.equal(
    assertMemoryTransition({
      from: 'confirmed',
      to: 'memory',
      actor: system,
      ownerAdvisorRef,
      confirmedByAdvisorRef: ownerAdvisorRef
    }),
    true
  );
  assert.throws(
    () => assertMemoryTransition({ from: 'draft', to: 'memory', actor: system, ownerAdvisorRef }),
    /Invalid memory transition/
  );
});

test('audit foundation accepts create, modify, confirm and writeback events', () => {
  for (const operation of ['create', 'modify', 'confirm', 'writeback']) {
    const event = createAuditEvent({
      id: `audit-${operation}`,
      operation,
      actor_role: operation === 'writeback' ? 'system' : 'advisor',
      actor_ref: operation === 'writeback' ? 'memory-writeback' : 'advisor-1',
      target_kind: 'memory_card',
      target_ref: 'memory-1',
      advisor_ref: 'advisor-1',
      occurred_at: '2026-07-31T12:00:00.000Z',
      metadata: { lifecycle_step: operation }
    });
    assert.equal(event.operation, operation);
    assert.equal(Object.isFrozen(event), true);
  }
});
