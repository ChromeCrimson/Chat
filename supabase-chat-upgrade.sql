-- Run once after the original Supabase schema to enable the Nocturne directory, DMs, username timer, and moderator tools.
alter table public.profiles add column if not exists role text not null default 'member';
alter table public.profiles add column if not exists username_changed_at timestamptz;
do $$ begin alter table public.profiles add constraint profiles_role_allowed check (role in ('member','moderator')); exception when duplicate_object then null; end $$;

-- Members can read profiles, edit their own public fields, and cannot assign their own role.
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant insert (id,display_name,status,about,theme,created_at,updated_at) on public.profiles to authenticated;
grant update (display_name,status,about,theme,updated_at) on public.profiles to authenticated;

create table if not exists public.workspace_settings (
 id text primary key check (id='main'), name text not null default 'Nocturne House', description text not null default 'Find your people after dark.', updated_at timestamptz not null default now()
);
insert into public.workspace_settings(id,name,description) values('main','Nocturne House','Find your people after dark.') on conflict(id) do nothing;
alter table public.workspace_settings enable row level security;
grant select,update on public.workspace_settings to authenticated;
drop policy if exists "Members read server settings" on public.workspace_settings;
create policy "Members read server settings" on public.workspace_settings for select to authenticated using(true);
drop policy if exists "Moderators edit server settings" on public.workspace_settings;
create policy "Moderators edit server settings" on public.workspace_settings for update to authenticated using(exists(select 1 from public.profiles where id=auth.uid() and role='moderator')) with check(exists(select 1 from public.profiles where id=auth.uid() and role='moderator'));

create table if not exists public.direct_messages (
 id uuid primary key default gen_random_uuid(), sender_id uuid not null references public.profiles(id) on delete cascade,
 recipient_id uuid not null references public.profiles(id) on delete cascade, content text not null check(length(trim(content))>0 and length(content)<=2000),
 reply_to uuid references public.direct_messages(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint direct_messages_distinct_users check(sender_id<>recipient_id)
);
create index if not exists direct_messages_pair_created_idx on public.direct_messages(sender_id,recipient_id,created_at desc);
create index if not exists direct_messages_recipient_created_idx on public.direct_messages(recipient_id,created_at desc);
create table if not exists public.member_moderation (
 user_id uuid primary key references public.profiles(id) on delete cascade, muted_until timestamptz, warning_count integer not null default 0,
 last_reason text not null default '', updated_by uuid references public.profiles(id) on delete set null, updated_at timestamptz not null default now()
);
alter table public.direct_messages enable row level security;
grant select,insert,update,delete on public.direct_messages to authenticated;
revoke update on public.direct_messages from authenticated;
grant update (content,reply_to,updated_at) on public.direct_messages to authenticated;
drop policy if exists "Participants read direct messages" on public.direct_messages;
create policy "Participants read direct messages" on public.direct_messages for select to authenticated using(auth.uid()=sender_id or auth.uid()=recipient_id);
drop policy if exists "Members send direct messages to real members" on public.direct_messages;
create policy "Members send direct messages to real members" on public.direct_messages for insert to authenticated with check(auth.uid()=sender_id and sender_id<>recipient_id and exists(select 1 from public.profiles where id=recipient_id) and not exists(select 1 from public.member_moderation where user_id=auth.uid() and muted_until>now()));
drop policy if exists "Senders edit their direct messages" on public.direct_messages;
create policy "Senders edit their direct messages" on public.direct_messages for update to authenticated using(auth.uid()=sender_id) with check(auth.uid()=sender_id);
drop policy if exists "Participants delete direct messages" on public.direct_messages;
create policy "Participants delete direct messages" on public.direct_messages for delete to authenticated using(auth.uid()=sender_id or auth.uid()=recipient_id);

create table if not exists public.member_moderation (
 user_id uuid primary key references public.profiles(id) on delete cascade, muted_until timestamptz, warning_count integer not null default 0,
 last_reason text not null default '', updated_by uuid references public.profiles(id) on delete set null, updated_at timestamptz not null default now()
);
alter table public.member_moderation enable row level security;
grant select on public.member_moderation to authenticated;
drop policy if exists "Members see own moderation state" on public.member_moderation;
create policy "Members see own moderation state" on public.member_moderation for select to authenticated using(auth.uid()=user_id or exists(select 1 from public.profiles where id=auth.uid() and role='moderator'));

-- Shared room-message deletion can be done by the author or a moderator; timed-out accounts cannot post.
drop policy if exists "Members delete their messages" on public.messages;
create policy "Members delete their messages" on public.messages for delete to authenticated using(auth.uid()=user_id);
drop policy if exists "Moderators delete room messages" on public.messages;
create policy "Moderators delete room messages" on public.messages for delete to authenticated using(exists(select 1 from public.profiles where id=auth.uid() and role='moderator'));
drop policy if exists "Members send as themselves" on public.messages;
create policy "Members send as themselves" on public.messages for insert to authenticated with check(auth.uid()=user_id and not exists(select 1 from public.member_moderation where user_id=auth.uid() and muted_until>now()));

create or replace function public.enforce_username_cooldown()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.display_name is distinct from old.display_name then
  if old.username_changed_at is not null and old.username_changed_at>now()-interval '24 hours' then raise exception 'You can change your username once every 24 hours.'; end if;
  new.username_changed_at:=now();
 end if;
 return new;
end;
$$;
drop trigger if exists profiles_username_cooldown on public.profiles;
create trigger profiles_username_cooldown before update on public.profiles for each row execute function public.enforce_username_cooldown();

create or replace function public.moderate_member(target_user uuid,moderation_action text,duration_minutes integer default null,reason_text text default '')
returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='moderator') then raise exception 'Moderator access required.'; end if;
 if target_user=auth.uid() and moderation_action in('demote','timeout') then raise exception 'You cannot demote or timeout your own account.'; end if;
 if not exists(select 1 from public.profiles where id=target_user) then raise exception 'Member not found.'; end if;
 if moderation_action='promote' then update public.profiles set role='moderator' where id=target_user;
 elsif moderation_action='demote' then
  if (select count(*) from public.profiles where role='moderator')<=1 then raise exception 'The last moderator cannot be demoted.'; end if;
  update public.profiles set role='member' where id=target_user;
 elsif moderation_action in('warn','timeout','clear_timeout') then
  insert into public.member_moderation(user_id,muted_until,warning_count,last_reason,updated_by)
  values(target_user,case when moderation_action='timeout' then now()+make_interval(mins=>greatest(coalesce(duration_minutes,10),1)) else null end,case when moderation_action='warn' then 1 else 0 end,coalesce(reason_text,''),auth.uid())
  on conflict(user_id) do update set muted_until=case when moderation_action='timeout' then now()+make_interval(mins=>greatest(coalesce(duration_minutes,10),1)) when moderation_action='clear_timeout' then null else member_moderation.muted_until end,
  warning_count=member_moderation.warning_count+case when moderation_action='warn' then 1 else 0 end,last_reason=coalesce(reason_text,''),updated_by=auth.uid(),updated_at=now();
 else raise exception 'Unknown moderator action.';
 end if;
end;
$$;
revoke all on function public.moderate_member(uuid,text,integer,text) from public;
grant execute on function public.moderate_member(uuid,text,integer,text) to authenticated;

do $$ begin alter publication supabase_realtime add table public.workspace_settings; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.direct_messages; exception when duplicate_object then null; end $$;

-- After creating your account, promote the first moderator using the SQL below.
-- update public.profiles set role='moderator' where id=(select id from auth.users where email='YOUR_ACCOUNT_EMAIL');

