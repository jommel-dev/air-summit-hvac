# System Architecture — HVAC Inventory & Sales Management System

## 1. Overview

This is a full-stack web application for managing HVAC (Heating, Ventilation, and Air Conditioning) products, sales orders, purchase orders, materials, quotations, projects, and accounting. It supports multi-branch operations with role-based access control (RBAC).

---

## 2. Tech Stack

| Layer       | Technology                                                  |
| ----------- | ----------------------------------------------------------- |
| Frontend    | Angular 21, Tailwind CSS 4, TypeScript 5.9                  |
| Backend     | NestJS 11, TypeScript 5.7, raw SQL via `pg` (no ORM)        |
| Database    | PostgreSQL (Supabase-hosted, pooler connection)             |
| Auth        | JWT (`@nestjs/jwt`, `jsonwebtoken`)                         |
| Charting    | ApexCharts, amCharts 5, D3.js                               |
| PDF/Excel   | pdf-lib, pdfmake, exceljs                                   |
| Calendar    | FullCalendar                                                |
| Deployment  | Docker (backend), Vercel (frontend)                         |
| Testing     | Jest (backend), Karma + Jasmine (frontend)                  |

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Angular 21)                     │
│  Tailwind CSS · ApexCharts · FullCalendar · pdf-lib · exceljs   │
│  Route Guards (RBAC) · Axios HTTP Client · Reactive Forms       │
└────────────────────────────────┬────────────────────────────────┘
                                 │ HTTP/REST (JSON)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        BACKEND (NestJS 11)                       │
│  JWT Auth · Global Exception Filter · Error Interceptor         │
│  Module-per-feature · Raw SQL via pg Pool · CORS                │
└────────────────────────────────┬────────────────────────────────┘
                                 │ TCP/SSL (pg wire protocol)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                   DATABASE (PostgreSQL / Supabase)               │
│  Normalized RBAC · Triggers · Generated Columns · Indexes       │
│  Audit Logs · Material Ledger · Auto-numbering                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Backend Module Architecture

```
backend/src/
├── main.ts                          # Bootstrap, CORS, global filters
├── app.module.ts                    # Root module (imports all feature modules)
├── app.controller.ts                # Health check / root endpoint
├── app.service.ts                   # Root service
│
├── database/
│   ├── database.module.ts           # Exports DatabaseService globally
│   └── database.service.ts          # pg Pool wrapper (query, withTransaction)
│
├── auth/
│   ├── jwt-auth.guard.ts            # JWT validation guard
│   └── login/                       # Login controller, service, DTOs
│
├── common/
│   ├── filters/                     # ApiExceptionFilter (global)
│   ├── interceptors/                # ApiErrorResponseInterceptor (global)
│   └── utils/                       # Shared utilities (resolveBranchId)
│
├── inventory/
│   ├── brands/                      # Brand CRUD
│   ├── products/                    # Product CRUD (linked to brands)
│   ├── capacity/                    # Product capacity/model variants
│   ├── materials/                   # Material inventory module
│   ├── material-items/              # Material catalog CRUD
│   ├── material-stock/              # Stock balance queries
│   ├── material-transactions/       # Stock movement ledger
│   ├── purchase/                    # Purchase order lifecycle
│   ├── vendor/                      # Vendor/supplier CRUD
│   └── serial-number/               # Unit serial number tracking
│
├── sales/
│   ├── sales-order/                 # Sales order lifecycle
│   ├── quotation/                   # Quotation lifecycle (draft→finalized→SO)
│   ├── public-order-form/           # Public order placement (no auth)
│   └── public-feedback/             # Public feedback form (no auth)
│
├── accounting/                      # Cheque vouchers, journal entries
├── audit-log/                       # Audit trail queries
├── dashboard/                       # Dashboard aggregation
├── settings/                        # Business settings CRUD
└── usermanage/users/                # User CRUD, role assignment
```

### Module Pattern

Each feature module follows the NestJS convention:
```
feature/
├── feature.module.ts       # Module declaration
├── feature.controller.ts   # REST endpoints
├── feature.service.ts      # Business logic + SQL queries
├── dto/                    # Request/response DTOs
└── entities/               # Type definitions
```

---

## 5. Frontend Architecture

