# AIPIWEN Phase B-3: Report Engine Privacy Hardening Decision

**Date**: 2026-07-29
**Type**: Privacy Architecture Decision (Read-only, no code changes)
**Source**: cases:index historical structure containing name + IP

---

## Root Cause

`pushCaseIndex()` in `api/generate-report.js` (L107-116) pushes every generated report to `cases:index` (an Upstash Redis list, max 2000 entries). The entry includes:

```
{ id, type, key, age, name, channel, brain, mType, plusR, ip, createdAt }
```

- `name` = client name extracted from report (OCR or user-input)
- `ip` = client source IP from `req.headers['x-forwarded-for']`

This is NOT Phase B code. It is the existing Report Engine (`generate-report.js` / `report-store`) that predates the entire V3 auth system. Phase B's only interaction with this is that `v3a_store_attributed_report` now creates advisor_reports rows — it does NOT write to `cases:index`.

---

## Privacy Risk Level

**PII fields in cases:index**: `name` (client display name) + `ip` (client source IP).

**No business dependency found**:
- `cases:index` is not queried by any API endpoint in the current codebase.
- It is not consumed by advisor workbench, customer list, or report viewer.
- It appears to be a pre-V3 artifact intended for a "case gallery" or "training case pipeline" feature that was never built.
- The comment says "案例库索引" (case library index) — a future feature, not a current dependency.

**Risk assessment**: The data is stored but not currently read. If the KV token were compromised, an attacker would have names + IPs + report metadata. Medium severity, no active exploitation vector.

---

## Required Fix (Minimal, Sprint Scope)

**Option A: Stop writing unnecessary fields** — Recommended.

In `pushCaseIndex()`, remove `name` and `ip` from the entry. Keep the structurally valuable fields:

```javascript
pushCaseIndex({
  id,                // report ID (keep — needed for future lookup)
  type,              // personality type (keep — case classification)
  age: ageNum,       // age (keep — age-based filtering)
  channel,           // learning channel (keep)
  brain,             // left/right brain (keep)
  mType,             // M-type flag (keep)
  plusR,             // reverse thinking flag (keep)
  createdAt: Date.now()  // (keep)
  // name DELETED
  // ip DELETED
});
```

**Impact**: One function, 2 lines removed. No API contract changes. No Redis structure changes. No migration. No data cleanup needed for existing entries (they age out naturally with LTRIM 2000).

**Non-impact boundary**: Does not affect any of the following:
- report-upload.html
- api/extract-fp.js (OCR pipeline)
- api/generate-report.js (AI generation logic)
- api/report-store handler (structured report storage)
- v3a_store_attributed_report (attribution layer)
- advisor_clients / advisor_reports tables
- GET /api/report-store (report retrieval)
- V3A Session / Auth / CSRF

---

## Historical Data Recommendation

**No active cleanup required**. Existing entries in `cases:index`:

- Are capped at 2000 entries (LTRIM)
- Will naturally age out as new reports push old ones off the list
- Are in a private KV store (not publicly accessible)
- Contain only report metadata + name + IP (no full sections, no generated report content)

If a forced purge is desired, a one-time `DEL cases:index` via KV CLI is the safest option — it affects only the index, not report storage (`report:{id}`). This is optional and not part of the minimum fix.

---

## Release Gate Decision

**PASS WITH CONDITIONS** — does NOT block Phase B Release.

Rationale:

1. The `name` + `ip` leakage is in the Report Engine, not in Phase B attribution code.
2. Phase B's entire scope (migration 020/021/022, attribution_tokens, RPCs, BFFs, advisor_import pipeline) does not write to `cases:index`.
3. `cases:index` has no current consumer — the data is stored but not read or displayed.
4. The fix is a 2-line removal in `pushCaseIndex()`, zero migration/API impact.
5. Blocking Release over pre-existing Report Engine behavior that Phase B didn't introduce would conflate two separate concerns.

**Condition**: The `name` + `ip` removal from `pushCaseIndex()` must be included in the Phase B Production deployment commit — not deferred as a separate Sprint. This is a 2-line change with zero blast radius.
