-- Update WhatsApp template names in sequences to match approved Meta templates
-- Old names (deleted from Meta): welcome_d2c, followup_day3, nudge_day7, appointment_reminder
-- New names (pending approval): ge_welcome_d2c, ge_followup_d3, ge_nudge_d7, ge_appt_reminder

UPDATE sequences
SET steps = (
  SELECT jsonb_agg(
    CASE
      WHEN step->>'templateName' = 'welcome_d2c'          THEN jsonb_set(step, '{templateName}', '"ge_welcome_d2c"')
      WHEN step->>'templateName' = 'followup_day3'        THEN jsonb_set(step, '{templateName}', '"ge_followup_d3"')
      WHEN step->>'templateName' = 'nudge_day7'           THEN jsonb_set(step, '{templateName}', '"ge_nudge_d7"')
      WHEN step->>'templateName' = 'appointment_reminder' THEN jsonb_set(step, '{templateName}', '"ge_appt_reminder"')
      WHEN step->>'templateName' = 'welcome_healthcare'   THEN jsonb_set(step, '{templateName}', '"ge_welcome_d2c"')
      ELSE step
    END
  )
  FROM jsonb_array_elements(steps::jsonb) AS step
)
WHERE steps::text ~ 'welcome_d2c|followup_day3|nudge_day7|appointment_reminder|welcome_healthcare';
