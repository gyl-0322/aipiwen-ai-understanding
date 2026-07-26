#!/usr/bin/env node
'use strict';

const readline = require('readline');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class BindingError extends Error {}

function normalize(value) {
  return String(value || '').trim();
}

function parseSupabaseConfig(env = process.env) {
  const projectRef = normalize(env.V3A_SUPABASE_PROJECT_REF);
  const supabaseUrl = normalize(env.V3A_SUPABASE_URL).replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    parsed = null;
  }
  if (
    !projectRef || !parsed || parsed.protocol !== 'https:' ||
    parsed.username || parsed.password || parsed.port ||
    parsed.hostname !== `${projectRef}.supabase.co` ||
    parsed.origin !== supabaseUrl || parsed.pathname !== '/' || parsed.search || parsed.hash
  ) {
    throw new BindingError('Supabase 环境配置无效，已停止。');
  }
  return { projectRef, supabaseUrl };
}

function normalizeChinaPhone(value) {
  let phone = normalize(value).replace(/[\s()-]/g, '');
  if (phone.startsWith('+86')) phone = phone.slice(3);
  else if (phone.startsWith('0086')) phone = phone.slice(4);
  else if (phone.startsWith('86') && phone.length === 13) phone = phone.slice(2);
  if (!/^1[3-9][0-9]{9}$/.test(phone)) throw new BindingError('请输入有效的中国大陆手机号。');
  return `+86${phone}`;
}

function maskPhone(phone) {
  return `+86 ${phone.slice(3, 6)}****${phone.slice(-4)}`;
}

