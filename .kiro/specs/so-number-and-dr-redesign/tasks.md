# Implementation Plan: SO Number & DR Redesign

## Overview

This implementation transitions the SO number generation from a PostgreSQL `GENERATED ALWAYS AS STORED` column to an application-level service with year-month-sequence format, and adds a new frontend DR PDF generator using pdf-lib. Tasks are ordered to establish database foundations first, then backend services, then frontend features, with tests interspersed close to their implementation targets.

## Tasks

- [x] 1. Database migration and sequence table setup
  - [x] 1.1 Create the `tblso_number_sequences` table migration SQL
    - Create file `backend/sql/supabase/migration_so_number_redesign.sql`
    - Define `tblso_number_sequences` table with columns: `id` (BIGINT IDENTITY), `year_month` (VARCHAR(7) UNIQUE NOT NULL), `last_sequence` (INTEGER DEFAULT 0), `created_at`, `updated_at`
    - Add CHECK constraint `chk_sequence_range` ensuring `last_sequence` between 0 and 99999
    - Add index on `year_month` column
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 1.2 Create the `so_number` column migration SQL
    - In the same migration file, add the two-step column migration:
      - Add `so_number_new TEXT` column
      - Copy existing `so_number` values to `so_number_new`
      - Drop original `so_number` generated column
      - Rename `so_number_new` to `so_number`
    - Add NOT NULL constraint on `so_number`
    - Add UNIQUE constraint `uq_sales_order_so_number` on `so_number`
    - Add seed INSERT for current month's sequence count based on existing orders
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 4.1_