```
frontend/src/app/
├── app.routes.ts                    # Route definitions with RBAC guards
├── app.config.ts                    # App configuration
│
├── pages/                           # Feature pages (one per route)
│   ├── accounting/                  # Cheque voucher management
│   ├── auth-pages/                  # Login/sign-in
│   ├── customers/                   # Customer/stakeholder management
│   ├── dashboard/                   # Main dashboard with charts
│   ├── feedback/                    # Public feedback page
│   ├── inventory/                   # Product inventory (units, serials)
│   ├── material-inventory/          # Material stock & transactions
│   ├── order-form/                  # Public order form
│   ├── projects/                    # Project management
│   ├── purchase-order/              # PO management
│   ├── quotation/                   # Quotation management
│   ├── sales-order/                 # SO management (units)
│   ├── sales-order-materials/       # SO materials management
│   ├── schedule-today-sales-order/  # Today's schedule view
│   ├── settings/                    # Business settings
│   └── user-management/             # Users & roles
│
└── shared/
    ├── components/                  # Reusable UI components
    ├── directives/                  # Custom Angular directives
    ├── guards/                      # authChildGuard, rbacGuard, guestOnlyGuard
    ├── layout/                      # App shell (sidebar, header, footer)
    ├── pipe/                        # Custom pipes
    └── services/                    # API services (axios-based)
        ├── api-client.ts            # Base HTTP client (axios instance)
        ├── auth.service.ts          # Login, token management
        ├── auth-storage.ts          # Token persistence
        ├── rbac.service.ts          # Permission checks
        ├── sales-order.service.ts   # SO API calls
        ├── purchase-order.service.ts
        ├── quotation.service.ts
        ├── material-inventory.service.ts
        ├── audit-log.service.ts
        └── ...
```

### Routing & Guards

- All authenticated routes live under `/users/*`
- `authChildGuard` — verifies JWT token validity
- `rbacGuard` — checks menu + permission access per route
- `guestOnlyGuard` — redirects authenticated users away from login
- Each route declares `data: { menu, permission }` for RBAC evaluation

---

## 6. Database Schema

### 6.1 Entity Relationship Diagram (Simplified)

```
tblbranches ─────────────────────────────────────────────────────────┐
    │                                                                 │
    ├── tblusers (branchId FK)                                        │
    │       │                                                         │
    │       ├── tblrbac (roleId FK)                                   │
    │       │       │                                                 │
    │       │       ├── auth_role_permissions ──► auth_permission_keys │
    │       │       └── auth_user_permission_overrides                 │
    │       │                                                         │
    │       └── tblaudit_logs (user_id)                               │
    │                                                                 │
    ├── tblpurchase_orders (branchId FK)                              │
    │       ├── tblvendors (vendor_id FK)                             │
    │       ├── tblpo_payments (po_id FK)                             │
    │       └── tbltransaction_product_items (purchaseId FK)          │
    │                                                                 │
    ├── tblsales_order (branchId FK)                                  │
    │       ├── tblcustomer (customer_id FK)                          │
    │       ├── tblprojects (project_id FK)                           │
    │       ├── tblso_payments (so_id FK)                             │
    │       ├── tblso_material_items (sales_id FK)                    │
    │       └── tbltransaction_product_items (salesId FK)             │
    │                                                                 │
    └── tblserial_numbers (branchId, purchaseId, salesId, etc.)       │
                                                                      │
tblbrands ──► tblproducts ──► tblcapacity                             │
                    │              │                                   │
                    │              └── tblcapacity_netprice_history    │
                    │                                                  │
                    └── tblproduct_capacity_material_map               │
                              │                                        │
                              └── tblmaterial_items                    │
                                      │                                │
                                      ├── tblmaterial_stock_balance    │
                                      └── tblmaterial_stock_movement   │
                                                                       │
tblquotation ──► tblquotation_items (product_id, capacity_id)          │
       │                                                               │
       └── converted_sales_id ──► tblsales_order                       │
                                                                       │
tblcheque_vouchers                                                     │
       ├── tblcheque_voucher_deposits                                  │
       ├── tblcheque_voucher_invoices                                  │
       └── tblcheque_voucher_account_titles ──► tblaccount_titles      │
                                                                       │
tblsettings (single-row business config) ──────────────────────────────┘
```

### 6.2 Table Inventory

#### Core Business

