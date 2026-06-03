# Implementation Plan: SO Serial Scan Validation

## Overview

This implementation extends the existing `scanSalesOrder` and `scanSalesOrderBatch` methods in the backend `SerialNumberService` to return structured validation responses (soft warnings) instead of hard failures for mismatch, defective, non-existing, and already-assigned scenarios. The frontend SO and Schedule Today SO pages are updated to interpret these responses, present confirmation modals, and support force operations. Batch size/idle timer constants are aligned with the PO scanning values (50/1500ms), and a rejected scan counter provides operational visibility.

## Tasks

- [x] 1. Backend: Extend DTO and response interfaces
  - [x] 1.1 Add force flags to `ScanSalesOrderDto` and batch item DTO
    - Add `forceAssign?: boolean`, `forceInsert?: boolean`, `forceReassign?: boolean` fields to `ScanSalesOrderDto` in `backend/src/inventory/serial-number/dto/scan-sales-order.dto.ts`
    - Add the same fields to `ScanSalesOrderBatchItemDto` in `backend/src/inventory/serial-number/dto/scan-sales-order-batch.dto.ts`
    - _Requirements: 2.5, 3.4, 4.3, 6.4_

  - [x] 1.2 Create `ScanSalesOrderResponse` interface with `validationStatus` and `details`
    - Create `backend/src/inventory/serial-number/interfaces/scan-sales-order-response.interface.ts`
    - Define `ScanSalesOrderResponse` with fields: `success`, `message`, `validationStatus` (enum: `ok`, `not_found`, `warning_defective`, `warning_mismatch`, `warning_reassignment`, `info_scanned_status`), `details` object, and `item`
    - Define the `details` shape: `expectedProductName`, `expectedCapacityName`, `actualProductName`, `actualCapacityName`, `currentCustomerName`, `currentSoNumber`, `currentSalesId`, `previousPoNumber`, `previousPurchaseId`
    - Update batch response type to include `warningCount` in summary
    - _Requirements: 2.3, 3.2, 4.1, 5.2, 6.1, 6.2_

- [x] 2. Backend: Refactor `scanSalesOrder` validation pipeline
  - [x] 2.1 Implement non-existing serial handling with `not_found` response
    - When serial lookup returns 0 rows and `forceInsert` is NOT true, return `{ success: false, validationStatus: 'not_found', message: 'Serial number not found' }`
    - When `forceInsert = true`, create a new serial record using `expectedProductId`, `expectedCapacityId`, `expectedUnitType`, `branchId`, and `created_by` from actor, then assign to salesId with status `reserved`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6_

  - [ ]* 2.2 Write property test for non-existing serial force-insert
    - **Property 4: Non-Existing Serial Force-Insert**
    - **Validates: Requirements 4.1, 4.3, 4.4, 4.6**

  - [x] 2.3 Implement defective serial detection with `warning_defective` response
    - After serial lookup, check `isDefective` flag on the serial record
    - When `isDefective = true` and `forceAssign` is NOT true, return `{ success: false, validationStatus: 'warning_defective', message: 'Serial number is marked as defective' }`
    - When `forceAssign = true`, skip the defective check and continue to assignment
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 2.4 Write property test for defective serial detection
    - **Property 3: Defective Serial Detection**
    - **Validates: Requirements 3.1, 3.3**

  - [x] 2.5 Refactor product/capacity mismatch to return `warning_mismatch` with details
    - Replace current `auditFailure()` calls for product/capacity mismatch with a structured response: `{ success: false, validationStatus: 'warning_mismatch', details: { expectedProductName, expectedCapacityName, actualProductName, actualCapacityName } }`
    - When `forceAssign = true`, skip mismatch checks and proceed to assignment
    - Fetch expected product/capacity names for the response details
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

  - [ ]* 2.6 Write property test for product/capacity mismatch detection
    - **Property 1: Product/Capacity Mismatch Detection**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ]* 2.7 Write property test for force-assign override
    - **Property 2: Force-Assign Overrides Warnings**
    - **Validates: Requirements 2.5, 3.4**

  - [x] 2.8 Implement already-assigned detection with `warning_reassignment` response
    - When serial is assigned to a different sales order and `forceReassign` is NOT true, return `{ success: false, validationStatus: 'warning_reassignment', details: { currentCustomerName, currentSoNumber, currentSalesId } }`
    - Fetch the customer name associated with the current sales order for the details
    - When `forceReassign = true`, proceed with reassignment: update `salesId`, record `previousSalesId`, and set status to `reserved`
    - _Requirements: 6.1, 6.2, 6.4, 6.5_

  - [ ]* 2.9 Write property test for already-assigned response details
    - **Property 7: Already-Assigned Response Contains Required Details**
    - **Validates: Requirements 6.1**

  - [ ]* 2.10 Write property test for force-reassignment
    - **Property 6: Force-Reassignment Records Previous Assignment**
    - **Validates: Requirements 6.4, 6.5**

  - [x] 2.11 Implement scanned-status serial acceptance with info response
    - When serial has status `scanned` and has a non-null `purchaseId`, proceed with assignment: update `salesId`, change status to `reserved`, record `purchaseId` in `previousPurchaseId` field
    - Return `{ success: true, validationStatus: 'info_scanned_status', message: 'Serial reassigned from pending PO', details: { previousPoNumber, previousPurchaseId } }`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 2.12 Write property test for scanned-status serial acceptance
    - **Property 5: Scanned-Status Serial Acceptance and State Transition**
    - **Validates: Requirements 5.1, 5.3, 5.4**

