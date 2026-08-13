'use strict';

const RESOURCE_CONTRACTS = Object.freeze({
  advisor: {
    segment: 'advisors',
    required: ['advisor_ref', 'status'],
    allowed: ['advisor_ref', 'status', 'updated_at']
  },
  client: {
    segment: 'clients',
    required: ['client_ref', 'advisor_ref', 'status'],
    allowed: ['client_ref', 'advisor_ref', 'status', 'updated_at']
  },
  report: {
    segment: 'reports',
    required: ['report_ref', 'client_ref', 'advisor_ref', 'status'],
    allowed: ['report_ref', 'client_ref', 'advisor_ref', 'status', 'report_type', 'created_at', 'updated_at']
  }
});

const V3_READ_BASE_PATH = '/api/v3/memory-source/v1';

function createV3Reader({ baseUrl, fetchImpl, getAccessToken }) {
  const root = parseBaseUrl(baseUrl);
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
  if (typeof getAccessToken !== 'function') throw new Error('getAccessToken is required');

  async function read(kind, reference) {
    const contract = RESOURCE_CONTRACTS[kind];
    if (!contract) throw new Error(`Unsupported V3 resource: ${kind}`);
    assertReference(reference);

    const token = await getAccessToken();
    if (typeof token !== 'string' || token.length === 0) throw new Error('V3 server credential is unavailable');

    const url = new URL(`${V3_READ_BASE_PATH}/${contract.segment}/${encodeURIComponent(reference)}`, root);
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      }
    });

    if (!response || response.ok !== true) {
      const status = response && Number.isInteger(response.status) ? response.status : 'unknown';
      throw new Error(`V3 ${kind} read failed with status ${status}`);
    }

    const body = await response.json();
    return projectResponse(kind, body && body.data);
  }

  return Object.freeze({
    getAdvisor: (reference) => read('advisor', reference),
    getClient: (reference) => read('client', reference),
    getReport: (reference) => read('report', reference)
  });
}

function projectResponse(kind, data) {
  const contract = RESOURCE_CONTRACTS[kind];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Invalid V3 ${kind} projection`);
  }

  const unexpected = Object.keys(data).filter((field) => !contract.allowed.includes(field));
  if (unexpected.length > 0) throw new Error(`V3 ${kind} projection contains forbidden fields`);

  for (const field of contract.required) {
    if (typeof data[field] !== 'string' || data[field].trim() === '') {
      throw new Error(`V3 ${kind} projection is missing ${field}`);
    }
  }

  const projected = {};
  for (const field of contract.allowed) {
    if (Object.prototype.hasOwnProperty.call(data, field)) projected[field] = data[field];
  }
  return Object.freeze(projected);
}

function parseBaseUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('A valid V3 baseUrl is required');
  }
  if (parsed.protocol !== 'https:') throw new Error('V3 baseUrl must use HTTPS');
  return parsed;
}

function assertReference(reference) {
  if (typeof reference !== 'string' || reference.trim() === '' || reference.length > 128) {
    throw new Error('V3 reference must be a non-empty opaque string');
  }
}

module.exports = {
  RESOURCE_CONTRACTS,
  V3_READ_BASE_PATH,
  createV3Reader,
  projectResponse
};
