# Implementation Plan: Custom Additional Items

## Overview

Refactor the Additional Items section of the order form from a tab-based catalog browsing experience to a unified custom item entry form. This is a frontend-only change — remove catalog-related signals, methods, and template code from `OrderFormComponent`, add a `customItemCategory` signal, and replace the tab UI with a simple form containing a category dropdown.

## Tasks

- [x] 1. Remove catalog-related signals, computed properties, and methods from the component
  - [x] 1.1 Remove `availableMaterials`, `activeMiscCategory`, and `customItemMode` signals from `OrderFormComponent`
    - Delete the `availableMaterials = signal<GroupedMaterials[]>([])` declaration
    - Delete the `activeMiscCategory = signal<string>('material')` declaration
    - Delete the `customItemMode = signal<boolean>(false)` declaration
    - Delete the `filteredMaterials` computed property
    - Remove the `GroupedMaterials` interface if no longer referenced elsewhere
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 1.2 Remove `loadMaterials()` method and its call in `ngOnInit()`
    - Delete the entire `loadMaterials()` method that calls `GET /public/order-form/materials`
    - Remove `this.loadMaterials()` from `ngOnInit()`
    - _Requirements: 6.1_

  - [x] 1.3 Remove `addMiscItem(material)` method
    - Delete the entire `addMiscItem()` method that adds catalog-based materials to the list
    - _Requirements: 6.2, 1.8_

- [x] 2. Add `customItemCategory` signal and modify `addCustomMiscItem()` method
  - [x] 2.1 Add `customItemCategory` signal with default value `'general'`
    - Add `customItemCategory = signal<string>('general')` to the miscellaneous items signals section
    - _Requirements: 1.2_

  - [x] 2.2 Modify `addCustomMiscItem()` to use `customItemCategory()` and reset it after adding
    - Change `category: this.activeMiscCategory()` to `category: this.customItemCategory()`
    - Add `this.customItemCategory.set('general')` to the reset block after a successful add
    - _Requirements: 2.2, 2.3, 2.5_

- [x] 3. Refactor the Additional Items template to a unified custom item form
  - [x] 3.1 Remove category tabs, "Custom Item" toggle, and catalog materials list from the template
    - Remove the category tab buttons loop (material, electrical, excess, general)
    - Remove the "Custom Item" toggle button
    - Remove the `@if (customItemMode())` conditional wrapper around the custom form
    - Remove the available materials list rendering (`filteredMaterials()` loop)
    - Remove the "No materials available" empty state
    - _Requirements: 1.7, 1.8, 6.2, 6.3_

  - [x] 3.2 Add category dropdown and restructure the form to always be visible when section is expanded
    - Add a `<select>` element bound to `customItemCategory` with options: Material, Electrical, Excess, General (values: material, electrical, excess, general)
    - Set the default selected option to General
    - Ensure the form fields (item name, category, quantity, unit, unit price) are always visible when `showMiscSection()` is true (no toggle needed)
    - Ensure the "Add Item" button is present and labeled correctly
    - Ensure numeric inputs have appropriate `min` attributes (quantity min=1, unit price min=0)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1_

- [x] 4. Checkpoint - Verify component compiles and form renders correctly
  - Ensure all tests pass, ask the user if questions arise.

- [ ]* 5. Write property-based tests for `addCustomMiscItem()` logic
  - [ ]* 5.1 Write property test: valid item addition preserves all fields
    - **Property 1: Valid item addition preserves all fields**
    - Use fast-check to generate valid item names, categories, quantities, units, and prices
    - Assert that after calling `addCustomMiscItem()`, the last item in `miscItems` matches all input values exactly
    - **Validates: Requirements 2.2**

  - [ ]* 5.2 Write property test: whitespace-only names are rejected
    - **Property 2: Whitespace-only names are rejected**
    - Use fast-check to generate whitespace-only strings (spaces, tabs, newlines)
    - Assert that `miscItems` length does not change after calling `addCustomMiscItem()` with a whitespace-only name
    - **Validates: Requirements 2.4**

  - [ ]* 5.3 Write property test: form resets to defaults after successful add
    - **Property 3: Form resets to defaults after successful add**
    - Use fast-check to generate valid form inputs
    - Assert that after a successful add, signals are: customItemName='', customItemCategory='general', customItemQty=1, customItemUnit='pcs', customItemPrice=0
    - **Validates: Requirements 2.5**

  - [ ]* 5.4 Write property test: miscTotal is always the sum of item totals
    - **Property 4: miscTotal is always the sum of item totals**
    - Use fast-check to generate arbitrary lists of MiscCartItems
    - Assert that `miscTotal()` equals the sum of `quantity × unitPrice` for all items
    - **Validates: Requirements 2.3, 3.2, 3.4**

  - [ ]* 5.5 Write property test: remove at index reduces list by one
    - **Property 5: Remove at index reduces list by one**
    - Use fast-check to generate non-empty lists and valid indices
    - Assert that after `removeMiscItem(i)`, the list length is one less and the item at index `i` is no longer present
    - **Validates: Requirements 3.3**

  - [ ]* 5.6 Write property test: backend rejects invalid miscItems
    - **Property 6: Backend rejects invalid miscItems**
    - Use fast-check to generate payloads with invalid itemName, category, quantity, or unitPrice
    - Assert that the backend returns a 400 error and does not insert the item
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- This is a frontend-only refactor — no backend changes are needed
- The backend already supports custom items (items without `materialId`)
- Each task references specific requirements for traceability
- Property tests use fast-check library for TypeScript property-based testing
- Checkpoints ensure incremental validation