| Table                              | Purpose                                              |
| ---------------------------------- | ---------------------------------------------------- |
| `tblbranches`                      | Multi-branch definitions                             |
| `tblbrands`                        | HVAC brand catalog                                   |
| `tblproducts`                      | Product catalog (linked to brand)                    |
| `tblcapacity`                      | Product variants (capacity, models, pricing)         |
| `tblcapacity_netprice_history`     | Historical net price tracking                        |
| `tblcustomer`                      | Customer master (UUID PK)                            |
| `tblvendors`                       | Supplier/vendor master (UUID PK)                     |

#### Sales & Purchase

| Table                              | Purpose                                              |
| ---------------------------------- | ---------------------------------------------------- |
| `tblsales_order`                   | Sales orders (auto SO-XXXXXX)                        |
| `tblpurchase_orders`               | Purchase orders (auto PO-XXXXXX)                     |
| `tbltransaction_product_items`     | Line items for SO/PO                                 |
| `tblso_material_items`             | Material line items on SO                            |
| `tblso_payments`                   | SO payment records                                   |
| `tblpo_payments`                   | PO payment records                                   |
| `tblserial_numbers`                | Individual unit serial tracking                      |
| `tblquotation`                     | Quotation header (lifecycle: draft→finalized→SO)     |
| `tblquotation_items`               | Quotation line items                                 |
| `tblprojects`                      | Project master (supports staggered SO releases)      |

#### Material Inventory (Ledger-based)

| Table                              | Purpose                                              |
| ---------------------------------- | ---------------------------------------------------- |
| `tblmaterial_items`                | Material catalog (code, name, unit)                  |
| `tblproduct_capacity_material_map` | BOM: materials per product-capacity                  |
| `tblmaterial_stock_balance`        | Current stock (on_hand, reserved, available)         |
| `tblmaterial_stock_movement`       | Stock movement ledger (IN/OUT/RESERVE/RELEASE/etc.)  |

#### Accounting

| Table                              | Purpose                                              |
| ---------------------------------- | ---------------------------------------------------- |
| `tblaccount_titles`                | Chart of accounts                                    |
| `tblcheque_vouchers`               | Cheque voucher header                                |
| `tblcheque_voucher_deposits`       | Bank/cheque deposit details                          |
| `tblcheque_voucher_invoices`       | Invoice references on voucher                        |
| `tblcheque_voucher_account_titles` | Debit/credit entries per voucher                     |

#### RBAC & Auth

| Table                              | Purpose                                              |
| ---------------------------------- | ---------------------------------------------------- |
| `tblrbac`                          | Role definitions                                     |
| `tblusers`                         | User accounts (linked to role + branch)              |
| `auth_permission_keys`             | Permission dictionary (feature/menu/tab/action)      |
| `auth_role_permissions`            | Role → permission mapping                            |
| `auth_user_permission_overrides`   | Per-user allow/deny overrides                        |
| `auth_user_roles`                  | Explicit user-role assignments                       |
| `auth_menus`                       | Menu registry for UI rendering                       |

#### System & Audit

| Table                              | Purpose                                              |
| ---------------------------------- | ---------------------------------------------------- |
| `tblaudit_logs`                    | Action audit trail (who, what, when)                 |
| `tblprocessflow`                   | Workflow step tracking                               |
| `tblinstallation`                  | Installation team assignments                        |
| `tblsettings`                      | Business identity & configuration (single-row)       |

---

## 7. Key Architectural Patterns

### 7.1 No ORM — Raw SQL

The backend uses the `pg` library directly. `DatabaseService` provides:
- `query(text, params)` — parameterized queries
- `withTransaction(callback)` — managed BEGIN/COMMIT/ROLLBACK

This gives full control over complex queries, CTEs, and PostgreSQL-specific features.

### 7.2 Multi-Branch Isolation

Most entities carry a `branchId` column. The backend resolves the active branch from the JWT token and filters data accordingly.

### 7.3 Normalized RBAC

```
User → Role → auth_role_permissions → auth_permission_keys
  └──────────► auth_user_permission_overrides (allow/deny)
```

Permission resolution order:
1. User-level **deny** override → blocked
2. User-level **allow** override → granted
3. Role-level grant → granted
4. Otherwise → denied

A PostgreSQL view `v_auth_user_effective_permissions` materializes this logic.

