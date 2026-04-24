-- 0015: Add discount fields to invoices + structured services column to billing_clients
--
-- Why: supports the "Discount" UI on invoices (fixed amount or percent-off with a label)
-- and a multi-select Services column on clients for analytics ("which services earn the
-- most MRR"). Both additive + nullable/default-zero, safe for existing rows.

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "discount_type"    text,
  ADD COLUMN IF NOT EXISTS "discount_percent" real    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discount_amount"  integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discount_label"   text;

ALTER TABLE "billing_clients"
  ADD COLUMN IF NOT EXISTS "services" text[] DEFAULT '{}'::text[];
