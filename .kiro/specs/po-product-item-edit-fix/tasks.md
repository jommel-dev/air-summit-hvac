# Tasks

## Task 1: Backend - Add updateProductItem endpoint

- [x] 1.1 Add `updateProductItem` method to `purchase.service.ts` that locates an existing row in `tbltransaction_product_items` by `(purchaseId, oldProductId, oldCapacityId)` and updates it to new values (productId, capacityId, unitPrice, sellPrice, discountPrice, unitTypesQty, totalSetQty). Falls back to INSERT if no matching row found.
- [x] 1.2 Add `PATCH :id/update-product-item` route to `purchase.controller.ts` that accepts body `{ oldProductId, oldCapacityId, productId, capacityId, unitPrice?, sellPrice?, discountPrice?, totalSetQty?, unitTypesQty? }` and calls the new service method
- [x] 1.3 Wire up request validation: require `purchaseId` (from route param), `oldProductId`, `oldCapacityId`, `productId`, `capacityId` in the request body; return 400 if any are missing or invalid

## Task 2: Backend - Replace DELETE-all with smart diff in update() method

- [x] 2.1 In `purchase.service.ts` `update()` method, replace the `DELETE FROM tbltransaction_product_items WHERE purchaseId = $1` query with a smart diff approach: fetch existing items, match payload items by `(productId, capacityId)`, UPDATE matched items, INSERT new items, DELETE removed items
- [x] 2.2 Implement the matching algorithm: Pass 1 — exact match by `(productId, capacityId)` marking used IDs; Pass 2 — remaining payload items become INSERTs; Pass 3 — unmatched existing rows become DELETEs
- [x] 2.3 Ensure serial number handling in the update flow still works correctly after the refactor (serial rows reference product item rows, so row IDs must be preserved for matched items)

## Task 3: Frontend - Preserve serial numbers during product change

- [x] 3.1 In `purchase-order.component.ts`, modify `onProductChanged()` to capture existing serial numbers from old `unitTypes` into a `_preservedSerials` record (keyed by unit type label) before rebuilding unitTypes
- [x] 3.2 Store `_originalProductId` and `_originalCapacityId` on the item when product changes in edit mode, so downstream logic can identify the existing row to update
- [x] 3.3 Extend `PurchaseProductFormItem` interface to include optional `_preservedSerials?: Record<string, string[]>`, `_originalProductId?: string`, and `_originalCapacityId?: string` fields
- [x] 3.4 Ensure the preserved serials are displayed in the UI in a pending state (serials still visible even though product changed) when no capacity is yet selected

## Task 4: Frontend - Reassign serials on capacity selection and fix autoSaveProductItem

- [x] 4.1 Add `reassignPreservedSerials(index)` method that distributes preserved serials to new unitTypes (match by label first, overflow remaining to first unit type)
- [x] 4.2 Modify `onCapacityChanged()` to call `reassignPreservedSerials` when `_preservedSerials` exists, then trigger `autoUpdateSerialsAssignment` with old productId/capacityId values, and clear tracking fields after successful reassignment
- [x] 4.3 Modify `autoSaveProductItem()` to call the new `updateProductItem` endpoint (PATCH) when `_originalProductId`/`_originalCapacityId` exist on the item, otherwise use the existing `addProductItem` (POST)
- [x] 4.4 Add `updateProductItem()` method to `purchase-order.service.ts` that calls `PATCH /purchase/:id/update-product-item` with the old and new product/capacity IDs plus item data
