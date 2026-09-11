-- Rollback for supabase/migrations/20260911000000_user_state.sql.
-- Not a migration: Supabase applies files in supabase/migrations only. Run by hand in the SQL
-- editor. This DELETES every saved schedule and preference in public.user_state; students would
-- have to paste their schedule again. public.profiles is not touched.

drop trigger if exists user_state_touch on public.user_state;
drop function if exists public.user_state_touch();
drop table if exists public.user_state;
