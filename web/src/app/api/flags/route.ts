import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { checkUserRateLimit } from '@/lib/rate-limit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // Check if user already flagged this card
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
    .select('id, flag_count')
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
    return NextResponse.json({ error: 'Failed to submit flag' }, { status: 500 });
  }

  // Increment flag_count on the card
  await supabase
    .from('cards')
    .update({ flag_count: card.flag_count + 1 })
    .eq('id', card_id);

  return NextResponse.json({ success: true }, { status: 201 });
}
