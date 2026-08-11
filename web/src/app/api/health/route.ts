import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isModerationConfigured } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, 'ok' | 'fail'> = {};

  // Check Supabase connectivity
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!,
    );
    const { error } = await supabase.from('cards').select('id').limit(1);
    checks.database = error ? 'fail' : 'ok';
  } catch {
    checks.database = 'fail';
  }

  // Reported separately from `checks` so it never turns the deploy red: an
  // unmoderated site still serves cards fine. It is here because an empty
  // ADMIN_USER_IDS denies everyone silently, which is how it went unnoticed long
  // enough to become a launch blocker. Something has to say it out loud.
  const warnings: string[] = [];
  if (!isModerationConfigured()) {
    warnings.push('ADMIN_USER_IDS is empty — no user can moderate flagged cards');
  }

  const healthy = Object.values(checks).every((v) => v === 'ok');

  return NextResponse.json(
    {
      status: healthy ? 'healthy' : 'degraded',
      checks,
      ...(warnings.length > 0 && { warnings }),
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
