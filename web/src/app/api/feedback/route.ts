import { auth } from '@/lib/server-auth';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { checkUserRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Per-user rate limit: 10 feedback per hour
  const rl = await checkUserRateLimit(userId, 'feedback', 10, 3_600_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { message, page_url } = body as { message?: string; page_url?: string };

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  if (message.length > 500) {
    return NextResponse.json({ error: 'message too long (500 char max)' }, { status: 400 });
  }

  if (page_url && (typeof page_url !== 'string' || page_url.length > 2048)) {
    return NextResponse.json({ error: 'page_url too long (2048 char max)' }, { status: 400 });
  }

  const { error } = await supabase
    .from('feedback')
    .insert({
      user_id: userId,
      message: message.trim(),
      page_url: page_url ?? null,
    });

  if (error) {
    return NextResponse.json({ error: 'Failed to submit feedback' }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
