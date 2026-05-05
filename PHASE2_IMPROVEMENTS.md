# Phase 2 Improvements

## Overview
This document covers all changes implemented in Phase 2 of the HVAC Warehouse and Sales system improvement cycle.
**Rule:** Give Insights and Possible Changes we need before Implementation. Update the status to complete once done.

---

# 1. Order Form — Show Product Capacity SRP + Miscellaneous Section

**Status:** ✅ Analysis Complete — Ready for Implementation

## Current Behavior
- The public order form fetches products with capacities (including `sellPrice` and `unitPrice`)
- When a user selects a product and capacity, the price is shown in the cart
- There is NO section for miscellaneous items (excess materials, electricals, etc.)

## Insights & Recommended Changes

### 1.1 Show Product Capacity SRP on Selection

**What's needed:** When a user selects a product, display all available capacities with their SRP (Suggested Retail Price) so the customer can compare before choosing.

**Changes required:**
- **Frontend only** — The backend already returns `sellPrice` (SRP) and `unitPrice` per capacity
- In `order-form.component.html`, when a product is selected, render a capacity selection card/table showing:
  - Capacity name (e.g., "1.0HP", "1.5HP", "2.0HP")
  - SRP price (formatted as currency)
  - A "Select" or "Add" button per capacity
- This is purely a UI enhancement — no backend changes needed

**Effort:** Low (frontend template changes only)

---

### 1.2 Miscellaneous Section (Excess, Electricals, Materials)

**What's needed:** A new section in the order form where customers (or sales staff via the form) can add miscellaneous items that aren't AC units — things like copper pipes, wires, brackets, circuit breakers, etc.

**Analysis — Do we need a new table?**

**YES — we need a new table: `tblorder_form_miscellaneous_items`**

