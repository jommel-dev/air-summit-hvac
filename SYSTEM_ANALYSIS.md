# System Analysis — HVAC Warehouse & Sales

**Document type:** Full-system strengths, weaknesses, bugs, and recurring client scenarios  
**Audience:** Developers, tech leads, stakeholders  
**Related docs:** [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md), [PHASE1_IMPROVEMENTS.md](./PHASE1_IMPROVEMENTS.md), [PHASE2_IMPROVEMENTS.md](./PHASE2_IMPROVEMENTS.md), [DEPLOYMENT.md](./DEPLOYMENT.md)  
**Last updated:** 2026-07-29

---

## 1. Executive Summary

The HVAC Warehouse & Sales system is **feature-rich and production-capable** for HVAC warehouse operations: serial tracking, purchase/sales order lifecycle, quotations, materials ledger, accounting, multi-branch support, and RBAC. Architecture is documented in `SYSTEM_ARCHITECTURE.md`, and the backend is organized into clear NestJS feature modules.

Repeating client scenarios are usually **not one-off random failures**. They come from structural patterns:

1. **Dual sources of truth** for serials (`tblserial_numbers` vs JSONB `scannedSerials`)
2. **Optimistic UI** (scan queue shows success before the database confirms)
3. **Inconsistent SQL** (jsonb `COALESCE` vs strict column names vs name-based matching)
4. **Missing transactions** on batch scans and multi-step workflows
5. **Minimal automated tests** (mostly smoke specs; little coverage of PO/SO/serial flows)
6. **Security and RBAC enforced mainly on the frontend**
7. **Very large files** (4k–6k lines) that are hard to change safely

Until those are addressed, fixes tend to be **local patches** while the same class of issue resurfaces in another module or path.

---

## 2. System Overview

```
Angular 21 SPA  →  HTTP/REST (JWT + branch header)  →  NestJS 11 API  →  PostgreSQL (Supabase)
                                                              ↓
                                                     Scan JSONL files (optional)
```

| Layer | Technology |
|-------|------------|
| Frontend | Angular 21, Tailwind CSS 4, TypeScript, Axios |
| Backend | NestJS 11, TypeScript, raw SQL via `pg` (no ORM) |
| Database | PostgreSQL (Supabase) |
| Auth | JWT + frontend RBAC guards |
| Deploy | Vercel (frontend); Docker / Render / DigitalOcean (backend — docs disagree) |

### 2.1 Largest files (maintenance risk)

| File | Approx. lines |
|------|----------------|
| `backend/src/sales/sales-order/sales-order.service.ts` | ~6,800 |
| `frontend/src/app/pages/sales-order/sales-order.component.ts` | ~5,300 |
| `frontend/src/app/pages/purchase-order/purchase-order.component.ts` | ~4,900 |
| `frontend/src/app/pages/accounting/accounting.component.ts` | ~4,500 |
| `backend/src/inventory/purchase/purchase.service.ts` | ~4,400 |
| `backend/src/inventory/serial-number/serial-number.service.ts` | ~4,100 |

---

## 3. Strengths

### 3.1 Domain coverage

End-to-end HVAC operations: brands/products/capacities, serial lifecycle, PO receiving, SO delivery/remittance, quotations, materials ledger, land costing, DR printing, multi-branch.

### 3.2 Backend foundation

- Feature modules (controller → service → DTO)
- Parameterized SQL (reduced SQL injection risk)
- `DatabaseService.withTransaction()` available for multi-step writes
- Global API exception filter and error response interceptor
- Audit log infrastructure (`AuditLogService`, `tblaudit_logs`)

### 3.3 Serial tracking depth

- Per-serial event log (`tblserial_number_events`)
- Scan file logs (JSONL backup under `logs/serial-scans/`)
- Global serial search with event history

### 3.4 Documentation & specs

- `SYSTEM_ARCHITECTURE.md` — ERD, flows, RBAC overview
- `.kiro/specs/` — feature specs for SO/PO/serial work
- `PHASE1_IMPROVEMENTS.md` / `PHASE2_IMPROVEMENTS.md` — change history

