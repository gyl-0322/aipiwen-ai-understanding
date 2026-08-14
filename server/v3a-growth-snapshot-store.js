'use strict';

const { HttpError, readJson } = require('./v3a-session-store');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVITE_CLIENT_LIMIT = 500;
const INVITE_REPORT_LIMIT = 1000;

function restUrl(config, table, params) {
  const url = new URL(`${config.supabaseUrl}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

function readKey() {
  const key = String(
    process.env.V3A_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  ).trim();
  if (!key) {
    throw new HttpError(503, '成长快照服务尚未完成环境配置。', 'GROWTH_SNAPSHOT_NOT_CONFIGURED');
  }
  return key;
}

async function selectRows(config, table, params) {
  const key = readKey();
  let response;
  try {
    response = await fetch(restUrl(config, table, params), {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json'
      }
    });
  } catch {
    throw new HttpError(502, '邀请成长记录暂时无法读取。', 'DATA_UPSTREAM_UNAVAILABLE');
  }
  if (!response.ok) {
    throw new HttpError(502, '邀请成长记录暂时无法读取。', 'DATA_UPSTREAM_ERROR');
  }
  const payload = await readJson(response);
  return Array.isArray(payload) ? payload : [];
}

async function nearestInviteeReadyReportCount(config, rawInviteeIds) {
  const inviteeIds = [...new Set(rawInviteeIds)].filter((id) => UUID_PATTERN.test(id));
  if (inviteeIds.length === 0) return 0;

  const clients = await selectRows(config, 'advisor_clients', {
    select: 'id,advisor_user_id',
    advisor_user_id: `in.(${inviteeIds.join(',')})`,
    archived_at: 'is.null',
    order: 'created_at.desc',
    limit: INVITE_CLIENT_LIMIT
  });
  if (clients.length === 0) return 0;

  const clientOwner = new Map(clients.map((row) => [row.id, row.advisor_user_id]));
  const reports = await selectRows(config, 'advisor_reports', {
    select: 'advisor_client_id',
    advisor_client_id: `in.(${clients.map((row) => row.id).join(',')})`,
    status: 'eq.ready',
    order: 'created_at.desc',
    limit: INVITE_REPORT_LIMIT
  });
  const counts = new Map(inviteeIds.map((id) => [id, 0]));
  for (const report of reports) {
    const ownerId = clientOwner.get(report.advisor_client_id);
    if (ownerId) counts.set(ownerId, (counts.get(ownerId) || 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

module.exports = { nearestInviteeReadyReportCount };
