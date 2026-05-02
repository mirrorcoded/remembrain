-- Remembrain — Chat threads + messages (run in Supabase SQL Editor after previous migrations)

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_threads_user_id_updated_at_idx
  on public.chat_threads (user_id, updated_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_thread_id_created_at_idx
  on public.chat_messages (thread_id, created_at);

-- Default user_id from JWT on insert (matches RLS WITH CHECK).
create or replace function public.chat_threads_set_user_id()
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

drop trigger if exists chat_threads_set_user_id_trigger on public.chat_threads;
create trigger chat_threads_set_user_id_trigger
  before insert on public.chat_threads
  for each row
  execute function public.chat_threads_set_user_id();

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "chat_threads_select_own" on public.chat_threads;
drop policy if exists "chat_threads_insert_own" on public.chat_threads;
drop policy if exists "chat_threads_update_own" on public.chat_threads;
drop policy if exists "chat_threads_delete_own" on public.chat_threads;

create policy "chat_threads_select_own"
  on public.chat_threads
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "chat_threads_insert_own"
  on public.chat_threads
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "chat_threads_update_own"
  on public.chat_threads
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "chat_threads_delete_own"
  on public.chat_threads
  for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "chat_messages_select_own" on public.chat_messages;
drop policy if exists "chat_messages_insert_own" on public.chat_messages;
drop policy if exists "chat_messages_update_own" on public.chat_messages;
drop policy if exists "chat_messages_delete_own" on public.chat_messages;

create policy "chat_messages_select_own"
  on public.chat_messages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.chat_threads t
      where t.id = chat_messages.thread_id and t.user_id = auth.uid()
    )
  );

create policy "chat_messages_insert_own"
  on public.chat_messages
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.chat_threads t
      where t.id = chat_messages.thread_id and t.user_id = auth.uid()
    )
  );

create policy "chat_messages_update_own"
  on public.chat_messages
  for update
  to authenticated
  using (
    exists (
      select 1 from public.chat_threads t
      where t.id = chat_messages.thread_id and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.chat_threads t
      where t.id = chat_messages.thread_id and t.user_id = auth.uid()
    )
  );

create policy "chat_messages_delete_own"
  on public.chat_messages
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.chat_threads t
      where t.id = chat_messages.thread_id and t.user_id = auth.uid()
    )
  );