- [x] 3. Checkpoint - Backend validation pipeline
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Backend: Update batch handler to propagate `validationStatus`
  - [x] 4.1 Update `scanSalesOrderBatch` to include `validationStatus` and `details` in batch item results
    - Pass force flags from each batch item DTO through to `scanSalesOrder`
    - Include `validationStatus` and `details` in each result item returned from the batch
    - Add `warningCount` to the batch summary (items where `validationStatus` starts with `warning_` or is `not_found`)
    - _Requirements: 2.3, 3.2, 4.1, 6.1_

  - [ ]* 4.2 Write unit tests for batch handler warning propagation
    - Test a mixed batch with valid, mismatch, defective, not-found, and already-assigned serials
    - Verify `warningCount` is accurate in summary
    - _Requirements: 2.3, 3.2, 4.1, 6.1_

- [x] 5. Frontend: Update batch constants on SO and Schedule Today pages
  - [x] 5.1 Update `serialBatchSize` and `serialBatchIdleMs` on Schedule Today SO page
    - Change `serialBatchSize` from 20 to 50 in `frontend/src/app/pages/schedule-today-sales-order/schedule-today-sales-order.component.ts`
    - Change `serialBatchIdleMs` from 1000 to 1500 in the same file
    - Verify `serialBatchIntervalMs` remains at 5000
    - _Requirements: 1.2, 1.4, 1.5_

  - [x] 5.2 Add batch queue scanning to the Sales Order page
    - Add `serialBatchSize = 50`, `serialBatchIdleMs = 1500`, `serialBatchIntervalMs = 5000` constants to `sales-order.component.ts`
    - Add `queuedSerialScans` array, `isFlushingQueuedSerials` flag, and `activeSerialFlushCount` state
    - Implement `flushQueuedSerialScans` method mirroring the Schedule Today pattern, calling `salesOrderService.scanSalesSerialBatch`
    - Update `scanSerialForSelectedUnit` to queue scans and flush via the batch mechanism instead of individual API calls
    - _Requirements: 1.1, 1.3, 1.5_

