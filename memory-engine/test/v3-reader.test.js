'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createV3Reader } = require('../src');

function response(data) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data })
  };
}

test('V3 reader consumes advisor, client and report through GET-only API projections', async () => {
  const calls = [];
  const payloads = [
    { advisor_ref: 'advisor-1', status: 'active' },
    { client_ref: 'client-1', advisor_ref: 'advisor-1', status: 'active' },
    {
      report_ref: 'report-1',
      client_ref: 'client-1',
      advisor_ref: 'advisor-1',
      status: 'ready',
      report_type: 'individual'
    }
  ];
  const reader = createV3Reader({
    baseUrl: 'https://v3.example.invalid',
    getAccessToken: async () => 'YOUR_SERVER_TOKEN_HERE',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(payloads[calls.length - 1]);
    }
  });

  await reader.getAdvisor('advisor-1');
  await reader.getClient('client-1');
  await reader.getReport('report-1');

  assert.deepEqual(calls.map((call) => call.options.method), ['GET', 'GET', 'GET']);
  assert.deepEqual(
    calls.map((call) => call.url.pathname),
    [
      '/api/v3/memory-source/v1/advisors/advisor-1',
      '/api/v3/memory-source/v1/clients/client-1',
      '/api/v3/memory-source/v1/reports/report-1'
    ]
  );
});

test('V3 reader rejects over-broad projections that contain identity data', async () => {
  const reader = createV3Reader({
    baseUrl: 'https://v3.example.invalid',
    getAccessToken: async () => 'YOUR_SERVER_TOKEN_HERE',
    fetchImpl: async () => response({ advisor_ref: 'advisor-1', status: 'active', email: 'blocked' })
  });

  await assert.rejects(() => reader.getAdvisor('advisor-1'), /forbidden fields/);
});

test('V3 reader has no default endpoint and requires an injected server credential', async () => {
  assert.throws(
    () => createV3Reader({ baseUrl: '', fetchImpl: async () => response({}), getAccessToken: async () => '' }),
    /valid V3 baseUrl/
  );

  const reader = createV3Reader({
    baseUrl: 'https://v3.example.invalid',
    getAccessToken: async () => '',
    fetchImpl: async () => response({ advisor_ref: 'advisor-1', status: 'active' })
  });
  await assert.rejects(() => reader.getAdvisor('advisor-1'), /credential is unavailable/);
});