### 7.4 Audit Logging

All significant mutations are recorded in `tblaudit_logs` with:
- Action name, entity type/ID
- Actor (user_id, username, role)
- Branch context
- IP address
- Arbitrary metadata (JSONB)

### 7.5 Material Inventory Ledger

Double-entry style stock movements with unique constraints to prevent duplicate entries:
- Movement types: `IN`, `OUT`, `RESERVE`, `RELEASE`, `RETURN`, `ADJUST`
- Source types: `PO`, `SO`, `MANUAL`
- `tblmaterial_stock_balance.available` is a computed column (`on_hand - reserved`)

### 7.6 Auto-Generated Document Numbers

| Document | Pattern | Mechanism |
|----------|---------|-----------|
| Purchase Order | `PO-000001` | PostgreSQL `GENERATED ALWAYS AS` |
| Sales Order | `SO-000001` | PostgreSQL `GENERATED ALWAYS AS` |
| Quotation | `QT-YYYYMMDD-000001` | `BEFORE INSERT` trigger |
| Cheque Voucher | Configurable prefix | Application-level |

### 7.7 Quotation → Sales Order Conversion

Quotations follow a lifecycle: `draft` → `finalized` → `converted` (or `cancelled`). On conversion, the quotation's `converted_sales_id` links to the newly created SO.

---

## 8. Authentication & Authorization Flow

```
1. User submits credentials → POST /auth/login
2. Backend validates password (bcrypt) → issues JWT (access + refresh)
3. Frontend stores tokens → attaches Authorization header via axios interceptor
4. Backend JwtAuthGuard validates token on protected routes
5. Frontend rbacGuard checks user permissions before route activation
6. Backend can additionally check permissions per-endpoint
```

---

## 9. Deployment Architecture

```
┌──────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Vercel     │  HTTPS  │   Docker Host    │  SSL    │   Supabase      │
│  (Frontend)  │ ──────► │   (Backend)      │ ──────► │  (PostgreSQL)   │
│  Angular SPA │         │   NestJS API     │         │  Pooler Mode    │
└──────────────┘         └──────────────────┘         └─────────────────┘
```

- Frontend: Static SPA deployed to Vercel with `vercel.json` rewrites
- Backend: Dockerized NestJS app, listens on configurable PORT
- Database: Supabase PostgreSQL with connection pooler (SSL required)

---

## 10. Environment Configuration

### Backend (.env)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Fallback individual params |
| `DB_SSL` | Enable SSL (auto-detected from URL) |
| `DB_SSL_REJECT_UNAUTHORIZED` | Strict cert validation |
| `JWT_SECRET` | Token signing secret |
| `PORT` | Server port (default: 3000) |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `NODE_ENV` | Environment name |

### Frontend (.env)

| Variable | Purpose |
|----------|---------|
| API base URL | Backend endpoint for axios client |

---

## 11. Data Flow Examples

### Sales Order Creation
```
Frontend → POST /sales-order
  → Validate JWT
  → Resolve branchId from token
  → BEGIN transaction
    → INSERT tblsales_order
    → INSERT tbltransaction_product_items (per line)
    → INSERT tblso_material_items (per material)
    → UPDATE tblcapacity.stockCount
    → INSERT tblmaterial_stock_movement (RESERVE)
    → UPDATE tblmaterial_stock_balance
  → COMMIT
  → INSERT tblaudit_logs
  → Return SO with generated so_number
```

### Material Stock Movement
```
Movement IN (from PO):
  → INSERT tblmaterial_stock_movement (type=IN, source=PO)
  → UPDATE tblmaterial_stock_balance SET on_hand = on_hand + qty

Movement RESERVE (from SO):
  → INSERT tblmaterial_stock_movement (type=RESERVE, source=SO)
  → UPDATE tblmaterial_stock_balance SET reserved = reserved + qty
  → available column auto-recalculates (on_hand - reserved)
```

---

## 12. Security Considerations

- Passwords hashed with bcrypt (cost factor 10)
- JWT tokens with configurable expiry
- CORS restricted to configured origins
- SSL/TLS for database connections
- Parameterized queries throughout (SQL injection prevention)
- Global exception filter prevents stack trace leakage
- RBAC enforced at both frontend (route guards) and backend levels
- Audit trail for all sensitive operations
