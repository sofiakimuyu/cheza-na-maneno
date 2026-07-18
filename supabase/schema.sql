-- ============================================================================
-- Matatu ya Maneno — Supabase schema
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Safe to re-run: everything is idempotent.
--
-- SECURITY MODEL
-- The game is a static site, so the only key it can hold is the *anon* key,
-- which is public by design. Row Level Security is therefore the entire
-- security boundary. Every table below has RLS enabled and denies by default.
--
-- Each device signs in with Supabase Anonymous Auth, so auth.uid() is a real,
-- server-issued identity. Policies key off auth.uid(), which means a player
-- cannot write to another player's row. (A player CAN still lie about their
-- own score — see ANTI-CHEAT note at the bottom.)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. PLAYERS  — one row per device/identity. Powers the scoreboard.
-- ---------------------------------------------------------------------------
create table if not exists public.players (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null check (char_length(username) between 2 and 16),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  -- denormalised score fields, kept current by the client
  levels_done  int  not null default 0 check (levels_done  >= 0),
  sarafu       int  not null default 0 check (sarafu       >= 0),
  bonus_words  int  not null default 0 check (bonus_words  >= 0),
  best_level   int  not null default 0 check (best_level   >= 0)
);

alter table public.players enable row level security;

-- Anyone may READ the scoreboard (it is a public leaderboard).
drop policy if exists players_public_read on public.players;
create policy players_public_read
  on public.players for select
  using (true);

-- You may only create/update YOUR OWN row.
drop policy if exists players_insert_own on public.players;
create policy players_insert_own
  on public.players for insert
  with check (auth.uid() = id);

drop policy if exists players_update_own on public.players;
create policy players_update_own
  on public.players for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No delete policy => nobody can delete rows via the anon key. Deliberate.

create index if not exists players_scoreboard_idx
  on public.players (levels_done desc, sarafu desc, bonus_words desc);


-- ---------------------------------------------------------------------------
-- 2. PLAYER_DAYS — one row per player per active day. Powers DAU + retention.
--    Cheaper than scanning the events table for daily-active counts.
-- ---------------------------------------------------------------------------
create table if not exists public.player_days (
  player_id uuid not null references public.players(id) on delete cascade,
  day       date not null default (now() at time zone 'utc')::date,
  primary key (player_id, day)
);

alter table public.player_days enable row level security;

drop policy if exists player_days_insert_own on public.player_days;
create policy player_days_insert_own
  on public.player_days for insert
  with check (auth.uid() = player_id);

-- Note: no SELECT policy for regular players. Only admins read this
-- (via the security-definer dashboard functions further down).

create index if not exists player_days_day_idx on public.player_days (day);


-- ---------------------------------------------------------------------------
-- 3. EVENTS — funnel + engagement telemetry. Append-only.
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id         bigserial primary key,
  player_id  uuid not null references public.players(id) on delete cascade,
  type       text not null check (type in (
                'level_start', 'level_complete', 'hint_used',
                'shuffle_used', 'game_finished', 'app_installed')),
  level_id   int,
  created_at timestamptz not null default now()
);

alter table public.events enable row level security;

drop policy if exists events_insert_own on public.events;
create policy events_insert_own
  on public.events for insert
  with check (auth.uid() = player_id);

-- Again: no SELECT policy. Telemetry is admin-only.

create index if not exists events_type_level_idx on public.events (type, level_id);
create index if not exists events_created_idx    on public.events (created_at);


-- ---------------------------------------------------------------------------
-- 4. ADMINS — who may view the private dashboard.
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
-- 5. DASHBOARD FUNCTIONS — admin-gated aggregates.
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
    (select count(*) from players),
    (select count(*) from player_days where day = today),
    (select count(*) from players where created_at::date = today),
    (select count(distinct player_id) from player_days where day > today - 7),
    (select count(*) from players where best_level >= (select max(best_level) from players));
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
    (select count(*) from players p  where p.created_at::date = s.day),
    (select count(*) from player_days d where d.day = s.day)
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

-- Leaderboard copy for the dashboard (same ordering the game uses).
create or replace function public.dash_leaderboard(lim int default 100)
returns table (
  rank        bigint,
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
    row_number() over (order by p.levels_done desc, p.sarafu desc, p.bonus_words desc),
    p.username, p.levels_done, p.sarafu, p.bonus_words, p.last_seen_at
  from players p
  order by p.levels_done desc, p.sarafu desc, p.bonus_words desc
  limit lim;
end;
$$;


-- ============================================================================
-- SETUP
--
-- 1. Run this whole file in the Supabase SQL editor.
--
-- 2. Enable Anonymous Sign-Ins:
--    Dashboard -> Authentication -> Providers -> Anonymous -> enable.
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
-- ABUSE / GROWTH — revisit before any public launch.
--
-- Anonymous sign-in is rate-limited to 30 requests per hour per IP (adjustable
-- under Auth -> Rate Limits). A classroom or any shared connection can hit that
-- ceiling; the 31st device just plays offline, which is a soft failure by design.
--
-- Supabase does NOT auto-delete anonymous users, and the sign-in endpoint can be
-- abused to inflate your database. When traffic justifies it, enable CAPTCHA
-- (Auth -> Settings) and run something like this on a schedule:
--
--   delete from auth.users u
--   where u.is_anonymous
--     and u.created_at < now() - interval '30 days'
--     and not exists (
--       select 1 from public.players p
--       where p.id = u.id and p.levels_done > 0
--     );
--
-- (Deletes only stale anonymous accounts that never completed a level. The
-- cascade on players/events/player_days cleans up their rows too. Test on a
-- branch database first — this is a destructive query.)
--
--
-- ANTI-CHEAT — read this before trusting the scoreboard.
--
-- These policies stop a player from writing to ANOTHER player's row, which is
-- the attack that matters (griefing / wiping the board). They do NOT stop a
-- player inflating their OWN score: the game runs on their device, so they can
-- open devtools and POST whatever they like for their own id.
--
-- That is an inherent property of a client-authoritative game, not a flaw in
-- these policies. If the leaderboard ever carries real stakes (prizes, public
-- rankings people care about), the fix is to move scoring server-side: submit
-- the found-word sequence to an Edge Function that re-validates it against the
-- puzzle and computes the score itself. That is a substantially bigger build,
-- so it is deliberately not done here.
-- ============================================================================
