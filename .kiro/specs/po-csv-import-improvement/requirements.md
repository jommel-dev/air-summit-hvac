# Requirements Document

## Introduction

This feature improves the existing "Import CSV" functionality on the Purchase Order (PO) edit form. Instead of immediately opening a file picker and processing the CSV, the improved flow introduces a modal dialog with a template download, upload with summary preview (including validation results), and a confirmation step before processing. Additionally, a new `previousPurchaseId` column is added to `tblserial_numbers` to preserve serial number purchase history when serials are reassigned.

## Glossary

- **Import_Modal**: The dialog component that opens when the user clicks "Import CSV" on the PO edit form, containing template download, file upload, summary preview, and confirm actions.
- **CSV_Template**: A downloadable CSV file containing the required column headers (`serialNumber`, `unitType`) with no data rows, serving as a guide for users to fill in serial numbers.
- **Summary_Preview**: The section within the Import_Modal that displays parsed CSV results including total count, valid rows, invalid rows with reasons, duplicates, and reassignment information.
- **Serial_Number_Service**: The backend service responsible for processing serial number scan operations, including the batch purchase order scan endpoint.
- **PO_Edit_Form**: The Purchase Order edit form component displayed in drawer mode when editing an existing purchase order.
- **Previous_Purchase_Tracker**: The database mechanism (column `previousPurchaseId` on `tblserial_numbers`) that stores the prior purchase order reference when a serial is reassigned to a new PO.

## Requirements

### Requirement 1: Import CSV Modal Trigger

**User Story:** As a warehouse operator, I want clicking "Import CSV" to open a modal dialog instead of directly opening a file picker, so that I can review instructions and download a template before uploading.

#### Acceptance Criteria

1. WHEN the user clicks the "Import CSV" button on the PO_Edit_Form, THE Import_Modal SHALL open displaying the template download and file upload sections.
2. WHILE the PO_Edit_Form is in create mode, THE Import_Modal SHALL remain unavailable and the "Import CSV" button SHALL be hidden.
3. IF the user does not have the `canImportPurchaseCsv` permission, THEN THE PO_Edit_Form SHALL hide the "Import CSV" button.
4. WHEN the Import_Modal opens, THE Import_Modal SHALL display a "Download Template" button and a file upload area.

### Requirement 2: CSV Template Download

**User Story:** As a warehouse operator, I want to download a CSV template with the correct column headers, so that I can fill in serial numbers in the expected format.

#### Acceptance Criteria

1. WHEN the user clicks the "Download Template" button in the Import_Modal, THE Import_Modal SHALL generate and download a CSV file named `serial_import_template.csv`.
2. THE CSV_Template SHALL contain exactly two column headers: `serialNumber` and `unitType`.
3. THE CSV_Template SHALL contain no data rows beyond the header row.
4. THE CSV_Template SHALL use UTF-8 encoding with a BOM prefix for Excel compatibility.

### Requirement 3: CSV File Upload and Parsing

**User Story:** As a warehouse operator, I want to upload a filled CSV file and see it parsed within the modal, so that I can verify the data before committing the import.

#### Acceptance Criteria

1. WHEN the user selects a CSV file via the file upload area in the Import_Modal, THE Import_Modal SHALL parse the file contents and display the Summary_Preview.
2. IF the uploaded file does not contain the required `serialNumber` and `unitType` headers, THEN THE Import_Modal SHALL display a validation error message indicating the missing headers.
3. IF the uploaded file contains zero data rows, THEN THE Import_Modal SHALL display a validation error message indicating the file is empty.
4. WHEN the CSV file is parsed, THE Import_Modal SHALL normalize serial numbers by trimming whitespace and applying consistent casing rules matching the existing `normalizeSerial` logic.
5. WHEN the CSV file is parsed, THE Import_Modal SHALL normalize unit type values using the existing `normalizeUnitTypeLabel` logic.

### Requirement 4: Summary Preview Display

**User Story:** As a warehouse operator, I want to see a detailed summary of the parsed CSV data before confirming, so that I can identify issues and understand what will happen during import.

