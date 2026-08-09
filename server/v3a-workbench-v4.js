const {
  HttpError,
  requireSameOrigin,
  requireJsonRequest,
  readRequestBody,
  loadSession,
  resolveSession,
  requireCsrf,
  readJson
} = require('./v3a-session-store');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGES = new Set(['initial', 'early', 'deep', 'consolidation']);
const RECORD_TYPES = new Set(['advisor_obs', 'parent_feedback', 'child_self_report', 'key_event', 'service_decision']);
const DOMAIN_TAGS = new Set(['learning', 'behavior', 'emotion', 'social', 'parent_child', 'family_system', 'physical']);
const DOMAIN_LABELS = {
  learning: '学习',
  behavior: '行为',
  emotion: '情绪',
  social: '社交',
  parent_child: '亲子关系',
  family_system: '家庭系统',
  physical: '身体'
};
const DIRECTIONS = new Set(['improving', 'stable', 'declining', 'new_emergence', 'resolved']);
const MARKERS = new Set(['TRC', 'ATD', 'pattern', 'personality', 'channel', 'brain']);
const VISIBILITIES = new Set(['advisor_only', 'shared']);
const CASE_TYPES = new Set([
  'fingerprint_rare', 'coaching_effective', 'turning_point', 'stubborn_problem',
  'parent_child_improvement', 'long_term_tracking', 'other'
]);
const KNOWLEDGE_IDS = /^[A-Z][A-Z0-9_-]{0,31}$/;
const COACHING_TYPES = new Set(['phone_follow_up', 'deep_coaching', 'initial_interpretation', 'emergency', 'daily_follow_up']);
const SESSION_TYPES = new Set(['pre_call', 'post_call', 'free']);

function normalize(value) {
  return String(value ?? '').trim();
}

function isUuid(value) {
  return UUID_PATTERN.test(normalize(value));
}

function integer(value, fallback, min, max) {
  const result = Number(value);
  return Number.isInteger(result) && result >= min && result <= max ? result : fallback;
}

function values(value, allowed, max) {
  if (!Array.isArray(value)) throw new HttpError(400, '请求字段格式无效。', 'INVALID_REQUEST_BODY');
  const result = [...new Set(value.map(normalize).filter(Boolean))];
  if (result.length > max || result.some((item) => !allowed.has(item))) {
    throw new HttpError(400, '请求字段格式无效。', 'INVALID_REQUEST_BODY');
  }
  return result;
}

function localizedDomains(tags) {
  return (Array.isArray(tags) ? tags : []).map((tag) => DOMAIN_LABELS[normalize(tag)]).filter(Boolean);
}

function restUrl(config, table, params) {
  const url = new URL(`${config.supabaseUrl}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

function sessionHeaders(config, session) {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${session.record.accessToken}`,
    Accept: 'application/json'
  };
}

async function selectRows(config, session, table, params, message) {
  let response;
  try {
    response = await fetch(restUrl(config, table, params), {
      method: 'GET',
      headers: sessionHeaders(config, session)
    });
  } catch {
    throw new HttpError(502, message, 'DATA_UPSTREAM_UNAVAILABLE');
  }
  if (!response.ok) throw new HttpError(502, message, 'DATA_UPSTREAM_ERROR');
  const payload = await readJson(response);
  return Array.isArray(payload) ? payload : [];
}

const RPC_ERRORS = {
  WORKBENCH_V4_FORBIDDEN: [403, '当前账号无此权限。'],
  WORKBENCH_V4_ADMIN_REQUIRED: [403, '当前账号无总部审核权限。'],
  WORKBENCH_V4_CLIENT_NOT_FOUND: [404, '未找到该客户。'],
  WORKBENCH_V4_INVALID_CASE_VISIBILITY: [400, '案例可见范围无效。'],
  WORKBENCH_V4_CASE_NOT_EDITABLE: [409, '当前案例不可编辑。'],
  WORKBENCH_V4_CASE_NOT_SUBMITTABLE: [409, '当前案例不可提交。'],
  WORKBENCH_V4_CASE_NOT_REVIEWABLE: [409, '当前案例不可审核。'],
  WORKBENCH_V4_CASE_NOT_DELETABLE: [409, '当前案例不可删除。'],
  WORKBENCH_V4_INVALID_REVIEW_DECISION: [400, '审核决定无效。']
};