### 3.5 RBAC model (design)

Normalized permission keys, effective-permissions view, frontend route guards, Settings UI for roles.

### 3.6 Mutation audit (partial)

SO/PO create/update, scan success/failure, quotation, vendor, and settlement flows can be logged with before/after on updates. Settings includes **Audit Logs** and **Scan Logs** tabs.

---

## 4. Weaknesses (Systemic)

### 4.1 Architecture & maintainability

| Issue | Impact |
|-------|--------|
| God services/components (4k–6k lines) | Every change risks side effects; hard to review |
| Duplicate logic (frontend + backend validation) | Fixes applied in one layer only |
| Template bloat (TailAdmin demo components) | Noise, larger bundle, confusion |
| No CI/CD pipeline | Regressions ship unnoticed |
| Docs drift (`IMPLEMENTATION_PROGRESS.md` stale; migrations referenced but missing) | Fresh installs ≠ production |

### 4.2 Security

| Issue | Severity | Notes |
|-------|----------|-------|
| `/users` API without JWT guard | Critical | Roles, permissions, user CRUD may be open |
| Vendor API unguarded | Critical | `vendor.controller.ts` — no `@UseGuards` |
| Material APIs unguarded | Critical | `material-items`, `material-stock`, `materials` — guards commented or unused |
| Accounting list/create partially unguarded | High | e.g. account-titles / next-number without guard |
| RBAC mainly on frontend | High | Backend often does not enforce permission keys on mutations |
| Branch override via query (`?branchId=`) | High | Can leak other branch data if not role-gated |
| SHA1 password hashing | High | `login.service.ts`, `users.service.ts` |
| JWT secret fallback `dev-secret` | High | Dangerous if env missing in production |
| Client-spoofable audit logs | Medium | `POST /audit-logs` accepts client-supplied actions |

### 4.3 Testing

| Metric | Status |
|--------|--------|
| Spec files | Dozens of files; mostly Nest “should be defined” smoke tests |
| Meaningful tests | Mainly `serial-number.service.property.spec.ts` (fast-check) |
| Frontend page/service tests | Effectively none for business pages |
| E2E | Boilerplate / minimal |
| CI enforcement | None found |

**Result:** Client-reported bugs get fixed manually; the same scenario can return after unrelated changes.

### 4.4 Data layer

| Issue | Impact |
|-------|--------|
| jsonb `COALESCE` reads everywhere | Tolerates schema drift; queries fragile and harder to index |
| Runtime column detection (`pickColumn`) | Good for migration; inconsistently applied |
| `schema_full.sql` ≠ all migrations | Fresh DB may miss SO sequences, backup logs, RBAC keys |
| No unique constraint on serial numbers | Duplicate rows possible |
| Legacy `tblaudit_log` unused | Confusion about audit source of truth (`tblaudit_logs` is used) |

### 4.5 Error handling & UX

| Issue | Client experience |
|-------|-------------------|
| Errors often `console.error` only | Action appears to succeed |
| No shared toast/notification pattern | Inconsistent feedback on warehouse floor |
| Some APIs return `{ success: false }` with HTTP 200 | Hard to debug |
| Silent `catch {}` in some transfer/load paths | Empty UI with no explanation |

---

## 5. Recurring Client Scenarios — Root Cause Map

