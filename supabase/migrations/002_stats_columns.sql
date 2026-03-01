-- ─────────────────────────────────────────
-- 002_stats_columns.sql
-- Compression stats columns on profiles
-- ─────────────────────────────────────────

alter table public.profiles
  add column if not exists total_compressions        integer not null default 0,
  add column if not exists total_videos_compressed   integer not null default 0,
  add column if not exists total_images_compressed   integer not null default 0,
  add column if not exists total_mb_saved            numeric not null default 0;

-- RPC function for atomic increments
create or replace function public.increment_compression_stats(
  p_user_id  uuid,
  p_type     text,
  p_mb_saved numeric
)
returns void
language plpgsql
security definer
as $$
begin
  update public.profiles
  set
    total_compressions      = total_compressions + 1,
    total_videos_compressed = total_videos_compressed + (case when p_type = 'video' then 1 else 0 end),
    total_images_compressed = total_images_compressed + (case when p_type = 'image' then 1 else 0 end),
    total_mb_saved          = total_mb_saved + greatest(p_mb_saved, 0)
  where id = p_user_id;
end;
$$;
