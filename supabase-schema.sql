-- Run once in Supabase Dashboard → SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'New member',
  status text not null default 'Around',
  about text not null default '',
  theme text not null default 'midnight',
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

alter table public.profiles enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.messages, public.message_reactions to authenticated;

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

drop policy if exists "Members read reactions" on public.message_reactions;
create policy "Members read reactions" on public.message_reactions for select to authenticated using (true);
drop policy if exists "Members react as themselves" on public.message_reactions;
create policy "Members react as themselves" on public.message_reactions for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Members remove their reactions" on public.message_reactions;
create policy "Members remove their reactions" on public.message_reactions for delete to authenticated using (auth.uid() = user_id);

-- Enable realtime updates for shared room messages and reaction counts.
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.message_reactions;
exception when duplicate_object then null; end $$;

