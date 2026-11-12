-- Run once after the original supabase-schema.sql if that schema is already installed.
alter table public.profiles add column if not exists role text not null default 'member';

do $$ begin
  alter table public.profiles add constraint profiles_role_allowed check (role in ('member', 'moderator'));
exception when duplicate_object then null; end $$;

-- Members may edit their own profile fields, but cannot grant themselves a moderator role.
revoke insert, update on public.profiles from authenticated;
grant select, delete on public.profiles to authenticated;
grant insert (id, display_name, status, about, theme, created_at, updated_at) on public.profiles to authenticated;
grant update (display_name, status, about, theme, updated_at) on public.profiles to authenticated;

create table if not exists public.workspace_settings (
  id text primary key check (id = 'main'),
  name text not null default 'Afterhours Club',
  description text not null default 'A little space for big ideas.',
  updated_at timestamptz not null default now()
);
insert into public.workspace_settings (id, name, description)
values ('main', 'Afterhours Club', 'A little space for big ideas.')
on conflict (id) do nothing;
alter table public.workspace_settings enable row level security;
grant select, update on public.workspace_settings to authenticated;

drop policy if exists "Members read server settings" on public.workspace_settings;
create policy "Members read server settings" on public.workspace_settings for select to authenticated using (true);
drop policy if exists "Moderators edit server settings" on public.workspace_settings;
create policy "Moderators edit server settings" on public.workspace_settings for update to authenticated
using (exists (select 1 from public.profiles where id = auth.uid() and role = 'moderator'))
with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'moderator'));

drop policy if exists "Moderators delete room messages" on public.messages;
create policy "Moderators delete room messages" on public.messages for delete to authenticated
using (exists (select 1 from public.profiles where id = auth.uid() and role = 'moderator'));

do $$ begin
  alter publication supabase_realtime add table public.workspace_settings;
exception when duplicate_object then null; end $$;

-- After creating your account, run this separately to make yourself a moderator:
-- update public.profiles set role = 'moderator'
-- where id = (select id from auth.users where email = 'YOUR_ACCOUNT_EMAIL');

