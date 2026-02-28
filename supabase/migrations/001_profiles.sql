-- ─────────────────────────────────────────
-- 001_profiles.sql
-- Pro tier: user profiles table
-- ─────────────────────────────────────────

-- Profiles table
create table if not exists public.profiles (
  id                  uuid references auth.users(id) on delete cascade primary key,
  is_pro              boolean      not null default false,
  pro_since           timestamptz,
  paystack_ref        text,
  created_at          timestamptz  not null default now()
);

-- Enable RLS
alter table public.profiles enable row level security;

-- Users can only read their own profile
create policy "Users can read own profile"
  on public.profiles
  for select
  using (auth.uid() = id);

-- ─────────────────────────────────────────
-- Auto-create a profile row on new signup
-- ─────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Drop trigger first so re-running this migration is safe
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
