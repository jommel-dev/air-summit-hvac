CREATE TABLE IF NOT EXISTS tblmaterial_items (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pcs',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tblproduct_capacity_material_map (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL,
  capacity_id BIGINT NOT NULL,
  material_id BIGINT NOT NULL REFERENCES tblmaterial_items(id),
  qty_per_set NUMERIC(14, 4) NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, capacity_id, material_id)
);

CREATE TABLE IF NOT EXISTS tblmaterial_stock_balance (
  id BIGSERIAL PRIMARY KEY,
  material_id BIGINT NOT NULL REFERENCES tblmaterial_items(id),
  on_hand NUMERIC(14, 2) NOT NULL DEFAULT 0,
  reserved NUMERIC(14, 2) NOT NULL DEFAULT 0,
  available NUMERIC(14, 2) GENERATED ALWAYS AS (on_hand - reserved) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(material_id)
);

CREATE TABLE IF NOT EXISTS tblmaterial_stock_movement (
  id BIGSERIAL PRIMARY KEY,
  material_id BIGINT NOT NULL REFERENCES tblmaterial_items(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('IN', 'OUT', 'RESERVE', 'RELEASE', 'RETURN', 'ADJUST')),
  qty NUMERIC(14, 2) NOT NULL CHECK (qty > 0),
  source_type TEXT NOT NULL CHECK (source_type IN ('PO', 'SO', 'MANUAL')),
  source_id BIGINT NOT NULL,
  source_line_key TEXT NOT NULL,
  status_snapshot TEXT,
  remarks TEXT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_type, source_id, movement_type, source_line_key)
);

CREATE INDEX IF NOT EXISTS idx_material_stock_movement_source
  ON tblmaterial_stock_movement(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_material_stock_movement_material
  ON tblmaterial_stock_movement(material_id, created_at DESC);