**Reasoning:**
- The existing `tblso_material_items` links materials to a sales order AFTER it's created, and uses `material_id` referencing `tblmaterial_items` (the ledger-based catalog)
- The public order form creates a sales order on submit, but miscellaneous items from a customer perspective are free-text or category-based (they don't necessarily map 1:1 to internal material codes)
- We need flexibility: some misc items are from our material catalog, others are custom line items

**Proposed table:**

```sql
CREATE TABLE IF NOT EXISTS public.tblso_miscellaneous_items (
  id BIGSERIAL PRIMARY KEY,
  sales_id INTEGER NOT NULL REFERENCES public.tblsales_order(id) ON UPDATE CASCADE ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL DEFAULT 'general',  -- 'excess', 'electrical', 'material', 'general'
  item_name TEXT NOT NULL,
  description TEXT NULL,
  material_id BIGINT NULL REFERENCES public.tblmaterial_items(id) ON DELETE SET NULL,  -- optional link to catalog
  quantity NUMERIC(12, 2) NOT NULL DEFAULT 1,
  unit VARCHAR(20) DEFAULT 'pcs',
  unit_price NUMERIC(12, 2) DEFAULT 0,
  total_price NUMERIC(12, 2) DEFAULT 0,
  is_inclusion BOOLEAN DEFAULT false,  -- true = included in package, false = additional charge
  remarks TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_so_misc_items_sales_id ON public.tblso_miscellaneous_items(sales_id);
CREATE INDEX IF NOT EXISTS idx_so_misc_items_category ON public.tblso_miscellaneous_items(category);
CREATE INDEX IF NOT EXISTS idx_so_misc_items_material_id ON public.tblso_miscellaneous_items(material_id);
```

**Categories:**
| Category | Use Case |
|----------|----------|
| `excess` | Extra materials beyond standard installation (extra copper pipe, etc.) |
| `electrical` | Circuit breakers, wires, outlets, etc. |
| `material` | Standard installation materials (from catalog) |
| `general` | Any other miscellaneous item |

**Changes required:**

| Layer | Change |
|-------|--------|
| **Database** | Add `tblso_miscellaneous_items` table |
| **Backend** | Add `GET /public/order-form/materials` endpoint to return available misc items by category |
| **Backend** | Update `POST /public/order-form` to accept `miscItems[]` in the payload and insert into new table |
| **Frontend** | Add a "Miscellaneous / Additional Items" section below the product cart |
| **Frontend** | Category tabs (Excess, Electricals, Materials) with item selection + quantity |
| **Frontend** | Show subtotal for misc items separate from product total |

**Frontend UX flow:**
1. User adds AC units to cart (existing flow)
2. Below the cart, a collapsible "Additional Items" section appears
3. User can pick a category tab → see available items → add with quantity
4. Or type a custom item name + price (for items not in catalog)
5. On submit, both `productItems` and `miscItems` are sent to the backend

**Effort:** Medium (new table + backend endpoint + frontend section)

---

# 2. Purchase Order — Serial Number Traceability After Scanning

**Status:** ✅ Analysis Complete — Ready for Implementation

## Problem Statement
After completing serial number scanning on a Purchase Order (all serials scanned and PO marked complete), some serial numbers later go "missing" or become untraceable. The business needs a way to:
1. Know the full history of every serial number (where it was, where it went)
2. Recover/trace serials even after they've been reassigned or removed

## Current Behavior
- Serial numbers are stored in `tblserial_numbers` with current state only (`status`, `salesId`, `purchaseId`)
- When a serial is reassigned (e.g., moved from one SO to another), the old `salesId` is overwritten
- The `previousSalesId` column was added but only tracks ONE previous assignment
- The `tblaudit_logs` table exists but serial-level events aren't consistently logged
- The `SerialNumberService` has a `logSerialScanAudit()` method but it only logs scan events, not lifecycle changes

## Root Cause
There's no **serial number event history table**. The current design stores only the CURRENT state of a serial. Once it's updated, the previous state is lost (except for the single `previousSalesId` field).

## Recommended Solution: Serial Number Event Log

**Create a dedicated `tblserial_number_events` table** that records every state change for every serial number. This gives you a complete, immutable audit trail.

**Proposed table:**

```sql
CREATE TABLE IF NOT EXISTS public.tblserial_number_events (
  id BIGSERIAL PRIMARY KEY,
  serial_id BIGINT NOT NULL REFERENCES public.tblserial_numbers(id) ON DELETE CASCADE,
  serial_number VARCHAR NOT NULL,  -- denormalized for fast lookup even if serial record changes
  
  -- What happened
  event_type VARCHAR(50) NOT NULL,  -- see event types below
  
  -- State transition
  previous_status VARCHAR(50) NULL,
  new_status VARCHAR(50) NULL,
  
  -- Context: where was it before, where is it now
  previous_purchase_id INTEGER NULL,
  new_purchase_id INTEGER NULL,
  previous_sales_id INTEGER NULL,
  new_sales_id INTEGER NULL,
  previous_branch_id BIGINT NULL,
  new_branch_id BIGINT NULL,
  previous_customer_id UUID NULL,
  new_customer_id UUID NULL,
  
  -- Who and when
  performed_by BIGINT NULL REFERENCES public.tblusers(id),
  performed_by_username VARCHAR(150) NULL,
  ip_address VARCHAR(60) NULL,
  
  -- Additional context
  reason TEXT NULL,
  metadata JSONB NULL,  -- flexible extra data (e.g., defect details, transfer reference)
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_serial_events_serial_id ON public.tblserial_number_events(serial_id);
CREATE INDEX IF NOT EXISTS idx_serial_events_serial_number ON public.tblserial_number_events(serial_number);
CREATE INDEX IF NOT EXISTS idx_serial_events_event_type ON public.tblserial_number_events(event_type);
CREATE INDEX IF NOT EXISTS idx_serial_events_purchase_id ON public.tblserial_number_events(new_purchase_id);
CREATE INDEX IF NOT EXISTS idx_serial_events_sales_id ON public.tblserial_number_events(new_sales_id);
CREATE INDEX IF NOT EXISTS idx_serial_events_created_at ON public.tblserial_number_events(created_at DESC);
```

**Event Types:**

| Event Type | When It Fires |
|------------|---------------|
| `SCANNED_IN_PO` | Serial scanned into a Purchase Order |
| `REMOVED_FROM_PO` | Serial removed/unlinked from a PO |
| `ASSIGNED_TO_SO` | Serial assigned to a Sales Order |
| `REMOVED_FROM_SO` | Serial removed/unlinked from an SO |
| `TRANSFERRED` | Serial moved between branches |
| `DELIVERED` | Serial marked as delivered to customer |
| `RETURNED` | Serial returned by customer |
| `MARKED_DEFECTIVE` | Serial flagged as defective |
| `STATUS_CHANGED` | Any other status change |
| `BRANCH_CHANGED` | Serial moved to different branch |
| `CUSTOMER_CHANGED` | Serial reassigned to different customer |

**Changes required:**

| Layer | Change |
|-------|--------|
| **Database** | Add `tblserial_number_events` table |
| **Backend** | Create `SerialEventLogService` with a `logEvent()` method |
| **Backend** | Hook into every place in `SerialNumberService` where serial state changes (scan, remove, assign, transfer, defect, return) |
| **Backend** | Add `GET /serial-numbers/:id/history` endpoint to retrieve full event timeline |
| **Backend** | Add `GET /serial-numbers/search-history?serialNumber=XXX` for lookup by serial string |
| **Frontend** | Add a "Serial History" modal/panel accessible from serial number views |
| **Frontend** | Show timeline of events with who/when/what for each serial |

**Recovery scenarios this solves:**

| Scenario | How to Recover |
|----------|---------------|
| Serial "disappeared" after PO scan | Query events for that serial → see if it was `REMOVED_FROM_PO` or `ASSIGNED_TO_SO` |
| Serial assigned to wrong SO | Query events → see the `ASSIGNED_TO_SO` event with previous state → can revert |
| Serial transferred but not acknowledged | Query events → see `TRANSFERRED` event with branch context |
| Need to know who scanned/moved a serial | Every event has `performed_by` + `ip_address` |
| Serial marked defective but customer disputes | Full timeline shows when and by whom it was flagged |

**Effort:** Medium-High (new table + service + hooks into existing serial operations + frontend timeline UI)

---

## Implementation Priority

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 1 | Order Form: Show capacity SRP | Low | Better UX for customers |
| 2 | Order Form: Miscellaneous section + table | Medium | New revenue capture, better order accuracy |
| 3 | Serial Number Event Log table + service | Medium | Critical for traceability |
| 4 | Hook event logging into existing serial operations | Medium | Enables recovery of "lost" serials |
| 5 | Serial history API + frontend timeline | Medium | User-facing visibility |

---

## Summary

Both improvements are well-scoped and don't require major architectural changes:

1. **Order Form** — The SRP display is a quick frontend win. The miscellaneous section needs one new table (`tblso_miscellaneous_items`) and a new section in the form. This aligns well with the existing material inventory system.

2. **Serial Traceability** — The core issue is that serial numbers only store current state. The solution is an append-only event log (`tblserial_number_events`) that records every state transition. This is the standard pattern for asset tracking systems and will make "missing" serials fully recoverable.

Both solutions are designed to be backward-compatible — they add new tables and behavior without modifying existing table structures.
