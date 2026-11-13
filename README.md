# The General Chat Department

A deliberately ordinary-looking chat site with an unreasonably thorough filing system. Built for GitHub Pages and Supabase, with one shared server, real accounts, searchable members, and private cross-device conversations.

## Features

- Searchable member directory; private conversations can only start with an actual account
- Profiles with a public account ID, status, about text, and synced themes
- Username changes are limited to once every 24 hours in the interface and database
- Room chat with replies, mentions, reactions, file attachments, edits, deletes, saved messages, search, and live typing/presence
- Private DMs with reply, edit, delete, and a recent-conversation list
- One shared server, nine appearance themes, animated transitions, custom right-click menus, and mobile navigation
- Downloadable plain-text room transcripts
- Moderator desk with member warnings, timed timeouts, clear-timeout, role changes, room-message removal, and server editing
- Original custom logo and paper-stack illustration in `assets/`
- Compact sync card that clearly shows whether an account is signed in

## Publish and connect Supabase

1. Publish the repository root from the `main` branch in **GitHub → Settings → Pages**.
2. In Supabase, enable email/password authentication and add the GitHub Pages URL under **Authentication → URL Configuration**.
3. For a new project, run [`supabase-schema.sql`](supabase-schema.sql). For the existing project, run [`supabase-chat-upgrade.sql`](supabase-chat-upgrade.sql) if the member/DM/moderator features are not installed yet.
4. Run [`supabase-rebrand.sql`](supabase-rebrand.sql) in an existing project to change the old shared server name and default theme to the new brand.
5. Ensure `config.js` contains the project URL and public publishable key. Never put a secret or `service_role` key in browser code.
6. Create an account from **Your profile**. To give the first account moderator access, run the SQL example at the end of `supabase-chat-upgrade.sql`, replacing the example email with the account email.

## Right-click and accessibility

Right-click messages, rooms, members, or the server for available actions. Text fields keep the browser's regular copy/paste menu. Motion effects honor `prefers-reduced-motion`.

Voice rooms remain visual hangout placeholders; voice calling needs a separate media service.
