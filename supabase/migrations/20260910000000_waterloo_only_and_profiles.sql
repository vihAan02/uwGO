-- UW GO: Waterloo-only sign-up and a minimal profile table.
-- Run in the Supabase SQL editor (or `supabase db push`). Idempotent.

-- ---------------------------------------------------------------------------
-- 1. Only @uwaterloo.ca may exist in auth.users. This is the real boundary: the
--    login form and the app's API route also check, but this runs even if someone
--    calls Supabase directly with the public anon key.
create or replace function public.enforce_waterloo_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  domain text;
begin
  if new.email is null then
    raise exception 'An email address is required.';
  end if;
  domain := lower(split_part(new.email, '@', 2));
  if domain <> 'uwaterloo.ca' or position('@' in new.email) <> length(new.email) - length(split_part(new.email, '@', 2)) then
    raise exception 'UW GO is currently available to University of Waterloo students only (uwaterloo.ca addresses).';
  end if;
  new.email := lower(new.email);
  return new;
end;
$$;

drop trigger if exists uwgo_waterloo_only on auth.users;
create trigger uwgo_waterloo_only
  before insert or update of email on auth.users
  for each row execute function public.enforce_waterloo_email();

-- ---------------------------------------------------------------------------
-- 2. Minimal profile: preferences only. Schedules stay on the device for now.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  gym_enabled boolean,
  gym_duration_minutes smallint check (gym_duration_minutes in (45, 60, 90)),
  gym_preferred_time text check (gym_preferred_time in ('MORNING', 'AFTERNOON', 'EVENING', 'LEAST_BUSY', 'NONE')),
  route_preference text check (route_preference in ('FASTEST', 'INDOORS')),
  arrival_buffer_minutes smallint check (arrival_buffer_minutes in (5, 10, 15))
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: own row read" on public.profiles;
create policy "profiles: own row read" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles: own row insert" on public.profiles;
create policy "profiles: own row insert" on public.profiles
  for insert with check (auth.uid() = id and lower(email) = lower(auth.jwt() ->> 'email') and lower(split_part(email, '@', 2)) = 'uwaterloo.ca');

drop policy if exists "profiles: own row update" on public.profiles;
create policy "profiles: own row update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id and lower(email) = lower(auth.jwt() ->> 'email'));

-- Keep updated_at honest.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Create the row when the account is created, so the app can always upsert into an existing row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, lower(new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists uwgo_on_auth_user_created on auth.users;
create trigger uwgo_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
