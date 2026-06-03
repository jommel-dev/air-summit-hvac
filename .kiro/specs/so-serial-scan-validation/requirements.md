# Requirements Document

## Introduction

This feature enhances serial number scanning validation for the Sales Order (SO) and Schedule Today SO pages. It brings batch size improvements (already implemented for PO scanning) to SO scanning, and adds comprehensive serial validation with user-friendly warning modals, force-insert capabilities, and a rejected scan counter. The goal is to improve warehouse scanning speed while ensuring data integrity through validation checks that inform but do not unnecessarily block fast-moving operations.

## Glossary

- **SO_Scanner**: The serial number scanning subsystem on the Sales Order and Schedule Today SO pages responsible for processing scanned serial inputs.
- **Serial_Validator**: The backend validation logic within `serial-number.service.ts` that checks serial number state before assignment to a sales order.
- **Scan_Queue**: The frontend batch queue that accumulates scanned serial numbers before flushing them to the backend in batches.
- **Reassignment_Modal**: A confirmation dialog (following the SO Session Guard pattern) displayed when a serial is already assigned to another customer or sales order.
- **Force_Insert_Prompt**: A confirmation dialog displayed when a scanned serial number does not exist in the database, offering the user the option to create it.
- **Rejected_Scan_Counter**: A visible UI counter that tracks the number of serial scans that were dropped or rejected during the current scanning session.
- **Defective_Serial**: A serial number record where `isDefective = true` in the database, indicating the unit has been flagged as defective.
- **Scanned_Status_Serial**: A serial number with status "scanned" that was received via a PO that has not yet been approved.

## Requirements

### Requirement 1: Increase Serial Batch Size and Idle Timer

**User Story:** As a warehouse operator, I want larger batch sizes and longer idle timers for SO serial scanning, so that rapid barcode scanning does not overflow the queue and fewer scans are dropped.

#### Acceptance Criteria

1. THE SO_Scanner SHALL use a serial batch size limit of 50 serials per flush on the Sales Order page.
2. THE SO_Scanner SHALL use a serial batch size limit of 50 serials per flush on the Schedule Today SO page.
3. THE SO_Scanner SHALL use a serial batch idle timer of 1500 milliseconds on the Sales Order page.
4. THE SO_Scanner SHALL use a serial batch idle timer of 1500 milliseconds on the Schedule Today SO page.
5. THE SO_Scanner SHALL maintain the existing serial batch interval timer of 5000 milliseconds for periodic flush on both pages.

### Requirement 2: Product and Capacity Mismatch Validation

**User Story:** As a warehouse operator, I want to be warned when a scanned serial belongs to a different product or capacity than the current SO line item, so that I can catch picking errors before they are finalized.

#### Acceptance Criteria

1. WHEN a serial number is scanned, THE Serial_Validator SHALL check whether the serial's product matches the expected product for the current SO line item.
2. WHEN a serial number is scanned, THE Serial_Validator SHALL check whether the serial's capacity matches the expected capacity for the current SO line item.
3. WHEN a product or capacity mismatch is detected, THE SO_Scanner SHALL display a warning message showing the expected product/capacity and the actual product/capacity of the scanned serial.
4. WHEN a product or capacity mismatch is detected, THE SO_Scanner SHALL present the user with options to confirm the scan or cancel the scan.
5. WHEN the user confirms a mismatched serial scan, THE Serial_Validator SHALL proceed with assigning the serial to the SO line item.
6. WHEN the user cancels a mismatched serial scan, THE SO_Scanner SHALL discard the serial from the queue and refocus the scan input.

### Requirement 3: Defective Serial Detection

**User Story:** As a warehouse operator, I want to be warned when a scanned serial is marked as defective, so that I do not accidentally ship faulty units to customers.

#### Acceptance Criteria

1. WHEN a serial number is scanned, THE Serial_Validator SHALL check the `isDefective` flag of the serial record in the database.
2. WHEN a serial with `isDefective = true` is detected, THE SO_Scanner SHALL display a warning message indicating the serial is marked as defective.
3. WHEN a defective serial warning is displayed, THE SO_Scanner SHALL block the scan from proceeding until the user explicitly confirms or cancels.
4. WHEN the user confirms scanning a defective serial, THE Serial_Validator SHALL proceed with assigning the serial to the SO line item.
5. WHEN the user cancels a defective serial scan, THE SO_Scanner SHALL discard the serial from the queue and refocus the scan input.

