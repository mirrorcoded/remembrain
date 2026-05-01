-- Remembrain — Step 1: entries.user_id + RLS (run in Supabase SQL Editor)
-- Existing rows keep user_id NULL until you run the backfill script.

alter table public.entries
  add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists entries_user_id_idx on public.entries (user_id);

-- On INSERT, default user_id from the JWT when the client omits it (matches RLS WITH CHECK).
create or replace function public.entries_set_user_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists entries_set_user_id_trigger on public.entries;
create trigger entries_set_user_id_trigger
  before insert on public.entries
  for each row
  execute function public.entries_set_user_id();

alter table public.entries enable row level security;

drop policy if exists "entries_select_own" on public.entries;
drop policy if exists "entries_insert_own" on public.entries;
drop policy if exists "entries_update_own" on public.entries;
drop policy if exists "entries_delete_own" on public.entries;

create policy "entries_select_own"
  on public.entries
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "entries_insert_own"
  on public.entries
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "entries_update_own"
  on public.entries
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "entries_delete_own"
  on public.entries
  for delete
  to authenticated
  using (user_id = auth.uid());
