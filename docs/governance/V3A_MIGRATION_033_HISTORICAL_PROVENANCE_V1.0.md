# V3A Migration 033 Historical Provenance V1.0

## Record status

- Record type: immutable historical execution provenance
- Recovery date: 2026-08-13 (Asia/Shanghai)
- Scope: metadata/evidence only; no database ledger mutation
- `STANDARD_SUPABASE_MIGRATION_LEDGER: NOT RECORDED`
- `HISTORICAL_EXECUTION: CONFIRMED`
- `DO_NOT_RE_RUN: TRUE`

## Migration identity

| Field | Value |
|---|---|
| File | `supabase/migrations/033_v3a_advisor_workbench_v4_foundation.sql` |
| SHA-256 | `4c7c77475e652b1ac5d5f15fb0edaf7cdd91df36410f35c91e66b30d71c65df7` |
| Source commit | `4c1bc9106c086d440c8287e4968ef7dd2d788b95` |
| Historical local release ref | `release/v4-production-20260809` |
| Recovered remote branch | `recovery/v4-production-sot-20260813` |
| Release commit tree | `2aef7a52f5f29f7a5f8f358fc144681aabd861a9` |

## Preview execution

| Field | Evidence |
|---|---|
| Supabase target | `lmjriqncuopgxwyudfee` (`aipiwen-v3a-preview`) |
| Date/time | 2026-08-09, approximately 14:01 CST |
| Method | Supabase Dashboard SQL Editor after project-ref and migration-hash guards |
| Execution result | Success; no rows returned |
| Postflight | PASS; tables, RLS, policies, privileges, RPC and security-definer checks true |
| Normalized object fingerprint | `bd671b6c27f493dc19730ffb98a81a0d33566726eda0ef02a63e14901cf4e2f1` |
| Preview deployment | `dpl_24depE2iBm5bhqcsXAGAFAbhDURR` |
| Preview P1 follow-up deployment | `dpl_6AThhyrvE7eb932h9GCpN1dz4s3o` |
| Execution report SHA-256 | `cbb702d8770eafb3f716de9f7fe1805ca26425a2863fa88746f63d056322ff32` |
| Preview E2E report SHA-256 | `76c5a35ac5bb1eac6f947703a479a9d112049c12a510102ed4f051e3c6187f61` |

## Production execution

| Field | Evidence |
|---|---|
| Supabase target | `tysbwijizgebnrazxpvo` |
| Date/time | 2026-08-09, approximately 23:31 CST |
| Method | Supabase Dashboard SQL Editor after project-ref and migration-hash guards |
| Execution result | Success |
| Postflight | PASS; nine checks true |
| Normalized object fingerprint | `bd671b6c27f493dc19730ffb98a81a0d33566726eda0ef02a63e14901cf4e2f1` |
| Production source commit | `4c1bc9106c086d440c8287e4968ef7dd2d788b95` |
| Production deployment | `dpl_4KnKteVky3rmwJzjeLX6hNaKLRnw` (READY) |
| Production alias evidence | `www.aipiwen.cn` pointed to the deployment during the recorded release |

## Provenance boundary

The Preview standard migration history was observed only through migration 012, and the Production project did not expose a standard migration metadata table in the audit. Migration 033 was executed through the Dashboard SQL Editor in both environments and therefore must not be inserted retroactively into the platform ledger or re-executed for bookkeeping.

The equal normalized object fingerprints provide `OBJECT_MATCH` evidence. They do not by themselves prove deployment provenance; the authorization, execution log, postflight, release source and deployment metadata above form the historical evidence chain.

