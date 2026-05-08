-- Migration: Add previousPurchaseId column to tblserial_numbers
-- Purpose: Track the previous purchase order assignment when serials are
--          reassigned between POs via CSV batch import.
-- Requirements: 6.4

ALTER TABLE public.tblserial_numbers
  ADD COLUMN IF NOT EXISTS "previousPurchaseId" INTEGER NULL;

ALTER TABLE public.tblserial_numbers
  ADD CONSTRAINT tblserial_numbers_previousPurchaseId_fkey
  FOREIGN KEY ("previousPurchaseId")
  REFERENCES public.tblpurchase_orders(id)
  ON UPDATE CASCADE
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tblserial_numbers_previousPurchaseId
  ON public.tblserial_numbers("previousPurchaseId")
  WHERE "previousPurchaseId" IS NOT NULL;
