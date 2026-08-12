import { createClient } from '@supabase/supabase-js';
import { ALL_SOURCES, DEACTIVATED_SOURCES } from '@hexcast/shared';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seed() {
  console.log(`Seeding ${ALL_SOURCES.length} sources (Tiers 1, 2, 3, 5, 6)...`);

  // is_active and deactivated_reason are set on EVERY row, not just the dead
  // ones. A bulk upsert builds one column list from the payload, so a mixed
  // payload sends NULL for the rows that omit the field and the insert dies on
  // is_active's NOT NULL constraint. Verified against a real Postgres.
  const rows = ALL_SOURCES.map((source) => ({
    ...source,
    is_active: !(source.id in DEACTIVATED_SOURCES),
    deactivated_reason: DEACTIVATED_SOURCES[source.id] ?? null,
  }));

  const { error } = await supabase
    .from('source_registry')
    .upsert(rows, { onConflict: 'id' });

  if (error) {
    console.error('Failed to seed sources:', error.message);
    process.exit(1);
  }

  console.log('Successfully seeded source_registry:');
  for (const source of ALL_SOURCES) {
    console.log(`  - ${source.id} (${source.api_type}, ${source.default_category})`);
  }
}

seed();
