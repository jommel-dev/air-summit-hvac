# Material Inventory API - Testing Guide

## 🧪 API Endpoints Testing

### Base URL
```
Development: http://localhost:3000
Production: https://your-backend.onrender.com
```

---

## 1. Get Material Brands

**Endpoint:** `GET /inventory/materials/brands`

**Description:** Get all brands with type='MAT' for dropdown options

**Request:**
```bash
curl http://localhost:3000/inventory/materials/brands
```

**Expected Response:**
```json
[
  {
    "id": 1,
    "brandName": "Generic Materials",
    "prefix": "GEN"
  },
  {
    "id": 2,
    "brandName": "Premium Pipes Co.",
    "prefix": "PPC"
  }
]
```

---

## 2. Get All Materials

**Endpoint:** `GET /inventory/materials`

**Query Parameters:**
- `search` (optional): Search by material name
- `brandId` (optional): Filter by brand ID

**Request:**
```bash
# Get all materials
curl http://localhost:3000/inventory/materials

# Search materials
curl "http://localhost:3000/inventory/materials?search=copper"

# Filter by brand
curl "http://localhost:3000/inventory/materials?brandId=1"

# Search and filter
curl "http://localhost:3000/inventory/materials?search=pipe&brandId=2"
```

**Expected Response:**
```json
[
  {
    "id": 1,
    "brand_id": 1,
    "material_name": "1/4 Copper Tube",
    "material_code": "CU-1/4",
    "description": "High quality copper tube",
    "unit": "METERS",
    "unit_price": 150.00,
    "sell_price": 200.00,
    "on_hand_stock": 100,
    "reorder_level": 20,
    "brand_name": "Generic Materials",
    "created_at": "2026-03-10T10:00:00Z",
    "created_by": 1,
    "updated_at": null,
    "updated_by": null,
    "deleted_at": null,
    "deleted_by": null
  }
]
```

---

## 3. Get Single Material

**Endpoint:** `GET /inventory/materials/:id`

**Request:**
```bash
curl http://localhost:3000/inventory/materials/1
```

**Expected Response:**
```json
{
  "id": 1,
  "brand_id": 1,
  "material_name": "1/4 Copper Tube",
  "material_code": "CU-1/4",
  "description": "High quality copper tube",
  "unit": "METERS",
  "unit_price": 150.00,
  "sell_price": 200.00,
  "on_hand_stock": 100,
  "reorder_level": 20,
  "brand_name": "Generic Materials",
  "created_at": "2026-03-10T10:00:00Z",
  "created_by": 1,
  "updated_at": null,
  "updated_by": null,
  "deleted_at": null,
  "deleted_by": null
}
```

**Error Response (404):**
```json
{
  "statusCode": 404,
  "message": "Material with ID 999 not found",
  "error": "Not Found"
}
```

---

## 4. Create Material

**Endpoint:** `POST /inventory/materials`

**Request Body:**
```json
{
  "brand_id": 1,
  "material_name": "1/4 Copper Tube",
  "material_code": "CU-1/4",
  "description": "High quality copper tube for AC installation",
  "unit": "METERS",
  "unit_price": 150.00,
  "sell_price": 200.00,
  "on_hand_stock": 100,
  "reorder_level": 20
}
```

**Request:**
```bash
curl -X POST http://localhost:3000/inventory/materials \
  -H "Content-Type: application/json" \
  -d '{
    "brand_id": 1,
    "material_name": "1/4 Copper Tube",
    "material_code": "CU-1/4",
    "description": "High quality copper tube",
    "unit": "METERS",
    "unit_price": 150.00,
    "sell_price": 200.00,
    "on_hand_stock": 100,
    "reorder_level": 20
  }'
```

**Expected Response:**
```json
{
  "id": 1,
  "brand_id": 1,
  "material_name": "1/4 Copper Tube",
  "material_code": "CU-1/4",
  "description": "High quality copper tube",
  "unit": "METERS",
  "unit_price": 150.00,
  "sell_price": 200.00,
  "on_hand_stock": 100,
  "reorder_level": 20,
  "brand_name": "Generic Materials",
  "created_at": "2026-03-10T10:00:00Z",
  "created_by": 1,
  "updated_at": null,
  "updated_by": null,
  "deleted_at": null,
  "deleted_by": null
}
```

**Validation Error Response (400):**
```json
{
  "statusCode": 400,
  "message": [
    "Material name is required",
    "Unit price cannot be negative"
  ],
  "error": "Bad Request"
}
```

**Duplicate Error Response (400):**
```json
{
  "statusCode": 400,
  "message": "Material with name \"1/4 Copper Tube\" already exists",
  "error": "Bad Request"
}
```

---

## 5. Update Material

**Endpoint:** `PATCH /inventory/materials/:id`

**Request Body:** (All fields optional)
```json
{
  "sell_price": 220.00,
  "on_hand_stock": 150,
  "reorder_level": 25
}
```

**Request:**
```bash
curl -X PATCH http://localhost:3000/inventory/materials/1 \
  -H "Content-Type: application/json" \
  -d '{
    "sell_price": 220.00,
    "on_hand_stock": 150
  }'
```

**Expected Response:**
```json
{
  "id": 1,
  "brand_id": 1,
  "material_name": "1/4 Copper Tube",
  "material_code": "CU-1/4",
  "description": "High quality copper tube",
  "unit": "METERS",
  "unit_price": 150.00,
  "sell_price": 220.00,
  "on_hand_stock": 150,
  "reorder_level": 20,
  "brand_name": "Generic Materials",
  "created_at": "2026-03-10T10:00:00Z",
  "created_by": 1,
  "updated_at": "2026-03-10T11:00:00Z",
  "updated_by": 1,
  "deleted_at": null,
  "deleted_by": null
}
```

