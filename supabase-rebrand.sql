-- Run in Supabase SQL Editor to update existing shared branding without changing member data.
update public.workspace_settings
set name = 'General Queue', description = 'Messages are handled in the order received.'
where id = 'main' and name in ('Nocturne House', 'Afterhours Club');

-- Move profiles still on the old default palette to the new neutral office theme.
update public.profiles set theme = 'paperwork' where theme = 'midnight';
