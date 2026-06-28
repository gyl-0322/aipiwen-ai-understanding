/**
 * brand.js — 轻量品牌注入脚本
 *
 * 调用 /api/auth?action=brand，按租户上下文设置页面品牌。
 * B端未登录访问时可在 URL 携带 ?tid=xxx 透传租户 ID。
 *
 * 页面使用方式：
 *   - <img data-brand-logo src="/assets/logo.png" alt="logo">
 *   - <span data-brand-name>沐海星辰</span>
 *   - CSS 中引用 var(--brand-primary) / var(--brand-accent)
 *
 * 现阶段只有 consumer（aipiwen 默认），M3 B端租户直接在 Redis tenant 记录配置 brand 字段即可。
 */
(async () => {
  try {
    // 将页面 URL 中的 tid 透传给 API（未登录时的 B端品牌识别）
    const params = new URLSearchParams(window.location.search);
    const tid    = params.get('tid') || '';
    const url    = '/api/auth?action=brand' + (tid ? `&tid=${encodeURIComponent(tid)}` : '');

    const r    = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) return;
    const data = await r.json();
    if (!data.ok) return;

    const { name, logoUrl, primaryColor, accentColor } = data;

    // CSS 变量注入（影响整个页面）
    const root = document.documentElement;
    if (primaryColor) root.style.setProperty('--brand-primary', primaryColor);
    if (accentColor)  root.style.setProperty('--brand-accent',  accentColor);

    // Logo 图片替换
    if (logoUrl) {
      document.querySelectorAll('[data-brand-logo]').forEach(el => { el.src = logoUrl; });
    }

    // 品牌名称文字替换
    if (name) {
      document.querySelectorAll('[data-brand-name]').forEach(el => { el.textContent = name; });
      // <title> 中含旧品牌名时也替换
      if (document.title.includes('沐海星辰')) {
        document.title = document.title.replace(/沐海星辰/g, name);
      }
    }
  } catch {
    // 降级静默：保持页面硬编码值，不影响功能
  }
})();
