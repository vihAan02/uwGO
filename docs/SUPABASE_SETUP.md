# Supabase setup for UW GO sign-in

UW GO uses Supabase Auth with passwordless email sign-in (magic link, plus a 6-digit code
for reading the email on another device). Only `@uwaterloo.ca` addresses may sign in; that
is enforced in the form, in `/api/auth/send`, in the auth callback, in the request proxy, and
by a database trigger on `auth.users`, so calling Supabase directly does not get around it.

## Dashboard, once

1. Create a project. Project Settings -> API: copy the **Project URL** and the **anon /
   publishable key** into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Do not copy the service_role key anywhere in this repo.
2. SQL Editor: run `supabase/migrations/20260910000000_waterloo_only_and_profiles.sql`.
   It adds the Waterloo-only trigger, the `profiles` table with Row Level Security, and the
   trigger that creates a profile row for each new user.
3. Authentication -> Providers -> Email: keep **Enable email provider** on. Turn **Confirm
   email** on (it is the default). Leave passwords off if you like; the app never uses them.
4. Authentication -> URL Configuration:
   - Site URL: your deployed origin (e.g. `https://uwgo.example`).
   - Redirect URLs: `https://uwgo.example/auth/callback` and `http://localhost:3010/auth/callback`
     (and any other local port you use).
5. Authentication -> Email Templates -> **Magic Link**: recommended body, which gives both a
   link that works on the device that asked and a code that works anywhere:

   ```html
   <h2>Sign in to UW GO</h2>
   <p><a href="{{ .ConfirmationURL }}">Open UW GO</a> on the device you signed in from.</p>
   <p>On another device, enter this code instead: <strong>{{ .Token }}</strong></p>
   ```

   The default template (link only) also works.
6. Authentication -> Rate Limits: the defaults are fine. Supabase's built-in email sender is
   limited to a few emails per hour per project; set up a custom SMTP sender before sharing
   the app widely.

## What is stored where

- Supabase `auth.users`: the Waterloo email and Supabase's own session data.
- Supabase `public.profiles`: one row per user with gym on/off, gym duration, preferred gym
  time, route preference and arrival buffer. Readable and writable only by that user (RLS).
- The device (localStorage): the schedule, home, the same preferences, reminders, PAC samples
  and the route cache. The device is the source of truth; the profile is a backup that a new
  device picks up when it has no local answers yet.

## Local development without a project

Set `UWGO_DEV_SKIP_AUTH=1` in `.env.local`. It is honoured only by development builds and
treats everyone as `dev@uwaterloo.ca`. Production builds ignore it and fail closed: without
Supabase keys nobody can sign in.
