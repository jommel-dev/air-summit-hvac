# Requirements Document

## Introduction

This feature covers two major changes to the HVAC Warehouse & Sales system:

1. **SO Number Format Redesign** — Transition from the current auto-generated stored column format (`SO-000001`) to a new year-month-sequence format (`SO2026-0600001`) that resets monthly. Existing sales orders retain their original format.

2. **Delivery Receipt (DR) Print Redesign** — A new code path that generates a DR document from scratch (HTML-to-PDF or pdf-lib), replacing the current PDF template overlay approach. The new DR groups multiple sales orders by customer and serves as the Master List for Installers printed before delivery.

## Glossary

- **SO_Number_Generator**: The application-level service or database trigger responsible for generating new SO numbers in the format `SO<YEAR>-<MONTH><5-DIGIT-SEQUENCE>`.
- **DR_Generator**: The service responsible for generating Delivery Receipt PDF documents from scratch using HTML-to-PDF or pdf-lib.
- **Sales_Order**: A record in `tblsales_order` representing a customer sales transaction.
- **Delivery_Receipt**: A printable PDF document listing products and serial numbers for one or more sales orders grouped by customer, used as the installer master list.
- **Monthly_Sequence**: A counter that tracks the next available 5-digit sequence number for SO generation, resetting to 00001 at the start of each calendar month.
- **Business_Settings**: The single-row configuration in `tblsettings` containing company name, address, logo, and print preferences.
- **Serial_Number**: A record in `tblserial_numbers` representing an indoor or outdoor unit serial linked to a sales order, product, and capacity.
- **Customer**: A record in `tblcustomer` representing a buyer (regular or sub-dealer).

## Requirements

### Requirement 1: SO Number Format Generation

**User Story:** As a warehouse administrator, I want new sales orders to receive a year-month-sequence number format, so that SO numbers are organized chronologically and the sequence resets monthly for cleaner tracking.

#### Acceptance Criteria

1. WHEN a new Sales_Order is created, THE SO_Number_Generator SHALL produce an so_number in the format `SO<4-digit-year>-<2-digit-month><5-digit-sequence>` (e.g., `SO2026-0600001`).
2. THE SO_Number_Generator SHALL use the Sales_Order creation timestamp to determine the year and month components.
3. WHEN the first Sales_Order of a new calendar month is created, THE SO_Number_Generator SHALL reset the 5-digit sequence to `00001`.
4. THE SO_Number_Generator SHALL increment the 5-digit sequence by 1 for each subsequent Sales_Order created within the same calendar month.
5. WHEN multiple Sales_Orders are created concurrently within the same month, THE SO_Number_Generator SHALL assign unique sequential numbers without gaps or duplicates.

### Requirement 2: SO Number Column Migration

**User Story:** As a developer, I want the `so_number` column changed from a GENERATED ALWAYS AS STORED column to a regular column with application-level or trigger-based generation, so that the new format can be applied without breaking existing records.

#### Acceptance Criteria

1. WHEN the migration is applied, THE database SHALL convert the `so_number` column from `GENERATED ALWAYS AS STORED` to a regular `TEXT` column.
2. WHEN the migration is applied, THE database SHALL preserve all existing so_number values (e.g., `SO-000001`, `SO-000002`) without modification.
3. THE database SHALL enforce a UNIQUE constraint on the `so_number` column to prevent duplicate SO numbers.
4. THE database SHALL enforce a NOT NULL constraint on the `so_number` column for all new Sales_Order records.
5. IF the SO_Number_Generator fails to produce a valid number during Sales_Order creation, THEN THE system SHALL reject the insert and return a descriptive error message.

### Requirement 3: Monthly Sequence Tracking

**User Story:** As a system administrator, I want the SO number sequence tracked per month, so that each month starts fresh and the numbering remains predictable.

#### Acceptance Criteria

1. THE SO_Number_Generator SHALL maintain a persistent sequence counter per year-month combination.
2. WHEN a Sales_Order is created in a year-month that has no prior sequence record, THE SO_Number_Generator SHALL initialize the sequence at 1.
3. THE SO_Number_Generator SHALL support sequences up to 99999 per month without error.
4. IF the monthly sequence exceeds 99999, THEN THE SO_Number_Generator SHALL reject the Sales_Order creation and return an error indicating the monthly limit has been reached.

### Requirement 4: Backward Compatibility of Existing SO Numbers

**User Story:** As a user, I want existing sales orders to retain their original SO numbers, so that historical references and printed documents remain valid.

#### Acceptance Criteria

