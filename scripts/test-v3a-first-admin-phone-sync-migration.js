#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '011_v3a_first_super_admin_phone_sync.sql'),
  'utf8'
);
const tool = fs.readFileSync(path.join(root, 'scripts', 'v3a-bind-first-admin-phone.js'), 'utf8');

assert(migration.includes('create function public.v3a_sync_own_first_super_admin_phone()'),
  '011 必须使用无参数同步函数');
assert(migration.includes('security definer') && migration.includes('set search_path = public, pg_temp'),
  '011 必须固定 SECURITY DEFINER search_path');
assert(migration.includes('v_auth_user_id := auth.uid()') && migration.includes("v_claims := coalesce(auth.jwt()"),
  '011 必须从当前 Supabase 身份派生 UUID 和 JWT');
assert(migration.includes("v_auth_phone := nullif(btrim(coalesce(v_auth ->> 'phone'"),
  '011 必须从 auth.users 派生手机号');
assert(migration.includes("v_jwt_phone is distinct from v_auth_phone"),
  '011 必须校验 JWT phone 与 auth.users.phone 一致');
assert(migration.includes("audit.action = 'FIRST_SUPER_ADMIN'"),
  '011 必须锁定 009 的首位 super_admin 审计标记');
assert(migration.includes("v_user.role <> 'super_admin'") && migration.includes("v_user.status <> 'active'"),
  '011 只能同步 active super_admin');
assert(migration.includes("set phone = v_auth_phone") && !/set\s+phone\s*=\s*p_/i.test(migration),
  'public.users.phone 必须只接受 Auth 派生值');
const auditInserts = [...migration.matchAll(
  /insert into public\.admin_audit_logs \([\s\S]*?returning id into v_audit_log_id;/g
)];
assert.equal(auditInserts.length, 2, '011 新写和幂等补写路径都必须生成审计');
assert(auditInserts.every((match) => !/'phone'\s*,/i.test(match[0])),
  '011 审计不得记录手机号');
assert(migration.includes('from public, anon, authenticated, service_role') &&
  migration.includes('grant execute on function public.v3a_sync_own_first_super_admin_phone()\n  to authenticated'),
  '011 必须撤销默认执行权，只授权 authenticated');

assert(tool.includes("'/rest/v1/rpc/v3a_sync_own_first_super_admin_phone'"),
  '本机工具必须在 Auth 验证后调用 011');
assert(tool.includes('body: {}'), '同步 RPC 不得接收手机号或 UUID 参数');
assert(tool.includes("select: 'auth_user_id,role,status,phone'"),
  '本机工具必须回读 public.users.phone');
assert(tool.includes('rows[0]?.phone !== phone'), '回读手机号必须与同一 Auth 手机号一致');

console.log('PASS: 011 derives phone from same verified Auth UUID, synchronizes public mapping, and writes no phone to audit');
