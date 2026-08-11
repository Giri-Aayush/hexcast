import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { checkUserRateLimit } from '@/lib/rate-limit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('saved_cards')
    .select('card_id, saved_at, cards(*)')
    .eq('user_id', userId)
    .order('saved_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch saved cards' }, { status: 500 });
  }

  return NextResponse.json({ saved: data ?? [] });
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Per-user rate limit: 30 saves per minute
  const rl = await checkUserRateLimit(userId, 'saved', 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { card_id } = body as { card_id?: string };

  if (!card_id || typeof card_id !== 'string' || !UUID_RE.test(card_id)) {
    return NextResponse.json({ error: 'Valid card_id is required' }, { status: 400 });
  }

  // Check if already saved
  const { data: existing } = await supabase
    .from('saved_cards')
    .select('card_id')
    .eq('user_id', userId)
    .eq('card_id', card_id)
    .maybeSingle();

  if (existing) {
    // Unsave
    await supabase
      .from('saved_cards')
      .delete()
      .eq('user_id', userId)
      .eq('card_id', card_id);

    return NextResponse.json({ saved: false });
  }

  // Save
  const { error } = await supabase
    .from('saved_cards')
    .insert({ user_id: userId, card_id });

  if (error) {
    return NextResponse.json({ error: 'Failed to save card' }, { status: 500 });
  }

  return NextResponse.json({ saved: true });
}