- [x] 6. Frontend: Implement warning modal system
  - [x] 6.1 Create shared serial validation warning modal component
    - Create a reusable dialog component at `frontend/src/app/pages/sales-order/serial-validation-modal/` following the existing `SalesGuardDialogMode` pattern
    - Support four modes: `mismatch-warning`, `defective-warning`, `reassignment-warning`, `force-insert-prompt`
    - Accept `validationStatus` and `details` as inputs to display contextual information
    - Emit `confirm` and `cancel` events
    - _Requirements: 2.3, 2.4, 3.2, 3.3, 4.2, 6.2, 6.3, 6.7_

  - [x] 6.2 Integrate warning modal into Sales Order page
    - After batch flush response, extract items with `validationStatus` in `['not_found', 'warning_defective', 'warning_mismatch', 'warning_reassignment']`
    - Queue warning items and present them sequentially to the user via the modal component
    - On confirm: re-send the serial with the appropriate force flag (`forceAssign`, `forceInsert`, or `forceReassign`) set to true
    - On cancel: discard the serial from the queue and refocus scan input
    - _Requirements: 2.4, 2.5, 2.6, 3.3, 3.4, 3.5, 4.2, 4.3, 4.5, 6.3, 6.4, 6.6_

  - [x] 6.3 Integrate warning modal into Schedule Today SO page
    - Apply the same modal integration pattern from 6.2 to `schedule-today-sales-order.component.ts`
    - Reuse the shared serial validation modal component
    - Wire confirm/cancel handlers to trigger force re-scans or discard serials
    - _Requirements: 2.4, 2.5, 2.6, 3.3, 3.4, 3.5, 4.2, 4.3, 4.5, 6.3, 6.4, 6.6_

- [x] 7. Frontend: Implement rejected scan counter
  - [x] 7.1 Add rejected scan counter state and UI to Sales Order page
    - Add `rejectedScanCount: number = 0` and `rejectedScanList: Array<{ serialNumber: string; reason: string; timestamp: Date }> = []` state
    - Increment counter when a scan fails due to network error, timeout, or backend error (not validation warnings)
    - Display the counter in the scanning UI section when count > 0
    - Reset counter and list when opening a new SO detail (new edit drawer)
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.6_

  - [x] 7.2 Add rejected scan counter state and UI to Schedule Today SO page
    - Apply the same rejected scan counter pattern from 7.1 to `schedule-today-sales-order.component.ts`
    - Increment on network/timeout/backend errors within `flushQueuedSerialScans` catch block
    - Display counter in the scanning section of the Schedule Today template
    - Reset when navigating to a different SO
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 7.3 Write unit tests for rejected scan counter logic
    - **Property 8: Rejected Scan Counter Accuracy**
    - **Property 9: Session Reset Clears Rejection State**
    - **Validates: Requirements 7.1, 7.2, 7.4, 7.5, 7.6**

- [x] 8. Frontend: Handle informational scanned-status message
  - [x] 8.1 Display info message for scanned-status serial reassignment
    - When batch response items have `validationStatus = 'info_scanned_status'`, display a non-blocking informational toast or inline message indicating the serial was reassigned from a pending PO
    - Include the previous PO number from `details.previousPoNumber` in the message
    - _Requirements: 5.2_

- [x] 9. Backend: Install fast-check and set up property test infrastructure
  - [x] 9.1 Install `fast-check` and create test helper utilities
    - Add `fast-check` as a devDependency in `backend/package.json`
    - Create `backend/src/inventory/serial-number/serial-number.service.property.spec.ts` test file
    - Set up test module with mocked `DatabaseService` and `SerialEventLogService`
    - Create reusable fast-check arbitraries for serial records, sales IDs, product IDs, capacity IDs
    - _Requirements: (test infrastructure)_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The Sales Order page currently uses individual scan API calls (not batch); task 5.2 introduces the batch queue mechanism already present on Schedule Today
- The existing `SalesGuardDialogMode` pattern in `sales-order.component.ts` provides the template for modal styling and behavior
- `fast-check` must be installed as it is not currently a project dependency

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "9.1"] },
    { "id": 1, "tasks": ["2.1", "2.3", "2.5", "2.8", "2.11", "5.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.6", "2.7", "2.9", "2.10", "2.12", "4.1"] },
    { "id": 3, "tasks": ["4.2", "5.2"] },
    { "id": 4, "tasks": ["6.1", "7.1", "7.2"] },
    { "id": 5, "tasks": ["6.2", "6.3", "7.3", "8.1"] }
  ]
}
```
