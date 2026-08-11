import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { checkUserRateLimit } from '@/lib/rate-limit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// How many different people have to flag a card before it stops being served.
// This is the floor under moderation, not the ceiling: it only fires after readers
// have already seen the card, so it exists to stop the bleeding rather than to
// catch bad cards early. The pipeline's quality gate is what should catch them
// before anyone reads them.
//
// One flag per person is enforced below, so a row count is a headcount — three
// people, not one person clicking three times. A suspended card is reversible
// from /admin, which matters because this can be wrong.
const AUTO_SUSPEND_FLAGS = Number(process.env.AUTO_SUSPEND_FLAGS ?? 3);

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Per-user rate limit: 10 flags per hour
  const rl = await checkUserRateLimit(userId, 'flags', 10, 3_600_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { card_id, reason } = body as { card_id?: string; reason?: string };

  if (!card_id || typeof card_id !== 'string' || !UUID_RE.test(card_id)) {
    return NextResponse.json({ error: 'Valid card_id is required' }, { status: 400 });
  }

  if (reason !== undefined && reason !== null) {
    if (typeof reason !== 'string' || reason.length > 500) {
      return NextResponse.json({ error: 'reason must be a string (500 char max)' }, { status: 400 });
    }
  }

  // Check if user already flagged this card. Migration 018 also enforces this with
  // UNIQUE (card_id, user_id); the pre-check gives a clean 409 without attempting a
  // write, and the constraint below catches the race this check cannot.
  const { data: existingFlag } = await supabase
    .from('flags')
    .select('id')
    .eq('card_id', card_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (existingFlag) {
    return NextResponse.json({ error: 'Already flagged' }, { status: 409 });
  }

  // Verify card exists
  const { data: card } = await supabase
    .from('cards')
    .select('id, is_suspended')
    .eq('id', card_id)
    .maybeSingle();

  if (!card) {
    return NextResponse.json({ error: 'Card not found' }, { status: 404 });
  }

  // Insert flag with user_id
  const { error: flagError } = await supabase
    .from('flags')
    .insert({ card_id, user_id: userId, reason: reason ?? null });

  if (flagError) {
    // 23505 is a unique violation: two concurrent flags from the same person got
    // past the check above. Same outcome as the pre-check, not a server error.
    if (flagError.code === '23505') {
      return NextResponse.json({ error: 'Already flagged' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to submit flag' }, { status: 500 });
  }

  // flag_count is maintained by the trg_increment_flag_count trigger on flags
  // (migration 003). This route used to increment it as well, which double-counted
  // every flag and raced two concurrent flags into one. The trigger's
  // `flag_count = flag_count + 1` is atomic; a read-modify-write here was not.

  if (card.is_suspended) {
    // Already suspended — the flag is still recorded for the audit trail.
    return NextResponse.json({ success: true, suspended: true }, { status: 201 });
  }

  // Count the flag rows rather than reading flag_count, so suppression does not
  // depend on a counter being right. Existing rows carry inflated counts from the
  // double-increment above.
  const { count, error: countError } = await supabase
    .from('flags')
    .select('id', { count: 'exact', head: true })
    .eq('card_id', card_id);

  if (countError || count === null) {
    // The flag is safely recorded; only the suppression check was inconclusive.
    return NextResponse.json({ success: true }, { status: 201 });
  }

  if (count >= AUTO_SUSPEND_FLAGS) {
    await supabase.from('cards').update({ is_suspended: true }).eq('id', card_id);
    return NextResponse.json({ success: true, suspended: true }, { status: 201 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