function validateInputs(anonKey, email, password) {
  if (!anonKey || anonKey.length > 4096 || /\s/.test(anonKey)) throw new BindingError('Supabase anon key 无效。');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) throw new BindingError('邮箱格式无效。');
  if (!password || password.length > 1024) throw new BindingError('邮箱账号密码无效。');
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestJson(fetchImpl, supabaseUrl, path, { method = 'GET', anonKey, accessToken, body, errorMessage }) {
  let response;
  try {
    response = await fetchImpl(`${supabaseUrl}${path}`, {
      method,
      headers: {
        apikey: anonKey,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new BindingError(errorMessage);
  }
  const payload = await readJson(response);
  if (!response.ok) throw new BindingError(errorMessage);
  return payload;
}

async function syncAndConfirmPublicPhone(fetchImpl, supabaseUrl, anonKey, accessToken, authUserId, phone) {
  const syncResult = await requestJson(fetchImpl, supabaseUrl, '/rest/v1/rpc/v3a_sync_own_first_super_admin_phone', {
    method: 'POST',
    anonKey,
    accessToken,
    body: {},
    errorMessage: 'Auth 手机号已验证，但业务身份同步失败，已停止；不要创建第二个账号。'
  });
  if (syncResult?.success !== true) {
    throw new BindingError('Auth 手机号已验证，但业务身份同步结果无效，已停止；不要创建第二个账号。');
  }

  const query = new URLSearchParams({
    select: 'auth_user_id,role,status,phone',
    auth_user_id: `eq.${authUserId}`,
    limit: '2'
  });
  const rows = await requestJson(fetchImpl, supabaseUrl, `/rest/v1/users?${query.toString()}`, {
    anonKey,
    accessToken,
    errorMessage: '无法回读业务身份手机号，已停止。'
  });
  if (
    !Array.isArray(rows) || rows.length !== 1 || rows[0]?.auth_user_id !== authUserId ||
    rows[0]?.role !== 'super_admin' || rows[0]?.status !== 'active' || rows[0]?.phone !== phone
  ) {
    throw new BindingError('Auth 与业务身份手机号未能证明一致，已停止；请立即人工核查。');
  }
}

async function bindFirstAdminPhone(options) {
  const fetchImpl = options.fetchImpl || fetch;
  const { supabaseUrl } = parseSupabaseConfig(options.env || process.env);
  const anonKey = normalize(options.anonKey);
  const email = normalize(options.email).toLowerCase();
  const password = String(options.password || '');
  const phone = normalizeChinaPhone(options.phone);
  validateInputs(anonKey, email, password);

  const auth = await requestJson(fetchImpl, supabaseUrl, '/auth/v1/token?grant_type=password', {
    method: 'POST',
    anonKey,
    body: { email, password },
    errorMessage: '现有邮箱账号认证失败，已停止。'
  });
  const authUserId = normalize(auth?.user?.id);
  const accessToken = normalize(auth?.access_token);
  const authEmail = normalize(auth?.user?.email).toLowerCase();
  if (
    !UUID_PATTERN.test(authUserId) || !accessToken || !auth?.user?.email_confirmed_at ||
    !authEmail || authEmail !== email
  ) {
    throw new BindingError('现有邮箱账号身份不符合换绑条件，已停止。');
  }

  let logoutAccessToken = accessToken;
  try {
    const query = new URLSearchParams({
      select: 'id,auth_user_id,email,role,status,phone',
      auth_user_id: `eq.${authUserId}`,
      limit: '2'
    });
    const rows = await requestJson(fetchImpl, supabaseUrl, `/rest/v1/users?${query.toString()}`, {
      anonKey,
      accessToken,
      errorMessage: '无法确认总部管理员映射，已停止。'
    });
    const publicUser = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    const publicUserId = normalize(publicUser?.id);
    if (
      !publicUser || !UUID_PATTERN.test(publicUserId) || publicUser.auth_user_id !== authUserId ||
      normalize(publicUser.email).toLowerCase() !== authEmail ||
      publicUser.role !== 'super_admin' || publicUser.status !== 'active'
    ) {
      throw new BindingError('当前邮箱账号不是唯一的 active super_admin，已停止。');
    }

    const auditQuery = new URLSearchParams({
      select: 'id,admin_id,target_id,details',
      action: 'eq.FIRST_SUPER_ADMIN',
      admin_id: `eq.${publicUserId}`,
      target_id: `eq.${publicUserId}`,
      limit: '2'
    });
    const auditRows = await requestJson(fetchImpl, supabaseUrl, `/rest/v1/admin_audit_logs?${auditQuery.toString()}`, {
      anonKey,
      accessToken,
      errorMessage: '无法确认首位总部管理员审计标记，已停止。'
    });
    if (
      !Array.isArray(auditRows) || auditRows.length !== 1 ||
      normalize(auditRows[0]?.admin_id) !== publicUserId ||
      normalize(auditRows[0]?.target_id) !== publicUserId ||
      normalize(auditRows[0]?.details?.auth_user_id) !== authUserId
    ) {
      throw new BindingError('首位总部管理员审计标记不完整，已停止。');
    }

    const existingPhone = normalize(auth.user.phone);
    const phoneConfirmed = Boolean(auth.user.phone_confirmed_at);
    if (existingPhone !== '' && !phoneConfirmed) {
      throw new BindingError('该账号存在未确认的 Auth 手机号状态，已停止；请先人工核查。');
    }
    if (existingPhone && auth.user.phone_confirmed_at) {
      if (existingPhone !== phone) throw new BindingError('该总部账号已经绑定其他手机号，已停止。');
      if (publicUser.phone && publicUser.phone !== phone) {
        throw new BindingError('Auth 与业务身份手机号冲突，已停止；请立即人工核查。');
      }
      await syncAndConfirmPublicPhone(fetchImpl, supabaseUrl, anonKey, accessToken, authUserId, phone);
      return { alreadyBound: true, publicPhoneSynced: true, phoneMasked: maskPhone(phone) };
    }
    if (publicUser.phone !== null) {
      throw new BindingError('业务身份已经存在手机号，已停止；请先人工核查。');
    }
    if (normalize(auth.user.phone_change)) {
      throw new BindingError('该账号已有未完成的手机号换绑记录，已停止；请先人工核查，不要自动清理。');
    }

    if (typeof options.beforePhoneChange !== 'function' || await options.beforePhoneChange({ phone, authUserId }) !== true) {
      throw new BindingError('发码前只读预检未确认，已停止。');
    }

    const update = await requestJson(fetchImpl, supabaseUrl, '/auth/v1/user', {
      method: 'PUT',
      anonKey,
      accessToken,
      body: { phone, channel: 'sms' },
      errorMessage: '手机号换绑验证码未能发送，已停止。'
    });
    if (normalize(update?.id) !== authUserId) {
      throw new BindingError('发码后的 Auth UUID 不一致，已停止。');
    }

    if (typeof options.afterPhoneChange !== 'function' || await options.afterPhoneChange({ phone, authUserId }) !== true) {
      throw new BindingError('验证码提交前只读预检未确认，已停止；远端可能保留待确认手机号，不要自动重试或清理。');
    }

    const otp = normalize(typeof options.getOtp === 'function'
      ? await options.getOtp({ phone, authUserId })
      : options.otp);
    if (!/^[0-9]{6}$/.test(otp)) throw new BindingError('请输入 6 位短信验证码。');

    const verified = await requestJson(fetchImpl, supabaseUrl, '/auth/v1/verify', {
      method: 'POST',
      anonKey,
      accessToken,
      body: { phone, token: otp, type: 'phone_change' },
      errorMessage: '手机号换绑验证码无效或已失效，已停止。'
    });
    if (
      normalize(verified?.user?.id) !== authUserId ||
      normalize(verified?.user?.phone) !== phone ||
      !verified?.user?.phone_confirmed_at ||
      !normalize(verified?.access_token)
    ) {
      throw new BindingError('换绑结果未能证明是同一 Auth UUID，已停止；请立即人工核查。');
    }
    logoutAccessToken = normalize(verified.access_token);
    await syncAndConfirmPublicPhone(fetchImpl, supabaseUrl, anonKey, logoutAccessToken, authUserId, phone);
    return { alreadyBound: false, publicPhoneSynced: true, phoneMasked: maskPhone(phone) };
  } finally {
    await requestJson(fetchImpl, supabaseUrl, '/auth/v1/logout?scope=local', {
      method: 'POST',
      anonKey,
      accessToken: logoutAccessToken,
      errorMessage: '临时邮箱会话退出失败。'
    }).catch(() => null);
  }
}

function promptVisible(label) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(label, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

function promptSecret(label) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new BindingError('当前终端不支持安全隐藏输入，已停止。');
  }
  process.stdout.write(label);
  return new Promise((resolve, reject) => {
    let value = '';
    function finish(error) {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    }
    function onData(buffer) {
      for (const character of buffer.toString('utf8')) {
        if (character === '\u0003') return finish(new BindingError('操作已取消。'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

async function main() {
  if (!process.argv.includes('--environment-write-approved')) {
    throw new BindingError('缺少 --environment-write-approved；本工具会发送短信并修改当前环境 Auth，已停止。');
  }
  parseSupabaseConfig(process.env);
  const approval = normalize(await promptVisible('确认当前环境已获写入批准后输入 ENVIRONMENT_APPROVED：'));
  if (approval !== 'ENVIRONMENT_APPROVED') {
    throw new BindingError('当前环境写入未确认，已停止。');
  }

  let anonKey = normalize(process.env.V3A_SUPABASE_ANON_KEY);
  let password = '';
  let otp = '';
  try {
    if (!anonKey) anonKey = await promptSecret('请输入 Supabase anon key（不会显示或保存）：');
    const email = await promptVisible('请输入现有 super_admin 邮箱：');
    password = await promptSecret('请输入现有邮箱账号密码（不会显示或保存）：');
    const phone = await promptVisible('请输入要绑定的中国大陆手机号：');
    const result = await bindFirstAdminPhone({
      anonKey,
      email,
      password,
      phone,
      otp,
      beforePhoneChange: async () => normalize(await promptVisible(
        '请先完成文档中的只读预检 A；结果完全符合时输入 PRECHECK_A_OK：'
      )) === 'PRECHECK_A_OK',
      afterPhoneChange: async () => normalize(await promptVisible(
        '短信已发送。请完成只读预检 B；结果完全符合时输入 PRECHECK_B_OK：'
      )) === 'PRECHECK_B_OK',
      getOtp: async () => {
        otp = await promptSecret('请输入收到的 6 位验证码（不会显示或保存）：');
        return otp;
      }
    });
    process.stdout.write(result.alreadyBound
      ? `PASS: 该总部账号已绑定 ${result.phoneMasked}，未重复换绑；业务身份已同步核对。\n`
      : `PASS: ${result.phoneMasked} 已绑定到原总部 Auth 账号，并同步到同一业务身份。\n`);
  } finally {
    anonKey = '';
    password = '';
    otp = '';
  }
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof BindingError ? error.message : '操作失败，已停止。';
    process.stderr.write(`BLOCKED: ${message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  BindingError,
  parseSupabaseConfig,
  normalizeChinaPhone,
  bindFirstAdminPhone
};
