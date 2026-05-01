# Phase 1 Improvements

## Overview

This document covers all changes implemented in Phase 1 of the HVAC Warehouse and Sales system improvement cycle.

---

## 1. Inventory

### 1.1 Brand Folder — Product List on Click

**Problem:** Clicking a brand folder in the tree only expanded/collapsed it. The content area showed no useful information when a brand was selected.

**Fix:** The content area now renders a full product card grid when a brand is selected. Each card shows:
- Product name
- Number of capacities
- Unit types (e.g. Indoor, Outdoor)

Clicking a product card navigates directly to that product's detail view.

**Files Changed:**
- `frontend/src/app/pages/inventory/inventory.component.html`

---

### 1.2 Product Tree — Expand/Collapse Already Working

**Status:** The product-level expand/collapse (`toggleProduct`) was already wired correctly in the tree. No additional changes were needed beyond confirming the behavior.

---

### 1.3 Capacity Detail — Delete All In-Stock Serials Button

**Problem:** There was no way to bulk-clear in-stock serial numbers for a capacity, which is needed before a reinventory operation.

**Fix:** Added a "Delete All In-Stock" button next to the Upload CSV button in the capacity serial section. The button:
- Only appears when the active tab is "In-Stock" and there are serials present
- Only visible to Admin/Super Admin roles
- Shows a confirmation dialog before deleting
- Calls `DELETE /serial-number/in-stock?productId=&capacityId=`
- Reloads the stock summary after deletion

**Files Changed:**
- `frontend/src/app/pages/inventory/inventory.component.html`
- `frontend/src/app/pages/inventory/inventory.component.ts`
- `backend/src/inventory/serial-number/serial-number.controller.ts`
- `backend/src/inventory/serial-number/serial-number.service.ts`

**New Backend Endpoint:**
```
DELETE /serial-number/in-stock?productId={id}&capacityId={id}
```
Deletes all serial numbers for the given product/capacity scope where status is not `reserved`, `delivered`, `installed`, `sold`, `released`, `out`, `outbound`, or `for-delivery`.

---

### 1.4 Soft Delete for Product and Capacity

> **Deferred to Phase 2.** Requires a database migration to add `deleted_at` columns to `tblproducts` and `tblcapacity`, plus backend query updates to filter out soft-deleted records across all list and lookup queries.

---

## 2. Stakeholders — Dealers Tab

### 2.1 Dealer Purchase Order View

**Problem:** Clicking "View" on a dealer in the Dealers tab showed a static message saying dealer data is not tracked. No purchase order history was visible.

**Fix:** The dealer drawer now loads and displays the full purchase order history for that vendor, including:

**Summary Cards:**
| Card | Description |
|---|---|
| Total POs | Count of all purchase orders for this dealer |
| Total Charge | Sum of all PO amounts |
| Outstanding Balance | Total Charge minus paid/approved POs |
| Terms POs | Total amount of POs with terms-based payment |

**PO Table Columns:** PO Number, Amount, Status, Date

**Files Changed:**
- `frontend/src/app/pages/customers/customers.component.ts`
- `frontend/src/app/pages/customers/customers.component.html`
- `frontend/src/app/shared/services/purchase-order.service.ts`
- `backend/src/inventory/purchase/dto/list-purchase-query.dto.ts`
- `backend/src/inventory/purchase/purchase.service.ts`

**Backend Change:** Added `vendorId` query parameter to `GET /purchase/master-data` so POs can be filtered by vendor/dealer ID.

---

## 3. Quotation

### 3.1 Unit Type Bug Fix on Finalize/Convert

**Problem:** When a quotation was converted to a Sales Order, the product items in the SO showed `"grouping"` as the unit type label instead of the actual unit types (e.g. Indoor, Outdoor). This was caused by `saveQuotation` hardcoding `unitTypesQty: [{ label: 'grouping', value: groupingName }]`.

**Fix:** `saveQuotation` now reads the actual `unitTypes` from the product catalog (e.g. `['Indoor', 'Outdoor']`) and saves them as proper `unitTypesQty` entries with the correct `totalSetQty` per unit type:

```ts
// Before (broken)
unitTypesQty: [{ label: 'grouping', value: String(item.grouping) }]

// After (fixed)
unitTypesQty: product.unitTypes.map(ut => ({
  label: ut.trim().toLowerCase(),
  value: Number(item.totalSetQty),
}))
```

The grouping name continues to be stored in the `remarks` field via `serializeItemMeta()` as before.

**Files Changed:**
- `frontend/src/app/pages/quotation/quotation.component.ts`

