-- Rollback for 20260912000000_route_closure_reports.sql.
drop view if exists public.route_closure_consensus;
drop trigger if exists route_closure_reports_touch on public.route_closure_reports;
drop function if exists public.route_closure_reports_touch();
drop table if exists public.route_closure_reports;
