#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '012_v3a_phone_first_super_admin_bootstrap.sql'),
  'utf8'
);

const signature = migration.match(
  /create function public\.v3a_create_first_super_admin_from_phone_auth\(([^)]*)\)/i
);
assert(signature, '012 必须新增 phone-first super_admin bootstrap 函数');
assert(/drop function if exists public\.v3a_bootstrap_first_super_admin\(uuid,\s*text\);/i.test(migration),
  '012 必须移除旧 006 owner-only bootstrap 精确签名，关闭并发双管理员入口');
assert(/drop function if exists public\.v3a_create_first_super_admin_from_auth\(uuid,\s*text\);/i.test(migration),
  '012 必须移除 009 email-era bootstrap 精确签名，确保手机号是唯一初始化入口');
assert(!/drop function(?: if exists)? public\.v3a_sync_own_first_super_admin_phone\s*\(/i.test(migration),
  '012 必须保留 011 历史首管理员手机号同步入口');
assert(/p_user_id\s+uuid/i.test(signature[1]) && /p_display_name\s+text/i.test(signature[1]),
  '012 只能接收 Auth UUID 和显示名');
assert(!/p_(phone|email)/i.test(signature[1]), '012 不得接收客户端手机号或邮箱参数');

assert(migration.includes('security definer') && migration.includes('set search_path = public, pg_temp'),
  '012 必须固定 SECURITY DEFINER search_path');
assert(migration.includes("hashtext('v3a_create_first_super_admin_from_auth')"),
  '012 必须沿用既有全局 advisory lock key，串行化所有手机号初始化尝试');
assert(migration.includes('from auth.users auth_user') && migration.includes('where auth_user.id = p_user_id'),
  '012 必须从指定 Auth UUID 的 auth.users 行派生身份');
assert(/where auth_user\.id = p_user_id\s+for update;/i.test(migration),
  '012 必须锁定目标 auth.users 行');
assert(migration.includes("v_phone := nullif(btrim(coalesce(v_auth ->> 'phone'"),
  '012 必须从 auth.users 派生手机号');
assert(migration.includes("nullif(v_auth ->> 'phone_confirmed_at', '') is null"),
  '012 必须要求 Auth 手机号已验证');
assert(migration.includes("v_phone !~ '^[+]861[3-9][0-9]{9}$'"),
  '012 必须只接受 +86 E.164 中国大陆手机号');
assert(!migration.includes('email_confirmed_at') && !migration.includes('AUTH_EMAIL'),
  '012 不得保留邮箱前置条件');

assert(migration.includes("audit.action = 'FIRST_SUPER_ADMIN'"),
  '012 必须复用 FIRST_SUPER_ADMIN 永久关闭标记');
assert(migration.includes("'FIRST_SUPER_ADMIN:' || v_public_user_id::text"),
  '012 必须复用 FIRST_SUPER_ADMIN 幂等键');
assert(migration.includes("users_row.role = 'super_admin'") &&
  migration.includes("users_row.status = 'active'"),
  '012 必须在已有 active super_admin 时关闭 bootstrap');
assert(migration.includes("'already_initialized', true") &&
  migration.includes("'already_initialized', false"),
  '012 必须支持同一已完成身份的幂等回读');

const userInsert = migration.match(
  /insert into public\.users \([\s\S]*?\n\s*\);/i
);
assert(userInsert, '012 必须原子创建 public.users 映射');
assert(userInsert[0].includes("'super_admin'") && userInsert[0].includes("'active'"),
  '012 必须直接创建 active / super_admin');
assert(/\bphone\b/i.test(userInsert[0]) && /\bv_phone\b/i.test(userInsert[0]),
  '012 必须写入 Auth 派生手机号');
assert(/\bemail\b/i.test(userInsert[0]) && /\bnull\b/i.test(userInsert[0]),
  '012 必须明确保持 public.users.email 为 null');

const auditInsert = migration.match(
  /insert into public\.admin_audit_logs \([\s\S]*?returning id into v_audit_log_id;/i
);
assert(auditInsert, '012 必须在同一函数内写入 FIRST_SUPER_ADMIN 审计');
assert(auditInsert[0].includes("'FIRST_SUPER_ADMIN'"), '012 审计 action 必须正确');
assert(!/v_phone|['"]phone['"]/i.test(auditInsert[0]), '012 审计不得记录手机号');

const insertTargets = [...migration.matchAll(/insert\s+into\s+public\.([a-z_]+)/gi)]
  .map((match) => match[1]);
assert.deepEqual(insertTargets, ['users', 'admin_audit_logs'],
  '012 只能创建 public.users 和 public.admin_audit_logs 数据');

assert(migration.includes(
  'revoke all on function public.v3a_create_first_super_admin_from_phone_auth(uuid, text)'
) && migration.includes('from public, anon, authenticated, service_role'),
  '012 必须撤销非 owner 执行权');
assert(!/grant\s+execute\s+on\s+function\s+public\.v3a_create_first_super_admin_from_phone_auth/i.test(migration),
  '012 不得把执行权授予任何运行时角色');

console.log('PASS: 012 phone-first bootstrap is owner-only, phone-derived, idempotent, and creates no advisor business data');
