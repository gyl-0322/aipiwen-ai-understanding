(function () {
  'use strict';

  const REPORT_STATE_KEY = 'aipiwen.previewReportIntakeState.v1';
  const PRODUCTION_HOSTS = new Set(['aipiwen.cn', 'www.aipiwen.cn']);
  const NAMED_SOURCES = new Set([
    'moren_mima',
    'system_359',
    'aierfa',
    'yifuyihan',
    'zhai_guijun',
    'zhu_shi'
  ]);
  let normalizationTimerIds = [];

  if (PRODUCTION_HOSTS.has(window.location.hostname)) {
    sessionStorage.removeItem(REPORT_STATE_KEY);
    window.location.replace('/homepage.html');
    return;
  }

  function setReportState(status) {
    sessionStorage.setItem(REPORT_STATE_KEY, JSON.stringify({
      mode: 'preview-demo',
      status: status
    }));
  }

  function setStep(stepNumber) {
    if (stepNumber !== 3) clearNormalizationTimers();

    document.querySelectorAll('[data-intake-step]').forEach((panel) => {
      panel.hidden = Number(panel.dataset.intakeStep) !== stepNumber;
    });

    document.querySelectorAll('[data-intake-marker]').forEach((marker) => {
      const markerStep = Number(marker.dataset.intakeMarker);
      marker.classList.toggle('active', markerStep === stepNumber);
      marker.classList.toggle('done', markerStep < stepNumber);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function clearNormalizationTimers() {
    normalizationTimerIds.forEach((timerId) => window.clearTimeout(timerId));
    normalizationTimerIds = [];
  }

  function resetNormalization() {
    const button = document.getElementById('run-normalization');
    const startActions = document.getElementById('normalization-start-actions');
    const result = document.getElementById('normalization-result');

    clearNormalizationTimers();
    sessionStorage.removeItem(REPORT_STATE_KEY);

    document.querySelectorAll('[data-pipeline-item]').forEach((item) => {
      item.classList.remove('done');
      item.querySelector('small').textContent = '等待';
    });

    button.disabled = false;
    button.textContent = '开始统一处理';
    startActions.hidden = false;
    result.hidden = true;

    document.querySelectorAll('[data-demo-headquarters-submit]').forEach((item) => {
      item.disabled = false;
    });
    document.querySelectorAll('[data-blocker-message]').forEach((node) => {
      node.textContent = '';
    });
    document.querySelectorAll('[data-blocker-complete]').forEach((node) => {
      node.hidden = true;
    });
  }

  function showSourceOutcome(source) {
    const standard = document.getElementById('normalization-standard');
    const needsReview = document.getElementById('source-needs-review');
    const unsupported = document.getElementById('source-unsupported');
    const status = document.getElementById('normalization-status');

    resetNormalization();
    standard.hidden = true;
    needsReview.hidden = true;
    unsupported.hidden = true;

    if (source === 'unknown') {
      needsReview.hidden = false;
      status.className = 'status pending';
      status.textContent = '需总部确认';
      return;
    }

    if (source === 'other') {
      unsupported.hidden = false;
      status.className = 'status risk';
      status.textContent = '暂不支持';
      return;
    }

    if (NAMED_SOURCES.has(source)) {
      standard.hidden = false;
      status.className = 'status info';
      status.textContent = '等待开始';
    }
  }

  function runNormalization() {
    const button = document.getElementById('run-normalization');
    const status = document.getElementById('normalization-status');
    const startActions = document.getElementById('normalization-start-actions');
    const result = document.getElementById('normalization-result');
    const items = Array.from(document.querySelectorAll('[data-pipeline-item]'));
    let index = 0;

    clearNormalizationTimers();
    button.disabled = true;
    button.textContent = '统一处理中…';
    status.className = 'status info';
    status.textContent = '处理中';

    function completeNextItem() {
      const item = items[index];
      if (!item) {
        normalizationTimerIds = [];
        status.className = 'status done';
        status.textContent = '处理完成';
        startActions.hidden = true;
        result.hidden = false;
        setReportState('normalized');
        return;
      }

      item.classList.add('done');
      item.querySelector('small').textContent = '完成';
      index += 1;
      normalizationTimerIds.push(window.setTimeout(completeNextItem, 240));
    }

    completeNextItem();
  }

  function initReportIntake() {
    const useReport = document.getElementById('use-demo-report');
    const form = document.getElementById('source-confirmation-form');
    const source = document.getElementById('report-source');
    const otherSourceField = document.getElementById('other-source-field');
    const otherSourceName = document.getElementById('other-source-name');
    const confirmation = document.getElementById('source-confirmation-check');
    const message = document.getElementById('source-form-message');
    const runButton = document.getElementById('run-normalization');
    const showOutput = document.getElementById('show-aipiwen-output');
    if (!useReport || !form || !source || !otherSourceField || !otherSourceName || !confirmation || !runButton || !showOutput) return;

    sessionStorage.removeItem(REPORT_STATE_KEY);

    useReport.addEventListener('click', () => setStep(2));

    function syncSourceFields() {
      const isOther = source.value === 'other';
      const isUnknown = source.value === 'unknown';
      const reportEvidence = form.querySelector('[name="source-evidence"][value="report"]');
      const unknownEvidence = form.querySelector('[name="source-evidence"][value="not_confirmable"]');

      otherSourceField.hidden = !isOther;
      otherSourceName.required = isOther;
      if (!isOther) otherSourceName.value = '';

      if (isUnknown && unknownEvidence) {
        unknownEvidence.checked = true;
      } else if (!isUnknown && unknownEvidence && unknownEvidence.checked && reportEvidence) {
        reportEvidence.checked = true;
      }
    }

    source.addEventListener('change', syncSourceFields);

    document.querySelectorAll('[data-go-step]').forEach((button) => {
      button.addEventListener('click', () => setStep(Number(button.dataset.goStep)));
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      message.dataset.tone = 'error';

      if (!source.value) {
        message.textContent = '请选择报告原件明确显示的来源；无法确认时请选择“无法确认”。';
        source.focus();
        return;
      }

      const evidence = form.querySelector('[name="source-evidence"]:checked');
      if (source.value === 'unknown' && (!evidence || evidence.value !== 'not_confirmable')) {
        message.textContent = '无法确认来源时，依据必须选择“原件未明确，当前无法确认”。';
        return;
      }

      if (source.value !== 'unknown' && evidence && evidence.value === 'not_confirmable') {
        message.textContent = '当前依据不足，请改选“无法确认”，不要推断具体来源。';
        return;
      }

      if (source.value === 'other' && !otherSourceName.value.trim()) {
        message.textContent = '请按报告原件填写其他来源名称；该名称只在本页临时使用。';
        otherSourceName.focus();
        return;
      }

      if (!confirmation.checked) {
        message.textContent = '请先确认来源依据，避免根据个人印象推断。';
        confirmation.focus();
        return;
      }

      message.textContent = '';
      otherSourceName.value = '';
      showSourceOutcome(source.value);
      setStep(3);
    });

    runButton.addEventListener('click', runNormalization);
    showOutput.addEventListener('click', () => {
      setReportState('output-ready');
      setStep(4);
    });

    document.querySelectorAll('[data-demo-headquarters-submit]').forEach((button) => {
      button.addEventListener('click', () => {
        const blocker = button.closest('.intake-blocker');
        const blockerMessage = blocker ? blocker.querySelector('[data-blocker-message]') : null;
        const blockerComplete = blocker ? blocker.querySelector('[data-blocker-complete]') : null;

        button.disabled = true;
        if (blockerMessage) {
          blockerMessage.dataset.tone = 'success';
          blockerMessage.textContent = '已模拟提交总部；没有保存来源、创建真实任务或写入任何远程系统。';
        }
        if (blockerComplete) blockerComplete.hidden = false;
        setReportState('headquarters-review');
      });
    });

    document.querySelectorAll('#reset-intake, [data-reset-intake]').forEach((button) => {
      button.addEventListener('click', () => {
        clearNormalizationTimers();
        sessionStorage.removeItem(REPORT_STATE_KEY);
        window.location.reload();
      });
    });

    syncSourceFields();
    setStep(1);
  }

  document.addEventListener('DOMContentLoaded', initReportIntake);
})();
