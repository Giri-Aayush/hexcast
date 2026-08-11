-- 020_deactivate_dead_sources.sql
--
-- Four sources fail every smoke run against live endpoints. None of these are our
-- bugs — they are upstream changes and outages — but leaving them active means the
-- smoke test cries wolf on every run, which trains us to ignore it.
--
-- Deactivated rather than deleted: reversible, keeps the row's history, and the
-- reason survives so nobody has to re-diagnose it. Re-enable by setting is_active
-- back to true once the endpoint recovers.
--
-- paradigm.xyz is deliberately NOT here. It is broken for a reason we can fix on our
-- side (the site moved from Next.js to SvelteKit and the scraper still looks for
-- __NEXT_DATA__), so it stays active and gets a rewritten fetcher.

ALTER TABLE source_registry ADD COLUMN IF NOT EXISTS deactivated_reason TEXT;

UPDATE source_registry SET is_active = false, deactivated_reason = $$Feed request times out after 60s (checked 2026-08-11)$$
WHERE id = 'ethereumweeklydigest.substack.com';

UPDATE source_registry SET is_active = false, deactivated_reason = $$RSS endpoint no longer resolves (checked 2026-08-11)$$
WHERE id = 'blog.chain.link';

UPDATE source_registry SET is_active = false, deactivated_reason = $$RSS endpoint no longer resolves (checked 2026-08-11)$$
WHERE id = 'samczsun.com';

UPDATE source_registry SET is_active = false, deactivated_reason = $$Discourse /latest.json returns zero topics (checked 2026-08-11)$$
WHERE id = 'gov.curve.finance';
