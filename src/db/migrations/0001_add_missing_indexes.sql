-- ===========================================================================
-- Migration 0001: Add missing indexes on hot query paths
-- 
-- These indexes are additive (CREATE INDEX IF NOT EXISTS) and safe to run
-- on a live database. They address performance bottlenecks identified in
-- the code review where frequently-filtered columns had no index.
--
-- Key improvements:
--   - Composite indexes for multi-column WHERE clauses (tenant_id + status)
--   - Covering indexes for list + timeline queries (including ORDER BY cols)
--   - Foreign-key columns missing indexes (invoice_id, client_id, user_id)
-- ===========================================================================

-- contacts: hot path = WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS contacts_tenant_status_idx ON contacts(tenant_id, status);
CREATE INDEX IF NOT EXISTS contacts_tenant_created_idx ON contacts(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contacts_assigned_to_idx ON contacts(assigned_to);
CREATE INDEX IF NOT EXISTS contacts_last_activity_idx ON contacts(last_activity_at DESC);

-- events: hot path = WHERE contact_id = $1 ORDER BY occurred_at DESC
-- (separate single-col indexes force a sort; composite avoids it)
CREATE INDEX IF NOT EXISTS events_contact_occurred_idx ON events(contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_tenant_created_idx ON events(tenant_id, created_at DESC);

-- messages: hot path = WHERE contact_id = $1 ORDER BY sent_at DESC
CREATE INDEX IF NOT EXISTS messages_contact_sent_idx ON messages(contact_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS messages_tenant_idx ON messages(tenant_id);

-- deals: hot path = WHERE tenant_id = $1 AND pipeline_id = $2 ORDER BY updated_at
CREATE INDEX IF NOT EXISTS deals_tenant_pipeline_idx ON deals(tenant_id, pipeline_id);
CREATE INDEX IF NOT EXISTS deals_tenant_stage_idx ON deals(tenant_id, stage);
CREATE INDEX IF NOT EXISTS deals_updated_at_idx ON deals(updated_at DESC);

-- tasks: NO indexes existed — add the essentials
CREATE INDEX IF NOT EXISTS tasks_tenant_id_idx ON tasks(tenant_id);
CREATE INDEX IF NOT EXISTS tasks_tenant_status_idx ON tasks(tenant_id, status);
CREATE INDEX IF NOT EXISTS tasks_assigned_to_idx ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS tasks_contact_id_idx ON tasks(contact_id);
CREATE INDEX IF NOT EXISTS tasks_deal_id_idx ON tasks(deal_id);
CREATE INDEX IF NOT EXISTS tasks_list_id_idx ON tasks(list_id);
CREATE INDEX IF NOT EXISTS tasks_due_at_idx ON tasks(due_at);

-- bookings: NO indexes existed
CREATE INDEX IF NOT EXISTS bookings_tenant_id_idx ON bookings(tenant_id);
CREATE INDEX IF NOT EXISTS bookings_contact_id_idx ON bookings(contact_id);
CREATE INDEX IF NOT EXISTS bookings_status_scheduled_idx ON bookings(status, scheduled_at);

-- contact_notes: NO indexes existed
CREATE INDEX IF NOT EXISTS contact_notes_contact_id_idx ON contact_notes(contact_id);
CREATE INDEX IF NOT EXISTS contact_notes_tenant_id_idx ON contact_notes(tenant_id);
CREATE INDEX IF NOT EXISTS contact_notes_created_at_idx ON contact_notes(created_at DESC);

-- invoices: NO indexes existed
CREATE INDEX IF NOT EXISTS invoices_tenant_id_idx ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS invoices_tenant_status_idx ON invoices(tenant_id, status);
CREATE INDEX IF NOT EXISTS invoices_client_id_idx ON invoices(client_id);
CREATE INDEX IF NOT EXISTS invoices_invoice_date_idx ON invoices(invoice_date DESC);
CREATE INDEX IF NOT EXISTS invoices_recurring_source_idx ON invoices(recurring_source_id);

-- invoice_line_items: NO indexes existed
CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_id_idx ON invoice_line_items(invoice_id);

-- payments: NO indexes existed
CREATE INDEX IF NOT EXISTS payments_invoice_id_idx ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS payments_client_id_idx ON payments(client_id);
CREATE INDEX IF NOT EXISTS payments_tenant_id_idx ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS payments_payment_date_idx ON payments(payment_date DESC);

-- users: missing tenant index for listing users within a tenant
CREATE INDEX IF NOT EXISTS users_tenant_id_idx ON users(tenant_id);

-- user_permissions: NO indexes existed
CREATE INDEX IF NOT EXISTS user_permissions_user_id_idx ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS user_permissions_tenant_id_idx ON user_permissions(tenant_id);

-- password_reset_tokens: NO indexes existed — token lookup must be fast
CREATE INDEX IF NOT EXISTS password_reset_tokens_token_idx ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx ON password_reset_tokens(expires_at);

-- billing_clients: NO indexes existed
CREATE INDEX IF NOT EXISTS billing_clients_tenant_id_idx ON billing_clients(tenant_id);
CREATE INDEX IF NOT EXISTS billing_clients_active_idx ON billing_clients(tenant_id, is_active);

-- social_accounts: NO indexes existed
CREATE INDEX IF NOT EXISTS social_accounts_tenant_id_idx ON social_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS social_accounts_tenant_active_idx ON social_accounts(tenant_id, is_active);

-- social_posts: NO indexes existed
CREATE INDEX IF NOT EXISTS social_posts_tenant_id_idx ON social_posts(tenant_id);
CREATE INDEX IF NOT EXISTS social_posts_status_scheduled_idx ON social_posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS social_posts_social_account_id_idx ON social_posts(social_account_id);

-- marketing_accounts: NO indexes existed
CREATE INDEX IF NOT EXISTS marketing_accounts_tenant_id_idx ON marketing_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS marketing_accounts_tenant_active_idx ON marketing_accounts(tenant_id, is_active);