-- Fix Sakcham user record: correct name and email
UPDATE users
SET name = 'Sakcham', email = 'sakcham@growthescalators.com'
WHERE name ILIKE '%sak%';
--> statement-breakpoint
-- Fix funnel_members
UPDATE funnel_members
SET member_name = 'Sakcham'
WHERE calcom_url LIKE '%sakcham-ge%';
