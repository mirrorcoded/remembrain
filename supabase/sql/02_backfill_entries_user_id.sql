-- Remembrain — Step 6: backfill legacy rows (run AFTER you create your Supabase Auth user)
--
-- 1) In Supabase Dashboard → Authentication → Users, copy your user UUID.
-- 2) Replace YOUR_USER_UUID below (keep the quotes).
-- 3) Run in SQL Editor. Inspect counts before/after if you like.

-- Preview rows that will be updated:
-- select id, created_at, user_id from public.entries where user_id is null;

update public.entries
set user_id = 'YOUR_USER_UUID'::uuid
where user_id is null;

-- Optional: verify none left NULL
-- select count(*) from public.entries where user_id is null;
