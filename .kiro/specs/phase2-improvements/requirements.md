# Requirements Document

## Introduction

This document defines the requirements for Phase 2 improvements to the HVAC Inventory & Sales Management System. Phase 2 covers two main feature areas:

1. **Order Form Enhancements** — Display product capacity SRP during selection and add a miscellaneous items section for non-unit line items (excess materials, electricals, etc.).
2. **Serial Number Traceability** — Implement an immutable event log for serial number lifecycle tracking to solve the "missing serial" problem after PO scanning completion.

## Glossary

- **Order_Form**: The public-facing web form at `/public/order-form` where customers submit sales orders
- **Capacity_SRP**: The Suggested Retail Price stored in the `srp` field of `tblcapacity`, representing the recommended selling price for a product at a given capacity
- **Miscellaneous_Item**: A non-unit line item on a sales order representing additional materials, electrical components, or excess items that are not AC units
- **Material_Catalog**: The `tblmaterial_items` table containing the ledger-based catalog of installation materials
- **Serial_Number_Service**: The backend service (`SerialNumberService`) responsible for all serial number state changes including scanning, assignment, removal, and status updates
- **Serial_Event_Log**: An append-only table (`tblserial_number_events`) that records every state transition for every serial number
- **Event_Type**: A categorized label describing what happened to a serial number (e.g., SCANNED_IN_PO, ASSIGNED_TO_SO, TRANSFERRED)
- **Sales_Order**: A customer order record in `tblsales_order` identified by an auto-generated SO number
- **Purchase_Order**: A vendor purchase record in `tblpurchase_orders` identified by an auto-generated PO number
- **Actor**: The authenticated user performing a serial number operation, identified by user ID and username

## Requirements

### Requirement 1: Display Capacity SRP on Product Selection

**User Story:** As a customer using the public order form, I want to see the Suggested Retail Price for each capacity option when I select a product, so that I can compare prices before choosing a capacity.

#### Acceptance Criteria

1. WHEN a customer selects a product in the Order_Form, THE Order_Form SHALL display all available capacities with their Capacity_SRP formatted as currency.
2. WHEN a capacity has a Capacity_SRP value of zero, THE Order_Form SHALL display the sell price (`sellPrice`) as the displayed price for that capacity.
3. THE Order_Form SHALL display each capacity option showing the capacity name, the Capacity_SRP, and a selection control.
4. WHEN a customer selects a capacity, THE Order_Form SHALL use the `sellPrice` as the cart line item price (preserving existing behavior).

### Requirement 2: Miscellaneous Items Database Table

**User Story:** As a system administrator, I want a dedicated table for miscellaneous order items, so that non-unit line items can be stored with proper categorization and optional material catalog linking.

#### Acceptance Criteria

1. THE Database SHALL provide a `tblso_miscellaneous_items` table with columns for: id, sales_id, category, item_name, description, material_id, quantity, unit, unit_price, total_price, is_inclusion, remarks, and created_at.
2. THE Database SHALL enforce a foreign key from `tblso_miscellaneous_items.sales_id` to `tblsales_order.id` with CASCADE on delete.
3. THE Database SHALL enforce a nullable foreign key from `tblso_miscellaneous_items.material_id` to `tblmaterial_items.id` with SET NULL on delete.
4. THE Database SHALL restrict the `category` column to one of: 'excess', 'electrical', 'material', 'general'.
5. THE Database SHALL index `tblso_miscellaneous_items` on `sales_id`, `category`, and `material_id` columns.

### Requirement 3: Miscellaneous Items API

**User Story:** As a frontend developer, I want API endpoints for managing miscellaneous items on orders, so that the order form can submit and retrieve miscellaneous line items.

#### Acceptance Criteria

1. THE Public_Order_Form_API SHALL accept a `miscItems` array in the order submission payload containing objects with: category, item_name, description, material_id, quantity, unit, unit_price, and is_inclusion fields.
2. WHEN the Order_Form submission includes `miscItems`, THE Public_Order_Form_API SHALL insert each miscellaneous item into `tblso_miscellaneous_items` linked to the created Sales_Order.
3. WHEN a miscellaneous item includes a `material_id`, THE Public_Order_Form_API SHALL validate that the referenced material exists in the Material_Catalog before insertion.
4. IF a miscellaneous item references a non-existent `material_id`, THEN THE Public_Order_Form_API SHALL reject that item and return a descriptive error message.
5. THE Public_Order_Form_API SHALL calculate `total_price` as `quantity * unit_price` for each miscellaneous item.
6. THE Public_Order_Form_API SHALL provide a `GET /public/order-form/materials` endpoint that returns available materials grouped by category for the miscellaneous section.

### Requirement 4: Miscellaneous Items Frontend Section

**User Story:** As a customer using the public order form, I want to add miscellaneous items (excess materials, electricals, general items) to my order, so that all additional costs are captured in a single submission.

#### Acceptance Criteria

1. THE Order_Form SHALL display a collapsible "Additional Items" section below the product cart.
2. THE Order_Form SHALL provide category tabs for: Excess, Electricals, Materials, and General.
3. WHEN a customer selects a category tab, THE Order_Form SHALL display available items from the Material_Catalog for that category.
4. THE Order_Form SHALL allow customers to add a custom item by entering an item name, quantity, unit, and unit price when no catalog match exists.
5. THE Order_Form SHALL display a subtotal for miscellaneous items separate from the product cart total.
6. WHEN the order is submitted, THE Order_Form SHALL include all miscellaneous items in the `miscItems` array of the submission payload.
7. THE Order_Form SHALL allow customers to remove miscellaneous items from the list before submission.

### Requirement 5: Serial Number Event Log Table