| Client says… | Likely root cause | Category |
|--------------|-------------------|----------|
| “Serials disappeared after PO scan/approve” | SO scan clears `purchaseId` from `scanned` serials; PO approve only updates rows still linked by `purchaseId` | Data integrity |
| “I scanned 50 but only 40 saved” | Optimistic UI queue; batch flush partial failure; no transaction | Race / UX |
| “Sidebar shows 8 SET but detail shows 7” | Loose vs strict stock queries (partially fixed); SET vs unit count; stale cache | Display / query |
| “CSV import skipped serials / wrong capacity” | No `trackPreviousPurchase` on CSV; capacity routing; column name mismatch in bulk ops | Import |
| “Same serial on two products” | No DB uniqueness; `LIMIT 1` picks arbitrary row | Duplicate data |
| “Inventory shows 0 after PO scan” | Status `scanned` excluded from in-stock counts until PO approved | Status logic |
| “Installed tab count is wrong” | `for-delivery` grouped with `installed` | Status bucketing |
| “Transfer received wrong units” | Receive path updates all serials with `salesId`, not PO-scoped | Transfer logic |
| “PO shows serials, inventory doesn’t” | JSONB `scannedSerials` vs `tblserial_numbers` drift | Dual source of truth |
| “Re-upload CSV doesn’t fix capacity” | Classification / reassignment gaps; capacity label normalization | Import |
| “Print DR wrong grouping” | Schedules vs Sub Dealers grouping rules | Business rules |
| “User did X but no audit trail” | Logging opt-in per method; CSV import lacks summary log | Audit gaps |
| “Staff saw another branch’s orders” | `?branchId=` override without strong role check | Security |
| “Permission changed but system still allows” | Frontend hides UI; backend doesn’t enforce | RBAC gap |

### 5.1 Why scenarios repeat

```
Client reports issue
        ↓
Fix applied in one file / one path
        ↓
Same class of bug exists in a parallel path
        ↓
Scenario returns under a different label
```

Underlying drivers: dual serial storage, optimistic scanning, inconsistent SQL, missing transactions, lack of automated regression tests.

**Example chain — “Serials vanished”**

1. User scans into PO → status `scanned`, shown in PO drawer (may also rely on JSONB path).
2. Another user scans same serial on SO → `purchaseId` cleared, status `reserved`.
3. PO approved → SQL only updates `WHERE purchaseId = :poId` → serial skipped.
4. Inventory count excludes `scanned` → may show 0 for those units.
5. Client reports lost serials — repeats until PO approve + SO scan interaction is fixed holistically.

---

## 6. Bugs & Issues by Module

### 6.1 Serial numbers & scanning

| # | Issue | Severity |
|---|-------|----------|
| 1 | Optimistic scan queue — UI updates before API confirms | High |
| 2 | Batch scans sequential, no transaction, no row lock | High |
| 3 | SO scan steals PO `scanned` serials; PO approve may miss them | Critical |
| 4 | SO scan doesn’t block all invalid statuses in every path | High |
| 5 | Duplicate serial rows — `LIMIT 1`, no unique index | High |
| 6 | Single-scan vs batch logging inconsistent (audit vs file log) | Medium |
| 7 | `removePurchaseOrderSerial` deletes row vs unlink | Medium |

### 6.2 PO CSV import

| # | Issue | Severity |
|---|-------|----------|
| 1 | `trackPreviousPurchase` not sent from frontend CSV confirm | High |
| 2 | `'reassign'` status typed but not fully wired | Medium |
| 3 | `reassignCapacityForPurchaseImport` — no audit log | Medium |
| 4 | No single “CSV import completed” summary audit entry | Medium |
| 5 | Re-import can duplicate if first import was partial | Medium |

### 6.3 Inventory CSV upload

| # | Issue | Severity |
|---|-------|----------|
| 1 | Naive `line.split(',')` — breaks on quoted commas | High |
| 2 | `bulkUpdateStatus` / `insertBulk` — SELECT vs UPDATE column resolution mismatch | High |
| 3 | Preview vs confirm can desync (local optimistic update) | Medium |
| 4 | Bulk ops — serial event log only; weak/no audit summary | Medium |

### 6.4 Inventory counts & display

| # | Issue | Severity |
|---|-------|----------|
| 1 | Sidebar “N SET” vs detail “N serials” — different math | Medium (UX) |
| 2 | `scanned` status invisible in stock counts | High (UX) |
| 3 | Sidebar cache stale after bulk actions | Medium |
| 4 | Stock summary vs list-by-scope matching (name OR id vs id-only) — partially fixed | Medium |

### 6.5 Sales orders

| # | Issue | Severity |
|---|-------|----------|
| 1 | Status → serial status updates miss edge cases | High |
| 2 | Remit may set linked serials to `installed` without strict from-status filter | Medium |
| 3 | Service-only / transfer / sub-dealer rules concentrated in one large file | Medium |
| 4 | Stub/incomplete delete paths — weak audit | Low |

