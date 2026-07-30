# AIPIWEN Phase B-1 Claude Architecture / Security Review

**Review date**: 2026-07-29
**Type**: Read-only architecture, security, data-boundary review
**Score**: 93 real checks PASS, node --check PASS
**Final Decision**: PASS

---

## Review 1: Migration 022 - PASS

Single transaction. Preflight guards: Phase A (020 + RPCs) must exist, 022 must not be partially applied.

**attribution_tokens**: independent of invite_codes. Token format `[0-9a-f]{32}`, max_uses 1-100, default expires 24h. No role column, no invite_type - confirms separation from practitioner invite_codes.

**advisor_clients additions**: source expanded to include 'unguided'. advisor_user_id dropped NOT NULL (NULL for unguided). Two new columns: assigned_by_user_id + assigned_at with assignment_shape_check (both null or both non-null). DB trigger enforces source IMMUTABILITY on both clients and reports tables.

**admin_audit_logs**: ASSIGN_CLIENT added to action check constraint.

**RPCs**: Four new SECURITY DEFINER functions:
- v3a_create_attribution_token: advisor_id from auth.uid(), token from gen_random_uuid()
- v3a_validate_attribution_token: anon + authenticated EXECUTE, validates expiry/exhausted/revoked
- v3a_store_attributed_report: service_role ONLY, atomic token consumption + client/report creation, idempotency_key with payload mismatch detection
- v3a_assign_advisor_client: service_role ONLY, admin+target existence checks, CLIENT_ALREADY_ASSIGNED guard, audit log insertion

**Postflight**: 8 assertions covering objects, columns, table privileges, RPC privileges (including verifying Phase A RPCs unchanged), source immutability triggers, and assignment column trigger exclusion from updated_at.

---

## Review 2: Attribution Token Security - PASS

Token lifecycle: generate (advisor-only via auth.uid()) -> validate (public, returns only displayName + expiry + remainingUses) -> consume (service_role only, atomically increments used_count, sets exhausted). Token never exposes advisor_user_id to client. Expiry defaults 24h. Revoked/exhausted/expired tokens rejected. Max uses 1 by default.

Client token goes into URL as query param: `/report-upload.html?token=32hex`. Token validation is public - returns minimal safe info.

---

## Review 3: Report Engine Boundary - PASS

Phase B does not duplicate OCR or report generation. v3a_store_attributed_report RECEIVES the already-generated report (p_generated_report, p_structured_input) and creates the client/report attribution record. The existing report-upload.html pipeline remains the sole upload entry point. Phase B adds the attribution layer behind it.

The bridge: report-upload.html, after generating a report, calls v3a_store_attributed_report to bind the report + token to an advisor. If no token, creates unguided record.

---

## Review 4: Three Business Scenarios - PASS

**A1 (QR scan)**: Token in URL -> validate returns advisor name -> upload + generate -> v3a_store_attributed_report consumes token -> source='advisor_qr', client + report created atomically.

**B (Advisor uploads for client)**: Advisor generates token (POST create) -> opens report-upload.html?token=CODE -> uploads client's report -> same pipeline as A1 -> client appears in advisor's customer list.

**A3 (no token)**: Direct upload -> no token -> v3a_store_attributed_report with null token -> source='unguided', advisor_user_id=NULL -> enters unassigned pool.

---

## Review 5: HQ Attribution Management - PASS

v3a_assign_advisor_client: service_role ONLY. Five validations:
1. p_admin_user_id must be active super_admin
2. Client must exist, not archived
3. Client must not already be assigned (advisor_user_id IS NULL guard + FOR UPDATE lock)
4. Client source must be 'unguided'
5. Target advisor must be active advisor

After update: writes ASSIGN_CLIENT audit log with full details (clientId, clientName, previousAdvisorId, newAdvisorId, reason, assignedAt).

---

## Review 6: Permission Model - PASS

| RPC | caller | auth |
|-----|--------|------|
| v3a_create_attribution_token | authenticated only | auth.uid() -> active advisor |
| v3a_validate_attribution_token | anon + authenticated | public (safe data only) |
| v3a_store_attributed_report | service_role only | BFF-internal |
| v3a_assign_advisor_client | service_role only | BFF-internal, super_admin check in function body |

advisor can: create tokens, list own clients.
advisor cannot: assign clients, read other advisors' clients, read attribution_tokens table.
agent/center: no access in MVP.

---

## Review 7: Phase A Compatibility - PASS

Postflight verifies Phase A RPCs unchanged. advisor_user_id made nullable (backward compat - Phase A rows had non-null values, new unguided rows have NULL). Source columns immutable via trigger on both clients and reports. New columns default NULL - Phase A created rows unaffected. Attribution BFF replaces v3a-customers.js (L14 shows attribution.js now holds the customer list endpoint). RLS policies still work (filter on advisor_user_id covers NULL correctly for unguided).

---

## Review 8: Test Authenticity - PASS

93 real checks, all PASS. Test suite reads actual migration SQL, API source, and vercel.json from disk. Regex validates: migration structure, RPC signatures, privilege grants, BFF patterns. Pure function tests exercise validateFingers, normalizeToken, publicAdvisor with real inputs. Integration mock tests simulate fetch chains.

---

## Final Decision: PASS

No P0, P1, or P2 findings. Phase B-1 reaches Preview Migration readiness.

Unchanged from Phase A: RPCs, RLS helper permissions, report state machine, CSRF model. Attribution is a clean layer on top.
