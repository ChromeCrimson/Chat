-- Run once in Supabase Dashboard → SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'New member',
  status text not null default 'Around',
  about text not null default '',
  theme text not null default 'midnight',
  role text not null default 'member' check (role in ('member', 'moderator')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  files jsonb not null default '[]'::jsonb,
  reply_to uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messages_content_or_files check (length(content) > 0 or files <> '[]'::jsonb)
);
create index if not exists messages_channel_created_idx on public.messages(channel, created_at desc);

create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique(message_id, user_id, emoji)
);

create table if not exists public.workspace_settings (
  id text primary key check (id = 'main'),
  name text not null default 'Afterhours Club',
  description text not null default 'A little space for big ideas.',
  updated_at timestamptz not null default now()
);
insert into public.workspace_settings (id, name, description)
values ('main', 'Afterhours Club', 'A little space for big ideas.')
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.workspace_settings enable row level security;
grant usage on schema public to authenticated;
grant select, delete on public.profiles to authenticated;
revoke insert on public.profiles from authenticated;
grant insert (id, display_name, status, about, theme, created_at, updated_at) on public.profiles to authenticated;
grant update (display_name, status, about, theme, updated_at) on public.profiles to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, delete on public.message_reactions to authenticated;
grant select, update on public.workspace_settings to authenticated;

drop policy if exists "Profiles visible to members" on public.profiles;
create policy "Profiles visible to members" on public.profiles for select to authenticated using (true);
drop policy if exists "Members create their profile" on public.profiles;
create policy "Members create their profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "Members update their profile" on public.profiles;
create policy "Members update their profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Members read room messages" on public.messages;
create policy "Members read room messages" on public.messages for select to authenticated using (true);
drop policy if exists "Members send as themselves" on public.messages;
create policy "Members send as themselves" on public.messages for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Members edit their messages" on public.messages;
create policy "Members edit their messages" on public.messages for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Members delete their messages" on public.messages;
create policy "Members delete their messages" on public.messages for delete to authenticated using (auth.uid() = user_id);
drop policy if exists "Moderators delete room messages" on public.messages;
create policy "Moderators delete room messages" on public.messages for delete to authenticated using (exists (select 1 from public.profiles where id = auth.uid() and role = 'moderator'));

drop policy if exists "Members read reactions" on public.message_reactions;
create policy "Members read reactions" on public.message_reactions for select to authenticated using (true);
drop policy if exists "Members react as themselves" on public.message_reactions;
create policy "Members react as themselves" on public.message_reactions for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Members remove their reactions" on public.message_reactions;
create policy "Members remove their reactions" on public.message_reactions for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "Members read server settings" on public.workspace_settings;
create policy "Members read server settings" on public.workspace_settings for select to authenticated using (true);
drop policy if exists "Moderators edit server settings" on public.workspace_settings;
create policy "Moderators edit server settings" on public.workspace_settings for update to authenticated using (exists (select 1 from public.profiles where id = auth.uid() and role = 'moderator')) with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'moderator'));

-- Enable realtime updates for shared room messages and reaction counts.
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.message_reactions;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.workspace_settings;
exception when duplicate_object then null; end $$;

