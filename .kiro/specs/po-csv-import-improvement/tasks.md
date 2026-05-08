# Implementation Plan: PO CSV Import Improvement

## Overview

This plan implements the improved CSV import flow for Purchase Orders. It adds a `previousPurchaseId` column to track serial reassignment history, introduces a `check-serials` backend endpoint for ownership verification, and replaces the existing direct file-picker import with a multi-step modal dialog (template download → upload/parse → summary preview → confirm).

## Tasks

- [x] 1. Database migration: add `previousPurchaseId` column
  - [x] 1.1 Create SQL migration file to add `previousPurchaseId` column to `tblserial_numbers`
    - Add column as `INTEGER NULL`
    - Add foreign key constraint referencing `tblpurchase_orders(id)` with ON UPDATE CASCADE and ON DELETE SET NULL
    - Add partial index on `previousPurchaseId` WHERE NOT NULL
    - Update `backend/sql/supabase/schema_full.sql` to reflect the new column
    - _Requirements: 6.4_

- [x] 2. Backend: new `check-serials` endpoint
  - [x] 2.1 Create `CheckSerialsDto` in `backend/src/inventory/serial-number/dto/check-serials.dto.ts`
    - Define `serialNumbers: string[]` (required, non-empty, max 5000 items)
    - Define `purchaseId: number` (required)
    - Add class-validator decorators for validation
    - _Requirements: 4.5, 4.6_

  - [x] 2.2 Implement `checkSerials` method in `serial-number.service.ts`
    - Accept `CheckSerialsDto` parameter
    - Validate array is non-empty and does not exceed 5000 entries
    - Query `tblserial_numbers` joined with `tblpurchase_orders` to get current ownership state
    - Normalize input serial numbers (lowercase, trim) for matching
    - Return array of results with `serialNumber`, `exists`, `currentPurchaseId`, `currentPoNumber`, `isSamePoAssignment`
    - _Requirements: 4.5, 4.6_

  - [x] 2.3 Add `checkSerials` route to `serial-number.controller.ts`
    - Add `@Post('check-serials')` endpoint
    - Wire to service method with auth guard
    - Return the check results response
    - _Requirements: 4.5, 4.6_

  - [ ]* 2.4 Write unit tests for `checkSerials` service method
    - Test returns correct state for existing serials assigned to same PO
    - Test returns correct state for existing serials assigned to different PO
    - Test returns `exists: false` for non-existing serials
    - Test validation rejects empty array
    - Test validation rejects arrays exceeding 5000 items
    - _Requirements: 4.5, 4.6_

- [x] 3. Backend: modify batch scan to support `trackPreviousPurchase`
  - [x] 3.1 Add `trackPreviousPurchase` optional field to `ScanPurchaseOrderBatchDto`
    - Add `trackPreviousPurchase?: boolean` to the DTO class in `scan-purchase-order-batch.dto.ts`
    - Field defaults to `false` when not provided (backward compatible)
    - _Requirements: 6.1, 7.1_

  - [x] 3.2 Modify `scanPurchaseOrder` method to accept and handle `trackPreviousPurchase` parameter
    - Add optional `trackPreviousPurchase?: boolean` parameter to the method signature
    - Resolve the `previousPurchaseId` column name via `pickColumn`
    - Before the UPDATE: if `trackPreviousPurchase === true` and the serial has an existing non-null `purchaseId` that differs from the new PO, set `previousPurchaseId` in the update record
    - If `purchaseId` is null or same as new PO, do not modify `previousPurchaseId`
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

  - [x] 3.3 Modify `scanPurchaseOrderBatch` to pass `trackPreviousPurchase` flag through
    - Read `dto.trackPreviousPurchase` and pass it to each `scanPurchaseOrder` call
    - _Requirements: 6.1, 7.1, 7.3_

  - [ ]* 3.4 Write unit tests for `previousPurchaseId` tracking logic
    - Test that `trackPreviousPurchase=true` sets `previousPurchaseId` when serial has different existing PO
    - Test that `trackPreviousPurchase=true` does NOT set `previousPurchaseId` when serial has null purchaseId
    - Test that `trackPreviousPurchase=true` does NOT set `previousPurchaseId` when serial is already on same PO
    - Test that `trackPreviousPurchase=false` (or unset) never modifies `previousPurchaseId`
    - Test that batch method passes the flag through correctly
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 7.3_

  - [ ]* 3.5 Write property test for previousPurchaseId preservation (Property 6)
    - **Property 6: Previous Purchase ID Preservation**
    - For any serial with `trackPreviousPurchase=true`: if existing non-null purchaseId differs from new PO, then `previousPurchaseId` is set to old value; if null purchaseId, `previousPurchaseId` remains null
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [ ]* 3.6 Write property test for individual scan not tracking previous purchase (Property 7)
    - **Property 7: Individual Scan Does Not Track Previous Purchase**
    - For any serial processed with `trackPreviousPurchase` unset/false, `previousPurchaseId` is never modified
    - **Validates: Requirements 6.5, 7.3**

- [x] 4. Checkpoint - Backend verification
  - Ensure all backend tests pass, ask the user if questions arise.

