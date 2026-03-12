# Material Transactions - Quick Reference Card

## 🚀 Quick Start

### Add Material to Sales Order (Backend)
```typescript
POST /sales-order/:id/materials
Body: {
  material_id: number,
  quantity: number,
  sell_price?: number,
  discount_price?: number
}
```

### Use Component (Frontend)
```html
<app-sales-order-materials [salesOrderId]="123"></app-sales-order-materials>
```

---

## 📁 File Locations

### Backend
- **Service:** `backend/src/inventory/material-transactions/material-transactions.service.ts`
- **Controller:** `backend/src/inventory/material-transactions/material-transactions.controller.ts`
- **Sales Order Controller:** `backend/src/sales/sales-order/sales-order.controller.ts`

### Frontend
- **Service:** `frontend/src/app/shared/services/sales-order-material.service.ts`
- **Component:** `frontend/src/app/pages/sales-order-materials/`

---

## 🔌 API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/sales-order/:id/materials` | POST | Add material |
| `/sales-order/:id/materials` | GET | List materials |
| `/sales-order/:id/materials/:itemId` | DELETE | Remove material |
| `/inventory/material-transactions/sales/:id` | GET | Get by sales order |
| `/inventory/material-transactions/purchase/:id` | GET | Get by purchase order |

---

## 💾 Database

**Table:** `tbltransaction_material_items`

**Key Columns:**
- `trans_type` - 'purchase' or 'sales'
- `material_id` - FK to tblmaterials
- `quantity` - Amount
- `sell_price` - Selling price
- `discount_price` - Discounted price
- `sales_id` - FK to tblsales_order
- `purchase_id` - FK to tblpurchase_orders

---

## 🎯 Common Tasks

### Add Material Item
```typescript
this.salesOrderMaterialService.addMaterialItem(salesOrderId, {
  material_id: 1,
  quantity: 10,
  sell_price: 200
}).subscribe();
```

### Get Material Items
```typescript
this.salesOrderMaterialService.getMaterialItems(salesOrderId)
  .subscribe(items => console.log(items));
```

### Remove Material Item
```typescript
this.salesOrderMaterialService.removeMaterialItem(salesOrderId, itemId)
  .subscribe();
```

---

## 🧪 Test Commands

```bash
# Add material
curl -X POST http://localhost:3000/sales-order/1/materials \
  -H "Content-Type: application/json" \
  -d '{"material_id":1,"quantity":10,"sell_price":200}'

# Get materials
curl http://localhost:3000/sales-order/1/materials

# Remove material
curl -X DELETE http://localhost:3000/sales-order/1/materials/45
```

---

## 📊 Response Format

```json
{
  "id": 45,
  "trans_type": "sales",
  "material_id": 1,
  "material_name": "Copper Pipe",
  "material_code": "CP-12",
  "unit": "METERS",
  "quantity": 10,
  "unit_price": 150.00,
  "sell_price": 200.00,
  "discount_price": 180.00,
  "sales_id": 1,
  "created_at": "2026-03-10T10:30:00Z"
}
```

---

## ⚙️ Component Props

```typescript
@Input() salesOrderId: number; // Required
```

---

## 🔍 Service Methods

### MaterialTransactionsService (Backend)
- `create(dto)` - Create transaction
- `findByPurchaseId(id)` - Get by PO
- `findBySalesId(id)` - Get by SO
- `findOne(id)` - Get single
- `remove(id)` - Delete

### SalesOrderMaterialService (Frontend)
- `addMaterialItem(soId, dto)` - Add material
- `getMaterialItems(soId)` - Get materials
- `removeMaterialItem(soId, itemId)` - Remove material

---

## 📝 Notes

- Material items are separate from AC unit products
- Prices auto-populate from material master
- Totals calculate automatically
- Stock validation not yet implemented
- Works with existing sales order flow

---

## 📚 Documentation

- **Full Guide:** `MATERIAL_TRANSACTIONS_IMPLEMENTATION.md`
- **API Testing:** `MATERIAL_TRANSACTIONS_API_TESTING.md`
- **Summary:** `MATERIAL_TRANSACTIONS_SUMMARY.md`
