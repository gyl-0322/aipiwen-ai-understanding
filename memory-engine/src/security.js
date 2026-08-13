'use strict';

const { assertContract } = require('./contracts');

const ROLES = Object.freeze({
  ADVISOR: 'advisor',
  FAMILY: 'family',
  ADMIN: 'admin'
});

const ACTIONS = Object.freeze({
  CREATE: 'memory:create',
  MODIFY: 'memory:modify',
  CONFIRM: 'memory:confirm',
  WRITEBACK: 'memory:writeback',
  AUDIT_READ: 'audit:read'
});

const OWNER_ACTIONS = new Set([
  ACTIONS.CREATE,
  ACTIONS.MODIFY,
  ACTIONS.CONFIRM,
  ACTIONS.WRITEBACK
]);

const ALLOWED_MEMORY_TRANSITIONS = Object.freeze({
  draft: ['review_pending'],
  review_pending: ['confirmed'],
  confirmed: ['memory'],
  memory: []
});

const SENSITIVE_KEY_PARTS = new Set([
  'name',
  'full_name',
  'display_name',
  'client_name',
  'advisor_name',
  'phone',
  'mobile',
  'telephone',
  'email',
  'address',
  'id_card',
  'id_number',
  'passport',
  'birthday',
  'birth_date',
  'biometric',
  'fingerprint',
  'fingerprint_image',
  'ocr_text',
  'raw_report',
  'report_content',
  'password',
  'cookie',
  'session_token',
  'access_token',
  'refresh_token',
  'authorization',
  'secret',
  'api_key'
]);

const SENSITIVE_VALUE_PATTERNS = Object.freeze([
  { type: 'email', expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { type: 'phone', expression: /(?:^|\D)1[3-9]\d{9}(?:\D|$)/ },
  { type: 'id_card', expression: /(?:^|\D)\d{17}[0-9Xx](?:\D|$)/ },
  { type: 'credential', expression: /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/i },
  { type: 'credential', expression: /\bsk-[A-Za-z0-9_-]{12,}\b/ }
]);

const SENSITIVE_KEY_PATTERNS = Object.freeze([
  /(?:^|_)(?:name|full_name|display_name|first_name|last_name|client_name|advisor_name)(?:_|$)/,
  /(?:^|_)(?:phone|mobile|telephone|email|address|id_card|id_number|passport|birthday|birth_date)(?:_|$)/,
  /(?:^|_)(?:biometric|fingerprint|fingerprint_image|ocr_text|raw_report|report_content)(?:_|$)/,
  /(?:^|_)(?:password|cookie|session_token|access_token|refresh_token|authorization|secret|api_key)(?:_|$)/
]);

function assertAuthorized(principal, action, resource) {
  if (!principal || !Object.values(ROLES).includes(principal.role)) {
    throw new Error('Permission denied: invalid server principal');
  }

  if (principal.role === ROLES.FAMILY) {
    throw new Error('Permission denied: family access is reserved in Alpha');
  }

  if (principal.role === ROLES.ADMIN) {
    if (action === ACTIONS.AUDIT_READ && resource && resource.kind === 'audit_event') return true;
    throw new Error('Permission denied: admin is limited to system audit');
  }

  if (!OWNER_ACTIONS.has(action)) throw new Error('Permission denied: unsupported advisor action');
  const ownerRef = resource && (resource.owner_advisor_ref || resource.advisor_ref);
  if (!ownerRef || ownerRef !== principal.advisor_ref) {
    throw new Error('Permission denied: advisor resource isolation');
  }
  return true;
}

function findPrivacyViolations(value, path = '$', violations = []) {
  if (typeof value === 'string') {
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      if (pattern.expression.test(value)) violations.push(`${path}: sensitive ${pattern.type} value`);
    }
    return violations;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => findPrivacyViolations(item, `${path}[${index}]`, violations));
    return violations;
  }

  if (!value || typeof value !== 'object') return violations;

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (
      SENSITIVE_KEY_PARTS.has(normalizedKey) ||
      SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(normalizedKey))
    ) {
      violations.push(`${path}.${key}: sensitive field`);
      continue;
    }
    findPrivacyViolations(child, `${path}.${key}`, violations);
  }
  return violations;
}

function assertPrivacySafe(value) {
  const violations = findPrivacyViolations(value);
  if (violations.length > 0) throw new Error(`Privacy boundary rejected: ${violations.join('; ')}`);
  return value;
}

function assertMemoryTransition({ from, to, actor, ownerAdvisorRef, confirmedByAdvisorRef }) {
  if (!ALLOWED_MEMORY_TRANSITIONS[from] || !ALLOWED_MEMORY_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid memory transition: ${from} -> ${to}`);
  }

  if (from === 'draft' && to === 'review_pending') {
    const isAi = actor && actor.kind === 'ai';
    const isOwnerAdvisor = isHumanOwnerAdvisor(actor, ownerAdvisorRef);
    if (!isAi && !isOwnerAdvisor) throw new Error('Only AI or the owning advisor can request review');
    return true;
  }

  if (from === 'review_pending' && to === 'confirmed') {
    if (!isHumanOwnerAdvisor(actor, ownerAdvisorRef)) {
      throw new Error('AI cannot confirm permanent memory');
    }
    return true;
  }

  if (from === 'confirmed' && to === 'memory') {
    if (!actor || actor.kind !== 'system' || confirmedByAdvisorRef !== ownerAdvisorRef) {
      throw new Error('Writeback requires server execution and owning-advisor confirmation');
    }
    return true;
  }

  throw new Error('Invalid memory transition');
}

function createAuditEvent(event) {
  assertContract('audit_event', event);
  assertPrivacySafe(event);
  return Object.freeze({ ...event, metadata: Object.freeze({ ...event.metadata }) });
}

function isHumanOwnerAdvisor(actor, ownerAdvisorRef) {
  return Boolean(
    actor &&
      actor.kind === 'human' &&
      actor.role === ROLES.ADVISOR &&
      actor.advisor_ref === ownerAdvisorRef
  );
}

module.exports = {
  ACTIONS,
  ALLOWED_MEMORY_TRANSITIONS,
  ROLES,
  assertAuthorized,
  assertMemoryTransition,
  assertPrivacySafe,
  createAuditEvent,
  findPrivacyViolations
};