- [x] 5. Frontend: CSV import modal state and template download
  - [x] 5.1 Add modal state types and signals to `purchase-order.component.ts`
    - Define `CsvImportStep` type (`'upload' | 'summary' | 'importing'`)
    - Define `CsvImportRow` and `CsvImportState` interfaces
    - Add component state properties: `csvImportDialogMode`, `csvImportState`
    - Initialize default state with step `'upload'`
    - _Requirements: 1.1, 1.4_

  - [x] 5.2 Implement `downloadCsvTemplate()` method
    - Generate CSV with UTF-8 BOM prefix and `serialNumber,unitType` header
    - Create Blob and trigger download as `serial_import_template.csv`
    - Revoke object URL after download
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 5.3 Add modal template markup for the upload step
    - Add dialog/modal HTML with "Download Template" button and file upload area
    - Include Cancel button to close modal
    - Show file size validation error (>10MB rejection)
    - Wire `csvImportDialogMode` to control visibility
    - _Requirements: 1.1, 1.4, 2.1_

- [x] 6. Frontend: CSV parsing with summary computation
  - [x] 6.1 Implement CSV parsing and validation in the modal flow
    - Reuse existing `parseSerialCsvRows` logic or extract to shared method
    - Validate required headers (`serialNumber`, `unitType`) — show error if missing
    - Validate file has at least one data row — show error if empty
    - Normalize serial numbers using existing `normalizeSerial` method
    - Normalize unit types using existing `normalizeUnitTypeLabel` method
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 6.2 Implement deduplication and row classification logic
    - Mark duplicate rows (same normalized serial appearing later in file)
    - Classify rows as `valid`, `invalid` (missing fields), or `duplicate`
    - Compute summary counts: `totalCount`, `validCount`, `invalidCount`, `duplicateCount`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 6.3 Write property test for normalization idempotence (Property 2)
    - **Property 2: Normalization Idempotence**
    - For any string input, `normalizeSerial(normalizeSerial(x)) === normalizeSerial(x)` and same for `normalizeUnitTypeLabel`
    - **Validates: Requirements 3.4, 3.5**

  - [ ]* 6.4 Write property test for summary count partition invariant (Property 3)
    - **Property 3: Summary Count Partition Invariant**
    - For any parsed CSV with N rows: `validCount + invalidCount + duplicateCount === totalCount === N`
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [ ]* 6.5 Write property test for duplicate detection correctness (Property 4)
    - **Property 4: Duplicate Detection Correctness**
    - A row is marked duplicate iff another row with same normalized serial appears earlier; first occurrence is never duplicate
    - **Validates: Requirements 4.4**

- [x] 7. Frontend: check-serials API call for ownership verification
  - [x] 7.1 Add `checkSerials` method to the purchase order service (or serial number service)
    - Call `POST /serial-number/check-serials` with serial numbers array and purchaseId
    - Return typed response with ownership state per serial
    - _Requirements: 4.5, 4.6_

  - [x] 7.2 Integrate check-serials call into modal flow after parsing
    - After successful parse, call `checkSerials` with valid (non-duplicate) serial numbers
    - Map response to classify rows as `exists-current-po`, `reassign`, or `valid`
    - Update `CsvImportState` with `existsCurrentPoCount` and `reassignCount`
    - Transition modal to `'summary'` step
    - Handle network errors with retry option
    - _Requirements: 4.5, 4.6_

  - [x] 7.3 Add summary step template markup
    - Display total, valid, invalid, duplicate, exists-current-po, and reassign counts
    - Show scrollable preview table with serial number, unit type, and status columns
    - Show "Confirm Import" button (disabled when validCount is 0)
    - Show "Back" button to return to upload step
    - Show "Cancel" button to close modal
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.5_

  - [ ]* 7.4 Write property test for serial status classification (Property 5)
    - **Property 5: Serial Status Classification**
    - For any valid row and check-serials response: `exists-current-po` iff `isSamePoAssignment`, `reassign` iff `exists && !isSamePoAssignment`, `valid` iff `!exists`
    - **Validates: Requirements 4.5, 4.6**

- [x] 8. Frontend: confirmation step and import execution
  - [x] 8.1 Implement confirm import action
    - On "Confirm Import" click, transition to `'importing'` step
    - Call `scanPurchaseSerialBatch` with valid + reassign rows and `trackPreviousPurchase: true`
    - Show loading indicator and disable confirm button during processing
    - _Requirements: 5.1, 5.2, 6.1_

  - [x] 8.2 Handle import results and error states
    - On success: close modal, display success message with imported count, update local serial list
    - On partial failure: show error details in modal with per-serial failure reasons
    - On network error: show error with retry option, preserve parsed state
    - _Requirements: 5.3, 5.4_

  - [x] 8.3 Add importing step template markup
    - Show loading spinner during import
    - Show error details if import fails with list of failed serials and reasons
    - Show retry button on failure
    - _Requirements: 5.2, 5.4_

- [x] 9. Frontend: replace existing Import CSV button behavior with modal trigger
  - [x] 9.1 Modify `openSerialCsvImportPicker()` to open the modal instead of file picker
    - Change method to set `csvImportDialogMode` to open state instead of triggering hidden file input
    - Preserve permission check (`canImportPurchaseCsv`)
    - Preserve edit-mode-only guard
    - Remove or deprecate the hidden file input element if no longer needed
    - _Requirements: 1.1, 1.2, 1.3, 7.4_

  - [x] 9.2 Clean up old direct-import code paths
    - Remove `onSerialCsvSelected` event handler (replaced by modal flow)
    - Remove hidden `<input type="file" id="purchaseSerialCsvInput">` from template if present
    - Keep `importSerialsFromCsv` private method as reference or remove if fully replaced
    - _Requirements: 7.4_

- [x] 10. Final checkpoint - Full verification
  - Ensure all backend and frontend tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The existing `scanPurchaseOrderBatch` endpoint remains backward compatible — the new `trackPreviousPurchase` field is optional and defaults to false
- Frontend uses the same inline dialog pattern already established in the component