### Requirement 4: Non-Existing Serial Handling

**User Story:** As a warehouse operator, I want to be prompted to force-insert a serial number that does not exist in the database, so that I can continue scanning without waiting for admin data entry.

#### Acceptance Criteria

1. WHEN a scanned serial number does not exist in the database, THE Serial_Validator SHALL return a response indicating the serial is not found.
2. WHEN a serial-not-found response is received, THE SO_Scanner SHALL display the Force_Insert_Prompt asking the user whether to create the serial.
3. WHEN the user confirms the force-insert, THE Serial_Validator SHALL create a new serial number record in the database with the product, capacity, and unit type from the current SO line item.
4. WHEN the user confirms the force-insert, THE Serial_Validator SHALL assign the newly created serial to the current sales order.
5. WHEN the user cancels the force-insert, THE SO_Scanner SHALL discard the serial from the queue and refocus the scan input.
6. THE Serial_Validator SHALL record the user who performed the force-insert in the `created_by` field of the new serial record.

### Requirement 5: Scanned Status Serial Handling

**User Story:** As a warehouse operator, I want serials with "scanned" status (from unapproved POs) to be accepted into SO scanning without blocking, so that warehouse operations are not delayed by pending PO approvals.

#### Acceptance Criteria

1. WHEN a serial number has status "scanned" (from a PO that has not been approved), THE Serial_Validator SHALL allow the serial to be assigned to the sales order.
2. WHEN a "scanned" status serial is successfully assigned to the SO, THE SO_Scanner SHALL display an informational message indicating the serial is being reassigned from a pending PO.
3. THE Serial_Validator SHALL update the serial status from "scanned" to "reserved" upon successful assignment to the SO.
4. THE Serial_Validator SHALL record the previous purchase order reference in the `previousPurchaseId` field when reassigning a "scanned" status serial.

### Requirement 6: Serial Already Assigned to Another Customer

**User Story:** As a warehouse operator, I want to see detailed information when a serial is already assigned to another SO/customer, so that I can make an informed decision about whether to force-reassign it.

#### Acceptance Criteria

1. WHEN a scanned serial is already assigned to a different sales order, THE Serial_Validator SHALL return the current customer name, current SO number, and serial number details.
2. WHEN a serial-already-assigned response is received, THE SO_Scanner SHALL display the Reassignment_Modal showing the current customer name, current SO number, and the scanned serial number.
3. THE Reassignment_Modal SHALL present the user with "Force Reassign" and "Cancel" action options.
4. WHEN the user selects "Force Reassign", THE Serial_Validator SHALL unassign the serial from the previous SO and assign it to the current SO.
5. WHEN the user selects "Force Reassign", THE Serial_Validator SHALL record the previous sales order ID in the `previousSalesId` field of the serial record.
6. WHEN the user selects "Cancel", THE SO_Scanner SHALL discard the serial from the queue and refocus the scan input.
7. THE Reassignment_Modal SHALL follow the existing SO Session Guard modal layout and styling pattern.

### Requirement 7: Rejected Scan Counter

**User Story:** As a warehouse operator, I want to see a counter of rejected scans during my session, so that I am aware of any scans that were silently dropped and can investigate them.

#### Acceptance Criteria

1. THE SO_Scanner SHALL maintain a count of rejected serial scans during the current scanning session on the Sales Order page.
2. THE SO_Scanner SHALL maintain a count of rejected serial scans during the current scanning session on the Schedule Today SO page.
3. THE SO_Scanner SHALL display the rejected scan count in the scanning UI when the count is greater than zero.
4. WHEN a serial scan is rejected (due to network failure, timeout, or backend error), THE SO_Scanner SHALL increment the rejected scan count by one.
5. WHEN a serial scan is rejected, THE SO_Scanner SHALL record the serial number and rejection reason in a session-level list.
6. WHEN the user opens a new scanning session (opens a new SO detail), THE SO_Scanner SHALL reset the rejected scan count and reason list to zero.
