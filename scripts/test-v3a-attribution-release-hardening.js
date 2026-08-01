#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/022_v3a_advisor_attribution.sql');
const admin = read('api/v3a-admin.js');
const upload = read('report-upload.html');
const reportStore = read('api/generate-report.js');

let checks = 0;
function match(source, pattern, message) {
  checks += 1;
  assert.match(source, pattern, message);
}

// Super Admin assignment must stay behind the complete BFF security chain.
match(admin, /requireSameOrigin\(req, config\)/, 'assign 必须经过 SameOrigin');
match(admin, /requireCsrf\(req, loaded\)/, 'assign 必须经过 CSRF');
match(admin, /requireActiveSuperAdmin\(config, session\)/, 'assign 必须要求 active super_admin Session');
match(admin, /action === 'assign'[\s\S]*assignClient\(config, admin, body\)/,
  'assign 必须通过受控 BFF 调用事务');
match(migration, /from public\.advisor_clients c[\s\S]*where c\.id = p_client_id[\s\S]*for update;/,
  'assign 必须先锁定目标客户');
match(migration, /where id = p_client_id\s+and advisor_user_id is null;/,
  'assign 更新必须只接受未分配客户');
match(migration, /u\.role = 'advisor'[\s\S]*u\.status = 'active'/,
  'assign 必须校验目标 active advisor');
match(migration,
  /jsonb_build_object\([\s\S]*'clientId'[\s\S]*'previousAdvisorId'[\s\S]*'newAdvisorId'[\s\S]*'reason'[\s\S]*'assignedAt'/,
  'ASSIGN_CLIENT 审计必须包含归属前后、原因和时间');

// The only upload page must preserve OCR -> generation -> report-store -> attribution.
match(upload, /fetch\('\/api\/extract-fp'/, '上传页必须调用现有 OCR');
match(upload, /fetch\('\/api\/generate-report'/, '上传页必须调用现有 Report Engine');
match(upload, /fetch\('\/api\/report-store'/, '上传页必须调用现有 report-store');
match(upload, /attributionToken:\s*_attributionToken/, 'report-store 请求必须携带 URL attribution token');
match(upload, /_saveReportForClient\(data\.sections\)/, '报告生成成功后必须进入归属存储');
match(reportStore, /v3a_store_attributed_report/, 'report-store 必须使用原子 attribution RPC');
match(reportStore, /source:\s*attribution\.source/, 'KV 报告必须保留 attribution source');
match(reportStore, /delete publicReport\.advisor_id/, '公开报告不得泄露内部 advisor id');

console.log(`PASS: Phase B-2 attribution release hardening (${checks} checks)`);
