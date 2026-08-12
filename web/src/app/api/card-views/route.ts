import { auth } from '@/lib/server-auth';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { card_ids } = body as { card_ids?: unknown };

  if (!Array.isArray(card_ids) || card_ids.length === 0) {
    return NextResponse.json({ error: 'card_ids array is required' }, { status: 400 });
  }

  // Validate and cap array size
  const ids = card_ids
    .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))
    .slice(0, 50);

  if (ids.length === 0) {
    return NextResponse.json({ error: 'No valid card_ids provided' }, { status: 400 });
  }

  const rows = ids.map((card_id) => ({ user_id: userId, card_id }));

  const { error } = await supabase
    .from('card_views')
    .upsert(rows, { onConflict: 'user_id,card_id', ignoreDuplicates: true });

  if (error) {
    return NextResponse.json({ error: 'Failed to record views' }, { status: 500 });
  }

  return NextResponse.json({ recorded: ids.length });
}
