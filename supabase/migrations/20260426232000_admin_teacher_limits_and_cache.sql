alter table public.profiles
  add column if not exists weekly_saved_essays_override integer check (weekly_saved_essays_override >= 0),
  add column if not exists weekly_corrections_override integer check (weekly_corrections_override >= 0);

alter table public.essays
  add column if not exists content_hash text,
  add column if not exists ai_provider text,
  add column if not exists ai_model text,
  add column if not exists cache_source text not null default 'fresh' check (cache_source in ('fresh', 'duplicate_student', 'duplicate_global'));

create index if not exists essays_content_hash_idx on public.essays(content_hash);
create index if not exists essays_student_hash_idx on public.essays(student_id, content_hash);

drop policy if exists "profiles_update_teacher_admin" on public.profiles;
create policy "profiles_update_teacher_admin"
on public.profiles
for update
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');
