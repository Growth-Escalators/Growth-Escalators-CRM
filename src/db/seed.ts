import { db, tenants, sequences } from './index';
import { eq, and } from 'drizzle-orm';
import { computeTenantFeatures } from '../services/tenantFeatures';

async function seed() {
  // -------------------------------------------------------------------------
  // Seed tenants
  //
  // `settings.features` below is DERIVED from computeTenantFeatures(plan, {}) —
  // i.e. exactly what src/services/tenantFeatures.ts's PLAN_DEFAULTS table
  // already computes for each plan as a fallback — so the two can never
  // drift apart. This is belt-and-suspenders seeding for a FRESH database
  // (dev/CI), not a behavior change: an unmigrated tenant (settings.features
  // empty, e.g. today's production rows) gets identical flags from the
  // plan-default fallback. See the "tenant feature gating" PR description
  // for the ground-truth evidence per flag.
  // -------------------------------------------------------------------------
  console.log('Seeding tenants...');
  const insertedTenants = await db
    .insert(tenants)
    .values([
      {
        name: 'Growth Escalators',
        slug: 'growth-escalators',
        plan: 'agency_internal',
        isActive: true,
        settings: { features: computeTenantFeatures('agency_internal', {}) },
      },
      {
        name: 'Wizmatch',
        slug: 'wizmatch',
        plan: 'wizmatch_internal',
        isActive: true,
        settings: { features: computeTenantFeatures('wizmatch_internal', {}) },
      },
      {
        name: 'City Clinic',
        slug: 'city-clinic',
        plan: 'client_basic',
        isActive: true,
        settings: { features: computeTenantFeatures('client_basic', {}) },
      },
    ])
    .onConflictDoNothing()
    .returning({ id: tenants.id, name: tenants.name });

  if (insertedTenants.length === 0) {
    console.log('Tenants already exist — nothing inserted (onConflictDoNothing).');
  } else {
    console.log(`Inserted ${insertedTenants.length} tenant(s):`);
    insertedTenants.forEach((t) => console.log(`  - ${t.name}: ${t.id}`));
  }

  // -------------------------------------------------------------------------
  // Seed sequences — find Growth Escalators tenant first
  // -------------------------------------------------------------------------
  console.log('\nSeeding sequences...');
  const geTenants = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, 'growth-escalators'))
    .limit(1);

  if (geTenants.length === 0) {
    console.error('Growth Escalators tenant not found — cannot seed sequences.');
    process.exit(1);
  }

  const geTenantId = geTenants[0].id;
  console.log(`  Using tenant: Growth Escalators (${geTenantId})`);

  const sequencesToSeed = [
    {
      name: 'D2C Lead Nurture',
      channel: 'whatsapp',
      tenantId: geTenantId,
      isActive: true,
      steps: [
        { stepIndex: 0, delayDays: 0, templateName: 'ge_welcome_d2c', channel: 'whatsapp', condition: null },
        { stepIndex: 1, delayDays: 3, templateName: 'ge_followup_d3', channel: 'whatsapp', condition: 'not_converted' },
        { stepIndex: 2, delayDays: 4, templateName: 'ge_nudge_d7', channel: 'whatsapp', condition: 'not_converted' },
      ],
    },
    {
      name: 'Healthcare Lead Nurture',
      channel: 'whatsapp',
      tenantId: geTenantId,
      isActive: true,
      steps: [
        { stepIndex: 0, delayDays: 0, templateName: 'ge_welcome_d2c', channel: 'whatsapp', condition: null },
        { stepIndex: 1, delayDays: 3, templateName: 'ge_followup_d3', channel: 'whatsapp', condition: 'not_converted' },
        { stepIndex: 2, delayDays: 4, templateName: 'ge_appt_reminder', channel: 'whatsapp', condition: 'not_converted' },
      ],
    },
  ];

  for (const seq of sequencesToSeed) {
    // Check if already exists (no unique constraint — use select-first)
    const existing = await db
      .select()
      .from(sequences)
      .where(and(eq(sequences.name, seq.name), eq(sequences.tenantId, geTenantId)))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  Sequence "${seq.name}" already exists — skipping.`);
      continue;
    }

    const [inserted] = await db.insert(sequences).values(seq).returning({ id: sequences.id, name: sequences.name });
    console.log(`  Inserted sequence "${inserted.name}": ${inserted.id}`);
  }

  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
