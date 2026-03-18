-- Migration: Backfill branchId for legacy records
-- Purpose: Assign all existing purchase orders and sales orders without branchId to the default branch
-- 
-- IMPORTANT: Replace '1' with your actual default branch ID before running
-- Run this query to see available branches:
-- SELECT id, "branchName" FROM public.tblbranches ORDER BY id;

-- Step 1: Check how many records need backfilling BEFORE update
SELECT 'BEFORE UPDATE - Purchase Orders' as status, COUNT(*) as records_without_branchid
FROM public.tblpurchase_orders 
WHERE "branchId" IS NULL
UNION ALL
SELECT 'BEFORE UPDATE - Sales Orders' as status, COUNT(*) as records_without_branchid
FROM public.tblsales_order 
WHERE "branchId" IS NULL;

-- Step 2: Backfill Purchase Orders (change '1' to your default branch ID)
UPDATE public.tblpurchase_orders 
SET "branchId" = 1
WHERE "branchId" IS NULL;

-- Step 3: Backfill Sales Orders (change '1' to your default branch ID)
UPDATE public.tblsales_order 
SET "branchId" = 1
WHERE "branchId" IS NULL;

-- Step 4: Verify the updates AFTER update
SELECT 'AFTER UPDATE - Purchase Orders' as status, COUNT(*) as records_without_branchid
FROM public.tblpurchase_orders 
WHERE "branchId" IS NULL
UNION ALL
SELECT 'AFTER UPDATE - Sales Orders' as status, COUNT(*) as records_without_branchid
FROM public.tblsales_order 
WHERE "branchId" IS NULL;

-- Step 5: Show final record counts with branchId
SELECT 'Purchase Orders' as record_type, COUNT(*) as total, 
       SUM(CASE WHEN "branchId" IS NULL THEN 1 ELSE 0 END) as null_count,
       SUM(CASE WHEN "branchId" IS NOT NULL THEN 1 ELSE 0 END) as with_branchid
FROM public.tblpurchase_orders
UNION ALL
SELECT 'Sales Orders' as record_type, COUNT(*) as total,
       SUM(CASE WHEN "branchId" IS NULL THEN 1 ELSE 0 END) as null_count,
       SUM(CASE WHEN "branchId" IS NOT NULL THEN 1 ELSE 0 END) as with_branchid
FROM public.tblsales_order;
