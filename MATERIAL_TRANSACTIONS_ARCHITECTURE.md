# Material Transactions - Architecture Diagram

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Angular)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  SalesOrderMaterialsComponent                          │    │
│  │  - Display material items table                        │    │
│  │  - Add material drawer                                 │    │
│  │  - Remove materials                                    │    │
│  │  - Calculate totals                                    │    │
│  └────────────────┬───────────────────────────────────────┘    │
│                   │                                             │
│                   │ uses                                        │
│                   ▼                                             │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  SalesOrderMaterialService                             │    │
│  │  - addMaterialItem()                                   │    │
│  │  - getMaterialItems()                                  │    │
│  │  - removeMaterialItem()                                │    │
│  └────────────────┬───────────────────────────────────────┘    │
│                   │                                             │
└───────────────────┼─────────────────────────────────────────────┘
                    │
                    │ HTTP Requests
                    │
┌───────────────────▼─────────────────────────────────────────────┐
│                      BACKEND (NestJS)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  SalesOrderController                                  │    │
│  │  POST   /sales-order/:id/materials                     │    │
│  │  GET    /sales-order/:id/materials                     │    │
│  │  DELETE /sales-order/:id/materials/:itemId             │    │
│  └────────────────┬───────────────────────────────────────┘    │
│                   │                                             │
│                   │ delegates to                                │
│                   ▼                                             │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  MaterialTransactionsService                           │    │
│  │  - create()                                            │    │
│  │  - findBySalesId()                                     │    │
│  │  - findByPurchaseId()                                  │    │
│  │  - remove()                                            │    │
│  └────────────────┬───────────────────────────────────────┘    │
│                   │                                             │
│                   │ queries                                     │
│                   ▼                                             │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  DatabaseService                                       │    │
│  │  - query()                                             │    │
│  │  - withTransaction()                                   │    │
│  └────────────────┬───────────────────────────────────────┘    │
│                   │                                             │
└───────────────────┼─────────────────────────────────────────────┘
                    │
                    │ SQL Queries
                    │
┌───────────────────▼─────────────────────────────────────────────┐
│                      DATABASE (PostgreSQL)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  tbltransaction_material_items                         │    │
│  │  - id (PK)                                             │    │
│  │  - trans_type (purchase/sales)                         │    │
│  │  - material_id (FK → tblmaterials)                     │    │
│  │  - quantity                                            │    │
│  │  - unit_price, sell_price, discount_price              │    │
│  │  - purchase_id (FK → tblpurchase_orders)               │    │
│  │  - sales_id (FK → tblsales_order)                      │    │
│  │  - created_at                                          │    │
│  └────────────────┬───────────────────────────────────────┘    │
│                   │                                             │
│                   │ joins with                                  │
│                   ▼                                             │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  tblmaterials                                          │    │
│  │  - id (PK)                                             │    │
│  │  - material_name                                       │    │
│  │  - material_code                                       │    │
│  │  - unit                                                │    │
│  │  - unit_price, sell_price                              │    │
│  │  - on_hand_stock                                       │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Adding Material to Sales Order

```
User Action
    │
    ▼
[Component] User clicks "Add Material"
    │
    ▼
[Component] Opens drawer, selects material
    │
    ▼
[Component] Calls service.addMaterialItem()
    │
    ▼
[Service] HTTP POST to /sales-order/:id/materials
    │
    ▼
[Controller] Receives request
    │
    ▼
[Controller] Calls materialTransactionsService.create()
    │
    ▼
[Service] Executes INSERT query
    │
    ▼
[Database] Inserts record into tbltransaction_material_items
    │
    ▼
[Database] Returns inserted record
    │
    ▼
[Service] Returns record to controller
    │
    ▼
[Controller] Returns JSON response
    │
    ▼
[Service] Returns Observable to component
    │
    ▼
[Component] Refreshes material items list
    │
    ▼
[Component] Updates totals
    │
    ▼
User sees updated table
```

## Module Dependencies

```
┌─────────────────────────────────────────────────────────┐
│                     AppModule                            │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────────────────────────────────┐      │
│  │  MaterialTransactionsModule                  │      │
│  │  - MaterialTransactionsController            │      │
│  │  - MaterialTransactionsService               │      │
│  │  - exports: MaterialTransactionsService      │      │
│  └──────────────────────────────────────────────┘      │
│                                                          │
│  ┌──────────────────────────────────────────────┐      │
│  │  SalesOrderModule                            │      │
│  │  - SalesOrderController                      │      │
│  │  - SalesOrderService                         │      │
│  │  - imports: MaterialTransactionsModule       │      │
│  └──────────────────────────────────────────────┘      │
│                                                          │
│  ┌──────────────────────────────────────────────┐      │
│  │  MaterialsModule                             │      │
│  │  - MaterialsController                       │      │
│  │  - MaterialsService                          │      │
│  └──────────────────────────────────────────────┘      │
│                                                          │
│  ┌──────────────────────────────────────────────┐      │
│  │  DatabaseModule                              │      │
│  │  - DatabaseService                           │      │
│  │  - exports: DatabaseService                  │      │
│  └──────────────────────────────────────────────┘      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## Component Hierarchy (Frontend)

```
SalesOrderPage
    │
    ├── SalesOrderForm
    │   ├── Customer Info
    │   ├── Product Items (AC Units)
    │   └── Payment Details
    │
    └── SalesOrderMaterialsComponent ← NEW
        ├── Material Items Table
        │   ├── Material Row 1
        │   ├── Material Row 2
        │   └── Total Row
        │
        └── Add Material Drawer
            ├── Material Dropdown
            ├── Quantity Input
            ├── Price Inputs
            └── Save Button
```

## Database Relationships

```
tblsales_order (1) ──────┐
                         │
                         │ has many
                         │
                         ▼
         tbltransaction_material_items (N)
                         │
                         │ references
                         │
                         ▼
                  tblmaterials (1)
                         │
                         │ belongs to
                         │
                         ▼
                    tblbrands (1)
```

## Transaction Flow

```
┌─────────────────────────────────────────────────────────┐
│  Sales Order Creation/Update                             │
└─────────────────────────────────────────────────────────┘
                    │
                    ├─► Create/Update Sales Order
                    │   (tblsales_order)
                    │
                    ├─► Add Product Items
                    │   (tbltransaction_product_items)
                    │
                    ├─► Add Material Items ← NEW
                    │   (tbltransaction_material_items)
                    │
                    ├─► Add Payment Details
                    │   (tblso_payments)
                    │
                    └─► Calculate Total
                        (Products + Materials)
```

## API Request/Response Flow

```
Client                    Server                  Database
  │                         │                         │
  │  POST /sales-order/1/materials                   │
  ├────────────────────────►│                         │
  │  {material_id: 1,       │                         │
  │   quantity: 10}         │                         │
  │                         │                         │
  │                         │  INSERT INTO            │
  │                         │  tbltransaction_...     │
  │                         ├────────────────────────►│
  │                         │                         │
  │                         │  ◄────────────────────┤
  │                         │  {id: 45, ...}          │
  │                         │                         │
  │  ◄────────────────────┤                         │
  │  {id: 45,               │                         │
  │   material_name: "...", │                         │
  │   quantity: 10}         │                         │
  │                         │                         │
```

---

This architecture provides:
- Clear separation of concerns
- Reusable services
- Scalable structure
- Easy testing
- Maintainable codebase