---

### 3.2 Total Discount Display on Print

> **Deferred.** The quotation print preview already shows per-item discount prices. A grand total discount row can be added to the HTML preview template in a follow-up task.

---

### 3.3 Expired Quotation — Restore and Set New Validity Date

> **Deferred to Phase 2.** Requires a new backend endpoint `PATCH /quotation/:id/restore` that clears `is_deleted`, resets `status` to `draft`, and sets a new `expires_at` based on a provided validity date.

---

## 4. Schedule Today Sales Order

### 4.1 Serial Scan Validation Before Send for Delivery

**Problem:** The "Move to For-Delivery" button could be clicked even if no serial numbers had been scanned, because the validation only checked `unitTypesQty` values — which were broken due to the quotation unit type bug (see §3.1). This meant `requiredQty` resolved to `0` for all unit types, and the check always passed.

**Fix (two-part):**

1. **Root cause fixed** — The quotation unit type bug (§3.1) is now resolved, so `unitTypesQty` correctly stores `Indoor`/`Outdoor` with numeric quantities. The existing `validateSerialScansForDelivery` logic now works as intended.

2. **Additional guard** — If the SO detail drawer has not been opened (meaning the warehouseman had no opportunity to scan serials), and the SO has products with required serial quantities, the move is blocked with a message prompting the user to open the SO detail first.

**Files Changed:**
- `frontend/src/app/pages/schedule-today-sales-order/schedule-today-sales-order.component.ts`

---

## Bug Fixes (Dashboard — Cheque & Card Receivables)

The following dashboard bugs were also resolved as part of this phase:

### Verify Button Showing "Verifying…" Without Clicking

**Root Cause:** `verifyingReceivableId` initializes as `null`. `item['paymentId']` is a UUID string — `null === null` evaluated to `true` on initial render, making the button appear stuck.

**Fix:** Added `verifyingReceivableId !== null` guard before the comparison in both `getReceivableVerifyLabel` and the `[disabled]` binding. Changed `paymentId` handling from `Number()` to `String()` since `tblso_payments.id` is a `uuid` column.

### Verify Button Doing Nothing When Clicked

**Root Cause:** `Number(uuid)` returns `NaN`, failing the `Number.isFinite()` guard and silently returning early.

**Fix:** `paymentId` is now treated as a `string` throughout the verify flow on both frontend and backend.

### SO Status Incorrectly Set to "paid" After Cheque Verify

**Root Cause:** `updateSalesOrderStatusForSettlement` was setting status to `'paid'` when fully paid, but the Collected Sales KPI only counts SOs with status `remitted/complete/completed`.

**Fix:** Status transitions updated:
- Fully paid (no outstanding receivables) → `complete`
- Fully covered by outstanding cheque/credit-card → `remitted`
- Already `complete`/`completed` → no change (early return)

**Files Changed:**
- `frontend/src/app/pages/dashboard/ecommerce/ecommerce.component.ts`
- `frontend/src/app/pages/dashboard/ecommerce/ecommerce.component.html`
- `backend/src/dashboard/dashboard.service.ts`

---

## Files Modified — Full List

### Frontend
| File | Change |
|---|---|
| `pages/dashboard/ecommerce/ecommerce.component.ts` | Verify button UUID fix, null guard, status fix |
| `pages/dashboard/ecommerce/ecommerce.component.html` | Disabled binding null guard |
| `pages/inventory/inventory.component.ts` | Delete in-stock serials method + state |
| `pages/inventory/inventory.component.html` | Brand product list view, delete button |
| `pages/customers/customers.component.ts` | Dealer PO state + load method |
| `pages/customers/customers.component.html` | Dealer PO summary cards + table |
| `pages/quotation/quotation.component.ts` | Unit type bug fix in saveQuotation |
| `pages/schedule-today-sales-order/schedule-today-sales-order.component.ts` | Serial validation guard |
| `shared/services/purchase-order.service.ts` | Added `getPurchasesByVendor` method |

### Backend
| File | Change |
|---|---|
| `dashboard/dashboard.service.ts` | SO status transitions, verify UUID fix |
| `inventory/serial-number/serial-number.controller.ts` | Added `DELETE /serial-number/in-stock` endpoint |
| `inventory/serial-number/serial-number.service.ts` | Added `deleteInStockByScope` method |
| `inventory/purchase/dto/list-purchase-query.dto.ts` | Added `vendorId` field |
| `inventory/purchase/purchase.service.ts` | Added `vendorId` filter in `fetchByMode` |
