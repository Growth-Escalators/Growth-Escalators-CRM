-- Seed/update 5 core email templates for Growth Escalators
-- Uses ON CONFLICT on (tenant_id, name) unique index

INSERT INTO email_templates (tenant_id, name, display_name, type, subject, from_name, body_html, brevo_template_id, is_active)
SELECT t.id,
  'welcome_d2c',
  'Welcome D2C',
  'sequence',
  'Your D2C Funnel Breakdown is ready 🎉',
  'Jatin from Growth Escalators',
  '<p>Hey {{params.firstName}},</p><p>Your D2C Funnel Breakdown Pack just landed.</p><p>But before you dive in — here''s the one thing most D2C brands get wrong on Meta Ads:</p><p><strong>They optimise for clicks. Not customers.</strong></p><p>The brands doing 3x-5x ROAS consistently? They build funnels that qualify buyers before the click — not after.</p><p>That''s exactly what we break down in the pack.</p><p>Open it, <strong>read page 12 first</strong>. That''s where most people have their first aha moment.</p><p>Talk soon,<br><strong>Jatin</strong><br>Growth Escalators</p><p><em>P.S. Reply "audit" if you want us to review your current funnel personally.</em></p>',
  2, true
FROM tenants t WHERE t.slug = 'growth-escalators'
ON CONFLICT (tenant_id, name)
DO UPDATE SET subject = EXCLUDED.subject, body_html = EXCLUDED.body_html, brevo_template_id = EXCLUDED.brevo_template_id, updated_at = now();
--> statement-breakpoint
INSERT INTO email_templates (tenant_id, name, display_name, type, subject, from_name, body_html, brevo_template_id, is_active)
SELECT t.id,
  'followup_day3',
  'Follow-up Day 3',
  'sequence',
  'The #1 reason D2C ads stop working (it''s not what you think)',
  'Jatin from Growth Escalators',
  '<p>Hey {{params.firstName}},</p><p>When Meta Ads stop working, most brands do one of three things:</p><p>→ Change the creative<br>→ Increase the budget<br>→ Test new audiences</p><p>But 80% of the time? The problem is <strong>offer clarity</strong>.</p><p>We call this the Offer Gap. And it kills more D2C brands than any algorithm change ever will.</p><p>Pages 18-24 of the pack cover exactly how to close it.</p><p>If you want to see how this applies to your brand — I have a few strategy call slots open this week.</p><p style="margin:20px 0;"><a href="https://web-production-311da.up.railway.app/book/d2c-strategy" style="background:#F47B20;color:#ffffff;padding:12px 28px;text-decoration:none;border-radius:4px;font-weight:bold;display:inline-block;">Book Your Free Strategy Call</a></p><p><strong>Jatin</strong><br>Growth Escalators</p>',
  3, true
FROM tenants t WHERE t.slug = 'growth-escalators'
ON CONFLICT (tenant_id, name)
DO UPDATE SET subject = EXCLUDED.subject, body_html = EXCLUDED.body_html, brevo_template_id = EXCLUDED.brevo_template_id, updated_at = now();
--> statement-breakpoint
INSERT INTO email_templates (tenant_id, name, display_name, type, subject, from_name, body_html, brevo_template_id, is_active)
SELECT t.id,
  'nudge_day7',
  'Nudge Day 7',
  'sequence',
  'Still thinking about it? Here''s what happened',
  'Jatin from Growth Escalators',
  '<p>Hey {{params.firstName}},</p><p>A brand spending ₹8L/month on Meta Ads came to us with 1.2x ROAS. We found 3 things:</p><p>1. TOF creative attracting browsers, not buyers<br>2. Landing page had 6 CTAs — confusion kills conversions<br>3. Retargeting window was 180 days — way too cold</p><p><strong>60 days later: 2.8x ROAS. Same budget. Different system.</strong></p><p>If you''re not seeing consistent 3x+ ROAS, I''d love to show you what''s holding you back.</p><p style="margin:20px 0;"><a href="https://web-production-311da.up.railway.app/book/d2c-strategy" style="background:#1B2E5E;color:#ffffff;padding:12px 28px;text-decoration:none;border-radius:4px;font-weight:bold;display:inline-block;">Book Free Strategy Call →</a></p><p><strong>Jatin</strong><br>Growth Escalators</p>',
  4, true
FROM tenants t WHERE t.slug = 'growth-escalators'
ON CONFLICT (tenant_id, name)
DO UPDATE SET subject = EXCLUDED.subject, body_html = EXCLUDED.body_html, brevo_template_id = EXCLUDED.brevo_template_id, updated_at = now();
--> statement-breakpoint
INSERT INTO email_templates (tenant_id, name, display_name, type, subject, from_name, body_html, brevo_template_id, is_active)
SELECT t.id,
  'appointment_confirm',
  'Appointment Confirmed',
  'transactional',
  'Your strategy call is confirmed ✅',
  'Jatin from Growth Escalators',
  '<p>Hey {{params.firstName}},</p><p>Your free D2C strategy call with Jatin is confirmed.</p><p>📅 <strong>{{params.callDate}}</strong><br>⏰ <strong>{{params.callTime}} IST</strong></p><p>To make the most of 30 minutes, come prepared with:</p><p>→ Your current monthly Meta Ads spend<br>→ Your current ROAS (approximate is fine)<br>→ Your biggest frustration with your ads right now</p><p>See you soon,<br><strong>Jatin</strong><br>Growth Escalators</p><p><em>You''ll also get a WhatsApp reminder 24 hours before the call.</em></p>',
  5, true
FROM tenants t WHERE t.slug = 'growth-escalators'
ON CONFLICT (tenant_id, name)
DO UPDATE SET subject = EXCLUDED.subject, body_html = EXCLUDED.body_html, brevo_template_id = EXCLUDED.brevo_template_id, updated_at = now();
--> statement-breakpoint
INSERT INTO email_templates (tenant_id, name, display_name, type, subject, from_name, body_html, brevo_template_id, is_active)
SELECT t.id,
  'proposal_followup',
  'Proposal Follow-up',
  'transactional',
  'Following up on our conversation',
  'Jatin from Growth Escalators',
  '<p>Hey {{params.firstName}},</p><p>It was great connecting with you.</p><p>Based on our call, here''s what I believe is possible in the next 90 days:</p><p>→ Improve ROAS consistently<br>→ Reduce cost per purchase by 30-40%<br>→ Build a repeatable funnel that scales without breaking</p><p>The proposal covers exactly how we''d get there.</p><p>If you have any questions — just reply here and I''ll answer personally.</p><p>Looking forward to working together.<br><strong>Jatin</strong><br>Growth Escalators</p>',
  6, true
FROM tenants t WHERE t.slug = 'growth-escalators'
ON CONFLICT (tenant_id, name)
DO UPDATE SET subject = EXCLUDED.subject, body_html = EXCLUDED.body_html, brevo_template_id = EXCLUDED.brevo_template_id, updated_at = now();