#### Acceptance Criteria

1. WHEN the CSV file is successfully parsed, THE Summary_Preview SHALL display the total count of serial number rows in the file.
2. WHEN the CSV file is successfully parsed, THE Summary_Preview SHALL display the count of valid rows that will be imported.
3. WHEN the CSV file is successfully parsed, THE Summary_Preview SHALL display the count and details of invalid rows with specific reasons (missing serialNumber, missing unitType).
4. WHEN the CSV file contains duplicate serial numbers within the file, THE Summary_Preview SHALL display the count of duplicates and indicate which serial numbers are duplicated.
5. WHEN the CSV file contains serial numbers already assigned to the current PO, THE Summary_Preview SHALL display those serials with a label indicating they already exist in this PO.
6. WHEN the CSV file contains serial numbers currently assigned to a different PO, THE Summary_Preview SHALL display those serials with a label indicating they will be reassigned from the other PO and the `previousPurchaseId` will be set.
7. THE Summary_Preview SHALL display a scrollable preview table of the parsed rows showing serial number, unit type, and status for each row.

### Requirement 5: Confirm Import Action

**User Story:** As a warehouse operator, I want to explicitly confirm the import after reviewing the summary, so that I do not accidentally import incorrect data.

#### Acceptance Criteria

1. WHEN the user clicks the "Confirm Import" button in the Import_Modal, THE Serial_Number_Service SHALL process the validated serial numbers using the existing `scanPurchaseSerialBatch` endpoint.
2. WHILE the import is being processed, THE Import_Modal SHALL display a loading indicator and disable the "Confirm Import" button.
3. WHEN the import completes successfully, THE Import_Modal SHALL close and THE PO_Edit_Form SHALL display a success message with the count of imported serials.
4. IF the import encounters errors, THEN THE Import_Modal SHALL display the error details including which serial numbers failed and the failure reasons.
5. IF the Summary_Preview shows zero valid rows, THEN THE Import_Modal SHALL disable the "Confirm Import" button.
6. WHEN the user clicks the "Cancel" button in the Import_Modal, THE Import_Modal SHALL close without processing any serial numbers.

### Requirement 6: Previous Purchase ID Tracking

**User Story:** As a system administrator, I want serial numbers to retain their previous purchase order reference when reassigned, so that the purchase history is preserved for auditing.

#### Acceptance Criteria

1. THE Previous_Purchase_Tracker SHALL store the prior `purchaseId` value in the `previousPurchaseId` column of `tblserial_numbers` before the `purchaseId` is overwritten with the new PO reference.
2. WHEN a serial number that has an existing `purchaseId` is assigned to a new PO via CSV import, THE Serial_Number_Service SHALL set `previousPurchaseId` to the current `purchaseId` value before updating `purchaseId` to the new PO.
3. WHEN a serial number has no existing `purchaseId` (null), THE Serial_Number_Service SHALL leave `previousPurchaseId` as null.
4. THE `previousPurchaseId` column SHALL be nullable and reference `tblpurchase_orders(id)` with ON UPDATE CASCADE and ON DELETE SET NULL constraints.
5. THE Previous_Purchase_Tracker SHALL NOT modify the `previousPurchaseId` value when a serial is scanned individually (non-CSV flow) to maintain backward compatibility.

### Requirement 7: Backward Compatibility

**User Story:** As a developer, I want the improved CSV import to maintain compatibility with the existing batch scan endpoint, so that no existing functionality is broken.

#### Acceptance Criteria

1. THE Serial_Number_Service SHALL continue to accept the existing `scanPurchaseSerialBatch` request payload format without requiring changes from other callers.
2. THE Serial_Number_Service SHALL return the same response structure from the batch endpoint as the current implementation.
3. WHEN serial numbers are scanned individually via the existing scan flow (non-CSV), THE Serial_Number_Service SHALL process them without invoking the `previousPurchaseId` tracking logic.
4. THE PO_Edit_Form SHALL continue to support the existing individual serial scan workflow without modification.
