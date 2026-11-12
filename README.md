# Vanta — Afterhours Club

A gradient-led community website for GitHub Pages. The local preview works without a backend. Connect Supabase to enable real accounts, cross-device profiles, and shared live room messages.

## Included features

- Eight dark themes; account holders can sync their chosen theme
- Sign-up and sign-in with email and password
- Profiles with display name, status, and about text, linked to an account
- Shared, realtime room messages, replies, message edits and deletes, reactions, and presence count
- Search, local pinboard, room navigation, event RSVP, and mobile layout
- Browser-local preview mode when no Supabase project is configured

## Turn on accounts and shared chat

GitHub Pages only serves static files, so it cannot store user accounts or shared messages by itself. Supabase provides the hosted database and authentication.

1. Create a project at [supabase.com](https://supabase.com/) and verify email/password sign-in is enabled in **Authentication → Providers**.
2. In **SQL Editor**, run the complete contents of [`supabase-schema.sql`](supabase-schema.sql). It creates profiles, messages, reactions, row-level access rules, and realtime publication settings.
3. In **Project Settings → API Keys**, copy the project URL and the **publishable** key (or legacy `anon` key). Never put a secret or `service_role` key in a website.
4. Copy `config.example.js` to `config.js` and replace the two placeholder values.
5. Publish the contents of this folder from the root of your GitHub repository using **Settings → Pages**.
6. In Supabase **Authentication → URL Configuration**, set the Site URL to your published GitHub Pages address and add that same address to the allowed Redirect URLs.
7. Open the published site and create an account. Verify the email if Supabase asks. Use that same email and password on another computer to load the same profile and room history.

The Supabase URL and anon/public key are designed to be used in a browser. The included SQL enables row-level security so signed-in visitors can edit only their own profile and messages. Review the policies before opening the service to a large public community.

## What stays local

The pinboard, temporary rooms, RSVP, and direct-message preview are stored in the current browser. Shared room messages, small attachments, reactions, account profiles, and presence use Supabase after sign-in. Voice rooms and GIF search need separate realtime/media services.

