-- ============================================================================
-- Matatu ya Maneno — DESTRUCTIVE RESET
--
--   *** THIS DELETES EVERY PLAYER, SCORE AND EVENT. THERE IS NO UNDO. ***
--
-- Run this ONCE, in the Supabase SQL editor, to clear the history from all
-- previous runs before switching to phone-number sign-in. Then run
-- schema.sql to build the new phone-keyed tables.
--
-- Order matters: drop the old tables first (they cascade from auth.users),
-- then delete the anonymous auth users themselves.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The old uuid-keyed tables. `cascade` also drops the policies, indexes
--    and foreign keys that hang off them.
-- ---------------------------------------------------------------------------
drop table if exists public.events      cascade;
drop table if exists public.player_days cascade;
drop table if exists public.players     cascade;

-- If you have already run the new schema.sql and want to clear it too,
-- uncomment these three lines as well:
-- drop table if exists public.events       cascade;
-- drop table if exists public.account_days cascade;
-- drop table if exists public.accounts     cascade;

-- ---------------------------------------------------------------------------
-- 2. The anonymous auth identities created by the old build.
--
--    Every device that ever opened the game has one of these. They are no
--    longer the account key — under phone sign-in, auth.users rows are
--    disposable JWT holders — so deleting them loses nothing that step 1
--    has not already deleted.
--
--    `is_anonymous` is deliberately checked so this CANNOT delete your own
--    admin email/password login. Verify the count before committing.
-- ---------------------------------------------------------------------------
delete from auth.users where is_anonymous;

-- Your admin login survives, but the admins table referenced auth.users and
-- may have been emptied if it was ever pointed at an anonymous id. Re-check
-- after this runs:
--   select * from public.admins;
-- and re-insert your admin uuid if it is gone (see SETUP step 3 in schema.sql).

commit;

-- ---------------------------------------------------------------------------
-- 3. Sanity check — all three should return 0 (or "relation does not exist",
--    which is equally fine).
-- ---------------------------------------------------------------------------
-- select count(*) from auth.users where is_anonymous;
-- select count(*) from public.accounts;
-- select count(*) from public.events;
