-- =====================================================
-- HVAC Management System - Material Inventory & Enhancements
-- Migration Date: 2026-03-10
-- Author: Senior Full-Stack Developer
-- Description: Comprehensive database schema for Material Inventory,
--              Sales Order Enhancements, Customer Management, and Accounting
-- =====================================================

-- =====================================================
-- SECTION 1: BRAND TYPE ENHANCEMENT
-- Purpose: Add type column to differentiate AC Units (ACU) from Materials (MAT)
-- =====================================================

-- Add type column to tblbrands if not exists
-- ACU = AC Unit brands, MAT = Material brands
ALTER TABLE public.tblbrands 
ADD COLUMN IF NOT EXISTS type VARCHAR(10) DEFAULT 'ACU' CHECK (type IN ('ACU', 'MAT'));

-- Add index for faster filtering by type
CREATE INDEX IF NOT EXISTS idx_tblbrands_type ON public.tblbrands(type);

-- Update existing brands to ACU (default for existing AC unit brands)
UPDATE public.tblbrands SET type = 'ACU' WHERE type IS NULL;

COMMENT ON COLUMN public.tblbrands.type IS 'Brand type: ACU for AC Units, MAT for Materials';


-- =====================================================
-- SECTION 2: MATERIAL PRODUCTS TABLE
-- Purpose: Store material products separate from AC units
-- =====================================================

