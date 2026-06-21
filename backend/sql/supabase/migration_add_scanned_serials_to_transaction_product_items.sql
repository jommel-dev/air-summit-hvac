ALTER TABLE public.tbltransaction_product_items
ADD COLUMN IF NOT EXISTS "scannedSerials" JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.tbltransaction_product_items
SET "scannedSerials" = '{}'::jsonb
WHERE "scannedSerials" IS NULL;

ALTER TABLE public.tbltransaction_product_items
ALTER COLUMN "scannedSerials" SET DEFAULT '{}'::jsonb;

ALTER TABLE public.tbltransaction_product_items
ALTER COLUMN "scannedSerials" SET NOT NULL;