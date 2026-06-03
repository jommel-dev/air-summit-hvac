# Requirements Document

## Introduction

This spec addresses two bugs in the Purchase Order (PO) product item editing workflow. When a user changes the product on an existing PO line item: (1) the serial numbers visually disappear from the UI, and (2) the backend creates new `tbltransaction_product_items` rows instead of updating existing ones, leading to orphaned/duplicated records.

## Glossary

- **PO_Form**: The Angular Purchase Order form component used to create and edit purchase orders (`purchase-order.component.ts`)
- **Product_Item**: A line item in a purchase order representing a product/capacity combination with quantities and serial numbers, stored in `tbltransaction_product_items`
- **Serial_Assignment**: The linkage between serial numbers and a product/capacity within a purchase order, stored in `tblserial_numbers`
- **Backend_Purchase_Service**: The NestJS service responsible for CRUD operations on purchase orders (`purchase.service.ts`)
- **Auto_Save**: The mechanism that immediately persists product item changes to the database when a user selects a capacity in edit mode (via `autoSaveProductItem()`)
- **Unit_Types**: The breakdown of quantities by type (e.g., "indoor", "outdoor", "set") for a product item, each carrying an array of scanned serial numbers

## Requirements

### Requirement 1: Preserve serial numbers during product change in edit mode

**User Story:** As a warehouse operator, I want serial numbers to remain visible in the UI when I change a product on an existing PO line item, so that I do not lose track of scanned serials.

#### Acceptance Criteria

1. WHEN a user changes the product on a Product_Item in edit mode, THE PO_Form SHALL retain the existing serial number arrays from the previous Unit_Types until a new capacity is selected
2. WHEN a user selects a new capacity after changing the product in edit mode, THE PO_Form SHALL reassign the retained serial numbers to the corresponding new Unit_Types
3. IF the new product has fewer Unit_Types than the previous product, THEN THE PO_Form SHALL redistribute excess serial numbers to the first available unit type
4. WHEN the product is changed but no capacity is yet selected, THE PO_Form SHALL display the retained serial numbers in a pending state without clearing them

### Requirement 2: Update existing product item records instead of creating new ones

**User Story:** As a warehouse operator, I want editing a product/capacity on a PO line item to update the existing database record, so that I do not get duplicate or orphaned rows in the system.

#### Acceptance Criteria

1. WHEN the Backend_Purchase_Service processes a PO update with product items that match existing records by purchaseId, THE Backend_Purchase_Service SHALL update the existing rows in `tbltransaction_product_items` using an UPSERT strategy keyed on (purchaseId, productId, capacityId) rather than deleting all and re-inserting
2. WHEN product items in the update payload no longer exist in the current database rows, THE Backend_Purchase_Service SHALL delete only those removed items
3. WHEN product items in the update payload match existing rows, THE Backend_Purchase_Service SHALL update unitPrice, sellPrice, discountPrice, unitTypesQty, and totalSetQty in place

### Requirement 3: Prevent duplicate records from auto-save during product changes

**User Story:** As a warehouse operator, I want the auto-save mechanism to not create duplicate product item rows when I change the product/capacity on an existing line item.

#### Acceptance Criteria

1. WHEN the Auto_Save triggers during a product/capacity change in edit mode, THE PO_Form SHALL call an update endpoint for the existing product item instead of the add endpoint
2. IF a product item with the same purchaseId and product/capacity combination already exists, THEN THE Backend_Purchase_Service SHALL update the existing row rather than inserting a duplicate
3. WHEN the Auto_Save is triggered, THE PO_Form SHALL pass the original product item identifier (or the old productId/capacityId) so the backend can locate the correct row to update

### Requirement 4: Trigger serial reassignment after capacity selection

**User Story:** As a warehouse operator, I want serial numbers to be automatically reassigned to the new product/capacity in the database after I complete both selections (product and capacity).

#### Acceptance Criteria

1. WHEN a user selects a new capacity in edit mode after having changed the product, THE PO_Form SHALL call the Serial_Assignment update with the old and new productId/capacityId values
2. WHEN the serial reassignment is triggered, THE Backend_Purchase_Service SHALL update all serial numbers linked to the old product/capacity combination on the given PO to point to the new product/capacity
3. IF the serial reassignment fails, THEN THE PO_Form SHALL display an error notification and retain the serial numbers in the UI for manual resolution
