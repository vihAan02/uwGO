# Supabase setup for UW GO sign-in

UW GO uses Supabase Auth with passwordless email sign-in by one-time code. There is no
sign-in link: the student types the code from the email into the sign-in page. Only
`@uwaterloo.ca` addresses may sign in; that is enforced in the form, in `/api/auth/send`, in
the request proxy, and by a database trigger on `auth.users`, so calling Supabase directly
does not get around it.

## Dashboard, once

1. Create a project. Project Settings -> API: copy the **Project URL** and the **anon /
   publishable key** into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Do not copy the service_role key anywhere in this repo.
2. SQL Editor: run `supabase/migrations/20260910000000_waterloo_only_and_profiles.sql`.
   It adds the Waterloo-only trigger, the `profiles` table with Row Level Security, and the
   trigger that creates a profile row for each new user. Then run
   `supabase/migrations/20260911000000_user_state.sql`: it adds `public.user_state`, where each
   student's schedule and preferences are saved, and copies over any preferences already in
   `profiles`. Run it before deploying an app version that reads `user_state`. To undo it, run
   `supabase/rollbacks/20260911000000_user_state.down.sql`, which deletes every saved schedule.
3. Authentication -> Providers -> Email: keep **Enable email provider** on. Turn **Confirm
   email** on (it is the default). Leave passwords off if you like; the app never uses them.
4. Authentication -> URL Configuration: set Site URL to your deployed origin (e.g.
   `https://uwgo.example`). No redirect URLs are needed, because sign-in never uses a link.
5. Authentication -> Email Templates: put the code, and no link, in **both** templates.
   **Magic Link** is sent to a returning student; **Confirm signup** is sent the first time an
   address signs in. The default templates contain only a link, so a student would get an
   email with nothing to type. Subject: `Your UW GO sign-in code`. Body:

   ```html
   <h2>Your UW GO sign-in code</h2>
   <p>Enter this code on the UW GO sign-in page:</p>
   <p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
   <p>If you did not try to sign in, you can ignore this email.</p>
   ```

   The sign-in page accepts codes of 6 to 10 digits, so the **Email OTP Length** setting
   under Providers -> Email can stay at its default.
6. Authentication -> Rate Limits: the defaults are fine. Supabase's built-in email sender is
   limited to a few emails per hour per project; set up a custom SMTP sender before sharing
   the app widely.

## What is stored where

- Supabase `auth.users`: the Waterloo email and Supabase's own session data.
- Supabase `public.user_state`: one row per student with the parsed schedule and preferences
  (home, arrival buffer, gym, route preference) as JSON, and whether onboarding is complete.
  Row Level Security allows select, insert, update and delete only where `auth.uid() = user_id`.
  The app uses the public anon key and the student's session; no service-role key is used.
- Supabase `public.profiles`: still created for each new account by the sign-up trigger, but the
  app no longer reads or writes it. Its preferences were copied into `user_state`.
- The device (localStorage): a copy of the schedule and preferences, tagged with the account it
  belongs to, plus per-device state that is never uploaded: gap answers, reminders, PAC samples
  and the route cache. On sign-in the account's copy wins, unless the device has newer unsaved
  changes or has a schedule the account lacks. A copy tagged with another account is discarded.
  Signing out clears the device copy.
- Never stored by the app: sign-in codes, session tokens, API keys, computed routes and map state.

## Local development without a project

Set `UWGO_DEV_SKIP_AUTH=1` in `.env.local`. It is honoured only by development builds and
treats everyone as `dev@uwaterloo.ca`. Production builds ignore it and fail closed: without
Supabase keys nobody can sign in.
