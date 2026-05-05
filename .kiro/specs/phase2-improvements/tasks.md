# Implementation Plan: Phase 2 Improvements

## Overview

This plan implements two feature areas: Order Form Enhancements (capacity SRP display + miscellaneous items) and Serial Number Traceability (event log + history API + frontend timeline). Tasks are ordered so each builds on the previous, starting with database schema, then backend services, then frontend integration.

## Tasks

- [x] 1. Database schema changes
  - [x] 1.1 Add `srp` to the products endpoint query and add `category` column to `tblmaterials`
    - Modify `GET /public/order-form/products` query in `public-order-form.controller.ts` to include the `srp` field from `tblcapacity` in the response
    - Add a `category` column (VARCHAR(50), default 'general') to `tblmaterials` in `schema_full.sql`
    - _Requirements: 1.1, 1.2, 3.6_

  - [x] 1.2 Create `tblso_miscellaneous_items` table
    - Add the CREATE TABLE statement to `backend/sql/supabase/schema_full.sql`
    - Include columns: id, sales_id, category, item_name, description, material_id, quantity, unit, unit_price, total_price, is_inclusion, remarks, created_at
    - Add CHECK constraint on category ('excess', 'electrical', 'material', 'general')
    - Add FK to `tblsales_order(id)` with CASCADE delete, FK to `tblmaterial_items(id)` with SET NULL
    - Add indexes on sales_id, category, material_id
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 1.3 Create `tblserial_number_events` table
    - Add the CREATE TABLE statement to `backend/sql/supabase/schema_full.sql`
    - Include all columns: id, serial_id, serial_number, event_type, previous/new status, previous/new purchase_id, previous/new sales_id, previous/new branch_id, previous/new customer_id, performed_by, performed_by_username, ip_address, reason, metadata, created_at
    - Add FK to `tblserial_numbers(id)` with CASCADE delete, FK to `tblusers(id)`
    - Add indexes on serial_id, serial_number, event_type, new_purchase_id, new_sales_id, created_at DESC
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 2. Checkpoint — Verify schema
  - Ensure schema SQL is valid and all constraints/indexes are defined. Ask the user if questions arise.

- [x] 3. Backend — Materials endpoint and miscellaneous items API
  - [x] 3.1 Create `GET /public/order-form/materials` endpoint
    - Add a new method in `PublicOrderFormController` that queries `tblmaterials` for active materials
    - Group results by category and return the `MaterialsResponse` shape (category, materials[]{id, code, name, unit, unitPrice})
    - _Requirements: 3.6_

  - [x] 3.2 Add `MiscItemDto` and update `PublicOrderFormDto`
    - Create a `MiscItemDto` class with class-validator decorators for: category (IsIn), itemName (IsString, IsNotEmpty), description (optional), materialId (optional, IsNumber), quantity (IsNumber, Min(0.01)), unit (IsString), unitPrice (IsNumber, Min(0)), isInclusion (IsBoolean)
    - Add `miscItems?: MiscItemDto[]` to `PublicOrderFormDto` with `@IsOptional()`, `@ValidateNested({ each: true })`, `@Type(() => MiscItemDto)`
    - _Requirements: 3.1_

  - [x] 3.3 Implement miscellaneous items insertion in order submission
    - In `PublicOrderFormController.submitOrder()`, after the sales order is created, insert each `miscItem` into `tblso_miscellaneous_items`
    - Validate `material_id` references exist in `tblmaterial_items` before insertion; reject with 400 if invalid
    - Calculate `total_price = quantity * unit_price` server-side
    - Wrap the entire operation (sales order + misc items) in a transaction so failure rolls back everything
    - _Requirements: 3.2, 3.3, 3.4, 3.5_

  - [ ]* 3.4 Write property tests for miscellaneous items API
    - **Property 5: Total Price Calculation** — For any numeric quantity and unit_price, stored total_price equals quantity * unit_price
    - **Property 2: Category Constraint Enforcement** — For any string not in valid set, insertion fails
    - **Property 4: Material ID Validation** — For any non-existent material_id, submission is rejected
    - **Validates: Requirements 2.4, 3.3, 3.4, 3.5**

  - [ ]* 3.5 Write unit tests for materials endpoint and misc items insertion
    - Test grouped response structure from materials endpoint
    - Test DTO validation rejects invalid payloads (negative quantity, missing item_name)
    - Test transaction rollback when misc item insertion fails
    - _Requirements: 3.1, 3.2, 3.6_

