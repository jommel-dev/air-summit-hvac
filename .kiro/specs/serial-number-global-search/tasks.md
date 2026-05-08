# Implementation Plan: Serial Number Global Search & Bulk Transfer

## Overview

Implement a global serial number search with detail view and bulk transfer capability. The backend extends the existing `SerialNumberController` and `SerialNumberService` with two new endpoints. The frontend adds a new standalone Angular component with search, detail panel, multi-select, and cascading-dropdown transfer dialog.

## Tasks

- [x] 1. Create BulkTransferDto and response interfaces
  - [x] 1.1 Create `backend/src/inventory/serial-number/dto/bulk-transfer.dto.ts`
    - Define `BulkTransferDto` class with fields: `serialIds: number[]`, `targetProductId: number`, `targetCapacityId: number`, `reason?: string`
    - _Requirements: 4.4, 6.5_

  - [x] 1.2 Create `backend/src/inventory/serial-number/interfaces/global-search.interfaces.ts`
    - Define `GlobalSearchResult` interface with all joined fields (id, serialNumber, status, unitType, brandName, productName, capacity, branchName, poNumber, soNumber, customerName, isDefective, isReturned, createdAt)
    - Define `GlobalSearchResponse` interface with fields: success, items, total, page, pageSize
    - Define `BulkTransferResponse` interface with fields: success, message, transferredCount
    - _Requirements: 1.2, 4.7_

- [x] 2. Implement globalSearch method in SerialNumberService
  - [x] 2.1 Add `globalSearch` method to `backend/src/inventory/serial-number/serial-number.service.ts`
    - Accept params: `{ search: string; page: number; pageSize: number }`
    - Execute parameterized SQL query joining `tblserial_numbers` with `tblproducts`, `tblbrands`, `tblcapacity`, `tblbranches`, `tblpurchase_orders`, `tblsales_order`, `tblcustomer`
    - Use ILIKE with `%search%` for case-insensitive partial match on `serialNumber`
    - Execute count query for total results
    - Apply LIMIT/OFFSET pagination
    - Return `{ success: true, items, total, page, pageSize }`
    - _Requirements: 1.1, 1.2, 1.4_

  - [ ]* 2.2 Write property test: Search returns all and only matching serials
    - **Property 1: Search returns all and only matching serials**
    - **Validates: Requirements 1.1**

  - [ ]* 2.3 Write property test: Pagination returns correct slices
    - **Property 2: Pagination returns correct slices**
    - **Validates: Requirements 1.4**

- [x] 3. Implement bulkTransfer method in SerialNumberService
  - [x] 3.1 Add `bulkTransfer` method to `backend/src/inventory/serial-number/serial-number.service.ts`
    - Accept params: `{ serialIds, targetProductId, targetCapacityId, reason, performedBy, performedByUsername, ipAddress }`
    - Validate serialIds is non-empty, return 400 error if empty
    - Validate target product exists in `tblproducts`
    - Validate target capacity exists in `tblcapacity` and its `prodId` matches target product
    - Use `DatabaseService.withTransaction()` for atomicity
    - SELECT current state of all serials before update (previous productId, capacityId)
    - UPDATE all serials' `productId` and `capacityId` using `WHERE id = ANY($1::bigint[])`
    - For each serial, call `SerialEventLogService.logEvent()` with event type `TRANSFERRED`, passing the transaction client, previous/new product/capacity in metadata, reason (default: "Bulk transfer - serial misplacement correction"), and actor info
    - Return `{ success: true, message, transferredCount }`
    - _Requirements: 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 3.2 Write property test: Bulk transfer updates all targeted serials correctly
    - **Property 4: Bulk transfer updates all targeted serials correctly**
    - **Validates: Requirements 4.4**

  - [ ]* 3.3 Write property test: Bulk transfer is atomic
    - **Property 5: Bulk transfer is atomic**
    - **Validates: Requirements 4.5, 4.6**

  - [ ]* 3.4 Write property test: Transfer event logging is complete and accurate
    - **Property 6: Transfer event logging is complete and accurate**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [ ]* 3.5 Write property test: Transfer validation rejects invalid targets
    - **Property 7: Transfer validation rejects invalid targets**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

