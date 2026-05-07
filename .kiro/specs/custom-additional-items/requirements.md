# Requirements Document

## Introduction

This feature replaces the existing tab-based category selection (Material, Electrical, Excess, General) in the Additional Items section of the public order form with a unified custom item form. Instead of browsing pre-defined catalog materials by category, users will enter item details and agreed-upon pricing directly into a form and click "Add Item" to build their list. The costing is based on what the customer and company have agreed upon (manually entered by the user).

## Glossary

- **Order_Form**: The public-facing sales order form used by customers to place HVAC product orders
- **Additional_Items_Section**: The collapsible section within the Order_Form where users can add miscellaneous items beyond the main product selection
- **Custom_Item_Form**: The unified input form that replaces category tabs, allowing users to enter item details and pricing directly
- **Item_List**: The displayed list of added custom items with their details and computed totals
- **Add_Item_Button**: The button that submits the Custom_Item_Form data and appends the item to the Item_List
- **Unit_Price**: The price per unit agreed upon between the customer and the company
- **Total_Price**: The computed value of quantity multiplied by unit_price for a given item
- **Category**: A classification label (Material, Electrical, Excess, General) assigned to each item for backend record-keeping

## Requirements

### Requirement 1: Display Unified Custom Item Form

**User Story:** As a customer, I want to see a single form for adding additional items, so that I can quickly enter any item with agreed-upon pricing without browsing through category tabs.

#### Acceptance Criteria

1. WHEN the Additional_Items_Section is expanded, THE Order_Form SHALL display the Custom_Item_Form with input fields for item name, category, quantity, unit, and unit price
2. THE Custom_Item_Form SHALL display a category dropdown with options: Material, Electrical, Excess, and General, defaulting to General
3. THE Custom_Item_Form SHALL display a text input for item name
4. THE Custom_Item_Form SHALL display a numeric input for quantity with a minimum value of 1 and a default value of 1
5. THE Custom_Item_Form SHALL display a text input for unit with a default value of "pcs"
6. THE Custom_Item_Form SHALL display a numeric input for unit price with a minimum value of 0 and a default value of 0
7. THE Order_Form SHALL NOT display category tabs (Material, Electrical, Excess, General) for browsing catalog materials
8. THE Order_Form SHALL NOT display the pre-defined materials catalog list

### Requirement 2: Add Item to List

**User Story:** As a customer, I want to click an "Add Item" button to add my entered item to the list, so that I can build up my additional items with agreed-upon costing.

#### Acceptance Criteria

1. THE Custom_Item_Form SHALL display the Add_Item_Button labeled "Add Item"
2. WHEN the user clicks the Add_Item_Button with a valid item name, THE Order_Form SHALL append the item to the Item_List with the entered category, item name, quantity, unit, and unit price
3. WHEN the user clicks the Add_Item_Button with a valid item name, THE Order_Form SHALL compute and display the Total_Price as quantity multiplied by unit price for the added item
4. WHEN the user clicks the Add_Item_Button with an empty item name, THE Order_Form SHALL not add the item to the Item_List
5. WHEN an item is successfully added, THE Custom_Item_Form SHALL reset all input fields to their default values (item name cleared, category to General, quantity to 1, unit to "pcs", unit price to 0)

### Requirement 3: Display and Manage Item List

**User Story:** As a customer, I want to see all my added items in a list with their costs, so that I can review and manage what I have added before submitting the order.

#### Acceptance Criteria

1. THE Order_Form SHALL display the Item_List showing each added item's category, item name, quantity, unit, unit price, and total price
2. THE Order_Form SHALL display a running grand total of all items in the Item_List (sum of all total prices)
3. WHEN the user clicks a remove button on an item, THE Order_Form SHALL remove that item from the Item_List
4. WHEN an item is removed from the Item_List, THE Order_Form SHALL recalculate and update the grand total

### Requirement 4: Submit Additional Items with Order

**User Story:** As a customer, I want my additional items to be included when I submit the order, so that the company receives the complete list of agreed-upon items and pricing.

#### Acceptance Criteria

1. WHEN the order is submitted, THE Order_Form SHALL include all items from the Item_List in the miscItems payload sent to the backend
2. THE Order_Form SHALL send each item with category, itemName, quantity, unit, unitPrice, and isInclusion fields to the backend
3. WHEN the order is submitted with an empty Item_List, THE Order_Form SHALL submit the order without miscItems (or with an empty array)

### Requirement 5: Backend Validation of Custom Items

**User Story:** As a system administrator, I want submitted custom items to be validated, so that only properly structured data is stored in the database.

#### Acceptance Criteria

1. WHEN a miscItem is received with an empty or missing itemName, THE Backend SHALL reject the request with a descriptive error message
2. WHEN a miscItem is received with a category not in the allowed set (excess, electrical, material, general), THE Backend SHALL reject the request with a descriptive error message
3. WHEN a miscItem is received with a quantity less than or equal to zero, THE Backend SHALL reject the request with a descriptive error message
4. WHEN a miscItem is received with a unit price less than zero, THE Backend SHALL reject the request with a descriptive error message
5. WHEN all miscItems pass validation, THE Backend SHALL store each item in the tblso_miscellaneous_items table with the computed total_price (quantity × unit_price)

### Requirement 6: Remove Catalog Material Dependencies from Frontend

**User Story:** As a developer, I want the frontend to no longer load or display catalog materials for the Additional Items section, so that the codebase is simplified and aligned with the new custom-only approach.

#### Acceptance Criteria

1. THE Order_Form SHALL NOT make an API call to load catalog materials for the Additional Items section
2. THE Order_Form SHALL NOT display a list of pre-defined materials grouped by category
3. THE Order_Form SHALL NOT include the "Custom Item" toggle button (since the entire section is now custom-item-based)
