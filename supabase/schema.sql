-- ============================================================================
-- Matatu ya Maneno — Supabase schema
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Safe to re-run: everything is idempotent.
--
-- IDENTITY MODEL — phone number is the account key
--
-- A player signs in with their phone number. That number IS the account: the
-- same number on any device loads the same username, the same score and the
-- same saved journey. One phone => one account => one username.
--
-- There is deliberately NO SMS verification (no OTP). See the TRUST note at
-- the bottom for exactly what that does and does not protect against.
--
-- SECURITY MODEL
-- The game is a static site, so the only key it can hold is the *anon* key,
-- which is public by design. Row Level Security is therefore the entire
-- security boundary.
--
-- Because the account key is a phone number rather than auth.uid(), RLS
-- policies keyed on auth.uid() cannot express "this is your row". So instead:
--
--   * `accounts` has RLS enabled and NO policies at all. That makes it
--     completely unreachable through the anon key — no direct select, insert,
--     update or delete, ever.
--   * Every legitimate operation goes through a `security definer` function
--     below, which runs as the function owner and can therefore touch the
--     table. Each one re-checks that the caller is authenticated first.
--
-- The important consequence: no client can ever run
-- `select phone from accounts` and walk off with the phone list. The only
-- way to read an account is to already know its number.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. ACCOUNTS — one row per phone number. Identity, scoreboard and save.
-- ---------------------------------------------------------------------------
create table if not exists public.accounts (
  -- E.164, normalised by the client (Kenyan numbers default to +254).
  phone        text primary key check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  username     text not null check (char_length(username) between 2 and 16),

  -- The whole client save (levels, ledger, journey position), so the same
  -- number resumes on a new device. Opaque to the database on purpose —
  -- journey.js owns this shape and migrates it.
  save         jsonb,

  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  -- denormalised score fields, kept current by the client
  levels_done  int  not null default 0 check (levels_done  >= 0),
  sarafu       int  not null default 0 check (sarafu       >= 0),
  bonus_words  int  not null default 0 check (bonus_words  >= 0),
  best_level   int  not null default 0 check (best_level   >= 0)
);

-- RLS on, zero policies => deny everything through the anon key. All access
-- is via the security-definer functions further down. This is what keeps the
-- phone numbers private.
alter table public.accounts enable row level security;

create index if not exists accounts_scoreboard_idx
  on public.accounts (levels_done desc, sarafu desc, bonus_words desc);


-- ---------------------------------------------------------------------------
-- 2. ACCOUNT_DAYS — one row per account per active day. Powers DAU + retention.
-- ---------------------------------------------------------------------------
create table if not exists public.account_days (
  phone text not null references public.accounts(phone) on delete cascade,
  day   date not null default (now() at time zone 'utc')::date,
  primary key (phone, day)
);

alter table public.account_days enable row level security;
-- No policies. Written by account_sync(), read by the admin dashboard only.

create index if not exists account_days_day_idx on public.account_days (day);


-- ---------------------------------------------------------------------------
-- 3. EVENTS — funnel + engagement telemetry. Append-only.
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id         bigserial primary key,
  phone      text not null references public.accounts(phone) on delete cascade,
  type       text not null check (type in (
                'level_start', 'level_complete', 'hint_used',
                'shuffle_used', 'game_finished', 'app_installed')),
  level_id   int,
  created_at timestamptz not null default now()
);

alter table public.events enable row level security;
-- No policies. Written by event_log(), read by the admin dashboard only.

create index if not exists events_type_level_idx on public.events (type, level_id);
create index if not exists events_created_idx    on public.events (created_at);


-- ---------------------------------------------------------------------------
-- 4. GAME API — the only way a client touches any of the above.
--
-- Each function is `security definer` (so it can reach the policy-less
-- tables) but starts by rejecting anyone who is not signed in. The game
-- signs in with Anonymous Auth purely to obtain a JWT, which keeps these
-- endpoints behind Supabase's auth rate limits rather than wide open.
-- ---------------------------------------------------------------------------

create or replace function public.require_auth()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'not authorised';
  end if;
end;
$$;

