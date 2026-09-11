-- UW GO: one row of saved app state per signed-in student, so a returning student (or the same
-- student on a new device) opens straight into their schedule instead of pasting it again.
-- Run after 20260910000000_waterloo_only_and_profiles.sql, in the Supabase SQL editor or with
-- `supabase db push`. Idempotent. Rollback: supabase/rollbacks/20260911000000_user_state.down.sql
--
-- Stored: the parsed schedule and the preferences needed to rebuild the app (home, arrival
-- buffer, gym, route preference), as JSON in the app's own shapes (src/lib/userState.ts).
-- Never stored: sign-in codes, tokens or keys (Supabase Auth owns the session), routes, plans
-- and map state (always recomputed), and per-device state such as gap answers and reminders.

create table if not exists public.user_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  schedule jsonb,
  preferences jsonb not null default '{}'::jsonb,
  onboarding_complete boolean not null default false,
  schema_version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_state_schedule_shape check (
    schedule is null or (jsonb_typeof(schedule) = 'object' and jsonb_typeof(schedule -> 'meetings') = 'array')
  ),
  constraint user_state_preferences_shape check (jsonb_typeof(preferences) = 'object'),
  -- Generous for any real term (a full schedule is a few kilobytes), small enough that the table
  -- cannot be used as free file storage.
  constraint user_state_size check (
    coalesce(pg_column_size(schedule), 0) <= 262144 and pg_column_size(preferences) <= 16384
  ),
  constraint user_state_complete_needs_schedule check (not onboarding_complete or schedule is not null)
);

-- Row Level Security: a student can read, create, change and delete only their own row.
alter table public.user_state enable row level security;

revoke all on table public.user_state from anon;
grant select, insert, update, delete on table public.user_state to authenticated;

drop policy if exists "user_state: select own" on public.user_state;
create policy "user_state: select own" on public.user_state
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "user_state: insert own" on public.user_state;
create policy "user_state: insert own" on public.user_state
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "user_state: update own" on public.user_state;
create policy "user_state: update own" on public.user_state
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_state: delete own" on public.user_state;
create policy "user_state: delete own" on public.user_state
  for delete to authenticated using (auth.uid() = user_id);

-- Timestamps come from the database, never from the client: the app compares updated_at with
-- a device's unsaved-changes time to decide which copy is newer.
create or replace function public.user_state_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_state_touch on public.user_state;
create trigger user_state_touch before insert or update on public.user_state
  for each row execute function public.user_state_touch();

-- Carry over preferences already saved in public.profiles, so existing students keep them.
-- No schedule existed server-side before this table, so these rows start with onboarding
-- incomplete; a device that still has the schedule uploads it on the next sign-in.
-- public.profiles itself is left in place (the sign-up trigger still creates it); the app no
-- longer reads it.
insert into public.user_state (user_id, preferences)
select
  p.id,
  jsonb_strip_nulls(jsonb_build_object(
    'arrivalBufferMinutes', p.arrival_buffer_minutes,
    'routePreference', p.route_preference,
    'gym', case
      when p.gym_enabled is null then null
      else jsonb_build_object(
        'enabled', p.gym_enabled,
        'durationMinutes', coalesce(p.gym_duration_minutes, 60),
        'preferredTime', coalesce(p.gym_preferred_time, 'NONE')
      )
    end
  ))
from public.profiles p
where p.gym_enabled is not null or p.route_preference is not null or p.arrival_buffer_minutes is not null
on conflict (user_id) do nothing;
