# Nocturne

Nocturne is a sleek, animated dark community chat built for GitHub Pages. Its single shared community has rooms and a real member directory; direct messages are private conversations between signed-in member accounts.

## Features

- Searchable member directory; DMs can only start with an existing account
- Account profiles with public Nocturne ID, status, about text, and synced themes
- Username changes are limited to once every 24 hours in both the interface and database
- Shared room chat with replies, @mentions, reactions, file attachments, edits, deletes, saved messages, search, and live presence
- Private cross-device DMs with reply, edit, and delete actions
- One editable community server, eight themes, custom right-click menus, keyboard focus states, motion effects, and mobile navigation
- Moderator profile tools: warn, 10-minute timeout, clear timeout, promote/demote moderator, remove any room message, and edit server details
- Custom Nocturne logo and atmospheric banner art in `assets/`

## Publish and connect Supabase

1. Publish the repository root from the `main` branch in **GitHub → Settings → Pages**.
2. In Supabase, enable email/password authentication and configure the GitHub Pages URL under **Authentication → URL Configuration**.
3. For a brand-new Supabase project, run [`supabase-schema.sql`](supabase-schema.sql) in the SQL Editor. If the project already uses the original schema or earlier moderator migration, run [`supabase-chat-upgrade.sql`](supabase-chat-upgrade.sql) instead.
4. Ensure `config.js` contains the project URL and public publishable key. Do not put a secret or `service_role` key in browser code.
5. Create your account through **Your profile** on the published site. To assign the first moderator, run the SQL statement commented at the end of `supabase-chat-upgrade.sql`, replacing `YOUR_ACCOUNT_EMAIL` with the account email.

The upgrade adds member search and DM storage, server settings, username cooldown enforcement, moderator roles, warnings, and timed silencing. The first moderator is intentionally assigned through the Supabase SQL Editor; members cannot give themselves moderator access.

## Right-click and accessibility

Right-click messages, rooms, members, and the server for contextual actions. The site uses the standard `contextmenu` event supported by desktop browsers, including Opera GX; text fields preserve the browser's normal copy/paste menu. Animations honor `prefers-reduced-motion`.

Voice rooms are visual hangout placeholders; voice calling requires a separate media service.