-- Look up ONE account by its exact number. Returns zero rows for an unknown
-- number, which is how the client decides "new player, ask for a username".
-- Note it never returns the phone back — the caller already knows it.
create or replace function public.account_load(p_phone text)
returns table (
  username    text,
  save        jsonb,
  levels_done int,
  sarafu      int,
  bonus_words int,
  best_level  int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_auth();

  return query
  select a.username, a.save, a.levels_done, a.sarafu, a.bonus_words, a.best_level
  from accounts a
  where a.phone = p_phone;
end;
$$;

-- Create or refresh an account, and mark today active. This is both
-- "sign up" and "save progress" — the client calls it on every sync.
create or replace function public.account_sync(
  p_phone       text,
  p_username    text,
  p_save        jsonb   default null,
  p_levels_done int     default 0,
  p_sarafu      int     default 0,
  p_bonus_words int     default 0,
  p_best_level  int     default 0
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.require_auth();

  insert into accounts as a (
    phone, username, save, last_seen_at,
    levels_done, sarafu, bonus_words, best_level
  )
  values (
    p_phone, p_username, p_save, now(),
    greatest(p_levels_done, 0), greatest(p_sarafu, 0),
    greatest(p_bonus_words, 0), greatest(p_best_level, 0)
  )
  on conflict (phone) do update set
    username     = excluded.username,
    -- A null save means "score-only ping" — never blank an existing save.
    save         = coalesce(excluded.save, a.save),
    last_seen_at = now(),
    levels_done  = excluded.levels_done,
    sarafu       = excluded.sarafu,
    bonus_words  = excluded.bonus_words,
    best_level   = excluded.best_level;

  insert into account_days (phone) values (p_phone)
  on conflict do nothing;
end;
$$;

-- Append one telemetry event.
create or replace function public.event_log(
  p_phone    text,
  p_type     text,
  p_level_id int default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.require_auth();

  -- Silently ignore events for an account that does not exist yet rather
  -- than raising: telemetry must never be able to break gameplay.
  if not exists (select 1 from accounts where phone = p_phone) then
    return;
  end if;

  insert into events (phone, type, level_id) values (p_phone, p_type, p_level_id);
end;
$$;

-- The public leaderboard. Returns usernames and scores only — the phone
-- column never leaves the database. `p_phone` is used solely to flag the
-- caller's own row so the UI can highlight it.
create or replace function public.leaderboard_top(
  lim     int  default 50,
  p_phone text default null
)
returns table (
  username    text,
  levels_done int,
  sarafu      int,
  bonus_words int,
  is_me       boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_auth();

  return query
  select a.username, a.levels_done, a.sarafu, a.bonus_words,
         (p_phone is not null and a.phone = p_phone)
  from accounts a
  order by a.levels_done desc, a.sarafu desc, a.bonus_words desc
  limit least(greatest(lim, 1), 200);
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. ADMINS — who may view the private dashboard.
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.admins enable row level security;
-- No policies at all => unreachable via the anon key. Managed only from the
-- Supabase SQL editor. See SETUP step 3 below.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;


-- ---------------------------------------------------------------------------
-- 6. DASHBOARD FUNCTIONS — admin-gated aggregates.
--    security definer so they can read admin-only tables, but each one
--    re-checks is_admin() first, so a non-admin gets nothing.
-- ---------------------------------------------------------------------------

-- Headline totals.
create or replace function public.dash_totals()
returns table (
  total_players   bigint,
  players_today   bigint,
  new_today       bigint,
  players_7d      bigint,
  finished_game   bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare today date := (now() at time zone 'utc')::date;
begin
  if not public.is_admin() then
    raise exception 'not authorised';
  end if;

  return query
  select
    (select count(*) from accounts),
    (select count(*) from account_days where day = today),
    (select count(*) from accounts where created_at::date = today),
    (select count(distinct phone) from account_days where day > today - 7),
    (select count(*) from accounts where best_level >= (select max(best_level) from accounts));
end;
$$;

-- Daily signups + actives, for the trend chart.
create or replace function public.dash_daily(days int default 30)
returns table (day date, new_players bigint, active_players bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised';
  end if;

  return query
  with span as (
    select generate_series(
      (now() at time zone 'utc')::date - (days - 1),
      (now() at time zone 'utc')::date,
      '1 day'::interval
    )::date as day
  )
  select
    s.day,
    (select count(*) from accounts a     where a.created_at::date = s.day),
    (select count(*) from account_days d where d.day = s.day)
  from span s
  order by s.day;
end;
$$;

-- Per-level funnel: how many reached each level vs completed it.
-- This is the number that tells you which puzzle is mistuned.
create or replace function public.dash_funnel()
returns table (level_id int, started bigint, completed bigint, hints bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised';
  end if;

  return query
  select
    e.level_id,
    count(*) filter (where e.type = 'level_start')    as started,
    count(*) filter (where e.type = 'level_complete') as completed,
    count(*) filter (where e.type = 'hint_used')      as hints
  from events e
  where e.level_id is not null
  group by e.level_id
  order by e.level_id;
end;
$$;

-- Leaderboard copy for the dashboard. Admins DO see the phone number here —
-- it is the only way to help a player who writes in about their account.
create or replace function public.dash_leaderboard(lim int default 100)
returns table (
  rank        bigint,
  phone       text,
  username    text,
  levels_done int,
  sarafu      int,
  bonus_words int,
  last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised';
  end if;

  return query
  select
    row_number() over (order by a.levels_done desc, a.sarafu desc, a.bonus_words desc),
    a.phone, a.username, a.levels_done, a.sarafu, a.bonus_words, a.last_seen_at
  from accounts a
  order by a.levels_done desc, a.sarafu desc, a.bonus_words desc
  limit lim;
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. GRANTS — the signed-in role must be allowed to CALL the game API,
--    even though it can touch none of the tables directly.
-- ---------------------------------------------------------------------------
revoke all on public.accounts, public.account_days, public.events from anon, authenticated;

grant execute on function public.account_load(text)                           to authenticated;
grant execute on function public.account_sync(text,text,jsonb,int,int,int,int) to authenticated;
grant execute on function public.event_log(text,text,int)                     to authenticated;
grant execute on function public.leaderboard_top(int,text)                    to authenticated;


-- ============================================================================
-- SETUP
--
-- 1. Run this whole file in the Supabase SQL editor.
--
-- 2. Enable Anonymous Sign-Ins:
--    Dashboard -> Authentication -> Providers -> Anonymous -> enable.
--    (The game still uses this, but only to obtain a JWT. The player's real
--    identity is their phone number.)
--
-- 3. Create your admin login, then grant it admin:
--    a) Dashboard -> Authentication -> Users -> "Add user" (email + password).
--       Create this yourself — never share the password.
--    b) Copy that user's UUID, then run:
--         insert into public.admins (user_id) values ('<paste-uuid>');
--
-- 4. Put your project URL + anon key into supabase-config.js.
--
--
-- TRUST — read this before treating an account as proof of anything.
--
-- There is no OTP. The game asks for a number and takes the player's word for
-- it. Concretely:
--
--   * A player who knows someone else's number can type it in and load that
--     player's journey and username. There is no defence against this by
--     design — the number is a convenience key, not a credential.
--   * The tables themselves are still locked down: nobody can dump the phone
--     list, delete another account, or read telemetry. You have to already
--     know a number to use it.
--   * account_load() can be probed number by number to test whether an
--     account exists. Supabase's per-IP auth rate limit is the only thing
--     slowing that down.
--
-- That is a reasonable trade for a word game with a friendly leaderboard. It
-- stops being reasonable the moment accounts carry anything of value (prizes,
-- purchases, personal data). The upgrade path is Supabase Phone Auth with a
-- real SMS provider: sign in with signInWithOtp({ phone }), then key accounts
-- off auth.uid() again and put the phone in a column only the owner can read.
--
--
-- ABUSE / GROWTH — revisit before any public launch.
--
-- Anonymous sign-in is rate-limited to 30 requests per hour per IP (adjustable
-- under Auth -> Rate Limits). A classroom or any shared connection can hit that
-- ceiling; the 31st device just plays offline, which is a soft failure by design.
--
-- Supabase does NOT auto-delete anonymous users, and the sign-in endpoint can be
-- abused to inflate your database. When traffic justifies it, enable CAPTCHA
-- (Auth -> Settings) and delete stale anonymous users on a schedule. Since
-- accounts no longer reference auth.users, deleting them is now safe and does
-- NOT touch any player's progress:
--
--   delete from auth.users u
--   where u.is_anonymous and u.created_at < now() - interval '30 days';
--
--
-- ANTI-CHEAT — read this before trusting the scoreboard.
--
-- The game runs on the player's device, so they can open devtools and call
-- account_sync() with whatever score they like. Server-side scoring (submit
-- the found-word sequence to an Edge Function that re-validates it) is the
-- fix if the leaderboard ever carries real stakes. Deliberately not done here.
-- ============================================================================
