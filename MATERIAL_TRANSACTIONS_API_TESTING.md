# Material Transactions API Testing Guide

## Quick Test Commands

### 1. Add Material to Sales Order

```bash
curl -X POST http://localhost:3000/sales-order/1/materials \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "material_id": 1,
    "quantity": 10,
    "unit_price": 150.00,
    "sell_price": 200.00,
    "discount_price": 180.00
  }'
```

### 2. Get All Materials for Sales Order

```bash
curl http://localhost:3000/sales-order/1/materials \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 3. Remove Material from Sales Order

```bash
curl -X DELETE http://localhost:3000/sales-order/1/materials/45 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 4. Get Material Transaction by ID

```bash
curl http://localhost:3000/inventory/material-transactions/45 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 5. Get Materials for Purchase Order

```bash
curl http://localhost:3000/inventory/material-transactions/purchase/5 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Postman Collection

### Add Material to Sales Order
- **Method:** POST
- **URL:** `{{baseUrl}}/sales-order/{{salesOrderId}}/materials`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer {{token}}`
- **Body (JSON):**
```json
{
  "material_id": 1,
  "quantity": 10,
  "sell_price": 200.00,
  "discount_price": 180.00
}
```

### Get Materials for Sales Order
- **Method:** GET
- **URL:** `{{baseUrl}}/sales-order/{{salesOrderId}}/materials`
- **Headers:**
  - `Authorization: Bearer {{token}}`

### Remove Material Item
- **Method:** DELETE
- **URL:** `{{baseUrl}}/sales-order/{{salesOrderId}}/materials/{{materialItemId}}`
- **Headers:**
  - `Authorization: Bearer {{token}}`

---

## Expected Responses

### Success - Add Material
```json
{
  "id": 45,
  "trans_type": "sales",
  "material_id": 1,
  "quantity": 10,
  "unit_price": 150.00,
  "sell_price": 200.00,
  "discount_price": 180.00,
  "purchase_id": null,
  "sales_id": 1,
  "created_at": "2026-03-10T10:30:00.000Z"
}
```

### Success - Get Materials
```json
[
  {
    "id": 45,
    "trans_type": "sales",
    "material_id": 1,
    "material_name": "Copper Pipe 1/2 inch",
    "material_code": "CP-12",
    "unit": "METERS",
    "quantity": 10,
    "unit_price": 150.00,
    "sell_price": 200.00,
    "discount_price": 180.00,
    "purchase_id": null,
    "sales_id": 1,
    "created_at": "2026-03-10T10:30:00.000Z"
  }
]
```

### Success - Remove Material
```json
{
  "id": 45
}
```

---

## Test Scenarios

### Scenario 1: Complete Sales Order with Materials
1. Create sales order with AC units
2. Add material items (pipes, wires, accessories)
3. Get all materials for the order
4. Calculate total (AC units + materials)
5. Approve sales order

### Scenario 2: Material-Only Sales Order
1. Create sales order without AC units
2. Add multiple material items
3. Verify totals
4. Remove one material
5. Verify updated totals

### Scenario 3: Purchase Order with Materials
1. Create purchase order with `po_type='MATERIAL'`
2. Add material transaction items
3. Approve purchase order
4. Verify stock increased in tblmaterials

---

## Database Verification

### Check Material Transactions
```sql
SELECT * FROM tbltransaction_material_items 
WHERE sales_id = 1;
```

### Check Material Stock
```sql
SELECT id, material_name, on_hand_stock 
FROM tblmaterials 
WHERE id = 1;
```

### Check Price History
```sql
SELECT * FROM tblmaterial_price_history 
WHERE material_id = 1 
ORDER BY created_at DESC;
```

---

## Integration Testing

### Test with Frontend
1. Open sales order page
2. Select existing sales order
3. Add material items using the component
4. Verify items appear in table
5. Check totals calculation
6. Remove an item
7. Verify removal and total update

---

## Notes
- Replace `YOUR_TOKEN` with actual JWT token
- Replace `{{baseUrl}}` with `http://localhost:3000`
- Replace IDs with actual database IDs
- Ensure materials exist in tblmaterials before adding
