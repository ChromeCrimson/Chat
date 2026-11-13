-- Run once in Supabase Dashboard → SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  status text not null default '',
  about text not null default '',
  theme text not null default 'paperwork',
  role text not null default 'member' check (role in ('member', 'moderator')),
  username_changed_at timestamptz,
  account_disabled boolean not null default false,
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
  name text not null default 'General Queue',
  description text not null default 'Messages are handled in the order received.',
  updated_at timestamptz not null default now()
);
insert into public.workspace_settings (id, name, description)
values ('main', 'General Queue', 'Messages are handled in the order received.')
on conflict (id) do nothing;

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (length(trim(content)) > 0 and length(content) <= 2000),
  reply_to uuid references public.direct_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint direct_messages_distinct_users check (sender_id <> recipient_id)
);
create index if not exists direct_messages_pair_created_idx on public.direct_messages(sender_id, recipient_id, created_at desc);
create index if not exists direct_messages_recipient_created_idx on public.direct_messages(recipient_id, created_at desc);

create table if not exists public.member_moderation (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  muted_until timestamptz,
  warning_count integer not null default 0,
  last_reason text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.workspace_settings enable row level security;
grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
revoke insert on public.profiles from authenticated;
grant insert (id, display_name, status, about, theme, created_at, updated_at) on public.profiles to authenticated;
grant update (display_name, status, about, theme, updated_at) on public.profiles to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, delete on public.message_reactions to authenticated;
grant select, update on public.workspace_settings to authenticated;
grant select, insert, update, delete on public.direct_messages to authenticated;
revoke update on public.direct_messages from authenticated;
grant update (content, reply_to, updated_at) on public.direct_messages to authenticated;
grant select on public.member_moderation to authenticated;

drop policy if exists "Profiles visible to members" on public.profiles;
create policy "Profiles visible to members" on public.profiles for select to authenticated using (true);
drop policy if exists "Members create their profile" on public.profiles;
create policy "Members create their profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "Members update their profile" on public.profiles;
create policy "Members update their profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create or replace function public.enforce_username_cooldown()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.display_name is distinct from old.display_name then
    if old.username_changed_at is not null and old.username_changed_at > now() - interval '24 hours' then
      raise exception 'You can change your username once every 24 hours.';
    end if;
    new.username_changed_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_username_cooldown on public.profiles;
create trigger profiles_username_cooldown before update on public.profiles for each row execute function public.enforce_username_cooldown();

drop policy if exists "Members read room messages" on public.messages;
create policy "Members read room messages" on public.messages for select to authenticated using (not exists (select 1 from public.profiles where id = auth.uid() and account_disabled));
drop policy if exists "Members send as themselves" on public.messages;
create policy "Members send as themselves" on public.messages for insert to authenticated with check (auth.uid() = user_id and not exists (select 1 from public.profiles where id = auth.uid() and account_disabled) and not exists (select 1 from public.member_moderation where user_id = auth.uid() and muted_until > now()));
drop policy if exists "Members edit their messages" on public.messages;
create policy "Members edit their messages" on public.messages for update to authenticated using (auth.uid() = user_id and not exists (select 1 from public.profiles where id = auth.uid() and account_disabled)) with check (auth.uid() = user_id and not exists (select 1 from public.profiles where id = auth.uid() and account_disabled));
drop policy if exists "Members delete their messages" on public.messages;
create policy "Members delete their messages" on public.messages for delete to authenticated using (auth.uid() = user_id and not exists (select 1 from public.profiles where id = auth.uid() and account_disabled));
drop policy if exists "Moderators delete room messages" on public.messages;
create policy "Moderators delete room messages" on public.messages for delete to authenticated using (exists (select 1 from public.profiles where id = auth.uid() and role = 'moderator'));

drop policy if exists "Members read reactions" on public.message_reactions;
create policy "Members read reactions" on public.message_reactions for select to authenticated using (true);
drop policy if exists "Members react as themselves" on public.message_reactions;
create policy "Members react as themselves" on public.message_reactions for insert to authenticated with check (auth.uid() = user_id and not exists (select 1 from public.profiles where id = auth.uid() and account_disabled));
drop policy if exists "Members remove their reactions" on public.message_reactions;
create policy "Members remove their reactions" on public.message_reactions for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "Members read server settings" on public.workspace_settings;
create policy "Members read server settings" on public.workspace_settings for select to authenticated using (true);
drop policy if exists "Moderators edit server settings" on public.workspace_settings;
create policy "Moderators edit server settings" on public.workspace_settings for update to authenticated using (exists (select 1 from public.profiles where id = auth.uid() and role = 'moderator')) with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'moderator'));