- [x] 4. Backend — Serial Event Log Service
  - [x] 4.1 Create `SerialEventLogService`
    - Create `backend/src/inventory/serial-number/serial-event-log.service.ts`
    - Implement `logEvent(params: LogEventParams, client?: PoolClient): Promise<void>` that inserts into `tblserial_number_events`
    - Wrap the insert in try/catch — on failure, log the error but do NOT throw (fire-and-forget safe)
    - Accept optional `PoolClient` to participate in caller's transaction
    - Implement `getHistoryBySerialId(serialId: number): Promise<SerialEvent[]>` returning events ordered by created_at DESC
    - Implement `getHistoryBySerialNumber(serialNumber: string): Promise<SerialEvent[]>` returning events ordered by created_at DESC
    - Define `SerialEventType` union type and `LogEventParams` interface
    - Register the service in `SerialNumberModule` providers
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 4.2 Write property test for append-only event log
    - **Property 9: Append-Only Event Log** — For any sequence of N logEvent() calls, exactly N new rows exist and no existing rows are modified
    - **Validates: Requirements 6.2**

  - [ ]* 4.3 Write property test for event logging resilience
    - **Property 10: Event Logging Resilience** — For any input causing a DB insert failure, logEvent() does not throw to the caller
    - **Validates: Requirements 6.3**

- [x] 5. Backend — Hook event logging into serial number operations
  - [x] 5.1 Inject `SerialEventLogService` into `SerialNumberService`
    - Add `SerialEventLogService` to the constructor injection
    - Ensure the module exports/provides it correctly
    - _Requirements: 7.8_

  - [x] 5.2 Add event logging to `scanPurchaseOrder` and `scanPurchaseOrderBatch`
    - After successful serial scan/insert, call `logEvent()` with event_type `SCANNED_IN_PO`, the purchase order context, and actor info
    - Pass the transaction client when available
    - _Requirements: 7.1, 7.8_

  - [x] 5.3 Add event logging to `removePurchaseOrderSerial`
    - Before/after removal, call `logEvent()` with event_type `REMOVED_FROM_PO`, capturing previous purchase_id
    - _Requirements: 7.2, 7.8_

  - [x] 5.4 Add event logging to `scanSalesOrder` and `scanSalesOrderBatch`
    - After successful assignment, call `logEvent()` with event_type `ASSIGNED_TO_SO`, the sales order context, and actor info
    - _Requirements: 7.3, 7.8_

  - [x] 5.5 Add event logging to `removeSalesOrderSerial`
    - Before/after removal, call `logEvent()` with event_type `REMOVED_FROM_SO`, capturing previous sales_id
    - _Requirements: 7.4, 7.8_

  - [x] 5.6 Add event logging to `bulkUpdateStatus`
    - For each affected serial, call `logEvent()` with event_type `STATUS_CHANGED`, previous_status, and new_status
    - Handle `MARKED_DEFECTIVE` and `RETURNED` as specific event types when status matches
    - _Requirements: 7.5, 7.6, 7.7, 7.8_

  - [ ]* 5.7 Write property test for serial operations producing correct events
    - **Property 11: Serial Operations Produce Correct Events** — For any successful state-changing operation, the event log contains a new event with correct event_type, actor, and state transition context
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8**

- [x] 6. Checkpoint — Backend verification
  - Ensure all backend tests pass and the serial event logging hooks don't break existing serial number operations. Ask the user if questions arise.

- [x] 7. Backend — Serial number history endpoints
  - [x] 7.1 Add `GET /serial-numbers/:id/history` endpoint
    - Add a new method in `SerialNumberController` protected by `JwtAuthGuard`
    - Call `SerialEventLogService.getHistoryBySerialId()` and return the `SerialEventResponse` shape
    - Return empty array with 200 for non-existent serials
    - _Requirements: 8.1, 8.3, 8.4, 8.5_

  - [x] 7.2 Add `GET /serial-numbers/search-history` endpoint
    - Add a new method in `SerialNumberController` protected by `JwtAuthGuard`
    - Accept `serialNumber` query parameter
    - Call `SerialEventLogService.getHistoryBySerialNumber()` and return the `SerialEventResponse` shape
    - Return empty array with 200 for non-existent serials
    - _Requirements: 8.2, 8.3, 8.4, 8.5_

  - [ ]* 7.3 Write property test for history API ordering
    - **Property 12: History API Ordering and Completeness** — For any serial with multiple events, the response is sorted by created_at descending and contains all required fields
    - **Validates: Requirements 8.1, 8.5**