- [x] 4. Add controller endpoints
  - [x] 4.1 Add `GET /serial-number/global-search` endpoint to `backend/src/inventory/serial-number/serial-number.controller.ts`
    - Accept query params: `search`, `page`, `pageSize`
    - Parse page/pageSize to integers with defaults (page=1, pageSize=20)
    - Call `serialNumberService.globalSearch()`
    - _Requirements: 1.1, 1.4_

  - [x] 4.2 Add `POST /serial-number/bulk-transfer` endpoint to `backend/src/inventory/serial-number/serial-number.controller.ts`
    - Accept `BulkTransferDto` body
    - Resolve audit actor from request (userId, username, ipAddress) using existing `resolveAuditActor` pattern
    - Call `serialNumberService.bulkTransfer()` with DTO fields and actor context
    - _Requirements: 4.4, 5.3_

- [x] 5. Checkpoint - Backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Create SerialGlobalSearchComponent (frontend)
  - [x] 6.1 Create component file `frontend/src/app/pages/inventory/serial-global-search/serial-global-search.component.ts`
    - Standalone Angular component with signals for state management
    - Inject `HttpClient` for API calls
    - Define signals: searchQuery, results, totalResults, currentPage, pageSize, selectedIds, detailSerial, eventHistory, isLoading, isTransferDialogOpen
    - Define transfer dialog signals: brands, products, capacities, selectedBrandId, selectedProductId, selectedCapacityId, transferReason
    - Implement `onSearch()` method: validate min 2 chars, call `GET /serial-number/global-search` with query params, update results/total signals
    - Implement `onPageChange()` method: update currentPage, re-fetch results
    - Implement `onSelectSerial(id)` and `onSelectAll()` methods for checkbox management
    - Implement `onViewDetail(serial)` method: set detailSerial signal, call `GET /serial-number/history/:id` to load event history
    - Implement `loadBrands()`, filter products by selectedBrandId (client-side), filter capacities by selectedProductId (client-side)
    - Implement `onConfirmTransfer()` method: call `POST /serial-number/bulk-transfer`, show success/error toast, refresh results on success
    - _Requirements: 1.1, 1.3, 1.5, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 7.1, 7.2, 7.3_

  - [x] 6.2 Create template file `frontend/src/app/pages/inventory/serial-global-search/serial-global-search.component.html`
    - Search input with min-length validation message
    - Results table with columns: checkbox, serial number, status, brand, product, capacity, branch, PO#, SO#, customer, defective, returned, date
    - Row click opens detail panel
    - Detail panel showing all serial fields and event history table
    - Selection count display and "Transfer" button (disabled when no selection)
    - Transfer dialog with cascading dropdowns (brand → product → capacity), reason textarea, confirmation step showing count and target details
    - Pagination controls
    - Use Tailwind CSS for styling
    - _Requirements: 1.3, 1.5, 2.1, 2.3, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 7.1, 7.2, 7.3_

  - [ ]* 6.3 Write property test: Event history is ordered by timestamp descending
    - **Property 3: Event history is ordered by timestamp descending**
    - **Validates: Requirements 2.2**

- [x] 7. Add route to app.routes.ts
  - [x] 7.1 Add route entry in `frontend/src/app/app.routes.ts`
    - Add inside the `users` layout children array with path `serial-global-search`
    - Use `loadComponent` for lazy loading the `SerialGlobalSearchComponent`
    - Set `canActivate: [rbacGuard]` with data `{ menu: 'inventory', permission: 'canRead' }`
    - Set title: 'Serial Global Search'
    - _Requirements: 1.1_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The frontend reuses existing `/brands`, `/products`, and `/capacity` endpoints for cascading dropdowns — no new backend endpoints needed for filtering
- The `SerialEventLogService.logEvent()` accepts an optional `PoolClient` parameter for transactional logging
