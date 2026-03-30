-- Migration: Add previousSalesId to tblserial_numbers for transfer traceability
ALTER TABLE public.tblserial_numbers
ADD COLUMN "previousSalesId" bigint NULL;

ALTER TABLE public.tblserial_numbers
ADD CONSTRAINT tblserial_numbers_previousSalesId_fkey FOREIGN KEY ("previousSalesId") REFERENCES tblsales_order (id) ON UPDATE CASCADE ON DELETE SET NULL;