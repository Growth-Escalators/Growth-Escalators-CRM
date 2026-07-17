-- ===========================================================================
-- M9 (Fable review) — folds two pre-existing migration files that were
-- never wired into _journal.json, so drizzle's migrator has skipped them on
-- every environment, always: 0001_add_missing_indexes.sql and
-- 0004_indexes.sql. Their contents are reproduced verbatim below, deduped
-- (contact_notes_contact_id_idx was defined in both). Every statement is
-- CREATE INDEX IF NOT EXISTS, so this is a safe no-op anywhere the indexes
-- already exist (e.g. if they were applied by hand at some point) and a
-- real fix for any environment that only ever ran the journaled migrations
-- (fresh dev DB, disaster-recovery restore) — those never got these indexes
-- at all, degrading contacts/events/messages/deals/tasks/... queries from
-- day one.
-- ===========================================================================

-- --- from 0001_add_missing_indexes.sql ---
CREATE INDEX IF NOT EXISTS contacts_tenant_status_idx ON contacts(tenant_id, status);
CREATE INDEX IF NOT EXISTS contacts_tenant_created_idx ON contacts(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contacts_assigned_to_idx ON contacts(assigned_to);
CREATE INDEX IF NOT EXISTS contacts_last_activity_idx ON contacts(last_activity_at DESC);

CREATE INDEX IF NOT EXISTS events_contact_occurred_idx ON events(contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_tenant_created_idx ON events(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS messages_contact_sent_idx ON messages(contact_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS messages_tenant_idx ON messages(tenant_id);

CREATE INDEX IF NOT EXISTS deals_tenant_pipeline_idx ON deals(tenant_id, pipeline_id);
CREATE INDEX IF NOT EXISTS deals_tenant_stage_idx ON deals(tenant_id, stage);
CREATE INDEX IF NOT EXISTS deals_updated_at_idx ON deals(updated_at DESC);

CREATE INDEX IF NOT EXISTS tasks_tenant_id_idx ON tasks(tenant_id);
CREATE INDEX IF NOT EXISTS tasks_tenant_status_idx ON tasks(tenant_id, status);
CREATE INDEX IF NOT EXISTS tasks_assigned_to_idx ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS tasks_contact_id_idx ON tasks(contact_id);
CREATE INDEX IF NOT EXISTS tasks_deal_id_idx ON tasks(deal_id);
CREATE INDEX IF NOT EXISTS tasks_list_id_idx ON tasks(list_id);
CREATE INDEX IF NOT EXISTS tasks_due_at_idx ON tasks(due_at);

CREATE INDEX IF NOT EXISTS bookings_tenant_id_idx ON bookings(tenant_id);
CREATE INDEX IF NOT EXISTS bookings_contact_id_idx ON bookings(contact_id);
CREATE INDEX IF NOT EXISTS bookings_status_scheduled_idx ON bookings(status, scheduled_at);

CREATE INDEX IF NOT EXISTS contact_notes_contact_id_idx ON contact_notes(contact_id);
CREATE INDEX IF NOT EXISTS contact_notes_tenant_id_idx ON contact_notes(tenant_id);
CREATE INDEX IF NOT EXISTS contact_notes_created_at_idx ON contact_notes(created_at DESC);

CREATE INDEX IF NOT EXISTS invoices_tenant_id_idx ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS invoices_tenant_status_idx ON invoices(tenant_id, status);
CREATE INDEX IF NOT EXISTS invoices_client_id_idx ON invoices(client_id);
CREATE INDEX IF NOT EXISTS invoices_invoice_date_idx ON invoices(invoice_date DESC);
CREATE INDEX IF NOT EXISTS invoices_recurring_source_idx ON invoices(recurring_source_id);

CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_id_idx ON invoice_line_items(invoice_id);

CREATE INDEX IF NOT EXISTS payments_invoice_id_idx ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS payments_client_id_idx ON payments(client_id);
CREATE INDEX IF NOT EXISTS payments_tenant_id_idx ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS payments_payment_date_idx ON payments(payment_date DESC);

CREATE INDEX IF NOT EXISTS users_tenant_id_idx ON users(tenant_id);

CREATE INDEX IF NOT EXISTS user_permissions_user_id_idx ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS user_permissions_tenant_id_idx ON user_permissions(tenant_id);

CREATE INDEX IF NOT EXISTS password_reset_tokens_token_idx ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx ON password_reset_tokens(expires_at);

CREATE INDEX IF NOT EXISTS billing_clients_tenant_id_idx ON billing_clients(tenant_id);
CREATE INDEX IF NOT EXISTS billing_clients_active_idx ON billing_clients(tenant_id, is_active);

CREATE INDEX IF NOT EXISTS social_accounts_tenant_id_idx ON social_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS social_accounts_tenant_active_idx ON social_accounts(tenant_id, is_active);

CREATE INDEX IF NOT EXISTS social_posts_tenant_id_idx ON social_posts(tenant_id);
CREATE INDEX IF NOT EXISTS social_posts_status_scheduled_idx ON social_posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS social_posts_social_account_id_idx ON social_posts(social_account_id);

CREATE INDEX IF NOT EXISTS marketing_accounts_tenant_id_idx ON marketing_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS marketing_accounts_tenant_active_idx ON marketing_accounts(tenant_id, is_active);

-- --- from 0004_indexes.sql (contact_notes_contact_id_idx dropped — exact
-- name duplicate of the one above) ---
-- messages_tenant_id_idx is a second, differently-named index covering the
-- same single column as messages_tenant_idx above (from 0001) — redundant
-- but harmless; kept for fidelity to what 0004 actually defined rather than
-- unilaterally deciding it's safe to drop.
CREATE INDEX IF NOT EXISTS messages_tenant_id_idx ON messages(tenant_id);
CREATE INDEX IF NOT EXISTS deals_contact_pipeline_idx ON deals(contact_id, pipeline_id);