- [x] 8. Frontend — Capacity SRP display
  - [x] 8.1 Update `ProductCapacity` interface and products endpoint response handling
    - Add `srp: number` to the `ProductCapacity` interface in `order-form.component.ts`
    - Update `loadProducts()` to map the new `srp` field from the API response
    - _Requirements: 1.1_

  - [x] 8.2 Display SRP in capacity selection UI
    - In `order-form.component.html`, show the SRP (or sellPrice when SRP is 0) as the displayed price next to each capacity option
    - Keep using `sellPrice` as the cart line item price (existing behavior preserved)
    - Add a computed or helper that resolves display price: `srp > 0 ? srp : sellPrice`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 8.3 Write property test for price resolution logic
    - **Property 1: Price Resolution Logic** — For any SRP/sellPrice combination, displayed price equals SRP when SRP > 0, sellPrice otherwise. Cart price always equals sellPrice.
    - **Validates: Requirements 1.2, 1.4**

- [x] 9. Frontend — Miscellaneous items section
  - [x] 9.1 Add miscellaneous items state and signals
    - Add `MiscCartItem` interface, `GroupedMaterials` interface
    - Add signals: `miscItems`, `availableMaterials`, `activeMiscCategory`, `customItemMode`
    - Add computed: `miscTotal` (sum of quantity * unitPrice for all misc items), `grandTotal` (cartTotal + miscTotal)
    - Add `loadMaterials()` method calling `GET /public/order-form/materials`
    - Call `loadMaterials()` in `ngOnInit()`
    - _Requirements: 4.1, 4.5_

  - [x] 9.2 Implement miscellaneous items UI section
    - Add a collapsible "Additional Items" section below the product cart in the template
    - Add category tabs (Excess, Electricals, Materials, General) that filter `availableMaterials` by category
    - Display available items for the selected category with "Add" buttons
    - Allow custom item entry (item name, quantity, unit, unit price) when no catalog match
    - Show the misc items list with quantity, price, and remove button
    - Display misc subtotal separate from product cart total
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7_

  - [x] 9.3 Wire miscellaneous items into order submission
    - Update the `submit()` method to include `miscItems` array in the POST payload
    - Map each misc cart item to the `MiscItemPayload` shape (category, itemName, quantity, unit, unitPrice, isInclusion, materialId, description)
    - Update `resetForm()` to clear misc items state
    - _Requirements: 4.6_

  - [ ]* 9.4 Write property tests for miscellaneous items frontend logic
    - **Property 6: Category Filtering** — For any category selection, all displayed materials belong to that category only
    - **Property 7: Miscellaneous Subtotal Computation** — For any list of misc items, subtotal equals sum of (quantity * unitPrice)
    - **Property 8: Miscellaneous Items List Invariants** — Add increases length by 1, remove decreases by 1, submission payload matches list
    - **Validates: Requirements 4.3, 4.5, 4.6, 4.7**

- [x] 10. Checkpoint — Order form verification
  - Ensure the order form compiles, the miscellaneous section renders correctly, and submission includes misc items. Ask the user if questions arise.

- [x] 11. Frontend — Serial history timeline
  - [x] 11.1 Create `SerialHistoryComponent`
    - Create `frontend/src/app/pages/serial-history/serial-history.component.ts` as a standalone component
    - Add inputs: `serialId` (number | null), `serialNumber` (string | null)
    - Add signals: `events`, `loading`, `error`, `searchQuery`
    - Implement `loadHistory()` method that calls the appropriate history endpoint based on available input
    - Implement `searchBySerial()` method for the search input
    - _Requirements: 9.1, 9.5, 9.6, 9.7_

  - [x] 11.2 Implement serial history timeline template
    - Create `serial-history.component.html` with a vertical timeline layout using Tailwind CSS
    - Display each event as a timeline entry: event_type badge, timestamp, actor, context (PO/SO numbers, branch)
    - Show reason and metadata when present
    - Add loading spinner and error state with retry button
    - Add search input for serial number lookup
    - Order events newest to oldest
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 11.3 Integrate serial history into existing serial number views
    - Add a "View History" button/link in serial number detail views that navigates to or opens the serial history component
    - Register the component route if using routing, or embed as a child component
    - _Requirements: 9.1_

- [x] 12. Final checkpoint — Full integration verification
  - Ensure all tests pass, both frontend and backend compile without errors, and all features are wired together. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The serial number service is ~3250 lines — hooks (tasks 5.2–5.6) should be added carefully at the end of each method's success path
- The order form uses axios for HTTP calls — the materials endpoint call follows the same pattern
- All new backend services use raw SQL via `DatabaseService` (no ORM)
