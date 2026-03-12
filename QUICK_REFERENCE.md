# HVAC System - Quick Reference Guide

## 🎯 Code Patterns & Examples

### Backend Patterns

#### 1. Creating a New Module

```typescript
// Step 1: Generate module structure
// backend/src/your-module/
//   ├── dto/
//   │   ├── create-item.dto.ts
//   │   └── update-item.dto.ts
//   ├── entities/
//   │   └── item.entity.ts
//   ├── item.controller.ts
//   ├── item.service.ts
//   └── item.module.ts

// Step 2: Create Entity
export class Item {
  id: number;
  name: string;
  created_at: Date;
}

// Step 3: Create DTOs
export class CreateItemDto {
  @IsNotEmpty()
  @IsString()
  name: string;
}

// Step 4: Create Service
@Injectable()
export class ItemService {
  constructor(private readonly db: DatabaseService) {}
  
  async create(dto: CreateItemDto): Promise<Item> {
    const result = await this.db.query(
      'INSERT INTO tblitems (name) VALUES ($1) RETURNING *',
      [dto.name]
    );
    return result.rows[0];
  }
}

// Step 5: Create Controller
@Controller('items')
export class ItemController {
  constructor(private readonly service: ItemService) {}
  
  @Post()
  create(@Body() dto: CreateItemDto) {
    return this.service.create(dto);
  }
}

// Step 6: Create Module
@Module({
  imports: [DatabaseModule],
  controllers: [ItemController],
  providers: [ItemService],
  exports: [ItemService],
})
export class ItemModule {}

// Step 7: Register in app.module.ts
imports: [
  // ... other modules
  ItemModule,
]
```

#### 2. Database Query Patterns

```typescript
// SELECT with JOIN
const query = `
  SELECT 
    m.*,
    b."brandName" as brand_name
  FROM tblmaterials m
  LEFT JOIN tblbrands b ON m.brand_id = b.id
  WHERE m.deleted_at IS NULL
  ORDER BY m.material_name ASC
`;
const result = await this.db.query(query);

// INSERT with RETURNING
const query = `
  INSERT INTO tblmaterials (name, price)
  VALUES ($1, $2)
  RETURNING *
`;
const result = await this.db.query(query, [name, price]);

// UPDATE with dynamic fields
const updateFields = [];
const values = [];
let paramIndex = 1;

if (dto.name) {
  updateFields.push(`name = $${paramIndex}`);
  values.push(dto.name);
  paramIndex++;
}

const query = `
  UPDATE tblmaterials
  SET ${updateFields.join(', ')}
  WHERE id = $${paramIndex}
`;
values.push(id);
await this.db.query(query, values);

// Soft DELETE
const query = `
  UPDATE tblmaterials
  SET deleted_at = NOW(), deleted_by = $1
  WHERE id = $2
`;
await this.db.query(query, [userId, id]);
```

#### 3. Error Handling

```typescript
// Not Found
if (result.rows.length === 0) {
  throw new NotFoundException(`Item with ID ${id} not found`);
}

// Bad Request
if (stock < 0) {
  throw new BadRequestException('Stock cannot be negative');
}

// Try-Catch
try {
  await this.db.query(query, values);
} catch (error) {
  throw new BadRequestException('Failed to create item');
}
```

### Frontend Patterns

#### 1. Creating a Service

```typescript
// shared/services/material.service.ts
import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface Material {
  id: number;
  material_name: string;
  unit_price: number;
  sell_price: number;
  on_hand_stock: number;
}

@Injectable({
  providedIn: 'root'
})
export class MaterialService {
  private baseUrl = '/inventory/materials';

  // GET all materials
  async getMaterials(search?: string): Promise<Material[]> {
    const params = search ? { search } : {};
    const response = await apiClient.get(this.baseUrl, { params });
    return response.data;
  }

  // GET single material
  async getMaterial(id: number): Promise<Material> {
    const response = await apiClient.get(`${this.baseUrl}/${id}`);
    return response.data;
  }

  // POST create material
  async createMaterial(data: Partial<Material>): Promise<Material> {
    const response = await apiClient.post(this.baseUrl, data);
    return response.data;
  }

  // PATCH update material
  async updateMaterial(id: number, data: Partial<Material>): Promise<Material> {
    const response = await apiClient.patch(`${this.baseUrl}/${id}`, data);
    return response.data;
  }

  // DELETE material
  async deleteMaterial(id: number): Promise<void> {
    await apiClient.delete(`${this.baseUrl}/${id}`);
  }
}
```

