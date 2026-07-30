# AIPIWEN Phase B Architecture Freeze Addendum - Client Attribution Management

**Date**: 2026-07-29
**Type**: Architecture Decision Addendum
**Depends on**: AIPIWEN_PHASE_B_ARCHITECTURE_DECISION.md

---

## 1. Data Model Final Decision

### advisor_clients additions (MERGE INTO migration 022)

Current from 020:
```
source in ('invite_link', 'advisor_qr', 'advisor_import')
```

After 022:
```
source in ('invite_link', 'advisor_qr', 'advisor_import', 'unguided')
```

**Add two columns to advisor_clients**:

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| assigned_by_user_id | uuid REFERENCES users(id) | NULL | Last admin who changed attribution |
| assigned_at | timestamptz | NULL | When the last attribution change occurred |

**Invariant**: `source` is write-once and NEVER modified after initial creation. It records the client's ORIGINAL source.

- Client scanned QR: `source = 'advisor_qr'` (permanent)
- Client uploaded directly: `source = 'unguided'` (permanent)
- Advisor imported in workbench: `source = 'advisor_import'` (permanent)

**Attribution change** only touches `advisor_user_id`, `assigned_by_user_id`, and `assigned_at`. The `source` column is the immutable audit trail.

---

## 2. Permission Model

| Role | Read | Change Attribution |
|------|------|-------------------|
| super_admin | All clients | YES (with audit) |
| advisor | Own clients only | NO |
| agent/center | None in MVP | NO |
| anon | None | NO |

**Critical**: `advisor_user_id` never comes from browser request. All attribution changes go through BFF which derives identity from HttpOnly Session + CSRF.

---

## 3. API Design

### GET /api/v3a-admin/unassigned

Returns clients where `source = 'unguided'` AND `advisor_user_id IS NULL`.
Auth: super_admin only (via Session + CSRF).

### POST /api/v3a-admin/assign

Request: `{ clientId: uuid, targetAdvisorUserId: uuid, reason: text }`

Server-side validations:
1. Require super_admin
2. Verify client exists and is currently unassigned
3. Verify target advisor exists and is active
4. Update `advisor_user_id`, `assigned_by_user_id`, `assigned_at`
5. Write `admin_audit_logs` row: action `ASSIGN_CLIENT`, details JSON with previous advisor_id, new advisor_id, reason, timestamp
6. Return updated client

### Audit Table Integration

Reuse existing `admin_audit_logs`. Add action:
```
'ASSIGN_CLIENT'
```

Details JSONB:
```
{
  "clientId": "uuid",
  "clientName": "...",
  "previousAdvisorId": null,
  "newAdvisorId": "uuid",
  "reason": "client forgot to scan QR; actual advisor is Li",
  "assignedAt": "2026-07-29T..."
}
```

---

## 4. MVP Scope (revised)

### MUST DO

1. attribution_tokens table + RPCs
2. QR-based attribution (Scenario A1)
3. unguided pool with source='unguided'
4. Super admin read-only view of unassigned clients
5. Super admin attribution assignment (single client)
6. advisor_clients.assigned_by_user_id + assigned_at columns
7. admin_audit_logs with ASSIGN_CLIENT action
8. Source immutability constraint enforcement

### WILL NOT DO

- Bulk assignment
- Auto/smart assignment
- CRM features
- agent/center permission to view or assign
- Client self-service transfer request
- Source column modification

---

## 5. Compatibility with Phase A

- Phase A RPCs (v3a_create_advisor_report_import, v3a_complete_advisor_report_import) are UNCHANGED. They only handle source='advisor_import' path.
- Phase A RLS policies automatically cover the new columns (they filter on advisor_user_id, which still works).
- New columns assigned_by_user_id and assigned_at are NULL by default - backward compatible with Phase A created rows.
- v3a-customers.js GET handler does not need changes (it already returns clients by advisor_user_id).

---

## 6. Audit Requirements

Every attribution change must record:
- who (super_admin auth_user_id)
- what (client_id, previous_advisor_id, new_advisor_id)
- when (assigned_at timestamp)
- why (reason text, max 500 chars)

All records stored in admin_audit_logs with action='ASSIGN_CLIENT'. Super admins can view audit trail. Advisors can see their own clients' assignment history (when they were assigned to them) but not others'.

---

## 7. Final Decision

**APPROVE FOR IMPLEMENTATION** with conditions:
1. source column is immutable after creation - enforced at application layer (not DB trigger in MVP)
2. assigned_by_user_id and assigned_at are MVP scope
3. ASSIGN_CLIENT action added to admin_audit_logs action check constraint
4. assign endpoint requires super_admin + CSRF + SameOrigin
5. No advisor self-service attribution changes