- [x] 2. Backend SoNumberService implementation
  - [x] 2.1 Create the `SoNumberService` class
    - Create file `backend/src/sales/sales-order/so-number.service.ts`
    - Implement `formatSoNumber(year, month, sequence)` method that produces the pattern `SO<YYYY>-<MM><5-digit-seq>`
    - Implement `generateNext(client, createdAt?)` method that:
      - Extracts year and month from `createdAt` (or current timestamp)
      - Uses `SELECT ... FOR UPDATE` on `tblso_number_sequences` for the target year-month
      - INSERTs a new row with `last_sequence = 1` if no row exists (UPSERT pattern)
      - UPDATEs `last_sequence = last_sequence + 1` if row exists
      - Throws `BadRequestException` if sequence exceeds 99999
      - Returns the formatted SO number string
    - Register `SoNumberService` as a provider in `sales-order.module.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.5, 3.1, 3.2, 3.3, 3.4_

  - [ ]* 2.2 Write property tests for SoNumberService (Properties 1–2)
    - Create file `backend/src/sales/sales-order/__tests__/so-number.property.spec.ts`
    - Install `fast-check` as devDependency if not already present
    - **Property 1: SO Number Format Validity** — For arbitrary valid year (2000–2099), month (1–12), sequence (1–99999), `formatSoNumber` produces a string matching `/^SO\d{4}-\d{7}$/` with correct components
    - **Property 2: Timestamp-to-Components Extraction** — For arbitrary valid Date objects, the generated SO number contains the correct 4-digit year and 2-digit month extracted from the timestamp
    - Run minimum 100 iterations per property
    - **Validates: Requirements 1.1, 1.2, 3.3**

  - [ ]* 2.3 Write property tests for SoNumberService (Properties 3–5)
    - In the same test file `backend/src/sales/sales-order/__tests__/so-number.property.spec.ts`
    - **Property 3: Monthly Sequence Initialization** — For any year-month with no prior record, first generation yields sequence 00001
    - **Property 4: Sequential Increment Invariant** — For N consecutive calls in same month, sequences are consecutive integers
    - **Property 5: Month Isolation** — Generating in one month does not affect another month's counter
    - Use mocked database client to test logic isolation
    - **Validates: Requirements 1.3, 1.4, 3.1, 3.2**

  - [ ]* 2.4 Write unit tests for SoNumberService
    - Create file `backend/src/sales/sales-order/__tests__/so-number.service.spec.ts`
    - Test `formatSoNumber` edge cases: month 1 → '01', month 12 → '12', sequence 1 → '00001', sequence 99999 → '99999'
    - Test year rollover: December 2026 → January 2027
    - Test overflow: sequence at 99999, next call throws `BadRequestException`
    - Test invalid inputs (month 0, month 13, negative sequence)
    - _Requirements: 1.1, 1.3, 3.3, 3.4_

- [x] 3. Backend SalesOrderService modifications
  - [x] 3.1 Modify `SalesOrderService.create()` to use SoNumberService
    - In `backend/src/sales/sales-order/sales-order.service.ts`:
      - Inject `SoNumberService` into the constructor
      - Remove existing conditional `so_number` assignment logic
      - Call `this.soNumberService.generateNext(client)` within the existing transaction
      - Pass the returned SO number into the INSERT statement for `tblsales_order`
    - Ensure the transaction rollback on failure still works correctly
    - _Requirements: 1.1, 1.5, 2.5_

  - [x] 3.2 Add DR-eligible orders endpoint to SalesOrderController
    - In `backend/src/sales/sales-order/sales-order.controller.ts`:
      - Add `@Get('customer/:customerId/dr-eligible')` endpoint
      - Accept optional `@Query('branchId')` parameter
    - In `backend/src/sales/sales-order/sales-order.service.ts`:
      - Implement `getDrEligibleOrders(customerId, branchId?)` method
      - Query sales orders WHERE `customer_id = customerId` AND status IN ('for-delivery', 'remitted', 'complete', 'released')
      - Join with `tblserial_numbers` and product/capacity tables to return full serial data
      - Return typed response matching `DrEligibleOrder[]` interface
    - _Requirements: 10.1, 10.2, 10.3, 5.1, 5.2_

  - [ ]* 3.3 Write property test for DR eligibility status filter (Property 12)
    - Create file `backend/src/sales/sales-order/__tests__/dr-eligibility.property.spec.ts`
    - **Property 12: DR Eligibility Status Filter** — For any sales order, DR action enabled iff status ∈ {"for-delivery", "remitted", "complete", "released"}; all other statuses excluded
    - Generate arbitrary status strings and verify correct filtering
    - **Validates: Requirements 10.1, 10.2, 10.3**

  - [ ]* 3.4 Write property test for SO number search (Property 6)
    - Create file `backend/src/sales/sales-order/__tests__/so-number-search.property.spec.ts`
    - **Property 6: SO Number Search Matches Both Formats** — For any valid SO number in old format (`SO-XXXXXX`) or new format (`SO<YEAR>-<MONTH><SEQ>`), search/filter function returns a match
    - Test with generated old-format and new-format strings
    - **Validates: Requirements 4.3**

- [x] 4. Checkpoint - Ensure backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Frontend DrGeneratorService implementation
  - [x] 5.1 Create shared interfaces for DR generation
    - Create file `frontend/src/app/shared/interfaces/dr-generator.interfaces.ts`
    - Define `DrEligibleOrder`, `DrProductItem`, `DrSerialEntry`, and `DrFonts` interfaces matching the design specification
    - _Requirements: 5.1, 5.2, 8.1_

  - [x] 5.2 Create the `DrGeneratorService` class
    - Create file `frontend/src/app/shared/services/dr-generator.service.ts`
    - Import `pdf-lib` (install as dependency if not already present)
    - Implement `generateDr(orders, businessProfile)` main method
    - Implement `drawHeader(page, profile, fonts)`:
      - Render company logo from `businessProfile.businessLogo` (skip if null/empty per Req 6.4)
      - Render company name from `businessProfile.businessName`
      - Render company address from `businessProfile.businessAddress`
    - Implement `drawDetails(page, orders, y, fonts)`:
      - Render delivery date, customer name, customer address
      - Render SO number(s) from all grouped orders
      - Render installer name
      - Label customer field as "Sub Dealer" when `customerType === 'sub_dealer'`
    - Implement `drawProductTable(page, orders, y, fonts)`:
      - Draw table headers: Customer, Address, Description, Indoor Serial, Outdoor Serial, Unit Price
      - For each order's product items, render one row per product-capacity-serial combination
      - Description = product name + capacity name concatenated
      - Indoor Serial column: serials where `unitType === 'indoor'`
      - Outdoor Serial column: serials where `unitType === 'outdoor'`
      - Unit Price from `sellPrice`
    - Implement `drawSignatures(page, y, fonts)`:
      - Render 5 signature lines labeled: "Warehouse Supervisor", "Warehouse Man", "HR Admin", "Checked By", "Received By"
      - Render "Printed Name Over Signature" below each line
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 9.2, 9.3, 9.4_

  - [ ]* 5.3 Write property tests for DrGeneratorService (Properties 7–11)
    - Create file `frontend/src/app/shared/services/__tests__/dr-generator.property.spec.ts`
    - **Property 7: DR Customer Grouping** — For any set of DR-eligible orders with same customer, all are included in a single PDF document
    - **Property 8: Sub-Dealer Label Rendering** — For any order with `customerType === 'sub_dealer'`, label reads "Sub Dealer"
    - **Property 9: Product Description Concatenation** — For any product item, description = productName + capacityName
    - **Property 10: Serial Type Filtering** — Indoor column only contains `unitType = "indoor"`, Outdoor column only contains `unitType = "outdoor"`
    - **Property 11: Table Row Count Equals Serial Combinations** — Row count = total product-capacity-serial combinations
    - Use `fast-check` with minimum 100 iterations per property
    - **Validates: Requirements 5.2, 7.6, 8.2, 8.3, 8.4, 8.5**

  - [ ]* 5.4 Write unit tests for DrGeneratorService
    - Create file `frontend/src/app/shared/services/__tests__/dr-generator.service.spec.ts`
    - Test header rendering with and without logo
    - Test exactly 5 signature labels are rendered
    - Test multi-page overflow with large order lists
    - Test empty orders array returns appropriate empty handling
    - _Requirements: 6.1, 6.4, 9.1, 9.2_

- [x] 6. Frontend SalesOrderComponent modifications
  - [x] 6.1 Add DR print button and API integration to SalesOrderComponent
    - In `frontend/src/app/pages/sales-order/sales-order.component.ts`:
      - Inject `DrGeneratorService` and `BusinessSettingsService`
      - Add `printNewDeliveryReceipt(customerId: string)` method:
        - Call `GET /sales-orders/customer/:customerId/dr-eligible` via the API client
        - Pass response data and business profile to `DrGeneratorService.generateDr()`
        - Open the resulting PDF bytes in a new browser tab for preview
      - Keep existing `printDeliveryReceipt()` method intact as legacy path (Req 5.4)
    - In `frontend/src/app/pages/sales-order/sales-order.component.html`:
      - Add new "Print DR" button/action for the new DR generation
      - Disable the button when order status is below "for-delivery"
      - Show both legacy and new DR options (or replace as appropriate)
    - In `frontend/src/app/shared/services/sales-order.service.ts`:
      - Add `getDrEligibleOrders(customerId: string, branchId?: string)` method to call the new backend endpoint
    - _Requirements: 5.1, 5.4, 10.1, 10.2_

  - [ ]* 6.2 Write unit tests for SalesOrderComponent DR integration
    - Test that DR button is disabled for orders with status below "for-delivery"
    - Test that DR button is enabled for eligible statuses
    - Test that `printNewDeliveryReceipt` calls the service correctly
    - _Requirements: 10.1, 10.2_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Integration wiring and final validation
  - [x] 8.1 Wire SoNumberService into SalesOrderModule and verify end-to-end
    - Ensure `SoNumberService` is properly exported/provided in `sales-order.module.ts`
    - Verify the full create flow: POST `/sales-orders` → `SoNumberService.generateNext()` → INSERT with new SO number format
    - Confirm existing old-format SO numbers display correctly in frontend list views
    - _Requirements: 1.1, 1.5, 4.2_

  - [ ]* 8.2 Write integration tests for concurrent SO generation
    - Create file `backend/src/sales/sales-order/__tests__/so-number.integration.spec.ts`
    - Test multiple parallel transactions produce unique, sequential SO numbers without gaps or duplicates
    - Test that different months produce independent sequences
    - _Requirements: 1.5, 3.1_

  - [ ]* 8.3 Write integration test for DR-eligible API endpoint
    - Create file `backend/src/sales/sales-order/__tests__/dr-eligible.integration.spec.ts`
    - Test endpoint returns correct orders grouped by customer with serial data
    - Test that ineligible-status orders are excluded
    - Test empty result when no eligible orders exist
    - _Requirements: 10.1, 10.3, 5.2_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The migration SQL should be reviewed manually before applying to production
- The existing DR template overlay path is preserved per Requirement 5.4
- `pdf-lib` must be installed in the frontend if not already present; `fast-check` must be installed as devDependency in both frontend and backend

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "5.1"] },
    { "id": 1, "tasks": ["2.1", "5.2"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.1", "3.2", "5.3", "5.4"] },
    { "id": 3, "tasks": ["3.3", "3.4", "6.1"] },
    { "id": 4, "tasks": ["6.2", "8.1"] },
    { "id": 5, "tasks": ["8.2", "8.3"] }
  ]
}
```
