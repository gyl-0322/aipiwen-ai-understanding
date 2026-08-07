# AIPIWEN AI Interpretation 16-Module V3 Review Report

## 1. Status

**READY FOR CLAUDE REVIEW / NOT AUTHORIZED FOR MIGRATION OR DEPLOYMENT**

Production was not modified. Migration 030 was not executed in Preview or Production.

## 2. Product correction

The former 8-step abstraction compressed multiple report modules into the same step. V3 freezes the advisor workflow as 16 independently reviewable modules:

1. 建立安全感
2. 严正声明四原则
3. 性格类型
4. TRC
5. ATD
6. 学习通道
7. 行为模式
8. 左右脑
9. 精神功能
10. 思维功能
11. 体觉功能
12. 听觉功能
13. 视觉功能
14. 客户关注问题
15. 行动建议
16. 记录客户反馈 / 必要时提交总部复核

Every module must contain the same six structured guidance categories. Minimum output is enforced for every customer: `why >= 2`, `say >= 3`, `ask >= 2`, `no >= 2`, `action >= 3`, and `risk >= 2`.

## 3. Root cause found during Preview E2E

Migration 029 permanently constrained `interpretation_data` to `version = 1`, status `generated/edited`, and exactly 8 steps. Therefore a 16-module plan could not be persisted even when AI generation completed.

Three Preview candidates were exercised while diagnosing the runtime. All returned a failed result and are **not release candidates**:

- `dpl_BXV96VuBV5DLXpwkLqM4TCMsfGPo`
- `dpl_HZtZ8ZK7rCoJaXVCZyC2Shhn3bbf`
- `dpl_HECBYY32FretZ4XWaCyKpRxQKggx`

No completed V3 interpretation was stored by these failed attempts.

## 4. Migration 030

`supabase/migrations/030_v3a_advisor_interpretation_v3.sql`:

- preserves legacy V1 `generated/edited` plans with exactly 8 steps;
- allows V3 `generating` plans with 2, 4, 6, 8, 10, 12, or 14 completed modules;
- requires V3 `generated/edited` plans to contain exactly 16 modules;
- retains the 64 KiB storage boundary;
- retains advisor ownership derivation from `auth.uid()`;
- grants RPC execution only to `authenticated`;
- does not grant browser table writes;
- does not delete or rewrite existing customer, report, or interpretation data.

## 5. Resumable generation design

The browser requests one two-module group at a time. The BFF validates and persists each successful group before continuing. Progress is returned as `completed / 16`.

If a later group fails, completed groups remain in `status = generating`. Reopening the same report resumes at the next missing module. The advisor generation rate limit is consumed only when a new plan starts, not for each continuation request.

Only after all 16 modules pass the detailed output validator is the status changed to `generated`.

## 6. Compatibility

- Legacy generated plans are upgraded when a new V3 plan is started.
- Legacy plans already edited by an advisor remain readable and editable as 8-step plans; they are not silently overwritten.
- V3 completed plans remain editable through the existing save operation.
- No Auth, Session, attribution, Report Engine, credit, payment, or customer ownership logic changed.

## 7. Verification

- 20 related regression scripts: PASS
- Node syntax checks: PASS
- Git diff check: PASS
- Vercel Function budget: 12/12 PASS
- Local temporary PostgreSQL rehearsal: PASS
- Legacy V1 data preservation: PASS
- V3 partial states: PASS
- V3 completed 16-module state: PASS
- Invalid V3 completed 8-module state: rejected
- RPC privilege postflight: PASS
- Temporary rehearsal database removed: PASS

## 8. Required release order

1. Claude read-only review of Migration 030, BFF, frontend loop, validators, tests, and this report.
2. Separate authorization for **Preview Migration 030**.
3. Execute Migration 030 in Preview and verify postflight.
4. Deploy the reviewed commit to Preview.
5. Run two-client synthetic E2E and verify all 16 modules and all six guidance categories.
6. Only after Preview PASS, request separate Production authorization.

## 9. Prohibited next actions

- Do not execute Migration 030 before review and authorization.
- Do not deploy this candidate to Production.
- Do not use real customer reports for E2E.
- Do not lower the per-module completeness standard to avoid generation failures.
