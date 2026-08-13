'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CONTRACTS, validateContract } = require('../src');

const now = '2026-07-31T12:00:00.000Z';

const fixtures = {
  service_session: {
    id: 'session-1',
    advisor_ref: 'advisor-1',
    client_ref: 'client-1',
    report_refs: ['report-1'],
    started_at: now,
    status: 'in_progress'
  },
  service_record: {
    id: 'record-1',
    service_session_ref: 'session-1',
    advisor_ref: 'advisor-1',
    client_ref: 'client-1',
    record_type: 'ai_result',
    source: 'ai',
    occurred_at: now,
    content: { summary: '需要人工确认的结构化结果' }
  },
  memory_card: {
    id: 'memory-1',
    memory_type: 'customer',
    subject_ref: 'client-1',
    owner_advisor_ref: 'advisor-1',
    source_record_refs: ['record-1'],
    lifecycle_state: 'draft',
    content: { summary: '服务偏好待确认' },
    created_at: now,
    updated_at: now
  },
  follow_up: {
    id: 'follow-up-1',
    service_session_ref: 'session-1',
    advisor_ref: 'advisor-1',
    client_ref: 'client-1',
    due_at: now,
    status: 'pending',
    plan: { next_step: '复核行动项' },
    created_at: now
  },
  preparation_card: {
    id: 'preparation-1',
    service_session_ref: 'session-1',
    advisor_ref: 'advisor-1',
    client_ref: 'client-1',
    report_refs: ['report-1'],
    status: 'draft',
    content: { focus: ['待确认主题'] },
    created_at: now
  },
  ai_confidence: {
    id: 'confidence-1',
    target_kind: 'service_record',
    target_ref: 'record-1',
    score: 0.72,
    basis: ['结构化输入完整'],
    limitations: ['尚未由指导师确认'],
    created_at: now
  }
};

test('all Sprint 0 core object contracts accept their minimal valid shape', () => {
  for (const [kind, fixture] of Object.entries(fixtures)) {
    assert.deepEqual(validateContract(kind, fixture), { ok: true, errors: [] }, kind);
  }
});

test('contracts reject missing, unknown and invalid fields', () => {
  assert.equal(validateContract('service_session', { ...fixtures.service_session, advisor_ref: '' }).ok, false);
  assert.equal(validateContract('memory_card', { ...fixtures.memory_card, lifecycle_state: 'published' }).ok, false);
  assert.equal(validateContract('ai_confidence', { ...fixtures.ai_confidence, score: 1.2 }).ok, false);
  assert.equal(validateContract('follow_up', { ...fixtures.follow_up, extra: true }).ok, false);
});

test('core contracts reference V3 identity without owning identity or report content', () => {
  const forbiddenFields = new Set([
    'user_id',
    'auth_user_id',
    'client_name',
    'advisor_name',
    'email',
    'phone',
    'report_content',
    'ocr_text'
  ]);

  for (const kind of Object.keys(fixtures)) {
    for (const field of Object.keys(CONTRACTS[kind].fields)) {
      assert.equal(forbiddenFields.has(field), false, `${kind}.${field}`);
    }
  }
});