**User Story:** As a warehouse manager, I want every serial number state change recorded in an immutable log, so that I can trace the full history of any serial number and recover "missing" units.

#### Acceptance Criteria

1. THE Database SHALL provide a `tblserial_number_events` table with columns for: id, serial_id, serial_number, event_type, previous_status, new_status, previous_purchase_id, new_purchase_id, previous_sales_id, new_sales_id, previous_branch_id, new_branch_id, previous_customer_id, new_customer_id, performed_by, performed_by_username, ip_address, reason, metadata, and created_at.
2. THE Database SHALL enforce a foreign key from `tblserial_number_events.serial_id` to `tblserial_numbers.id` with CASCADE on delete.
3. THE Database SHALL enforce a nullable foreign key from `tblserial_number_events.performed_by` to `tblusers.id`.
4. THE Database SHALL store `serial_number` as a denormalized copy for fast lookup independent of the serial record.
5. THE Database SHALL index `tblserial_number_events` on: serial_id, serial_number, event_type, new_purchase_id, new_sales_id, and created_at (descending).
6. THE Database SHALL support the following Event_Type values: SCANNED_IN_PO, REMOVED_FROM_PO, ASSIGNED_TO_SO, REMOVED_FROM_SO, TRANSFERRED, DELIVERED, RETURNED, MARKED_DEFECTIVE, STATUS_CHANGED, BRANCH_CHANGED, CUSTOMER_CHANGED.

### Requirement 6: Serial Event Logging Service

**User Story:** As a backend developer, I want a centralized service for logging serial number events, so that all serial state changes are recorded consistently through a single interface.

#### Acceptance Criteria

1. THE Serial_Event_Log_Service SHALL provide a `logEvent()` method that accepts: serial_id, serial_number, event_type, previous state fields, new state fields, performed_by, performed_by_username, ip_address, reason, and metadata.
2. THE Serial_Event_Log_Service SHALL insert a new row into `tblserial_number_events` for each invocation without modifying existing rows.
3. IF the `logEvent()` method fails to insert, THEN THE Serial_Event_Log_Service SHALL log the error but not throw an exception that would abort the parent operation.
4. THE Serial_Event_Log_Service SHALL accept an optional `PoolClient` parameter to participate in the calling transaction when provided.

### Requirement 7: Hook Event Logging into Serial Operations

**User Story:** As a warehouse manager, I want serial number events automatically logged whenever a serial changes state, so that the event trail is complete without manual intervention.

#### Acceptance Criteria

1. WHEN a serial number is scanned into a Purchase_Order via `scanPurchaseOrder` or `scanPurchaseOrderBatch`, THE Serial_Number_Service SHALL log a SCANNED_IN_PO event with the purchase order context.
2. WHEN a serial number is removed from a Purchase_Order via `removePurchaseOrderSerial`, THE Serial_Number_Service SHALL log a REMOVED_FROM_PO event with the previous purchase order context.
3. WHEN a serial number is assigned to a Sales_Order via `scanSalesOrder` or `scanSalesOrderBatch`, THE Serial_Number_Service SHALL log an ASSIGNED_TO_SO event with the sales order context.
4. WHEN a serial number is removed from a Sales_Order via `removeSalesOrderSerial`, THE Serial_Number_Service SHALL log a REMOVED_FROM_SO event with the previous sales order context.
5. WHEN a serial number status is changed via `bulkUpdateStatus`, THE Serial_Number_Service SHALL log a STATUS_CHANGED event for each affected serial number.
6. WHEN a serial number is marked as defective, THE Serial_Number_Service SHALL log a MARKED_DEFECTIVE event with the defect reason in the metadata.
7. WHEN a serial number is marked as returned, THE Serial_Number_Service SHALL log a RETURNED event with the return reason in the metadata.
8. THE Serial_Number_Service SHALL capture the Actor (user ID and username) performing the operation in each logged event.

### Requirement 8: Serial Number History API

**User Story:** As a warehouse staff member, I want API endpoints to retrieve the full event history of a serial number, so that I can investigate where a serial has been and what happened to it.

#### Acceptance Criteria

1. THE Serial_Number_API SHALL provide a `GET /serial-numbers/:id/history` endpoint that returns all events for a serial number ordered by `created_at` descending.
2. THE Serial_Number_API SHALL provide a `GET /serial-numbers/search-history` endpoint that accepts a `serialNumber` query parameter and returns all events matching that serial number string.
3. WHEN no events exist for the requested serial, THE Serial_Number_API SHALL return an empty array with a 200 status code.
4. THE Serial_Number_API SHALL require JWT authentication for both history endpoints.
5. THE Serial_Number_API SHALL return each event with: event_type, previous and new state fields, performed_by_username, reason, metadata, and created_at timestamp.

### Requirement 9: Serial Number History Frontend

**User Story:** As a warehouse manager, I want a visual timeline showing the complete history of a serial number, so that I can quickly understand its lifecycle and identify where issues occurred.

#### Acceptance Criteria

1. THE Frontend SHALL provide a "Serial History" view accessible from serial number detail screens and search results.
2. THE Frontend SHALL display events in a vertical timeline format ordered from newest to oldest.
3. THE Frontend SHALL show for each event: the Event_Type as a labeled badge, the timestamp, the Actor who performed it, and relevant context (PO number, SO number, branch name).
4. WHEN an event includes a reason or metadata, THE Frontend SHALL display the additional context below the event summary.
5. THE Frontend SHALL allow searching for a serial number by its string value to view its history.
6. WHILE the history data is loading, THE Frontend SHALL display a loading indicator.
7. IF the history API returns an error, THEN THE Frontend SHALL display an error message with a retry option.