---

## 6. Delete Material

**Endpoint:** `DELETE /inventory/materials/:id`

**Request:**
```bash
curl -X DELETE http://localhost:3000/inventory/materials/1
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Material deleted successfully"
}
```

**Error Response (404):**
```json
{
  "statusCode": 404,
  "message": "Material with ID 999 not found",
  "error": "Not Found"
}
```

---

## 7. Get Low Stock Materials

**Endpoint:** `GET /inventory/materials/low-stock`

**Description:** Get materials where on_hand_stock <= reorder_level

**Request:**
```bash
curl http://localhost:3000/inventory/materials/low-stock
```

**Expected Response:**
```json
[
  {
    "id": 5,
    "brand_id": 2,
    "material_name": "R410A Refrigerant",
    "material_code": "REF-410A",
    "description": "Refrigerant gas",
    "unit": "KG",
    "unit_price": 500.00,
    "sell_price": 650.00,
    "on_hand_stock": 5,
    "reorder_level": 10,
    "brand_name": "Premium Pipes Co.",
    "created_at": "2026-03-10T10:00:00Z",
    "created_by": 1,
    "updated_at": null,
    "updated_by": null,
    "deleted_at": null,
    "deleted_by": null
  }
]
```

---

## 🧪 Testing with Postman

### Setup

1. **Create New Collection:** "HVAC Material Inventory"

2. **Set Environment Variables:**
   - `base_url`: `http://localhost:3000`
   - `auth_token`: (if authentication is implemented)

3. **Add Requests:**
   - Get Brands
   - Get All Materials
   - Get Single Material
   - Create Material
   - Update Material
   - Delete Material
   - Get Low Stock

### Example Postman Request

**Create Material:**
```
Method: POST
URL: {{base_url}}/inventory/materials
Headers:
  Content-Type: application/json
  Authorization: Bearer {{auth_token}}
Body (raw JSON):
{
  "brand_id": 1,
  "material_name": "Test Material",
  "unit": "PCS",
  "unit_price": 100,
  "sell_price": 150,
  "on_hand_stock": 50,
  "reorder_level": 10
}
```

---

## 🧪 Testing Scenarios

### Scenario 1: Create Material Flow

1. **Get Brands** → Get available material brands
2. **Create Material** → Create new material with selected brand
3. **Get All Materials** → Verify material appears in list
4. **Get Single Material** → Verify material details

### Scenario 2: Update Material Flow

1. **Get Single Material** → Get current material data
2. **Update Material** → Update specific fields
3. **Get Single Material** → Verify changes

### Scenario 3: Low Stock Alert

1. **Create Material** → Create with stock below reorder level
2. **Get Low Stock** → Verify material appears in low stock list

### Scenario 4: Delete Material Flow

1. **Create Material** → Create test material
2. **Delete Material** → Soft delete the material
3. **Get All Materials** → Verify material doesn't appear
4. **Get Single Material** → Should return 404

### Scenario 5: Validation Testing

1. **Create Material** → Try with empty name (should fail)
2. **Create Material** → Try with negative price (should fail)
3. **Create Material** → Try with duplicate name (should fail)
4. **Create Material** → Try with invalid brand (should fail)

---

## 🐛 Common Issues & Solutions

### Issue: 404 Not Found
**Cause:** Route not registered or server not running
**Solution:** 
- Check if MaterialsModule is imported in app.module.ts
- Restart backend server
- Verify URL is correct

### Issue: 500 Internal Server Error
**Cause:** Database connection issue or query error
**Solution:**
- Check database connection in .env
- Review server logs for error details
- Verify table exists in database

### Issue: 400 Bad Request
**Cause:** Validation error or invalid data
**Solution:**
- Check request body matches DTO requirements
- Verify all required fields are provided
- Check data types match expectations

### Issue: CORS Error
**Cause:** Frontend can't access backend due to CORS policy
**Solution:**
- Add frontend URL to CORS_ORIGINS in backend .env
- Restart backend server

---

## 📊 Database Verification

After testing, verify data in database:

```sql
-- Check materials table
SELECT * FROM tblmaterials WHERE deleted_at IS NULL;

-- Check price history
SELECT * FROM tblmaterial_price_history ORDER BY created_at DESC LIMIT 10;

-- Check low stock materials
SELECT 
  material_name, 
  on_hand_stock, 
  reorder_level 
FROM tblmaterials 
WHERE on_hand_stock <= reorder_level 
  AND deleted_at IS NULL;

-- Check soft deleted materials
SELECT * FROM tblmaterials WHERE deleted_at IS NOT NULL;
```

---

## ✅ Testing Checklist

- [ ] Backend server starts without errors
- [ ] Database migration applied successfully
- [ ] GET /materials/brands returns material brands
- [ ] GET /materials returns all materials
- [ ] GET /materials/:id returns single material
- [ ] POST /materials creates new material
- [ ] PATCH /materials/:id updates material
- [ ] DELETE /materials/:id soft deletes material
- [ ] GET /materials/low-stock returns low stock materials
- [ ] Validation errors return proper messages
- [ ] Duplicate names are rejected
- [ ] Invalid brand IDs are rejected
- [ ] Price history is tracked on updates
- [ ] Soft deleted materials don't appear in lists

---

## 📝 Notes

- All timestamps are in UTC
- Prices are stored with 2 decimal places
- Stock quantities are integers
- Soft delete preserves data (deleted_at timestamp)
- Price changes are automatically tracked in history table

---

**Last Updated:** March 10, 2026
**Status:** Ready for Testing ✅
