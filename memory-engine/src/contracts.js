'use strict';

const MEMORY_STATES = Object.freeze([
  'draft',
  'review_pending',
  'confirmed',
  'memory'
]);

const CONTRACTS = Object.freeze({
  service_session: {
    required: ['id', 'advisor_ref', 'client_ref', 'started_at', 'status'],
    fields: {
      id: { type: 'string' },
      advisor_ref: { type: 'string' },
      client_ref: { type: 'string' },
      report_refs: { type: 'array', itemType: 'string' },
      started_at: { type: 'timestamp' },
      ended_at: { type: 'timestamp' },
      status: { type: 'enum', values: ['scheduled', 'in_progress', 'completed', 'cancelled'] }
    }
  },
  service_record: {
    required: [
      'id',
      'service_session_ref',
      'advisor_ref',
      'client_ref',
      'record_type',
      'source',
      'occurred_at',
      'content'
    ],
    fields: {
      id: { type: 'string' },
      service_session_ref: { type: 'string' },
      advisor_ref: { type: 'string' },
      client_ref: { type: 'string' },
      record_type: {
        type: 'enum',
        values: ['advisor_note', 'structured_observation', 'decision', 'ai_result']
      },
      source: { type: 'enum', values: ['advisor', 'system', 'ai'] },
      occurred_at: { type: 'timestamp' },
      content: { type: 'object' }
    }
  },
  memory_card: {
    required: [
      'id',
      'memory_type',
      'subject_ref',
      'owner_advisor_ref',
      'source_record_refs',
      'lifecycle_state',
      'content',
      'created_at',
      'updated_at'
    ],
    fields: {
      id: { type: 'string' },
      memory_type: { type: 'enum', values: ['customer', 'advisor', 'case'] },
      subject_ref: { type: 'string' },
      owner_advisor_ref: { type: 'string' },
      source_record_refs: { type: 'array', itemType: 'string' },
      lifecycle_state: { type: 'enum', values: MEMORY_STATES },
      content: { type: 'object' },
      created_at: { type: 'timestamp' },
      updated_at: { type: 'timestamp' }
    }
  },
  follow_up: {
    required: [
      'id',
      'service_session_ref',
      'advisor_ref',
      'client_ref',
      'due_at',
      'status',
      'plan',
      'created_at'
    ],
    fields: {
      id: { type: 'string' },
      service_session_ref: { type: 'string' },
      advisor_ref: { type: 'string' },
      client_ref: { type: 'string' },
      due_at: { type: 'timestamp' },
      status: { type: 'enum', values: ['pending', 'completed', 'cancelled'] },
      plan: { type: 'object' },
      created_at: { type: 'timestamp' }
    }
  },
  preparation_card: {
    required: [
      'id',
      'service_session_ref',
      'advisor_ref',
      'client_ref',
      'report_refs',
      'status',
      'content',
      'created_at'
    ],
    fields: {
      id: { type: 'string' },
      service_session_ref: { type: 'string' },
      advisor_ref: { type: 'string' },
      client_ref: { type: 'string' },
      report_refs: { type: 'array', itemType: 'string' },
      status: { type: 'enum', values: ['draft', 'ready', 'consumed'] },
      content: { type: 'object' },
      created_at: { type: 'timestamp' }
    }
  },
  ai_confidence: {
    required: [
      'id',
      'target_kind',
      'target_ref',
      'score',
      'basis',
      'limitations',
      'created_at'
    ],
    fields: {
      id: { type: 'string' },
      target_kind: { type: 'enum', values: ['service_record', 'memory_card', 'preparation_card'] },
      target_ref: { type: 'string' },
      score: { type: 'number', minimum: 0, maximum: 1 },
      basis: { type: 'array', itemType: 'string' },
      limitations: { type: 'array', itemType: 'string' },
      created_at: { type: 'timestamp' }
    }
  },
  audit_event: {
    required: [
      'id',
      'operation',
      'actor_role',
      'actor_ref',
      'target_kind',
      'target_ref',
      'advisor_ref',
      'occurred_at',
      'metadata'
    ],
    fields: {
      id: { type: 'string' },
      operation: { type: 'enum', values: ['create', 'modify', 'confirm', 'writeback'] },
      actor_role: { type: 'enum', values: ['advisor', 'admin', 'ai', 'system'] },
      actor_ref: { type: 'string' },
      target_kind: {
        type: 'enum',
        values: [
          'service_session',
          'service_record',
          'memory_card',
          'follow_up',
          'preparation_card',
          'ai_confidence'
        ]
      },
      target_ref: { type: 'string' },
      advisor_ref: { type: 'string' },
      occurred_at: { type: 'timestamp' },
      metadata: { type: 'object' }
    }
  }
});

function validateContract(kind, value) {
  const contract = CONTRACTS[kind];
  const errors = [];

  if (!contract) return { ok: false, errors: [`unknown contract: ${kind}`] };
  if (!isPlainObject(value)) return { ok: false, errors: [`${kind} must be an object`] };

  for (const field of contract.required) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${field} is required`);
  }

  for (const [field, fieldValue] of Object.entries(value)) {
    const rule = contract.fields[field];
    if (!rule) {
      errors.push(`${field} is not allowed`);
      continue;
    }
    validateField(field, fieldValue, rule, errors);
  }

  return { ok: errors.length === 0, errors };
}

function assertContract(kind, value) {
  const result = validateContract(kind, value);
  if (!result.ok) throw new Error(`Invalid ${kind}: ${result.errors.join('; ')}`);
  return value;
}

function validateField(field, value, rule, errors) {
  if (rule.type === 'string') {
    if (typeof value !== 'string' || value.trim() === '') errors.push(`${field} must be a non-empty string`);
    return;
  }

  if (rule.type === 'timestamp') {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) errors.push(`${field} must be an ISO timestamp`);
    return;
  }

  if (rule.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${field} must be a finite number`);
    } else if (value < rule.minimum || value > rule.maximum) {
      errors.push(`${field} must be between ${rule.minimum} and ${rule.maximum}`);
    }
    return;
  }

  if (rule.type === 'enum') {
    if (!rule.values.includes(value)) errors.push(`${field} has an unsupported value`);
    return;
  }

  if (rule.type === 'array') {
    if (!Array.isArray(value) || value.some((item) => typeof item !== rule.itemType)) {
      errors.push(`${field} must be an array of ${rule.itemType}`);
    }
    return;
  }

  if (rule.type === 'object' && !isPlainObject(value)) errors.push(`${field} must be an object`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
  CONTRACTS,
  MEMORY_STATES,
  assertContract,
  validateContract
};
