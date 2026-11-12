# Vanta — One community server

A gradient-led community chat website for GitHub Pages. People can sign in from different computers and keep profiles and shared room messages synced with Supabase.

## Features

- One shared server, with editable name and description
- Member profiles and cross-device accounts
- Shared room chat with live updates, reactions, replies, attachments, and presence
- Direct messages, themes, search, and saved messages
- Moderator badges, server editing, and moderator message removal
- Custom right-click menus for messages, rooms, members, and server settings
- No browser prompt or confirm dialogs; forms and confirmations stay inside the site
- Mobile layout and eight dark themes

## Publish the site

1. In the GitHub repository, choose **Settings → Pages** and publish from the `main` branch root.
2. In Supabase, enable email and password sign-in.
3. If setting up a fresh Supabase project, run [`supabase-schema.sql`](supabase-schema.sql) in its SQL Editor. If you already ran the earlier schema, run [`supabase-moderators-migration.sql`](supabase-moderators-migration.sql) instead.
4. Confirm `config.js` contains your Supabase project URL and public publishable key. Never put a `service_role` or secret key in the website.
5. In Supabase **Authentication → URL Configuration**, add your GitHub Pages address as the Site URL and an allowed redirect URL.
6. Create your account on the published site. To make the first moderator, run the commented SQL statement at the end of `supabase-moderators-migration.sql`, replacing `YOUR_ACCOUNT_EMAIL` with the email used for your account.

Moderators can edit the shared server name and description, and delete any room message. Other members can edit or remove their own messages. Moderator access is assigned through Supabase SQL so members cannot promote themselves.

## Right-click menu

Right-click a message, room, member, or the server to see available actions. It uses the browser-standard `contextmenu` event, supported by current desktop browsers including Opera GX. Right-click remains native inside text fields so the normal copy/paste menu works. Keyboard users can open the same menu with the Context Menu key or Shift+F10 when an item has focus.

## Local preview limits

If Supabase is not configured, the site works as a local preview. Direct-message previews and rooms created in preview mode are stored only in that browser. Voice chat needs a separate voice service.
