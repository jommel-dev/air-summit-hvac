-- Migration: Link Purchase Order to Sales Order for hybrid transfer workflow
ALTER TABLE public.tblpurchase_orders
ADD COLUMN IF NOT EXISTS linked_sales_order_id INTEGER REFERENCES public.tblsales_order(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- (Optional) Link Sales Order to Purchase Order for bidirectional reference
ALTER TABLE public.tblsales_order
ADD COLUMN IF NOT EXISTS linked_purchase_order_id INTEGER REFERENCES public.tblpurchase_orders(id) ON UPDATE CASCADE ON DELETE SET NULL;
