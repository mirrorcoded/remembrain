-- Remembrain — Add tags column to entries (run in Supabase SQL Editor after prior migrations)

alter table public.entries
  add column if not exists tags text[] not null default '{}';

comment on column public.entries.tags is 'User/AI-assigned tags for filtering and search; max 5 per entry enforced in app.';
