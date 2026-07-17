ALTER TABLE "events" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "events_type_processed_idx" ON "events" USING btree ("event_type","processed_at");