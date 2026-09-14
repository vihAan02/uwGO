-- Rollback for supabase/migrations/20260912000000_route_closure_reports.sql.
-- Not a migration: Supabase applies files in supabase/migrations only. Run by hand in the SQL
-- editor. This DELETES every closure report; routing goes back to ignoring closures.

drop view if exists public.route_closure_consensus;
drop function if exists private.route_closure_tallies();
drop trigger if exists route_closure_reports_touch on public.route_closure_reports;
drop function if exists public.route_closure_reports_touch();
drop table if exists public.route_closure_reports;

-- The migration created `private` for the tally function. Remove it only if nothing else has
-- been put there since; a schema someone else now relies on is left alone.
do $$
begin
  drop schema if exists private;
exception
  when dependent_objects_still_exist then null;
end;
$$;
