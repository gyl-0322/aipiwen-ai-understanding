# AIPIWEN V4 Production Release Provenance V1.0

## Controlled evidence record

| Field | Verified value |
|---|---|
| Production source commit | `4c1bc9106c086d440c8287e4968ef7dd2d788b95` |
| Source tree | `2aef7a52f5f29f7a5f8f358fc144681aabd861a9` |
| Parent | `2ed2870b73baf8e2182161ec4735075f2bc19b4e` |
| Recovered remote branch | `recovery/v4-production-sot-20260813` |
| Migration 033 SHA-256 | `4c7c77475e652b1ac5d5f15fb0edaf7cdd91df36410f35c91e66b30d71c65df7` |
| Preview Supabase | `lmjriqncuopgxwyudfee` |
| Production Supabase | `tysbwijizgebnrazxpvo` |
| Preview deployments | `dpl_24depE2iBm5bhqcsXAGAFAbhDURR`; `dpl_6AThhyrvE7eb932h9GCpN1dz4s3o` |
| Production deployment | `dpl_4KnKteVky3rmwJzjeLX6hNaKLRnw` |
| Object fingerprint, both databases | `bd671b6c27f493dc19730ffb98a81a0d33566726eda0ef02a63e14901cf4e2f1` |

## Approval and execution chain

1. Historical architecture artifact remained `DRAFT`.
2. Codex implemented V4 and recorded local quality gates as passing.
3. Claude review approved the implementation subject to P1 closure.
4. The human user authorized Preview-only Migration 033, postflight and Preview deployment on 2026-08-09 at 13:58 CST.
5. Codex executed Preview Migration 033, postflight and Preview deployment; the later picker follow-up was also Preview-only.
6. Claude release review stated that Production deployment was permitted.
7. The human user authorized the exact release commit and Production migration/deployment scope on 2026-08-09 at 23:21 CST.
8. Codex executed Production Migration 033, passed postflight and deployed the prebuilt output from detached `4c1bc91`.

`AI_CEO_APPROVAL_EVIDENCE_NOT_FOUND`: this means no bindable historical ChatGPT AI CEO approval artifact was found. It does not assert that approval never occurred.

## Preview-only exclusion

Commit `1199fcd811974655c8e29c956d53330b0b79e15f` is preserved at remote branch `archive/v4-picker-preview-20260809`. It modifies only:

- `ai-coaching-assistant.html`
- `static/ai-interpreter.css`
- `static/v3a-coaching.js`

It was deployed to Preview and is not part of the Production baseline. It must not be merged into the Production recovery branch by implication.

## Non-change statement

This recovery record documents historical facts. Source recovery is not redeployment. No Production or Preview database, environment, deployment or routing change is authorized by this artifact.