1. THE database migration SHALL retain the original `SO-XXXXXX` format for all Sales_Order records created before the migration.
2. THE system SHALL display both old-format (`SO-000001`) and new-format (`SO2026-0600001`) SO numbers without any rendering issues in the frontend.
3. WHEN searching or filtering by SO number, THE system SHALL match against both old-format and new-format patterns.

### Requirement 5: Delivery Receipt PDF Generation

**User Story:** As a warehouse supervisor, I want a newly generated Delivery Receipt document that groups multiple sales orders by customer, so that installers have a clear master list for delivery runs.

#### Acceptance Criteria

1. WHEN the user requests a Delivery Receipt for a customer with one or more Sales_Orders at status "for-delivery" or above, THE DR_Generator SHALL produce a PDF document.
2. THE DR_Generator SHALL group all qualifying Sales_Orders for the same Customer onto a single Delivery Receipt page or set of pages.
3. THE DR_Generator SHALL generate the PDF from scratch using HTML-to-PDF rendering or programmatic pdf-lib construction, independent of the existing PDF template overlay approach.
4. THE existing PDF template overlay DR feature SHALL remain functional as a separate code path.

### Requirement 6: Delivery Receipt Header Section

**User Story:** As a warehouse supervisor, I want the DR header to display company branding and identification, so that the document is professional and traceable.

#### Acceptance Criteria

1. THE DR_Generator SHALL render the company logo from Business_Settings `businessLogo` field in the header section.
2. THE DR_Generator SHALL render the company name from Business_Settings `businessName` field in the header section.
3. THE DR_Generator SHALL render the company address from Business_Settings `businessAddress` field in the header section.
4. IF the `businessLogo` field is empty or null, THEN THE DR_Generator SHALL render the header without a logo placeholder.

### Requirement 7: Delivery Receipt Details Section

**User Story:** As an installer, I want the DR details section to show the delivery context, so that I know the date, customer, address, SO number, and installer assignment at a glance.

#### Acceptance Criteria

1. THE DR_Generator SHALL display the delivery date in the details section.
2. THE DR_Generator SHALL display the Customer name in the details section.
3. THE DR_Generator SHALL display the Customer address in the details section.
4. THE DR_Generator SHALL display the SO number (or multiple SO numbers when grouped) in the details section.
5. THE DR_Generator SHALL display the installer name in the details section.
6. WHERE the Customer is of type "sub_dealer", THE DR_Generator SHALL label the customer name field as "Sub Dealer".

### Requirement 8: Delivery Receipt Body Table

**User Story:** As an installer, I want a table listing all products with their serial numbers and pricing, so that I can verify the delivery contents on-site.

#### Acceptance Criteria

1. THE DR_Generator SHALL render a table with columns: Customer, Address, Description, Indoor Serial, Outdoor Serial, Unit Price.
2. THE DR_Generator SHALL populate the Description column with the product name and capacity name concatenated.
3. THE DR_Generator SHALL populate the Indoor Serial column with the serial number from Serial_Number records where `unitType` is "indoor" for the corresponding product and capacity.
4. THE DR_Generator SHALL populate the Outdoor Serial column with the serial number from Serial_Number records where `unitType` is "outdoor" for the corresponding product and capacity.
5. WHEN a Sales_Order contains multiple product items, THE DR_Generator SHALL render one row per product-capacity-serial combination.
6. THE DR_Generator SHALL populate the Unit Price column with the selling price of each product item.

### Requirement 9: Delivery Receipt Footer Signature Section

**User Story:** As a warehouse supervisor, I want five designated signature lines on the DR, so that accountability is documented for the delivery chain.

#### Acceptance Criteria

1. THE DR_Generator SHALL render exactly 5 signature line sections in the footer area.
2. THE DR_Generator SHALL label the signature lines as: "Warehouse Supervisor", "Warehouse Man", "HR Admin", "Checked By", "Received By".
3. THE DR_Generator SHALL render the text "Printed Name Over Signature" below each signature line.
4. THE DR_Generator SHALL allocate adequate spacing for physical signatures above each line.

### Requirement 10: Delivery Receipt Print Eligibility

**User Story:** As a warehouse staff member, I want the DR print option available only for sales orders at the correct delivery status, so that incomplete orders are not accidentally printed.

#### Acceptance Criteria

1. THE system SHALL enable the DR print action only for Sales_Orders with a normalized status of "for-delivery", "remitted", "complete", or "released".
2. IF a Sales_Order has a status below "for-delivery" (e.g., "pending"), THEN THE system SHALL disable the DR print action for that order.
3. WHEN the user triggers DR print for a customer, THE DR_Generator SHALL include only Sales_Orders that meet the eligible status criteria.
