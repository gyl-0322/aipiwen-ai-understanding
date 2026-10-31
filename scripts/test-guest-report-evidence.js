const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '../js/aipiwen-core.js'), 'utf8');
const context = { console, localStorage: { getItem() { return null; }, setItem() {} } };
context.window = context;
vm.createContext(context);
vm.runInContext(`${code}\nthis.AnalysisEngine = AnalysisEngine;\nthis.ContentLibrary = ContentLibrary;`, context);

const fake = context.AnalysisEngine.analyze('这是一段明显假的测试备注，没有具体行为。', []);
if (fake.primary === 'emotional_explosion') {
  throw new Error('无行为事实的备注被标成情绪爆发');
}
if (fake.evidence !== 'insufficient') {
  throw new Error(`证据等级应为 insufficient，实际 ${fake.evidence}`);
}
const fakeReport = context.ContentLibrary.fullReport(fake);
if (fakeReport.label === '情绪爆发' || /1100万|科学依据：/.test(`${fakeReport.structHeading}\n${fakeReport.structBody}`)) {
  throw new Error('信息不足的报告仍在做危机或无出处科学断言');
}

const matched = context.AnalysisEngine.analyze('孩子一说作业就发脾气，还摔东西。', []);
if (matched.primary !== 'emotional_explosion') {
  throw new Error(`明确的发脾气描述应仍能匹配情绪爆发，实际 ${matched.primary}`);
}
const matchedReport = context.ContentLibrary.fullReport(matched);
if (/科学依据：|1100万/.test(matchedReport.structBody)) {
  throw new Error('已匹配行为仍写了无出处科学依据');
}
if (!/证据等级/.test(matchedReport.structBody)) {
  throw new Error('已匹配行为没有证据等级说明');
}

console.log('PASS: guest report evidence stays below the facts');
