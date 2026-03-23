-- Accounting live backend tables for Cheque Voucher workflow

CREATE TABLE IF NOT EXISTS tblaccount_titles (
  id BIGSERIAL PRIMARY KEY,
  account_number VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tblaccount_titles_number_description
  ON tblaccount_titles (account_number, description);

CREATE TABLE IF NOT EXISTS tblcheque_vouchers (
  id BIGSERIAL PRIMARY KEY,
  cv_no VARCHAR(32) NOT NULL UNIQUE,
  voucher_type VARCHAR(120) NOT NULL,
  payee TEXT NOT NULL DEFAULT '',
  voucher_date DATE NOT NULL,
  tin_number TEXT,
  address TEXT,
  zip_code TEXT,
  particulars TEXT,
  released_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tblcheque_voucher_deposits (
  id BIGSERIAL PRIMARY KEY,
  voucher_id BIGINT NOT NULL REFERENCES tblcheque_vouchers(id) ON DELETE CASCADE,
  bank_name TEXT,
  cheque_no TEXT,
  cheque_date DATE,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tblcheque_voucher_invoices (
  id BIGSERIAL PRIMARY KEY,
  voucher_id BIGINT NOT NULL REFERENCES tblcheque_vouchers(id) ON DELETE CASCADE,
  invoice_no TEXT,
  invoice_date DATE,
  description TEXT,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tblcheque_voucher_account_titles (
  id BIGSERIAL PRIMARY KEY,
  voucher_id BIGINT NOT NULL REFERENCES tblcheque_vouchers(id) ON DELETE CASCADE,
  account_title_id BIGINT REFERENCES tblaccount_titles(id),
  account_number VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  debit NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblcheque_vouchers_voucher_date
  ON tblcheque_vouchers (voucher_date);

CREATE INDEX IF NOT EXISTS idx_tblcheque_voucher_deposits_voucher_id
  ON tblcheque_voucher_deposits (voucher_id);

CREATE INDEX IF NOT EXISTS idx_tblcheque_voucher_invoices_voucher_id
  ON tblcheque_voucher_invoices (voucher_id);

CREATE INDEX IF NOT EXISTS idx_tblcheque_voucher_account_titles_voucher_id
  ON tblcheque_voucher_account_titles (voucher_id);

INSERT INTO tblaccount_titles (account_number, description, is_active)
VALUES
  ('11001', 'Cash In Bank', TRUE),
  ('14001', 'Purchases', TRUE),
  ('14010', 'Input Tax', TRUE),
  ('12001', 'Expanded Withholding Tax', TRUE),
  ('15001', 'DC-Outside Services', TRUE),
  ('15002', 'DC-Materials', TRUE),
  ('15003', 'DC-Others', TRUE)
ON CONFLICT (account_number, description) DO UPDATE
SET
  is_active = TRUE,
  updated_at = NOW();
