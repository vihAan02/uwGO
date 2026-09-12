-- UW GO: crowdsourced route closures.
-- A student who finds a tunnel locked, a bridge shut or a path hoarded off reports the one
-- segment that is blocked. Once enough different accounts agree, routing stops using that
-- segment for everyone. Run after 20260911000000_user_state.sql, in the Supabase SQL editor or
-- with `supabase db push`. Idempotent.
-- Rollback: supabase/rollbacks/20260912000000_route_closure_reports.down.sql
--
-- Stored: who reported, which segment, and when. Nothing about where the student was, and no
-- free text: a report is a vote on a known segment, not a message.
--
-- `edge_id` is the canonical segment id from src/data/indoor/edgeId.ts: 16 hex characters
-- derived from the segment's kind and its two endpoints, so it survives the network data being
-- regenerated. A segment that genuinely moves gets a new id and its old reports simply stop
-- matching, which is the safe way for this to fail.

create table if not exists public.route_closure_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  edge_id text not null,
  status text not null default 'CLOSED',
  reported_at timestamptz not null default now(),
  constraint route_closure_reports_edge_id_shape check (edge_id ~ '^[0-9a-f]{16}$'),
  constraint route_closure_reports_status check (status in ('CLOSED', 'OPEN')),
  -- One account, one live opinion per segment. Reporting again refreshes the timestamp
  -- (which is how a closure is reconfirmed) and can never add a second vote.
  constraint route_closure_reports_one_per_reporter unique (reporter_id, edge_id)
);

create index if not exists route_closure_reports_edge_recent
  on public.route_closure_reports (edge_id, reported_at desc);

-- The clock is the database's, never the client's: a report cannot be backdated to look fresh
-- or forward-dated to outlive the expiry window.
create or replace function public.route_closure_reports_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.reported_at := now();
  return new;
end;
$$;

drop trigger if exists route_closure_reports_touch on public.route_closure_reports;
create trigger route_closure_reports_touch before insert or update on public.route_closure_reports
  for each row execute function public.route_closure_reports_touch();

-- Row Level Security: a student sees and changes only their own reports. Nobody can read who
-- else reported anything; the shared picture comes from the aggregate view below.
alter table public.route_closure_reports enable row level security;

revoke all on table public.route_closure_reports from anon;
grant select, insert, update, delete on table public.route_closure_reports to authenticated;

drop policy if exists "closures: select own" on public.route_closure_reports;
create policy "closures: select own" on public.route_closure_reports
  for select to authenticated using (auth.uid() = reporter_id);

drop policy if exists "closures: insert own" on public.route_closure_reports;
create policy "closures: insert own" on public.route_closure_reports
  for insert to authenticated with check (auth.uid() = reporter_id);

drop policy if exists "closures: update own" on public.route_closure_reports;
create policy "closures: update own" on public.route_closure_reports
  for update to authenticated using (auth.uid() = reporter_id) with check (auth.uid() = reporter_id);

drop policy if exists "closures: delete own" on public.route_closure_reports;
create policy "closures: delete own" on public.route_closure_reports
  for delete to authenticated using (auth.uid() = reporter_id);

-- What everyone is allowed to know: how many distinct accounts currently call a segment shut,
-- and when the most recent of those reports arrived. Counted, never stored, so there is no
-- tally to drift out of step with the rows. Reporter identities are not in it.
--
-- The window is 24 hours. Campus closures are mostly same-day facts: a tunnel locked for an
-- event, a corridor shut for cleaning, a path behind hoarding for a morning. A day is long
-- enough that a closure found at 9am still counts for the evening rush, and short enough that
-- something cleared overnight is not still diverting people the next afternoon. A closure that
-- really does last weeks stays in force because people keep meeting it and keep reporting,
-- and each report refreshes that account's row.
create or replace view public.route_closure_consensus as
  select
    edge_id,
    count(*)::int as reports,
    max(reported_at) as latest
  from public.route_closure_reports
  where status = 'CLOSED'
    and reported_at > now() - interval '24 hours'
  group by edge_id;

-- The view runs as its owner, so it can count rows the caller may not read. That is the point:
-- it exposes totals without exposing who. It selects no reporter_id, and anon gets nothing.
revoke all on public.route_closure_consensus from anon;
grant select on public.route_closure_consensus to authenticated;

comment on view public.route_closure_consensus is
  'Anonymised closure tallies: distinct accounts reporting each segment shut in the last 24 hours. Never exposes reporter identity.';
