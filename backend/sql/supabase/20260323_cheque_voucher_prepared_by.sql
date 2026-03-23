-- Add prepared_by column to tblcheque_vouchers to track who released each voucher

ALTER TABLE tblcheque_vouchers
  ADD COLUMN IF NOT EXISTS prepared_by TEXT;
