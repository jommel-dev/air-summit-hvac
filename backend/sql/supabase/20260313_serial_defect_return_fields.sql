-- Add new fields to tblserial_numbers for defect and return tracking
ALTER TABLE public.tblserial_numbers
ADD COLUMN IF NOT EXISTS "isDefective" boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS "isReturned" boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS "defectReason" text,
ADD COLUMN IF NOT EXISTS "returnReason" text,
ADD COLUMN IF NOT EXISTS "defectDate" timestamp with time zone,
ADD COLUMN IF NOT EXISTS "returnDate" timestamp with time zone;

-- Add comments for documentation
COMMENT ON COLUMN public.tblserial_numbers."isDefective" IS 'Flag indicating if the serial number is defective';
COMMENT ON COLUMN public.tblserial_numbers."isReturned" IS 'Flag indicating if the serial number has been returned';
COMMENT ON COLUMN public.tblserial_numbers."defectReason" IS 'Reason for defect if isDefective is true';
COMMENT ON COLUMN public.tblserial_numbers."returnReason" IS 'Reason for return if isReturned is true';
COMMENT ON COLUMN public.tblserial_numbers."defectDate" IS 'Date when defect was recorded';
COMMENT ON COLUMN public.tblserial_numbers."returnDate" IS 'Date when return was recorded';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tblserial_numbers_isDefective ON public.tblserial_numbers("isDefective") WHERE "isDefective" = true;
CREATE INDEX IF NOT EXISTS idx_tblserial_numbers_isReturned ON public.tblserial_numbers("isReturned") WHERE "isReturned" = true;