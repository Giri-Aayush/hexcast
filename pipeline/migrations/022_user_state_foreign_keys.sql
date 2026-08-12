-- 022_user_state_foreign_keys.sql
--
-- Every table holding per-user state has carried a bare TEXT user_id with no
-- foreign key to anything. Nothing constrained it, so identity could change under
-- it silently: swap providers, users get new ids, and their saved cards simply stop
-- being theirs. No error, no violation, no log line. That risk is why we asked for
-- production row counts before touching auth at all.
--
-- Better Auth puts a real users table in our own database, so these can finally be
-- real references.
--
-- DO NOT RUN THIS ON PRODUCTION UNTIL THE ROW COUNTS ARE CONFIRMED AND ANY
-- CLERK-ERA IDS ARE REMAPPED. If a row holds a Clerk id with no matching "user"
-- row, this migration will fail — which is the correct behaviour: it refuses to
-- pretend the data is consistent. Locally all five tables are empty, so it applies
-- cleanly.
--
-- ON DELETE choices, deliberately not uniform:
--   saved_cards, card_views, reactions — CASCADE. Purely personal state; deleting
--     the account should take it, and it is what a deletion request implies.
--   feedback — CASCADE. Losing the message on account deletion is the right side of
--     the privacy tradeoff, even though the team loses the content.
--   flags — SET NULL. A flag is a moderation signal about a CARD, not about the
--     flagger. Cascading would let deleting an account quietly un-suspend content
--     it had been flagged for, so the row survives and only the identity is dropped.
--     (Already nullable, from 018.)

ALTER TABLE saved_cards
  ADD CONSTRAINT saved_cards_user_fk FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;

ALTER TABLE card_views
  ADD CONSTRAINT card_views_user_fk FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;

ALTER TABLE reactions
  ADD CONSTRAINT reactions_user_fk FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;

ALTER TABLE feedback
  ADD CONSTRAINT feedback_user_fk FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;

ALTER TABLE flags
  ADD CONSTRAINT flags_user_fk FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE SET NULL;
