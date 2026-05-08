# Requirements Document

## Introduction

This feature adds a Global Serial Number Search capability to the Inventory section of the admin panel. It enables users to search for any serial number across the entire system and view comprehensive details (brand, product, capacity, purchase order, sales order, status, branch, customer, and full event history). Additionally, it provides a Bulk Transfer function that allows reassigning multiple serial numbers to a different brand, product, and capacity — addressing misplacements that occurred during sales order migration.

## Glossary

- **Search_Module**: The backend service and API endpoint responsible for querying serial numbers across the entire `tblserial_numbers` table with joined details from related tables.
- **Search_UI**: The Angular frontend component in the Inventory section that provides the search input, results table, and detail view for serial number lookup.
- **Transfer_Module**: The backend service and API endpoint responsible for updating the `productId` and `capacityId` of selected serial numbers and logging the changes.
- **Transfer_UI**: The Angular frontend component that provides the multi-select interface and target brand/product/capacity selection for bulk reassignment.
- **Serial_Event_Log**: The existing `SerialEventLogService` that records all state changes to serial numbers in `tblserial_number_events`.
- **Admin_User**: An authenticated user with access to the Inventory section of the admin panel.

## Requirements

### Requirement 1: Global Serial Number Search

**User Story:** As an Admin_User, I want to search for serial numbers globally across all inventory records, so that I can quickly locate any serial number and see its full details regardless of which purchase order, sales order, or branch it belongs to.

#### Acceptance Criteria

1. WHEN an Admin_User enters a search query, THE Search_Module SHALL query `tblserial_numbers` using a case-insensitive partial match on the `serialNumber` field.
2. WHEN matching serial numbers are found, THE Search_Module SHALL return each result with the following joined details: serial number, status, unit type, brand name, product name, capacity, branch name, purchase order number, sales order number, customer name, defective flag, returned flag, and creation date.
3. WHEN no matching serial numbers are found, THE Search_UI SHALL display a message indicating zero results were found for the given query.
4. THE Search_Module SHALL support pagination of search results with a configurable page size.
5. WHEN an Admin_User submits a search query shorter than 2 characters, THE Search_UI SHALL display a validation message requiring a minimum of 2 characters.

### Requirement 2: Serial Number Detail View

**User Story:** As an Admin_User, I want to view the complete details and event history of a specific serial number, so that I can trace its full lifecycle and understand its current state.

#### Acceptance Criteria

1. WHEN an Admin_User selects a serial number from the search results, THE Search_UI SHALL display a detail panel showing all fields: serial number, status, unit type, brand name, product name, capacity, indoor model, outdoor model, branch name, vendor name, purchase order number, sales order number, previous sales order number, customer name, defective flag, defect reason, defect date, returned flag, return reason, return date, created by user, and creation date.
2. WHEN a serial number detail panel is opened, THE Search_Module SHALL retrieve the full event history from `tblserial_number_events` for that serial number, ordered by most recent event first.
3. WHEN event history is displayed, THE Search_UI SHALL show for each event: event type, previous and new status, previous and new purchase order, previous and new sales order, previous and new branch, performed by username, reason, and timestamp.

### Requirement 3: Bulk Serial Number Selection

**User Story:** As an Admin_User, I want to select multiple serial numbers from the search results, so that I can perform bulk operations on them.

#### Acceptance Criteria

1. THE Search_UI SHALL provide a checkbox on each row of the search results to allow individual serial number selection.
2. THE Search_UI SHALL provide a "Select All" checkbox that selects all serial numbers on the current page of results.
3. WHEN one or more serial numbers are selected, THE Search_UI SHALL display the count of selected serial numbers and enable the "Transfer" action button.
4. WHEN no serial numbers are selected, THE Transfer_UI SHALL disable the "Transfer" action button.

### Requirement 4: Bulk Transfer to Different Brand/Product/Capacity

**User Story:** As an Admin_User, I want to transfer multiple selected serial numbers to a different brand, product, and capacity, so that I can correct misplacements that occurred during sales order migration.

#### Acceptance Criteria

1. WHEN the Admin_User initiates a bulk transfer, THE Transfer_UI SHALL present a form to select a target brand, target product (filtered by the selected brand), and target capacity (filtered by the selected product).
2. WHEN the Admin_User selects a target brand, THE Transfer_UI SHALL load and display only products belonging to that brand.
3. WHEN the Admin_User selects a target product, THE Transfer_UI SHALL load and display only capacities belonging to that product.
4. WHEN the Admin_User confirms the transfer, THE Transfer_Module SHALL update the `productId` and `capacityId` fields of each selected serial number to the chosen target product and capacity.
5. WHEN the Admin_User confirms the transfer, THE Transfer_Module SHALL execute all updates within a single database transaction so that either all serial numbers are updated or none are updated.
6. IF the database transaction fails, THEN THE Transfer_Module SHALL roll back all changes and return an error message describing the failure.
7. WHEN a transfer is completed successfully, THE Transfer_UI SHALL display a success message indicating the number of serial numbers transferred and the target product and capacity.

### Requirement 5: Transfer Event Logging

**User Story:** As an Admin_User, I want every bulk transfer to be logged in the serial event history, so that there is a full audit trail of reassignments for traceability.

#### Acceptance Criteria

1. WHEN a serial number is transferred, THE Transfer_Module SHALL create an event log entry in `tblserial_number_events` with event type `TRANSFERRED` for each serial number in the batch.
2. THE Transfer_Module SHALL record in the event metadata the previous product ID, previous capacity ID, new product ID, new capacity ID, previous brand name, and new brand name.
3. THE Transfer_Module SHALL record the performing user's ID, username, and IP address in each event log entry.
4. THE Transfer_Module SHALL include a reason field in the event log entry, defaulting to "Bulk transfer - serial misplacement correction" if no custom reason is provided by the Admin_User.

### Requirement 6: Transfer Validation

**User Story:** As an Admin_User, I want the system to validate my transfer request before executing it, so that I do not accidentally assign serial numbers to invalid or non-existent products.

#### Acceptance Criteria

1. WHEN a transfer is requested, THE Transfer_Module SHALL verify that the target product ID exists in `tblproducts` and the target capacity ID exists in `tblcapacity`.
2. WHEN a transfer is requested, THE Transfer_Module SHALL verify that the target capacity belongs to the target product (i.e., `tblcapacity.prodId` matches the target product ID).
3. IF the target product or capacity does not exist, THEN THE Transfer_Module SHALL reject the transfer and return a descriptive error message.
4. IF the target capacity does not belong to the target product, THEN THE Transfer_Module SHALL reject the transfer and return an error message indicating the mismatch.
5. WHEN a transfer is requested with an empty list of serial number IDs, THE Transfer_Module SHALL reject the request and return a validation error.

### Requirement 7: Transfer Confirmation Dialog

**User Story:** As an Admin_User, I want to see a confirmation dialog before the transfer executes, so that I can review the operation and avoid accidental reassignments.

#### Acceptance Criteria

1. WHEN the Admin_User clicks the transfer submit button, THE Transfer_UI SHALL display a confirmation dialog showing: the count of serial numbers to be transferred, the target brand name, the target product name, and the target capacity.
2. WHEN the Admin_User confirms the dialog, THE Transfer_UI SHALL send the transfer request to the Transfer_Module.
3. WHEN the Admin_User cancels the dialog, THE Transfer_UI SHALL close the dialog without sending any request and preserve the current selection state.