alter table public.direct_messages enable row level security;
alter table public.member_moderation enable row level security;
drop policy if exists "Participants read direct messages" on public.direct_messages;
create policy "Participants read direct messages" on public.direct_messages for select to authenticated using ((auth.uid() = sender_id or auth.uid() = recipient_id) and not exists (select 1 from public.profiles where id = auth.uid() and account_disabled));
drop policy if exists "Members send direct messages to real members" on public.direct_messages;
create policy "Members send direct messages to real members" on public.direct_messages for insert to authenticated with check (auth.uid() = sender_id and sender_id <> recipient_id and exists (select 1 from public.profiles where id = recipient_id and not account_disabled) and not exists (select 1 from public.profiles where id = auth.uid() and account_disabled) and not exists (select 1 from public.member_moderation where user_id = auth.uid() and muted_until > now()));
drop policy if exists "Senders edit their direct messages" on public.direct_messages;
create policy "Senders edit their direct messages" on public.direct_messages for update to authenticated using (auth.uid() = sender_id and not exists (select 1 from public.profiles where id = auth.uid() and account_disabled)) with check (auth.uid() = sender_id and not exists (select 1 from public.profiles where id = auth.uid() and account_disabled));
drop policy if exists "Participants delete direct messages" on public.direct_messages;
create policy "Participants delete direct messages" on public.direct_messages for delete to authenticated using ((auth.uid() = sender_id or auth.uid() = recipient_id) and not exists (select 1 from public.profiles where id = auth.uid() and account_disabled));
drop policy if exists "Members see own moderation state" on public.member_moderation;
create policy "Members see own moderation state" on public.member_moderation for select to authenticated using (auth.uid() = user_id or exists (select 1 from public.profiles where id = auth.uid() and role = 'moderator'));

create or replace function public.moderate_member(target_user uuid, moderation_action text, duration_minutes integer default null, reason_text text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'moderator') then
    raise exception 'Moderator access required.';
  end if;
  if target_user = auth.uid() and moderation_action in ('demote', 'timeout', 'disable') then
    raise exception 'You cannot demote, timeout, or disable your own account.';
  end if;
  if not exists (select 1 from public.profiles where id = target_user) then raise exception 'Member not found.'; end if;
  if moderation_action = 'promote' then
    update public.profiles set role = 'moderator' where id = target_user;
  elsif moderation_action = 'demote' then
    if (select count(*) from public.profiles where role = 'moderator') <= 1 then raise exception 'The last moderator cannot be demoted.'; end if;
    update public.profiles set role = 'member' where id = target_user;
  elsif moderation_action = 'disable' then
    if exists (select 1 from public.profiles where id = target_user and role = 'moderator') then raise exception 'Remove moderator access before disabling this account.'; end if;
    update public.profiles set account_disabled = true where id = target_user;
  elsif moderation_action = 'enable' then
    update public.profiles set account_disabled = false where id = target_user;
  elsif moderation_action in ('warn', 'timeout', 'clear_timeout') then
    insert into public.member_moderation(user_id, muted_until, warning_count, last_reason, updated_by)
    values (target_user,
      case when moderation_action = 'timeout' then now() + make_interval(mins => greatest(coalesce(duration_minutes, 10), 1)) else null end,
      case when moderation_action = 'warn' then 1 else 0 end,
      coalesce(reason_text, ''), auth.uid())
    on conflict (user_id) do update set
      muted_until = case when moderation_action = 'timeout' then now() + make_interval(mins => greatest(coalesce(duration_minutes, 10), 1)) when moderation_action = 'clear_timeout' then null else member_moderation.muted_until end,
      warning_count = member_moderation.warning_count + case when moderation_action = 'warn' then 1 else 0 end,
      last_reason = coalesce(reason_text, ''), updated_by = auth.uid(), updated_at = now();
  else
    raise exception 'Unknown moderator action.';
  end if;
end;
$$;
revoke all on function public.moderate_member(uuid, text, integer, text) from public;
grant execute on function public.moderate_member(uuid, text, integer, text) to authenticated;

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
do $$ begin
  alter publication supabase_realtime add table public.direct_messages;
exception when duplicate_object then null; end $$;

