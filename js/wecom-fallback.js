(function () {
  'use strict';

  const DEFAULT_URL = 'https://work.weixin.qq.com/kfid/kfc6ce446e6e057c683';

  function isPhoneWechat(ua) {
    return /MicroMessenger|Android|iPhone|iPod/i.test(ua || '');
  }

  function ensureModal() {
    let modal = document.getElementById('aipiwen-wecom-fallback');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'aipiwen-wecom-fallback';
    modal.hidden = true;
    modal.style.cssText = 'position:fixed;inset:0;z-index:1400;background:rgba(26,23,20,.72);display:flex;align-items:flex-end;justify-content:center;padding:20px;';
    modal.innerHTML = '<div role="dialog" aria-modal="true" aria-labelledby="aipiwen-wecom-title" style="width:min(440px,100%);background:#FDFCF8;color:#1A1714;border-radius:18px;padding:22px 20px 18px;box-shadow:0 24px 64px rgba(0,0,0,.28);">'
      + '<h2 id="aipiwen-wecom-title" style="margin:0 0 8px;font-size:18px;">请用手机微信打开</h2>'
      + '<p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#4A4540;">桌面浏览器打开企业微信客服链接时，常会停在空白页并试图拉起外部应用。请复制链接，到手机微信里打开。</p>'
      + '<p id="aipiwen-wecom-url" style="margin:0 0 14px;padding:10px 12px;background:#F5F3EE;border-radius:10px;word-break:break-all;font-size:13px;"></p>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
      + '<button type="button" id="aipiwen-wecom-copy" style="border:0;background:#C2692A;color:#fff;border-radius:10px;padding:10px 14px;cursor:pointer;">复制链接</button>'
      + '<button type="button" id="aipiwen-wecom-close" style="border:1px solid #EAE7E2;background:#fff;border-radius:10px;padding:10px 14px;cursor:pointer;">关闭</button>'
      + '</div></div>';
    document.body.append(modal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) modal.hidden = true;
    });
    modal.querySelector('#aipiwen-wecom-close').addEventListener('click', () => {
      modal.hidden = true;
    });
    modal.querySelector('#aipiwen-wecom-copy').addEventListener('click', async () => {
      const url = modal.dataset.url || DEFAULT_URL;
      try {
        await navigator.clipboard.writeText(url);
        modal.querySelector('#aipiwen-wecom-copy').textContent = '已复制';
      } catch {
        modal.querySelector('#aipiwen-wecom-copy').textContent = '请手动选择上方链接';
      }
    });
    return modal;
  }

  function open(event, href) {
    if (event) event.preventDefault();
    const url = href || DEFAULT_URL;
    if (isPhoneWechat(navigator.userAgent)) {
      window.location.href = url;
      return;
    }
    const modal = ensureModal();
    modal.dataset.url = url;
    modal.querySelector('#aipiwen-wecom-url').textContent = url;
    modal.querySelector('#aipiwen-wecom-copy').textContent = '复制链接';
    modal.hidden = false;
  }

  window.AIPIWEN_WECOM = Object.freeze({ open, isPhoneWechat });

  document.addEventListener('click', (event) => {
    const link = event.target.closest && event.target.closest('a[href*="work.weixin.qq.com/kfid/"]');
    if (!link) return;
    open(event, link.href);
  }, true);
}());
