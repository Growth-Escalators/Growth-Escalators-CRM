-- Seed Jatin's owner permissions
INSERT INTO user_permissions (
  user_id, tenant_id, is_owner,
  contacts_view, contacts_create, contacts_edit, contacts_delete, contacts_export, contacts_bulk,
  pipeline_view, pipeline_create, pipeline_edit, pipeline_delete, pipeline_manage,
  billing_view, billing_create, billing_edit, billing_mark_paid, billing_view_mrr, billing_download, billing_manage_clients,
  automations_view, automations_trigger,
  reports_view, reports_meta_ads,
  settings_users, settings_pipelines, settings_templates, settings_billing
)
SELECT
  u.id, t.id, true,
  true, true, true, true, true, true,
  true, true, true, true, true,
  true, true, true, true, true, true, true,
  true, true,
  true, true,
  true, true, true, true
FROM users u
JOIN tenants t ON t.slug = 'growth-escalators'
WHERE u.email = 'jatin@growthescalators.com'
ON CONFLICT DO NOTHING;

-- Seed Paraiso Comfortwear billing client
INSERT INTO billing_clients (
  tenant_id, name, contact_person, email,
  address_line1, city, state, state_code, pincode,
  is_gst, gstin, tax_type,
  retainer_amount, service_description, sac_code, invoice_day_of_month, is_active
)
SELECT
  t.id, 'Paraiso Comfortwear', 'Sandeep', 'sandeep@paraisocomfortwear.com',
  '123 MG Road, Ernakulam', 'Ernakulam', 'Kerala', '32', '682016',
  true, '32AABCP1234A1ZX', 'igst',
  2500000, 'Digital Marketing and Meta Ads Management', '9983', 1, true
FROM tenants t
WHERE t.slug = 'growth-escalators'
AND NOT EXISTS (
  SELECT 1 FROM billing_clients bc2
  JOIN tenants t2 ON t2.id = bc2.tenant_id
  WHERE t2.slug = 'growth-escalators' AND bc2.name = 'Paraiso Comfortwear'
);

-- Seed invoice series counters
INSERT INTO invoice_series (tenant_id, series_type, financial_year, last_number)
SELECT t.id, 'gst', '2026-27', 0
FROM tenants t WHERE t.slug = 'growth-escalators'
AND NOT EXISTS (
  SELECT 1 FROM invoice_series s2
  JOIN tenants t2 ON t2.id = s2.tenant_id
  WHERE t2.slug = 'growth-escalators' AND s2.series_type = 'gst' AND s2.financial_year = '2026-27'
);

INSERT INTO invoice_series (tenant_id, series_type, financial_year, last_number)
SELECT t.id, 'non_gst', '2026-27', 0
FROM tenants t WHERE t.slug = 'growth-escalators'
AND NOT EXISTS (
  SELECT 1 FROM invoice_series s2
  JOIN tenants t2 ON t2.id = s2.tenant_id
  WHERE t2.slug = 'growth-escalators' AND s2.series_type = 'non_gst' AND s2.financial_year = '2026-27'
);