#### 2. Component Pattern

```typescript
// pages/material-inventory/material-inventory.component.ts
import { Component, OnInit } from '@angular/core';
import { MaterialService, Material } from '../../shared/services/material.service';

@Component({
  selector: 'app-material-inventory',
  templateUrl: './material-inventory.component.html',
})
export class MaterialInventoryComponent implements OnInit {
  materials: Material[] = [];
  isLoading = false;
  errorMessage = '';
  search = '';

  // Form state
  isDrawerOpen = false;
  drawerMode: 'create' | 'edit' = 'create';
  editingId: number | null = null;
  
  form = {
    material_name: '',
    unit_price: 0,
    sell_price: 0,
    on_hand_stock: 0,
  };

  constructor(private materialService: MaterialService) {}

  async ngOnInit() {
    await this.loadMaterials();
  }

  async loadMaterials() {
    this.isLoading = true;
    this.errorMessage = '';
    
    try {
      this.materials = await this.materialService.getMaterials(this.search);
    } catch (error: any) {
      this.errorMessage = error.message || 'Failed to load materials';
    } finally {
      this.isLoading = false;
    }
  }

  openCreateDrawer() {
    this.drawerMode = 'create';
    this.editingId = null;
    this.resetForm();
    this.isDrawerOpen = true;
  }

  async openEditDrawer(material: Material) {
    this.drawerMode = 'edit';
    this.editingId = material.id;
    this.form = { ...material };
    this.isDrawerOpen = true;
  }

  async saveForm() {
    try {
      if (this.drawerMode === 'create') {
        await this.materialService.createMaterial(this.form);
      } else {
        await this.materialService.updateMaterial(this.editingId!, this.form);
      }
      
      this.isDrawerOpen = false;
      await this.loadMaterials();
    } catch (error: any) {
      this.errorMessage = error.message || 'Failed to save material';
    }
  }

  async deleteMaterial(id: number) {
    if (!confirm('Are you sure you want to delete this material?')) {
      return;
    }

    try {
      await this.materialService.deleteMaterial(id);
      await this.loadMaterials();
    } catch (error: any) {
      this.errorMessage = error.message || 'Failed to delete material';
    }
  }

  resetForm() {
    this.form = {
      material_name: '',
      unit_price: 0,
      sell_price: 0,
      on_hand_stock: 0,
    };
  }
}
```

#### 3. Template Pattern

```html
<!-- material-inventory.component.html -->
<div class="container">
  <!-- Header -->
  <div class="header">
    <h1>Material Inventory</h1>
    <button (click)="openCreateDrawer()">Add Material</button>
  </div>

  <!-- Search -->
  <input 
    type="text" 
    [(ngModel)]="search" 
    (ngModelChange)="loadMaterials()"
    placeholder="Search materials..."
  />

  <!-- Loading State -->
  @if (isLoading) {
    <div>Loading...</div>
  }

  <!-- Error Message -->
  @if (errorMessage) {
    <div class="error">{{ errorMessage }}</div>
  }

  <!-- Table -->
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Unit Price</th>
        <th>Sell Price</th>
        <th>Stock</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      @for (material of materials; track material.id) {
        <tr>
          <td>{{ material.material_name }}</td>
          <td>{{ material.unit_price }}</td>
          <td>{{ material.sell_price }}</td>
          <td>{{ material.on_hand_stock }}</td>
          <td>
            <button (click)="openEditDrawer(material)">Edit</button>
            <button (click)="deleteMaterial(material.id)">Delete</button>
          </td>
        </tr>
      }
    </tbody>
  </table>

  <!-- Form Drawer -->
  @if (isDrawerOpen) {
    <div class="drawer">
      <h2>{{ drawerMode === 'create' ? 'Create' : 'Edit' }} Material</h2>
      
      <form (ngSubmit)="saveForm()">
        <label>
          Material Name
          <input type="text" [(ngModel)]="form.material_name" name="name" required />
        </label>

        <label>
          Unit Price
          <input type="number" [(ngModel)]="form.unit_price" name="unitPrice" />
        </label>

        <label>
          Sell Price
          <input type="number" [(ngModel)]="form.sell_price" name="sellPrice" />
        </label>

        <label>
          Stock
          <input type="number" [(ngModel)]="form.on_hand_stock" name="stock" />
        </label>

        <button type="submit">Save</button>
        <button type="button" (click)="isDrawerOpen = false">Cancel</button>
      </form>
    </div>
  }
</div>
```