-- Create materials table for material inventory management
CREATE TABLE IF NOT EXISTS public.tblmaterials (
  id BIGSERIAL PRIMARY KEY,
  brand_id BIGINT NULL REFERENCES public.tblbrands(id) ON UPDATE CASCADE ON DELETE SET NULL,
  material_name TEXT NOT NULL,
  material_code VARCHAR(50) UNIQUE, -- SKU or material code
  description TEXT,
  unit VARCHAR(20) DEFAULT 'PCS', -- PCS, METERS, LITERS, KG, etc.
  unit_price NUMERIC(12, 2) DEFAULT 0, -- Cost price
  sell_price NUMERIC(12, 2) DEFAULT 0, -- Selling price
  on_hand_stock BIGINT DEFAULT 0, -- Current stock quantity
  reorder_level BIGINT DEFAULT 0, -- Minimum stock level for reorder alert
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES public.tblusers(id) ON UPDATE CASCADE ON DELETE SET NULL,
  updated_at TIMESTAMPTZ,
  updated_by BIGINT REFERENCES public.tblusers(id) ON UPDATE CASCADE ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by BIGINT REFERENCES public.tblusers(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT tblmaterials_material_name_key UNIQUE (material_name)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tblmaterials_brand_id ON public.tblmaterials(brand_id);
CREATE INDEX IF NOT EXISTS idx_tblmaterials_deleted_at ON public.tblmaterials(deleted_at);
CREATE INDEX IF NOT EXISTS idx_tblmaterials_on_hand_stock ON public.tblmaterials(on_hand_stock);

COMMENT ON TABLE public.tblmaterials IS 'Material products inventory (pipes, wires, accessories, etc.)';
COMMENT ON COLUMN public.tblmaterials.on_hand_stock IS 'Current available stock quantity';
COMMENT ON COLUMN public.tblmaterials.reorder_level IS 'Alert threshold for low stock';


-- =====================================================
-- SECTION 3: MATERIAL PRICE HISTORY
-- Purpose: Track material price changes over time
-- =====================================================

CREATE TABLE IF NOT EXISTS public.tblmaterial_price_history (
  id BIGSERIAL PRIMARY KEY,
  material_id BIGINT NOT NULL REFERENCES public.tblmaterials(id) ON DELETE CASCADE,
  unit_price NUMERIC(12, 2) NOT NULL,
  sell_price NUMERIC(12, 2) NOT NULL,
  supplier_id UUID REFERENCES public.tblvendors(id),
  purchase_order_id INTEGER REFERENCES public.tblpurchase_orders(id),
  purchase_order_no VARCHAR(100),
  created_by BIGINT REFERENCES public.tblusers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_material_price_history_lookup 
ON public.tblmaterial_price_history(material_id, id DESC);

COMMENT ON TABLE public.tblmaterial_price_history IS 'Historical tracking of material price changes';


-- =====================================================
-- SECTION 4: PURCHASE ORDER TYPE ENHANCEMENT
-- Purpose: Differentiate between AC Unit PO and Material PO
-- =====================================================

-- Add po_type column to purchase orders
ALTER TABLE public.tblpurchase_orders 
ADD COLUMN IF NOT EXISTS po_type VARCHAR(20) DEFAULT 'ACU' CHECK (po_type IN ('ACU', 'MATERIAL'));

-- Add index for filtering by PO type
CREATE INDEX IF NOT EXISTS idx_tblpurchase_orders_po_type ON public.tblpurchase_orders(po_type);

COMMENT ON COLUMN public.tblpurchase_orders.po_type IS 'Purchase order type: ACU for AC Units, MATERIAL for materials';


-- =====================================================
-- SECTION 5: MATERIAL TRANSACTION ITEMS
-- Purpose: Track material items in purchase orders and sales orders
-- =====================================================

CREATE TABLE IF NOT EXISTS public.tbltransaction_material_items (
  id BIGSERIAL PRIMARY KEY,
  trans_type VARCHAR(20) NOT NULL CHECK (trans_type IN ('purchase', 'sales')), -- purchase or sales
  material_id BIGINT NOT NULL REFERENCES public.tblmaterials(id) ON UPDATE CASCADE ON DELETE CASCADE,
  quantity BIGINT NOT NULL DEFAULT 0,
  unit_price NUMERIC(12, 2) DEFAULT 0, -- Cost price at time of transaction
  sell_price NUMERIC(12, 2) DEFAULT 0, -- Selling price at time of transaction
  discount_price NUMERIC(12, 2) DEFAULT 0,
  purchase_id INTEGER REFERENCES public.tblpurchase_orders(id) ON UPDATE CASCADE ON DELETE CASCADE,
  sales_id INTEGER REFERENCES public.tblsales_order(id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_transaction_material_purchase ON public.tbltransaction_material_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_transaction_material_sales ON public.tbltransaction_material_items(sales_id);
CREATE INDEX IF NOT EXISTS idx_transaction_material_material_id ON public.tbltransaction_material_items(material_id);

COMMENT ON TABLE public.tbltransaction_material_items IS 'Material items in purchase and sales transactions';


-- =====================================================
-- SECTION 6: SALES ORDER ENHANCEMENTS - PROJECT DETAILS
-- Purpose: Store project-specific information for project sales type
-- =====================================================

CREATE TABLE IF NOT EXISTS public.tblproject_details (
  id BIGSERIAL PRIMARY KEY,
  sales_id INTEGER NOT NULL REFERENCES public.tblsales_order(id) ON UPDATE CASCADE ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  project_code VARCHAR(50) UNIQUE,
  project_location TEXT,
  project_start_date DATE,
  project_end_date DATE,
  project_manager TEXT,
  project_status VARCHAR(20) DEFAULT 'ongoing' CHECK (project_status IN ('planning', 'ongoing', 'completed', 'cancelled')),
  project_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT tblproject_details_sales_id_key UNIQUE (sales_id)
);

CREATE INDEX IF NOT EXISTS idx_project_details_sales_id ON public.tblproject_details(sales_id);
CREATE INDEX IF NOT EXISTS idx_project_details_status ON public.tblproject_details(project_status);

COMMENT ON TABLE public.tblproject_details IS 'Project-specific details for project sales type';


-- =====================================================
-- SECTION 7: SERVICE DETAILS TABLE
-- Purpose: Store service information for service-related sales
-- =====================================================

CREATE TABLE IF NOT EXISTS public.tblservice_details (
  id BIGSERIAL PRIMARY KEY,
  sales_id INTEGER NOT NULL REFERENCES public.tblsales_order(id) ON UPDATE CASCADE ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  service_description TEXT,
  service_type VARCHAR(50), -- Installation, Maintenance, Repair, etc.
  technician_assigned TEXT,
  service_date DATE,
  service_duration_hours NUMERIC(5, 2),
  service_cost NUMERIC(12, 2) DEFAULT 0,
  parts_cost NUMERIC(12, 2) DEFAULT 0,
  labor_cost NUMERIC(12, 2) DEFAULT 0,
  service_status VARCHAR(20) DEFAULT 'scheduled' CHECK (service_status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  service_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_service_details_sales_id ON public.tblservice_details(sales_id);
CREATE INDEX IF NOT EXISTS idx_service_details_status ON public.tblservice_details(service_status);
CREATE INDEX IF NOT EXISTS idx_service_details_date ON public.tblservice_details(service_date);

COMMENT ON TABLE public.tblservice_details IS 'Service details for sales orders with service component';


-- =====================================================
-- SECTION 8: CONCERN DETAILS TABLE
-- Purpose: Store customer concerns and issues
-- =====================================================

CREATE TABLE IF NOT EXISTS public.tblconcern_details (
  id BIGSERIAL PRIMARY KEY,
  sales_id INTEGER REFERENCES public.tblsales_order(id) ON UPDATE CASCADE ON DELETE CASCADE,
  customer_id UUID REFERENCES public.tblcustomer(id) ON UPDATE CASCADE ON DELETE CASCADE,
  concern_type VARCHAR(50), -- Complaint, Inquiry, Technical Issue, etc.
  concern_subject TEXT NOT NULL,
  concern_description TEXT NOT NULL,
  concern_status VARCHAR(20) DEFAULT 'open' CHECK (concern_status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assigned_to BIGINT REFERENCES public.tblusers(id),
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_concern_details_sales_id ON public.tblconcern_details(sales_id);
CREATE INDEX IF NOT EXISTS idx_concern_details_customer_id ON public.tblconcern_details(customer_id);
CREATE INDEX IF NOT EXISTS idx_concern_details_status ON public.tblconcern_details(concern_status);

COMMENT ON TABLE public.tblconcern_details IS 'Customer concerns, complaints, and issues tracking';


-- =====================================================
-- SECTION 9: TRANSFER/DISTRIBUTION DETAILS
-- Purpose: Track branch-to-branch transfers
-- =====================================================

CREATE TABLE IF NOT EXISTS public.tbltransfer_details (
  id BIGSERIAL PRIMARY KEY,
  sales_id INTEGER NOT NULL REFERENCES public.tblsales_order(id) ON UPDATE CASCADE ON DELETE CASCADE,
  from_branch_id BIGINT NOT NULL REFERENCES public.tblbranches(id),
  to_branch_id BIGINT NOT NULL REFERENCES public.tblbranches(id),
  transfer_date DATE,
  expected_delivery_date DATE,
  actual_delivery_date DATE,
  transfer_status VARCHAR(20) DEFAULT 'pending' CHECK (transfer_status IN ('pending', 'in_transit', 'delivered', 'acknowledged', 'cancelled')),
  sent_by BIGINT REFERENCES public.tblusers(id),
  received_by BIGINT REFERENCES public.tblusers(id),
  acknowledged_by BIGINT REFERENCES public.tblusers(id),
  acknowledged_at TIMESTAMPTZ,
  transfer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT tbltr ansfer_details_sales_id_key UNIQUE (sales_id)
);

CREATE INDEX IF NOT EXISTS idx_transfer_details_from_branch ON public.tbltransfer_details(from_branch_id);
CREATE INDEX IF NOT EXISTS idx_transfer_details_to_branch ON public.tbltransfer_details(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_transfer_details_status ON public.tbltransfer_details(transfer_status);

COMMENT ON TABLE public.tbltransfer_details IS 'Branch-to-branch transfer/distribution tracking';


-- =====================================================
-- SECTION 10: EXPENSE DETAILS FOR TRANSFERS
-- Purpose: Track expenses related to transfers
-- =====================================================

CREATE TABLE IF NOT EXISTS public.tblexpense_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_id INTEGER REFERENCES public.tblsales_order(id) ON UPDATE CASCADE ON DELETE CASCADE,
  transfer_id BIGINT REFERENCES public.tbltransfer_details(id) ON UPDATE CASCADE ON DELETE CASCADE,
  expense_type VARCHAR(50) NOT NULL, -- Transportation, Handling, Insurance, etc.
  expense_description TEXT,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  expense_date DATE,
  paid_to TEXT,
  payment_method VARCHAR(50),
  reference_no VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES public.tblusers(id)
);

CREATE INDEX IF NOT EXISTS idx_expense_details_sales_id ON public.tblexpense_details(sales_id);
CREATE INDEX IF NOT EXISTS idx_expense_details_transfer_id ON public.tblexpense_details(transfer_id);

COMMENT ON TABLE public.tblexpense_details IS 'Expense tracking for transfers and distributions';


-- =====================================================
-- SECTION 11: CUSTOMER ENHANCEMENTS - SUB-DEALER FLAG
-- Purpose: Differentiate regular customers from sub-dealers
-- =====================================================

ALTER TABLE public.tblcustomer 
ADD COLUMN IF NOT EXISTS customer_type VARCHAR(20) DEFAULT 'regular' CHECK (customer_type IN ('regular', 'sub_dealer'));

ALTER TABLE public.tblcustomer 
ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12, 2) DEFAULT 0;

ALTER TABLE public.tblcustomer 
ADD COLUMN IF NOT EXISTS current_balance NUMERIC(12, 2) DEFAULT 0;

ALTER TABLE public.tblcustomer 
ADD COLUMN IF NOT EXISTS payment_terms INTEGER DEFAULT 0; -- Days

ALTER TABLE public.tblcustomer 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.tblcustomer 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tblcustomer_type ON public.tblcustomer(customer_type);

COMMENT ON COLUMN public.tblcustomer.customer_type IS 'Customer type: regular or sub_dealer';
COMMENT ON COLUMN public.tblcustomer.credit_limit IS 'Maximum credit allowed for sub-dealers';
COMMENT ON COLUMN public.tblcustomer.current_balance IS 'Current outstanding balance';


-- =====================================================
-- SECTION 12: CUSTOMER PAYMENT HISTORY
-- Purpose: Track all customer payments
-- =====================================================

CREATE TABLE IF NOT EXISTS public.tblcustomer_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.tblcustomer(id) ON UPDATE CASCADE ON DELETE CASCADE,
  sales_id INTEGER REFERENCES public.tblsales_order(id),
  payment_amount NUMERIC(12, 2) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method VARCHAR(50),
  reference_no VARCHAR(100),
  payment_notes TEXT,
  applied_to_balance NUMERIC(12, 2) DEFAULT 0, -- Amount applied to outstanding balance
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES public.tblusers(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_payments_customer_id ON public.tblcustomer_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_sales_id ON public.tblcustomer_payments(sales_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_date ON public.tblcustomer_payments(payment_date);

COMMENT ON TABLE public.tblcustomer_payments IS 'Customer payment history and tracking';


-- =====================================================
-- SECTION 13: STATEMENT OF ACCOUNT (SOA) TABLE
-- Purpose: Generate and store SOA for sub-dealers
-- =====================================================

CREATE TABLE IF NOT EXISTS public.tblstatement_of_account (
  id BIGSERIAL PRIMARY KEY,
  soa_number TEXT GENERATED ALWAYS AS ('SOA-' || LPAD(id::TEXT, 6, '0')) STORED,
  customer_id UUID NOT NULL REFERENCES public.tblcustomer(id) ON UPDATE CASCADE ON DELETE CASCADE,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  opening_balance NUMERIC(12, 2) DEFAULT 0,
  total_charges NUMERIC(12, 2) DEFAULT 0, -- New sales/charges
  total_payments NUMERIC(12, 2) DEFAULT 0,
  closing_balance NUMERIC(12, 2) DEFAULT 0,
  soa_status VARCHAR(20) DEFAULT 'draft' CHECK (soa_status IN ('draft', 'sent', 'paid', 'overdue')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by BIGINT REFERENCES public.tblusers(id),
  sent_at TIMESTAMPTZ,
  due_date DATE,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_soa_customer_id ON public.tblstatement_of_account(customer_id);
CREATE INDEX IF NOT EXISTS idx_soa_status ON public.tblstatement_of_account(soa_status);
CREATE INDEX IF NOT EXISTS idx_soa_period ON public.tblstatement_of_account(period_from, period_to);

COMMENT ON TABLE public.tblstatement_of_account IS 'Statement of Account for sub-dealers';


-- =====================================================
-- SECTION 14: ACCOUNTING - CHEQUE VOUCHER
-- Purpose: Manage cheque vouchers for disbursements
-- =====================================================

CREATE TABLE IF NOT EXISTS public.tblcheque_voucher (
  id BIGSERIAL PRIMARY KEY,
  cv_number TEXT GENERATED ALWAYS AS ('CV-' || LPAD(id::TEXT, 6, '0')) STORED,
  payee_name TEXT NOT NULL,
  payee_address TEXT,
  payee_tin VARCHAR(50),
  cheque_number VARCHAR(50),
  bank_name VARCHAR(100),
  cheque_date DATE,
  amount NUMERIC(12, 2) NOT NULL,
  amount_in_words TEXT,
  particulars TEXT NOT NULL, -- Description of payment
  account_code VARCHAR(50), -- Chart of accounts code
  category VARCHAR(50), -- Expense category
  payment_type VARCHAR(50), -- Supplier Payment, Salary, Utilities, etc.
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'issued', 'cleared', 'cancelled')),
  approved_by BIGINT REFERENCES public.tblusers(id),
  approved_at TIMESTAMPTZ,
  issued_by BIGINT REFERENCES public.tblusers(id),
  issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES public.tblusers(id),
  updated_at TIMESTAMPTZ,
  updated_by BIGINT REFERENCES public.tblusers(id)
);

CREATE INDEX IF NOT EXISTS idx_cheque_voucher_status ON public.tblcheque_voucher(status);
CREATE INDEX IF NOT EXISTS idx_cheque_voucher_date ON public.tblcheque_voucher(cheque_date);
CREATE INDEX IF NOT EXISTS idx_cheque_voucher_payee ON public.tblcheque_voucher(payee_name);

COMMENT ON TABLE public.tblcheque_voucher IS 'Cheque voucher management for disbursements';


-- =====================================================
-- SECTION 15: ACCOUNTING - GENERAL JOURNAL
-- Purpose: Record all accounting journal entries
-- =====================================================

CREATE TABLE IF NOT EXISTS public.tblgeneral_journal (
  id BIGSERIAL PRIMARY KEY,
  journal_number TEXT GENERATED ALWAYS AS ('JE-' || LPAD(id::TEXT, 6, '0')) STORED,
  journal_date DATE NOT NULL,
  reference_type VARCHAR(50), -- SO, PO, CV, Manual, etc.
  reference_id INTEGER, -- ID of related transaction
  reference_number TEXT,
  description TEXT NOT NULL,
  total_debit NUMERIC(12, 2) DEFAULT 0,
  total_credit NUMERIC(12, 2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  posted_at TIMESTAMPTZ,
  posted_by BIGINT REFERENCES public.tblusers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES public.tblusers(id)
);

CREATE INDEX IF NOT EXISTS idx_general_journal_date ON public.tblgeneral_journal(journal_date);
CREATE INDEX IF NOT EXISTS idx_general_journal_status ON public.tblgeneral_journal(status);
CREATE INDEX IF NOT EXISTS idx_general_journal_reference ON public.tblgeneral_journal(reference_type, reference_id);

COMMENT ON TABLE public.tblgeneral_journal IS 'General journal entries for accounting';


-- =====================================================
-- SECTION 16: ACCOUNTING - JOURNAL ENTRY LINES
-- Purpose: Detailed line items for journal entries
-- =====================================================

CREATE TABLE IF NOT EXISTS public.tbljournal_entry_lines (
  id BIGSERIAL PRIMARY KEY,
  journal_id BIGINT NOT NULL REFERENCES public.tblgeneral_journal(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  account_code VARCHAR(50) NOT NULL,
  account_name TEXT NOT NULL,
  description TEXT,
  debit_amount NUMERIC(12, 2) DEFAULT 0,
  credit_amount NUMERIC(12, 2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_journal_id ON public.tbljournal_entry_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON public.tbljournal_entry_lines(account_code);

COMMENT ON TABLE public.tbljournal_entry_lines IS 'Line items for general journal entries';


-- =====================================================
-- SECTION 17: ACCOUNTING - 2307 TAX REPORT
-- Purpose: Track withholding tax (BIR Form 2307)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.tbltax_2307 (
  id BIGSERIAL PRIMARY KEY,
  tax_year INTEGER NOT NULL,
  tax_quarter INTEGER CHECK (tax_quarter BETWEEN 1 AND 4),
  tax_month INTEGER CHECK (tax_month BETWEEN 1 AND 12),
  payee_name TEXT NOT NULL,
  payee_tin VARCHAR(50) NOT NULL,
  payee_address TEXT,
  income_payment_type VARCHAR(100), -- Professional Fees, Rental, etc.
  atc_code VARCHAR(10), -- Alphanumeric Tax Code
  gross_amount NUMERIC(12, 2) NOT NULL,
  tax_rate NUMERIC(5, 2) NOT NULL, -- Percentage
  tax_withheld NUMERIC(12, 2) NOT NULL,
  payment_date DATE,
  reference_type VARCHAR(50), -- CV, SO, PO
  reference_id INTEGER,
  reference_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES public.tblusers(id)
);

CREATE INDEX IF NOT EXISTS idx_tax_2307_year_quarter ON public.tbltax_2307(tax_year, tax_quarter);
CREATE INDEX IF NOT EXISTS idx_tax_2307_payee_tin ON public.tbltax_2307(payee_tin);
CREATE INDEX IF NOT EXISTS idx_tax_2307_date ON public.tbltax_2307(payment_date);

COMMENT ON TABLE public.tbltax_2307 IS 'BIR Form 2307 - Certificate of Creditable Tax Withheld at Source';


-- =====================================================
-- SECTION 18: PAYMENT TYPE ENHANCEMENT
-- Purpose: Differentiate sales payments from expenses
-- =====================================================

ALTER TABLE public.tblso_payments 
ADD COLUMN IF NOT EXISTS payment_type VARCHAR(20) DEFAULT 'sales' CHECK (payment_type IN ('sales', 'expense'));

ALTER TABLE public.tblso_payments 
ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_so_payments_type ON public.tblso_payments(payment_type);

COMMENT ON COLUMN public.tblso_payments.payment_type IS 'Payment type: sales for customer payments, expense for transfer expenses';


-- =====================================================
-- SECTION 19: RBAC ENHANCEMENT FOR ACCOUNTING
-- Purpose: Add accounting-specific permissions
-- =====================================================

-- Accounting permissions will be managed through existing tblrbac table
-- Sample permission keys for accounting:
-- - accounting.cheque_voucher.canCreate
-- - accounting.cheque_voucher.canRead
-- - accounting.cheque_voucher.canUpdate
-- - accounting.cheque_voucher.canDelete
-- - accounting.general_journal.canCreate
-- - accounting.reports.canView
-- - accounting.tax_2307.canGenerate

COMMENT ON TABLE public.tblrbac IS 'Role-based access control with support for accounting permissions';


-- =====================================================
-- SECTION 20: AUDIT LOG TABLE
-- Purpose: Track all important system changes
-- =====================================================

CREATE TABLE IF NOT EXISTS public.tblaudit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name VARCHAR(100) NOT NULL,
  record_id TEXT NOT NULL,
  action VARCHAR(20) NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'CANCEL')),
  old_values JSONB,
  new_values JSONB,
  changed_by BIGINT REFERENCES public.tblusers(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address VARCHAR(50),
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON public.tblaudit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_by ON public.tblaudit_log(changed_by);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON public.tblaudit_log(changed_at);

COMMENT ON TABLE public.tblaudit_log IS 'System-wide audit trail for tracking changes';


-- =====================================================
-- SECTION 21: HELPER FUNCTIONS
-- Purpose: Utility functions for common operations
-- =====================================================

-- Function to update material stock after purchase order approval
CREATE OR REPLACE FUNCTION update_material_stock_on_po_approval()
RETURNS TRIGGER AS $$
BEGIN
  -- Only update stock when status changes to APPROVED
  IF NEW.status = 'APPROVED' AND OLD.status != 'APPROVED' AND NEW.po_type = 'MATERIAL' THEN
    -- Update material stock from transaction items
    UPDATE public.tblmaterials m
    SET on_hand_stock = on_hand_stock + tmi.quantity,
        updated_at = NOW()
    FROM public.tbltransaction_material_items tmi
    WHERE tmi.purchase_id = NEW.id 
      AND tmi.material_id = m.id
      AND tmi.trans_type = 'purchase';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for material stock update
DROP TRIGGER IF EXISTS trg_update_material_stock_on_po_approval ON public.tblpurchase_orders;
CREATE TRIGGER trg_update_material_stock_on_po_approval
  AFTER UPDATE ON public.tblpurchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_material_stock_on_po_approval();

COMMENT ON FUNCTION update_material_stock_on_po_approval() IS 'Automatically update material stock when PO is approved';


-- Helper: Recalculate a customer balance based on sales orders and payments
CREATE OR REPLACE FUNCTION recalc_customer_balance(p_customer_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.tblcustomer
  SET current_balance = (
    -- total sales for the customer
    COALESCE(
      (SELECT SUM(total_amount) FROM public.tblsales_order WHERE customer_id = p_customer_id),
      0
    )
    -- subtract customer payments (legacy table)
    - COALESCE(
      (SELECT SUM(payment_amount) FROM public.tblcustomer_payments WHERE customer_id = p_customer_id),
      0
    )
    -- subtract sales order payments (current table, only paid ones)
    - COALESCE(
      (
        SELECT SUM(COALESCE(sp.amount, 0))
        FROM public.tblso_payments sp
        JOIN public.tblsales_order so ON so.id = sp.so_id
        WHERE so.customer_id = p_customer_id
          AND LOWER(COALESCE(sp.status, 'paid')) = 'paid'
          AND LOWER(COALESCE(sp.payment_type, 'sales')) = 'sales'
      ),
      0
    )
  ),
  updated_at = NOW()
  WHERE id = p_customer_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Update balance when a sales order changes
CREATE OR REPLACE FUNCTION update_customer_balance_on_sales()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    PERFORM recalc_customer_balance(NEW.customer_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_customer_balance_on_sales ON public.tblsales_order;
CREATE TRIGGER trg_update_customer_balance_on_sales
  AFTER INSERT OR UPDATE ON public.tblsales_order
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_balance_on_sales();

-- Trigger: Update balance when a customer payment record changes (legacy table)
CREATE OR REPLACE FUNCTION update_customer_balance_on_customer_payment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    PERFORM recalc_customer_balance(NEW.customer_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_customer_balance_on_payment ON public.tblcustomer_payments;
CREATE TRIGGER trg_update_customer_balance_on_payment
  AFTER INSERT OR UPDATE ON public.tblcustomer_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_balance_on_customer_payment();

-- Trigger: Update balance when a sales order payment is recorded/updated
CREATE OR REPLACE FUNCTION update_customer_balance_on_so_payment()
RETURNS TRIGGER AS $$
DECLARE
  v_customer_id UUID;
BEGIN
  -- Find customer for the associated sales order
  SELECT customer_id INTO v_customer_id FROM public.tblsales_order WHERE id = NEW.so_id;
  IF v_customer_id IS NOT NULL THEN
    PERFORM recalc_customer_balance(v_customer_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_customer_balance_on_so_payment ON public.tblso_payments;
CREATE TRIGGER trg_update_customer_balance_on_so_payment
  AFTER INSERT OR UPDATE ON public.tblso_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_balance_on_so_payment();

COMMENT ON FUNCTION recalc_customer_balance(UUID) IS 'Recalculates a customer''s current balance based on sales orders and paid payments';
COMMENT ON FUNCTION update_customer_balance_on_sales() IS 'Trigger: recalc balance when a sales order changes';
COMMENT ON FUNCTION update_customer_balance_on_customer_payment() IS 'Trigger: recalc balance when a customer payment record changes (legacy)';
COMMENT ON FUNCTION update_customer_balance_on_so_payment() IS 'Trigger: recalc balance when a sales order payment record changes';


-- =====================================================
-- SECTION 22: SAMPLE DATA INSERTS (Optional)
-- Purpose: Insert sample data for testing
-- =====================================================

-- Insert sample material brands (commented out - uncomment if needed)
-- INSERT INTO public.tblbrands (brandName, prefix, type) VALUES
-- ('Generic Materials', 'GEN', 'MAT'),
-- ('Premium Pipes Co.', 'PPC', 'MAT'),
-- ('ElectroWire Inc.', 'EWI', 'MAT')
-- ON CONFLICT DO NOTHING;


-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================

-- Verify migration
DO $$
BEGIN
  RAISE NOTICE 'Migration 20260310_material_inventory_enhancement completed successfully!';
  RAISE NOTICE 'Tables created: tblmaterials, tblproject_details, tblservice_details, tblconcern_details, tbltransfer_details, tblexpense_details, tblcustomer_payments, tblstatement_of_account, tblcheque_voucher, tblgeneral_journal, tbljournal_entry_lines, tbltax_2307, tblaudit_log';
  RAISE NOTICE 'Enhancements: Brand types, PO types, Customer types, Payment types';
  RAISE NOTICE 'Triggers: Material stock update, Customer balance update';
END $$;
