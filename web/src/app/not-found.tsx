import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="text-center space-y-4">
        <div
          className="text-[11px] tracking-widest uppercase"
          style={{ color: 'var(--link)' }}
        >
          &gt; error 404
        </div>
        <p
          className="text-[13px] tracking-wider"
          style={{ color: 'var(--ink-dim)' }}
        >
          page not found.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 mt-4 px-4 py-2 text-[10px] font-medium uppercase tracking-widest transition-all hover:brightness-110"
          style={{ background: 'var(--link)', color: '#fff' }}
        >
          <span>&lt;-</span>
          back to feed
        </Link>
      </div>
    </main>
  );
}