### Database Patterns

#### 1. Creating a Table

```sql
-- Basic table with audit fields
CREATE TABLE IF NOT EXISTS public.tblitems (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12, 2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES public.tblusers(id),
  updated_at TIMESTAMPTZ,
  updated_by BIGINT REFERENCES public.tblusers(id),
  deleted_at TIMESTAMPTZ,
  deleted_by BIGINT REFERENCES public.tblusers(id)
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_items_name ON public.tblitems(name);
CREATE INDEX IF NOT EXISTS idx_items_deleted_at ON public.tblitems(deleted_at);

-- Add comments
COMMENT ON TABLE public.tblitems IS 'Items inventory table';
COMMENT ON COLUMN public.tblitems.deleted_at IS 'Soft delete timestamp';
```

#### 2. Creating a Trigger

```sql
-- Function to update stock
CREATE OR REPLACE FUNCTION update_stock_on_transaction()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'APPROVED' AND OLD.status != 'APPROVED' THEN
    UPDATE public.tblmaterials
    SET on_hand_stock = on_hand_stock + NEW.quantity
    WHERE id = NEW.material_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trg_update_stock ON public.tbltransactions;
CREATE TRIGGER trg_update_stock
  AFTER UPDATE ON public.tbltransactions
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_on_transaction();
```

#### 3. Complex Query

```sql
-- Get materials with low stock and brand info
SELECT 
  m.id,
  m.material_name,
  m.on_hand_stock,
  m.reorder_level,
  b."brandName" as brand_name,
  (m.reorder_level - m.on_hand_stock) as shortage
FROM tblmaterials m
LEFT JOIN tblbrands b ON m.brand_id = b.id
WHERE m.deleted_at IS NULL 
  AND m.on_hand_stock <= m.reorder_level
ORDER BY shortage DESC;
```

## 🔧 Common Tasks

### Add a New Field to Existing Table

```sql
-- 1. Add column
ALTER TABLE public.tblmaterials 
ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.tblvendors(id);

-- 2. Add index if needed
CREATE INDEX IF NOT EXISTS idx_materials_supplier 
ON public.tblmaterials(supplier_id);

-- 3. Add comment
COMMENT ON COLUMN public.tblmaterials.supplier_id IS 'Primary supplier for this material';
```

### Update Backend for New Field

```typescript
// 1. Update Entity
export class Material {
  // ... existing fields
  supplier_id: string | null;
}

// 2. Update DTO
export class CreateMaterialDto {
  // ... existing fields
  
  @IsOptional()
  @IsString()
  supplier_id?: string;
}

// 3. Update Service
async create(dto: CreateMaterialDto): Promise<Material> {
  const query = `
    INSERT INTO tblmaterials (name, supplier_id)
    VALUES ($1, $2)
    RETURNING *
  `;
  const result = await this.db.query(query, [dto.name, dto.supplier_id]);
  return result.rows[0];
}
```

### Update Frontend for New Field

```typescript
// 1. Update Interface
export interface Material {
  // ... existing fields
  supplier_id: string | null;
}

// 2. Update Form
form = {
  // ... existing fields
  supplier_id: '',
};

// 3. Update Template
<label>
  Supplier
  <select [(ngModel)]="form.supplier_id" name="supplier">
    <option value="">Select Supplier</option>
    @for (supplier of suppliers; track supplier.id) {
      <option [value]="supplier.id">{{ supplier.name }}</option>
    }
  </select>
</label>
```

## 📚 Useful Commands

```bash
# Backend
npm run start:dev          # Start development server
npm run build              # Build for production
npm run test               # Run tests

# Frontend
ng serve                   # Start development server
ng build                   # Build for production
ng generate component name # Generate component
ng generate service name   # Generate service

# Database
psql -h host -U user -d db # Connect to database
\dt                        # List tables
\d tablename               # Describe table
\q                         # Quit
```

## 🎨 Styling Tips

```css
/* Use existing Tailwind classes */
.btn-primary {
  @apply rounded-lg bg-brand-500 px-4 py-2 text-white hover:bg-brand-600;
}

.card {
  @apply rounded-xl border border-gray-200 p-4 dark:border-gray-800;
}

.input {
  @apply w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900;
}
```

---

**Remember:** 
- Always backup before modifying
- Test thoroughly
- Follow existing patterns
- Add comments for complex logic
- Keep code DRY (Don't Repeat Yourself)