async function callRpc(config, session, functionName, body, fallback) {
  let response;
  try {
    response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: {
        ...sessionHeaders(config, session),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch {
    throw new HttpError(502, fallback, 'RPC_UPSTREAM_UNAVAILABLE');
  }
  const payload = await readJson(response);
  if (!response.ok) {
    const marker = normalize(payload?.message);
    const mapped = RPC_ERRORS[marker];
    if (mapped) throw new HttpError(mapped[0], mapped[1], marker);
    throw new HttpError(502, fallback, 'RPC_UPSTREAM_ERROR');
  }
  return Array.isArray(payload) ? payload[0] : payload;
}

async function requireIdentity(config, req, write, roles = ['advisor']) {
  if (write) {
    requireSameOrigin(req, config);
    requireJsonRequest(req);
  }
  const loaded = await loadSession(req, config);
  if (write) requireCsrf(req, loaded);
  const session = await resolveSession(config, loaded);
  const users = await selectRows(config, session, 'users', {
    select: 'id,role,status,display_name',
    auth_user_id: `eq.${session.user.id}`,
    limit: 1
  }, '账号信息暂时无法读取。');
  const user = users[0];
  if (!user || user.status !== 'active' || !roles.includes(user.role)) {
    throw new HttpError(403, '当前账号无此权限。', 'FORBIDDEN');
  }
  return { session, user };
}

function publicReport(report) {
  const structured = report?.structured_input && typeof report.structured_input === 'object'
    ? report.structured_input
    : {};
  return {
    id: report.id,
    status: report.status,
    reportType: normalize(structured.reportType) || '报告',
    ageAtReport: Number.isInteger(report.age_at_report) ? report.age_at_report : null,
    fingers: structured.fingers && typeof structured.fingers === 'object' ? structured.fingers : {},
    atd: Number.isFinite(Number(structured.atd)) ? Number(structured.atd) : null,
    engineResult: structured.engineResult && typeof structured.engineResult === 'object' ? structured.engineResult : {},
    selectedIssues: Array.isArray(structured.selectedIssues) ? structured.selectedIssues.map(normalize).filter(Boolean).slice(0, 8) : [],
    customIssue: normalize(structured.customIssue).slice(0, 200) || null,
    interpretationStatus: normalize(report.interpretation_data?.status) || null,
    createdAt: report.created_at,
    updatedAt: report.updated_at
  };
}

function stageFor(reports, stageLogs) {
  const explicit = stageLogs[0]?.to_stage;
  if (STAGES.has(explicit)) return explicit;
  const ready = reports.filter((report) => report.status === 'ready').length;
  if (ready >= 2) return 'deep';
  if (ready === 1) return 'early';
  return 'initial';
}

function candidateFromReports(reports) {
  for (const report of reports) {
    if (report?.status !== 'ready') continue;
    const structured = report.structured_input || {};
    const fingers = structured.fingers && typeof structured.fingers === 'object' ? Object.values(structured.fingers) : [];
    const trc = fingers.reduce((sum, finger) => sum + (Number(finger?.trc) || 0), 0);
    const atd = Number(structured.atd);
    const symbols = fingers.map((finger) => normalize(finger?.sym)).filter(Boolean);
    const samePattern = symbols.length === 10 && new Set(symbols).size === 1;
    const archCount = symbols.filter((symbol) => ['X', 'Xn'].includes(symbol)).length;
    if ((trc > 0 && (trc <= 50 || trc >= 280)) || (Number.isFinite(atd) && (atd <= 34 || atd >= 46)) || samePattern || archCount >= 5) {
      return true;
    }
  }
  return false;
}

async function loadOwnedClients(config, session, advisorUserId, ids) {
  const params = {
    select: 'id,display_name,birth_date,source,note,created_at,updated_at,assigned_at',
    advisor_user_id: `eq.${advisorUserId}`,
    archived_at: 'is.null',
    order: 'created_at.desc',
    limit: 500
  };
  if (ids?.length) params.id = `in.(${ids.join(',')})`;
  return selectRows(config, session, 'advisor_clients', params, '客户数据暂时无法读取。');
}

async function loadClientCollections(config, session, clientIds) {
  if (clientIds.length === 0) return { reports: [], growth: [], coaching: [], stages: [], cases: [] };
  const filter = `in.(${clientIds.join(',')})`;
  const [reports, growth, coaching, stages, cases] = await Promise.all([
    selectRows(config, session, 'advisor_reports', {
      select: 'id,advisor_client_id,status,structured_input,age_at_report,interpretation_data,created_at,updated_at',
      advisor_client_id: filter,
      order: 'created_at.desc',
      limit: 1000
    }, '客户报告暂时无法读取。'),
    selectRows(config, session, 'growth_records', {
      select: 'id,advisor_client_id,record_type,domain_tags,change_direction,related_fingerprint_markers,visibility,content,source,created_at,updated_at',
      advisor_client_id: filter,
      order: 'created_at.desc',
      limit: 500
    }, '成长记录暂时无法读取。'),
    selectRows(config, session, 'coaching_sessions', {
      select: 'id,advisor_client_id,coaching_type,session_type,topic,parent_reaction,session_effect,next_plan,created_at,updated_at',
      advisor_client_id: filter,
      order: 'created_at.desc',
      limit: 500
    }, '辅导记录暂时无法读取。'),
    selectRows(config, session, 'service_stage_log', {
      select: 'id,advisor_client_id,from_stage,to_stage,reason,created_at',
      advisor_client_id: filter,
      order: 'created_at.desc',
      limit: 500
    }, '服务阶段暂时无法读取。'),
    selectRows(config, session, 'case_card', {
      select: 'id,advisor_client_id,auto_detected,detection_rule,visibility,created_at',
      advisor_client_id: filter,
      order: 'created_at.desc',
      limit: 500
    }, '案例标签暂时无法读取。')
  ]);
  return { reports, growth, coaching, stages, cases };
}

function groupByClient(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.advisor_client_id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
}

async function handleStageSummary(config, req, res) {
  const { session, user } = await requireIdentity(config, req, false);
  const ids = normalize(req.query?.person_ids).split(',').map(normalize).filter(Boolean);
  if (ids.length === 0 || ids.length > 100 || ids.some((id) => !isUuid(id))) {
    throw new HttpError(400, '客户标识列表无效。', 'INVALID_PERSON_IDS');
  }
  const clients = await loadOwnedClients(config, session, user.id, ids);
  const collections = await loadClientCollections(config, session, clients.map((client) => client.id));
  const reports = groupByClient(collections.reports);
  const stages = groupByClient(collections.stages);
  const cases = groupByClient(collections.cases);
  return res.status(200).json({
    ok: true,
    csrfToken: session.csrfToken,
    summaries: clients.map((client) => {
      const clientReports = reports.get(client.id) || [];
      return {
        personId: client.id,
        stage: stageFor(clientReports, stages.get(client.id) || []),
        candidate: (cases.get(client.id) || []).some((item) => item.auto_detected) || candidateFromReports(clientReports)
      };
    })
  });
}

async function handlePersonList(config, req, res) {
  const { session, user } = await requireIdentity(config, req, false);
  const clients = await loadOwnedClients(config, session, user.id);
  const collections = await loadClientCollections(config, session, clients.map((client) => client.id));
  const reports = groupByClient(collections.reports);
  const stages = groupByClient(collections.stages);
  return res.status(200).json({
    ok: true,
    csrfToken: session.csrfToken,
    people: clients.map((client) => ({
      id: client.id,
      displayName: client.display_name,
      stage: stageFor(reports.get(client.id) || [], stages.get(client.id) || [])
    }))
  });
}

async function handleDataCenter(config, req, res) {
  const { session, user } = await requireIdentity(config, req, false);
  const clientId = normalize(req.query?.person_id);
  const view = normalize(req.query?.view) || 'full';
  if (!isUuid(clientId) || !['full', 'coaching'].includes(view)) {
    throw new HttpError(400, '客户视图请求无效。', 'INVALID_CLIENT_VIEW');
  }
  const clients = await loadOwnedClients(config, session, user.id, [clientId]);
  const client = clients[0];
  if (!client) throw new HttpError(404, '未找到该客户。', 'CLIENT_NOT_FOUND');
  const collections = await loadClientCollections(config, session, [clientId]);
  const reports = collections.reports.map(publicReport);
  const growth = collections.growth.map((row) => ({
    id: row.id,
    recordType: row.record_type,
    domainTags: row.domain_tags,
    changeDirection: row.change_direction,
    relatedFingerprintMarkers: row.related_fingerprint_markers,
    visibility: row.visibility,
    content: row.content,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
  const coaching = collections.coaching.map((row) => ({
    id: row.id,
    coachingType: row.coaching_type,
    sessionType: row.session_type,
    topic: row.topic,
    parentReaction: row.parent_reaction,
    sessionEffect: row.session_effect,
    nextPlan: row.next_plan,
    createdAt: row.created_at
  }));
  const stageLogs = collections.stages.map((row) => ({
    id: row.id,
    fromStage: row.from_stage,
    toStage: row.to_stage,
    reason: row.reason,
    createdAt: row.created_at
  }));
  const latestReport = reports[0] || null;
  const concerns = latestReport
    ? [...latestReport.selectedIssues, latestReport.customIssue].filter(Boolean).slice(0, 8)
    : [];
  const declining = growth.filter((record) => record.changeDirection === 'declining').length;
  const insight = declining >= 2
    ? '近期出现多条退步记录，建议先理解变化背景，再讨论新的行动。'
    : growth.length > 0
      ? '已有成长记录可供本次辅导参考。'
      : '暂无成长记录，建议先确认客户当前最关注的问题。';
  const payload = {
    ok: true,
    csrfToken: session.csrfToken,
    view,
    client: {
      id: client.id,
      displayName: client.display_name,
      birthDate: client.birth_date,
      source: client.source,
      note: client.note,
      stage: stageFor(collections.reports, collections.stages),
      createdAt: client.created_at,
      assignedAt: client.assigned_at
    },
    latestReport,
    reports,
    coreConcerns: concerns,
    growthRecords: growth,
    coachingSessions: coaching,
    stageHistory: stageLogs,
    actionPlan: {
      currentGoal: coaching[0]?.sessionEffect || concerns[0] || null,
      nextFollowUp: coaching[0]?.nextPlan || null
    },
    insight
  };
  if (view === 'coaching') {
    payload.growthRecords = growth.slice(0, 5);
    payload.coachingSessions = coaching.slice(0, 5);
    payload.reports = latestReport ? [latestReport] : [];
    payload.stageHistory = stageLogs.slice(0, 5);
  }
  return res.status(200).json(payload);
}

async function handleClues(config, req, res) {
  const { session, user } = await requireIdentity(config, req, false);
  const clients = await loadOwnedClients(config, session, user.id);
  const selected = clients.slice(0, 100);
  const collections = await loadClientCollections(config, session, selected.map((client) => client.id));
  const reports = groupByClient(collections.reports);
  const growth = groupByClient(collections.growth);
  const stages = groupByClient(collections.stages);
  const clues = [];
  for (const client of selected) {
    const clientReports = reports.get(client.id) || [];
    const records = growth.get(client.id) || [];
    const declining = records.find((record) => record.change_direction === 'declining');
    const generating = clientReports.find((report) => report.status === 'generating');
    const ready = clientReports.find((report) => report.status === 'ready');
    let description = '';
    let clueType = '';
    if (declining) {
      clueType = 'growth_declining';
      description = `近期${localizedDomains(declining.domain_tags).join('、') || '成长'}记录需要关注。`;
    } else if (generating) {
      clueType = 'report_generating';
      description = '客户报告仍在生成中，可稍后查看。';
    } else if (ready && !collections.coaching.some((item) => item.advisor_client_id === client.id)) {
      clueType = 'first_follow_up';
      description = '报告已生成，尚未记录首次跟进。';
    }
    if (!clueType) continue;
    clues.push({
      person_id: client.id,
      person_name: client.display_name,
      stage: stageFor(clientReports, stages.get(client.id) || []),
      clue_type: clueType,
      description,
      suggested_action: ready ? '打开 AI 辅导助手' : '查看客户档案',
      action_url: ready
        ? `/ai-coaching-assistant.html?person_id=${encodeURIComponent(client.id)}`
        : `/client-360.html?person_id=${encodeURIComponent(client.id)}`
    });
    if (clues.length >= 8) break;
  }
  return res.status(200).json({ ok: true, csrfToken: session.csrfToken, clues });
}

function validateGrowthBody(body) {
  const personId = normalize(body.person_id || body.personId);
  const content = normalize(body.content);
  const recordType = normalize(body.record_type || body.recordType);
  const direction = normalize(body.change_direction || body.changeDirection);
  const visibility = normalize(body.visibility) || 'advisor_only';
  const source = normalize(body.source) || 'advisor_workbench';
  if (!isUuid(personId) || !RECORD_TYPES.has(recordType) || !DIRECTIONS.has(direction) || !VISIBILITIES.has(visibility) || !['advisor_workbench', 'coaching_session'].includes(source) || content.length < 1 || content.length > 2000) {
    throw new HttpError(400, '成长记录内容无效。', 'INVALID_GROWTH_RECORD');
  }
  return {
    personId,
    recordType,
    domainTags: values(body.domain_tags || body.domainTags || [], DOMAIN_TAGS, 7),
    direction,
    markers: values(body.related_fingerprint_markers || body.relatedFingerprintMarkers || [], MARKERS, 6),
    visibility,
    content,
    source
  };
}

async function handleGrowthRecords(config, req, res) {
  const write = req.method === 'POST';
  const { session, user } = await requireIdentity(config, req, write);
  if (write) {
    const input = validateGrowthBody(readRequestBody(req));
    const record = await callRpc(config, session, 'v3a_create_growth_record', {
      p_client_id: input.personId,
      p_record_type: input.recordType,
      p_domain_tags: input.domainTags,
      p_change_direction: input.direction,
      p_related_fingerprint_markers: input.markers,
      p_visibility: input.visibility,
      p_content: input.content,
      p_source: input.source
    }, '成长记录暂时无法保存。');
    return res.status(201).json({ ok: true, csrfToken: session.csrfToken, record });
  }

  const personId = normalize(req.query?.person_id);
  if (personId && !isUuid(personId)) throw new HttpError(400, '客户标识无效。', 'INVALID_PERSON_ID');
  const params = {
    select: 'id,advisor_client_id,record_type,domain_tags,change_direction,related_fingerprint_markers,visibility,content,source,created_at,updated_at',
    advisor_user_id: `eq.${user.id}`,
    order: 'created_at.desc',
    limit: integer(req.query?.limit, 20, 1, 100),
    offset: integer(req.query?.offset, 0, 0, 10000)
  };
  if (personId) params.advisor_client_id = `eq.${personId}`;
  const direction = normalize(req.query?.change_direction);
  if (direction) {
    if (!DIRECTIONS.has(direction)) throw new HttpError(400, '变化方向无效。', 'INVALID_DIRECTION');
    params.change_direction = `eq.${direction}`;
  }
  let rows = await selectRows(config, session, 'growth_records', params, '成长记录暂时无法读取。');
  const requestedDomains = normalize(req.query?.domain_tags).split(',').map(normalize).filter(Boolean);
  if (requestedDomains.length) {
    if (requestedDomains.some((item) => !DOMAIN_TAGS.has(item))) throw new HttpError(400, '领域标签无效。', 'INVALID_DOMAIN_TAGS');
    rows = rows.filter((row) => requestedDomains.some((tag) => (row.domain_tags || []).includes(tag)));
  }
  const records = rows.map((row) => ({
    id: row.id,
    personId: row.advisor_client_id,
    recordType: row.record_type,
    domainTags: row.domain_tags,
    changeDirection: row.change_direction,
    relatedFingerprintMarkers: row.related_fingerprint_markers,
    visibility: row.visibility,
    content: row.content,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
  return res.status(200).json({ ok: true, csrfToken: session.csrfToken, records, total: records.length });
}

async function handleCoachingSession(config, req, res) {
  const { session } = await requireIdentity(config, req, true);
  const body = readRequestBody(req);
  const personId = normalize(body.person_id || body.personId);
  const coachingType = normalize(body.coaching_type || body.coachingType);
  const sessionType = normalize(body.session_type || body.sessionType);
  const topic = normalize(body.topic);
  const suggestion = body.suggestion;
  const notes = [body.parent_reaction || body.parentReaction, body.session_effect || body.sessionEffect, body.next_plan || body.nextPlan].map(normalize);
  if (!isUuid(personId) || !COACHING_TYPES.has(coachingType) || !SESSION_TYPES.has(sessionType) || topic.length < 2 || topic.length > 1000 || !suggestion || typeof suggestion !== 'object' || Array.isArray(suggestion) || notes.some((item) => item.length > 2000)) {
    throw new HttpError(400, '辅导记录内容无效。', 'INVALID_COACHING_SESSION');
  }
  const result = await callRpc(config, session, 'v3a_create_coaching_session', {
    p_client_id: personId,
    p_coaching_type: coachingType,
    p_session_type: sessionType,
    p_topic: topic,
    p_suggestion: suggestion,
    p_parent_reaction: notes[0] || null,
    p_session_effect: notes[1] || null,
    p_next_plan: notes[2] || null
  }, '辅导记录暂时无法保存。');
  return res.status(201).json({ ok: true, csrfToken: session.csrfToken, session: result });
}

function validateCaseBody(body) {
  const personId = normalize(body.person_id || body.personId);
  const title = normalize(body.title);
  const content = normalize(body.content);
  const visibility = normalize(body.visibility) || 'private';
  const caseTypes = values(body.case_type || body.caseType || [], CASE_TYPES, 7);
  const knowledge = Array.isArray(body.related_knowledge_cards || body.relatedKnowledgeCards)
    ? [...new Set((body.related_knowledge_cards || body.relatedKnowledgeCards).map(normalize).filter(Boolean))]
    : [];
  if (!isUuid(personId) || title.length < 1 || title.length > 120 || content.length < 1 || content.length > 5000 || caseTypes.length === 0 || !['private', 'submitted'].includes(visibility) || knowledge.length > 30 || knowledge.some((item) => !KNOWLEDGE_IDS.test(item))) {
    throw new HttpError(400, '案例内容无效。', 'INVALID_CASE_CARD');
  }
  return { personId, title, content, visibility, caseTypes, knowledge };
}

async function listCases(config, req, res, identity) {
  const requested = normalize(req.query?.visibility);
  const params = {
    select: 'id,advisor_client_id,advisor_user_id,title,content,case_type,auto_detected,detection_rule,visibility,hq_review_comment,hq_reviewed_at,related_knowledge_cards,key_turning_points,created_at,updated_at',
    order: 'created_at.desc',
    limit: integer(req.query?.limit, 100, 1, 200)
  };
  if (requested) {
    const allowed = identity.user.role === 'super_admin'
      ? ['private', 'submitted', 'shared', 'returned']
      : ['private', 'submitted', 'shared', 'returned'];
    if (!allowed.includes(requested)) throw new HttpError(400, '案例状态无效。', 'INVALID_CASE_VISIBILITY');
    params.visibility = `eq.${requested}`;
  }
  const rows = await selectRows(config, identity.session, 'case_card', params, '案例列表暂时无法读取。');
  const own = rows.filter((row) => row.advisor_user_id === identity.user.id);
  const shared = rows.filter((row) => row.visibility === 'shared' && row.advisor_user_id !== identity.user.id);
  const pending = identity.user.role === 'super_admin' ? rows.filter((row) => row.visibility === 'submitted') : [];
  const clientIds = [...new Set(own.map((row) => row.advisor_client_id))];
  const clients = clientIds.length
    ? await selectRows(config, identity.session, 'advisor_clients', {
      select: 'id,display_name', id: `in.(${clientIds.join(',')})`, limit: 200
    }, '案例客户信息暂时无法读取。')
    : [];
  const names = new Map(clients.map((client) => [client.id, client.display_name]));
  const mapCase = (row) => ({
    id: row.id,
    personId: row.advisor_user_id === identity.user.id ? row.advisor_client_id : null,
    personName: row.advisor_user_id === identity.user.id ? (names.get(row.advisor_client_id) || '客户') : '团队共享案例',
    title: row.title,
    content: row.content,
    caseType: row.case_type,
    autoDetected: row.auto_detected,
    detectionRule: row.detection_rule,
    visibility: row.visibility,
    reviewComment: row.hq_review_comment,
    reviewedAt: row.hq_reviewed_at,
    relatedKnowledgeCards: row.related_knowledge_cards,
    keyTurningPoints: row.key_turning_points,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
  return res.status(200).json({
    ok: true,
    csrfToken: identity.session.csrfToken,
    role: identity.user.role,
    myCases: own.map(mapCase),
    sharedCases: shared.map(mapCase),
    pendingCases: pending.map(mapCase)
  });
}

async function handleCases(config, req, res) {
  const write = req.method !== 'GET';
  const identity = await requireIdentity(config, req, write, ['advisor', 'super_admin']);
  if (!write) return listCases(config, req, res, identity);
  const caseId = normalize(req.query?.caseId);
  const caseAction = normalize(req.query?.caseAction);
  if (req.method === 'POST' && !caseId) {
    if (identity.user.role !== 'advisor') throw new HttpError(403, '当前账号无此权限。', 'FORBIDDEN');
    const input = validateCaseBody(readRequestBody(req));
    const result = await callRpc(config, identity.session, 'v3a_create_case_card', {
      p_client_id: input.personId,
      p_title: input.title,
      p_content: input.content,
      p_case_type: input.caseTypes,
      p_visibility: input.visibility,
      p_related_knowledge_cards: input.knowledge,
      p_key_turning_points: []
    }, '案例暂时无法保存。');
    return res.status(201).json({ ok: true, csrfToken: identity.session.csrfToken, case: result });
  }
  if (!isUuid(caseId)) throw new HttpError(400, '案例标识无效。', 'INVALID_CASE_ID');
  if (req.method === 'PUT') {
    const input = validateCaseBody(readRequestBody(req));
    const result = await callRpc(config, identity.session, 'v3a_update_case_card', {
      p_case_id: caseId,
      p_title: input.title,
      p_content: input.content,
      p_case_type: input.caseTypes,
      p_related_knowledge_cards: input.knowledge,
      p_key_turning_points: []
    }, '案例暂时无法更新。');
    return res.status(200).json({ ok: true, csrfToken: identity.session.csrfToken, case: result });
  }
  if (req.method === 'DELETE') {
    const result = await callRpc(config, identity.session, 'v3a_delete_case_card', { p_case_id: caseId }, '案例暂时无法删除。');
    return res.status(200).json({ ok: true, csrfToken: identity.session.csrfToken, case: result });
  }
  if (req.method === 'POST' && caseAction === 'submit') {
    const result = await callRpc(config, identity.session, 'v3a_submit_case_card', { p_case_id: caseId }, '案例暂时无法提交。');
    return res.status(200).json({ ok: true, csrfToken: identity.session.csrfToken, case: result });
  }
  if (req.method === 'POST' && caseAction === 'review') {
    if (identity.user.role !== 'super_admin') throw new HttpError(403, '当前账号无总部审核权限。', 'FORBIDDEN');
    const body = readRequestBody(req);
    const decision = normalize(body.decision);
    const comment = normalize(body.comment);
    if (!['approve', 'return'].includes(decision) || comment.length > 1000) {
      throw new HttpError(400, '案例审核内容无效。', 'INVALID_CASE_REVIEW');
    }
    const result = await callRpc(config, identity.session, 'v3a_review_case_card', {
      p_case_id: caseId, p_decision: decision, p_comment: comment || null
    }, '案例暂时无法审核。');
    return res.status(200).json({ ok: true, csrfToken: identity.session.csrfToken, case: result });
  }
  throw new HttpError(400, '不支持的案例操作。', 'INVALID_ACTION');
}

async function handleCandidates(config, req, res) {
  const { session, user } = await requireIdentity(config, req, false);
  const clients = await loadOwnedClients(config, session, user.id);
  const collections = await loadClientCollections(config, session, clients.map((client) => client.id));
  const reports = groupByClient(collections.reports);
  const candidates = clients.filter((client) => candidateFromReports(reports.get(client.id) || [])).map((client) => ({
    personId: client.id,
    personName: client.display_name,
    reason: '报告中存在需要进一步学习与复核的少见指标组合。'
  }));
  return res.status(200).json({ ok: true, csrfToken: session.csrfToken, candidates });
}

async function handleAction(config, req, res, action) {
  if (action === 'client-data-center-stage-summary' && req.method === 'GET') return handleStageSummary(config, req, res);
  if (action === 'client-data-center-person-list' && req.method === 'GET') return handlePersonList(config, req, res);
  if (action === 'client-data-center' && req.method === 'GET') return handleDataCenter(config, req, res);
  if (action === 'client-data-center-clues' && req.method === 'GET') return handleClues(config, req, res);
  if (action === 'growth-records' && ['GET', 'POST'].includes(req.method)) return handleGrowthRecords(config, req, res);
  if (action === 'coaching-sessions' && req.method === 'POST') return handleCoachingSession(config, req, res);
  if (action === 'case-cards' && ['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) return handleCases(config, req, res);
  if (action === 'case-candidates' && req.method === 'GET') return handleCandidates(config, req, res);
  throw new HttpError(400, '不支持的工作台操作。', 'INVALID_ACTION');
}

module.exports = { handleAction };
module.exports._test = {
  candidateFromReports,
  isUuid,
  localizedDomains,
  stageFor,
  validateCaseBody,
  validateGrowthBody
};