### 6.6 Purchase orders

| # | Issue | Severity |
|---|-------|----------|
| 1 | Dual storage: `tblserial_numbers` + JSONB `scannedSerials` | Critical |
| 2 | Autosave snapshot can fail silently | High |
| 3 | Cancel deletes serials — narrow `purchaseId` column set | Medium |
| 4 | Multiple transfer-received paths with different behavior | Medium |

### 6.7 Auth, RBAC, multi-branch

| # | Issue | Severity |
|---|-------|----------|
| 1 | Unguarded admin/business APIs | Critical |
| 2 | Backend permission checks missing on many mutations | Critical |
| 3 | Branch query param override | High |
| 4 | Role detection by substring (e.g. `includes('admin')`) | Medium |
| 5 | SHA1 passwords | High |

### 6.8 Audit & logging

| # | Issue | Severity |
|---|-------|----------|
| 1 | No summary log for CSV import, bulk insert, capacity reassign | Medium |
| 2 | Weak/no auth, RBAC, settings, accounting audit | High |
| 3 | Duplicate frontend + backend scan failure logs | Low |
| 4 | Inconsistent `entity_type` naming | Low |
| 5 | GET/list APIs correctly not logged — keep this rule | — |

**Logging rule (intended):** Log mutations only (create, update, delete, scan, import confirm). Do **not** log GET/list/preview/check APIs.

### 6.9 Database & deployment

| # | Issue | Severity |
|---|-------|----------|
| 1 | Migrations not fully merged into `schema_full.sql` | High |
| 2 | No automated migration runner | High |
| 3 | Stub endpoints still exposed (login CRUD stubs, serial-number CRUD stubs) | Medium |
| 4 | Production API URL / deploy target inconsistency across docs and client | Medium |

---

## 7. Audit Logging — Current State

### 7.1 Already covered (mutations)

| Action | Logged? | Where |
|--------|---------|-------|
| Create/update Sales Order | Yes | `SALES_ORDER_CREATE`, `SALES_ORDER_UPDATE`, status actions |
| Create/update Purchase Order | Yes | `PURCHASE_CREATE`, `PURCHASE_UPDATE`, approve/cancel/etc. |
| Manual / batch scan | Yes (per serial) | `SERIAL_SCAN_SUCCESS` / `FAILURE` + serial events + batch file log |
| CSV import (PO) | Partial | Per-serial scan logs; **no** summary “imported N via CSV” row |
| Inventory CSV confirm | Partial / weak | Events only in some paths |
| Capacity reassign on re-import | No | Gap |
| List/GET/preview/check | No | Correct — do not add |

### 7.2 Recommended mutation-only actions to add

| Action | When |
|--------|------|
| `PO_SERIAL_CSV_IMPORT` | User confirms PO CSV import (summary counts + file name) |
| `PO_SERIAL_CAPACITY_REASSIGN` | Re-upload moves serials to different capacity |
| `INVENTORY_SERIAL_BULK_STATUS` | Bulk mark installed / in-stock from Inventory CSV |
| `INVENTORY_SERIAL_BULK_INSERT` | Insert not-found serials from Inventory CSV |

---

## 8. Recommended Priority Roadmap

### Phase 0 — Stabilize (1–2 weeks)

1. Lock down APIs: JWT on `/users`, `/vendor`, materials modules, accounting reads/writes.
2. Serial PO approve fix: handle `previousPurchaseId` / re-link when SO steals from PO.
3. Single source of truth: canonical serial data = `tblserial_numbers`; stop relying on JSONB for counts.
4. Batch scans in transactions with row-level lock on serial.
5. DB unique index on normalized serial number.

### Phase 1 — Recurring client scenarios (2–3 weeks)

