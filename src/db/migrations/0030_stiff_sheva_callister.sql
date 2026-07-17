-- Defensive dedupe (C5): getNextInvoiceNumber() has always upserted via
-- ON CONFLICT (tenant_id, series_type, financial_year), but no unique
-- constraint on that combination existed until this migration — so this
-- table may already hold duplicate rows for the same tenant+type+year if
-- that race was ever actually hit. Keep the row with the highest
-- last_number (the most-advanced series state) per group and delete the
-- rest, so the CREATE UNIQUE INDEX below is safe to apply regardless of
-- whether prod has ever hit this race.
DELETE FROM "invoice_series" a
USING "invoice_series" b
WHERE a.tenant_id = b.tenant_id
  AND a.series_type = b.series_type
  AND a.financial_year = b.financial_year
  AND (a.last_number < b.last_number
       OR (a.last_number = b.last_number AND a.id < b.id));
--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_series_tenant_type_fy_uniq_idx" ON "invoice_series" USING btree ("tenant_id","series_type","financial_year");
