#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const {
  searchReportKnowledge,
  buildReportGroundingBlock,
} = require('../lib/report-knowledge-index');

const root = path.resolve(__dirname, '..');
const guestSource = fs.readFileSync(path.join(root, 'api/guest-chat.js'), 'utf8');
const chatPageSource = fs.readFileSync(path.join(root, 'child-chat.html'), 'utf8');
const reportPageSource = fs.readFileSync(path.join(root, 'report-upload.html'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(guestSource.includes("const trcContent = isReportContext ? TRC_SECTION : '';"), '普通行为理解仍会注入 TRC/ATD 知识');
assert(!guestSource.includes('history.length >= 4;'), '普通对话仍会因轮数自动开启 TRC 知识');
assert(guestSource.includes('普通行为理解的术语边界'), '普通行为理解缺少术语禁用规则');
assert(guestSource.includes('不得输出/解释 TRC, ATD') || guestSource.includes('不能出现在用户可见回答中'), '普通行为理解未禁止裸露术语');
assert(guestSource.includes("searchReportKnowledge(query"), '行为理解没有接入 Report Knowledge Index');
assert(!guestSource.includes('如果识别出TRC类型，用1-2句自然引入'), '普通亲子提示仍鼓励猜测 TRC 类型');
assert(!guestSource.includes('如果伴侣的行为模式高度匹配某TRC类型'), '普通关系提示仍鼓励猜测 TRC 类型');
assert(guestSource.includes('检索失败时静默回退现有提示词'), '知识检索缺少失败兜底说明');

assert(chatPageSource.includes("context:         isReportDeepChat ? 'report' : _for"), '报告深聊没有切换到 report context');
assert(chatPageSource.includes('reportSummary:   isReportDeepChat ? sessionPrevContext : null'), '报告摘要没有传给深聊接口');
assert(reportPageSource.includes('onclick="openDeepChat()"'), '报告问题页或末页没有通过 openDeepChat 传递上下文');

const plainHits = searchReportKnowledge('小学 写作业拖拉 家长 一催就炸', {
  topK: 3,
  allowedStatuses: ['auto_safe', 'rewrite_required'],
});
assert(plainHits.length > 0, '普通行为问题没有命中知识索引');
assert(plainHits.some(hit => /拖拉|启动|被催/.test(hit.title)), '普通行为问题命中内容不贴近场景');
const grounding = buildReportGroundingBlock(plainHits, { maxItems: 3 });
assert(!grounding.includes('/Users/'), '知识底座暴露了本地路径');
assert(!grounding.includes('teacher_report_reading_001'), '知识底座暴露了原始资料文件名');

console.log(JSON.stringify({
  ok: true,
  plainBehaviorHits: plainHits.map(hit => hit.id),
  standaloneUsesReportTerms: false,
  reportDeepChatCarriesSummary: true,
  retrievalFallbackPreserved: true,
}, null, 2));