1. PO CSV: send `trackPreviousPurchase`, complete reassign, add `PO_SERIAL_CSV_IMPORT` audit summary.
2. Inventory CSV: proper CSV parser; align bulk SQL column resolution.
3. Status buckets: separate `scanned` (pending PO) and `for-delivery` from installed.
4. Inventory UI: clarify SET vs serial count; refresh sidebar after mutations.
5. Shared frontend error/toast service — no silent failures.

### Phase 2 — Quality & security (2–4 weeks)

1. Backend permission guard on all mutations.
2. Restrict `branchId` query override to admin roles.
3. bcrypt (or argon2) passwords; enforce strong `JWT_SECRET`.
4. Merge migrations into schema; add migration runner.
5. CI pipeline with tests on serial, PO approve, SO status transitions.

### Phase 3 — Maintainability (ongoing)

1. Split god files: sales-order service, purchase-order component, serial-number service.
2. Extract shared serial/audit utilities.
3. E2E: login → create PO → scan → approve → create SO → scan → remit.
4. Unified User Activity view in Settings (mutations only).
5. Remove stub endpoints and template dead code.

---

## 9. Pre-Release Regression Checklist

| # | Flow | What to verify |
|---|------|----------------|
| 1 | PO scan → approve → inventory count | Serials appear in-stock at correct capacity |
| 2 | PO scan → SO scan same serial → approve PO | No orphaned/lost serials |
| 3 | PO CSV import (multi-capacity) | Correct routing; summary audit log |
| 4 | Re-upload CSV with different capacity | Update Capacity, not duplicate |
| 5 | Transfer PO receive | Only intended serials change branch/status |
| 6 | SO for-delivery → remit | Installed count matches physical |
| 7 | Inventory sidebar vs detail | SET/serial counts consistent after refresh |
| 8 | Branch user cannot access other branch via API | Security |
| 9 | Failed scan on poor network | UI shows error; no ghost serials |
| 10 | Settings → Audit Logs | Create/update SO/PO and import appear |

---

## 10. Stakeholder Talking Points

**Assessment**

> The system works for daily operations and has deep HVAC-specific features many off-the-shelf systems lack. Repeating scenarios are mostly known categories — serial state conflicts between PO and SO, CSV/import edge cases, count display confusion, and UI showing success before the server confirms — not purely random failures.

**Why repeats happen**

> Fixes have often been localized (one screen, one endpoint) while the underlying design (dual serial storage, optimistic scanning, inconsistent queries) stays in place. Without automated tests and transactional batch operations, the same bug class appears in the next workflow path.

**What reduces repeats fastest**

1. Serial lifecycle hardening (PO ↔ SO ↔ inventory)
2. Security lockdown (wrong branch/user cannot corrupt data)
3. CSV/import audit summaries + consistent backend logging (mutations only)
4. Automated tests on the top client-reported flows

---

## 11. Key File References

| Area | Path |
|------|------|
| Architecture | `SYSTEM_ARCHITECTURE.md` |
| JWT guard | `backend/src/auth/jwt-auth.guard.ts` |
| Login / passwords | `backend/src/auth/login/login.service.ts` |
| Users API | `backend/src/usermanage/users/users.controller.ts` |
| Branch resolver | `backend/src/common/utils/resolve-branch-id.ts` |
| Serial service | `backend/src/inventory/serial-number/serial-number.service.ts` |
| Purchase service | `backend/src/inventory/purchase/purchase.service.ts` |
| Sales order service | `backend/src/sales/sales-order/sales-order.service.ts` |
| Audit service | `backend/src/audit-log/audit-log.service.ts` |
| Inventory UI | `frontend/src/app/pages/inventory/inventory.component.ts` |
| PO UI / CSV | `frontend/src/app/pages/purchase-order/purchase-order.component.ts` |
| SO UI | `frontend/src/app/pages/sales-order/sales-order.component.ts` |
| Schema | `backend/sql/supabase/schema_full.sql` |
| Migrations | `backend/sql/supabase/migration_*.sql` |

---

## 12. Document History

| Date | Change |
|------|--------|
| 2026-07-29 | Initial full-system analysis documentation (strengths, weaknesses, bugs, recurring scenarios, roadmap, audit logging guidance) |
