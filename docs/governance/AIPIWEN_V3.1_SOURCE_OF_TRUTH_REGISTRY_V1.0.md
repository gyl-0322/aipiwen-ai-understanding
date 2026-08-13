# AIPIWEN V3.1 Source-of-Truth Registry V1.0

Recovery date: 2026-08-13 (Asia/Shanghai)

| Asset / System | Canonical Repo | Branch | Commit / Identity | Runtime Status | DB Target | Deployment | Governance Status |
|---|---|---|---|---|---|---|---|
| V3A Production V4 | `gyl-0322/aipiwen-ai-understanding` | `recovery/v4-production-sot-20260813` | Production source `4c1bc9106c086d440c8287e4968ef7dd2d788b95`; governance head `dba89c0b25c294e3d8f3f21fa66c3a9a39713aaa` | Production | `tysbwijizgebnrazxpvo` | `dpl_4KnKteVky3rmwJzjeLX6hNaKLRnw` | `RECOVERED` |
| V4 Preview follow-up | `gyl-0322/aipiwen-ai-understanding` | `archive/v4-picker-preview-20260809` | `1199fcd811974655c8e29c956d53330b0b79e15f` | Preview only | `lmjriqncuopgxwyudfee` | `dpl_6AThhyrvE7eb932h9GCpN1dz4s3o` | `ARCHIVED / NOT PRODUCTION` |
| Migration 033 | `gyl-0322/aipiwen-ai-understanding` | `recovery/v4-production-sot-20260813` | File SHA-256 `4c7c77475e652b1ac5d5f15fb0edaf7cdd91df36410f35c91e66b30d71c65df7`; source `4c1bc91` | Executed in Preview + Production | `lmjriqncuopgxwyudfee`; `tysbwijizgebnrazxpvo` | n/a | `HISTORICAL LEDGER / DO NOT RE-RUN` |
| Memory Engine Sprint 0 | `gyl-0322/aipiwen-ai-understanding` | `baseline/v3.1-memory-engine-sprint0` | `e453ff3941079bb9e1c48f35259aabdf77227931`; tree `692e6bfb967d8416874c6c870485d1f5fd6b2001` | Local only | none | none | `BASELINED` |
| Family OS | `/Users/gyl0322gmail.com/Documents/AIPIWEN家庭成长服务经营系统` | `baseline/v3.1-family-os-20260813` | `2645218c3d8f8d4b5fc4f4f0907d27c32e0f3834`; tree `e0fb4e67e92905a362aa5644a935e43e7a9e1e1a` | Local only | local development only | none | `BASELINED / REMOTE PENDING` |
| Identity Bridge | Design artifacts only | n/a | n/a | none | none | none | `NOT FROZEN / HOLD` |

## Interpretation boundaries

- The V4 recovery branch preserves the exact Production source as an ancestor; later commits on that branch add governance Markdown only.
- The Preview follow-up is intentionally isolated and is not part of the Production baseline.
- Migration 033 historical execution is confirmed but absent from the standard Supabase migration ledger; it must not be rerun to repair bookkeeping.
- Memory Engine Sprint 0 is a local-only foundation asset. It is not deployed, connected to V3 routes or authorized for Sprint 1.
- Family OS has a trusted local canonical baseline, but no remote target was proven: `FAMILY_OS_REMOTE_TARGET_UNCONFIRMED`.
- Identity Bridge, UPDC production linkage, Family OS integration and related patches remain on hold.

