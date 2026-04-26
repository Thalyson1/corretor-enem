create extension if not exists "pgcrypto";

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  role text not null default 'student' check (role in ('student', 'teacher', 'admin')),
  is_active boolean not null default true,
  school_name text,
  class_group text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.essays (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  corrected_by uuid references public.profiles(id) on delete set null,
  theme text not null,
  content text not null,
  word_count integer not null default 0 check (word_count >= 0),
  status text not null default 'submitted' check (status in ('draft', 'submitted', 'corrected', 'error')),
  final_score integer check (final_score between 0 and 1000 and final_score % 40 = 0),
  submitted_at timestamptz not null default timezone('utc', now()),
  corrected_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.essay_scores (
  id uuid primary key default gen_random_uuid(),
  essay_id uuid not null unique references public.essays(id) on delete cascade,
  competency_1_score integer not null default 0 check (competency_1_score between 0 and 200 and competency_1_score % 40 = 0),
  competency_1_justification text,
  competency_1_improvement text,
  competency_2_score integer not null default 0 check (competency_2_score between 0 and 200 and competency_2_score % 40 = 0),
  competency_2_justification text,
  competency_2_improvement text,
  competency_3_score integer not null default 0 check (competency_3_score between 0 and 200 and competency_3_score % 40 = 0),
  competency_3_justification text,
  competency_3_improvement text,
  competency_4_score integer not null default 0 check (competency_4_score between 0 and 200 and competency_4_score % 40 = 0),
  competency_4_justification text,
  competency_4_improvement text,
  competency_5_score integer not null default 0 check (competency_5_score between 0 and 200 and competency_5_score % 40 = 0),
  competency_5_justification text,
  competency_5_improvement text,
  summary text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.usage_limits (
  role text primary key check (role in ('student', 'teacher', 'admin')),
  weekly_saved_essays integer not null check (weekly_saved_essays >= 0),
  weekly_corrections integer not null check (weekly_corrections >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  essay_id uuid references public.essays(id) on delete set null,
  event_type text not null check (event_type in ('correction_requested', 'correction_saved', 'essay_saved', 'essay_deleted')),
  metadata jsonb not null default '{}'::jsonb,
  week_start date not null default date_trunc('week', timezone('America/Sao_Paulo', now()))::date,
  occurred_at timestamptz not null default timezone('utc', now())
);

create index if not exists essays_student_id_idx on public.essays(student_id);
create index if not exists essays_corrected_by_idx on public.essays(corrected_by);
create index if not exists essays_status_idx on public.essays(status);
create index if not exists usage_events_profile_id_idx on public.usage_events(profile_id);
create index if not exists usage_events_week_start_idx on public.usage_events(week_start);
create index if not exists usage_events_profile_week_idx on public.usage_events(profile_id, week_start);

insert into public.usage_limits (role, weekly_saved_essays, weekly_corrections)
values
  ('student', 2, 2),
  ('teacher', 100, 100),
  ('admin', 1000, 1000)
on conflict (role) do update
set
  weekly_saved_essays = excluded.weekly_saved_essays,
  weekly_corrections = excluded.weekly_corrections,
  updated_at = timezone('utc', now());

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid();
$$;

create or replace function public.is_teacher_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('teacher', 'admin'), false);
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists set_essays_updated_at on public.essays;
create trigger set_essays_updated_at
before update on public.essays
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists set_essay_scores_updated_at on public.essay_scores;
create trigger set_essay_scores_updated_at
before update on public.essay_scores
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists set_usage_limits_updated_at on public.usage_limits;
create trigger set_usage_limits_updated_at
before update on public.usage_limits
for each row
execute function public.set_current_timestamp_updated_at();

alter table public.profiles enable row level security;
alter table public.essays enable row level security;
alter table public.essay_scores enable row level security;
alter table public.usage_limits enable row level security;
alter table public.usage_events enable row level security;

drop policy if exists "profiles_select_own_or_staff" on public.profiles;
create policy "profiles_select_own_or_staff"
on public.profiles
for select
to authenticated
using (auth.uid() = id or public.is_teacher_or_admin());

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin"
on public.profiles
for update
to authenticated
using (auth.uid() = id or public.current_user_role() = 'admin')
with check (auth.uid() = id or public.current_user_role() = 'admin');

drop policy if exists "profiles_insert_admin_only" on public.profiles;
create policy "profiles_insert_admin_only"
on public.profiles
for insert
to authenticated
with check (public.current_user_role() = 'admin');

drop policy if exists "essays_select_own_or_staff" on public.essays;
create policy "essays_select_own_or_staff"
on public.essays
for select
to authenticated
using (auth.uid() = student_id or public.is_teacher_or_admin());

drop policy if exists "essays_insert_own_or_staff" on public.essays;
create policy "essays_insert_own_or_staff"
on public.essays
for insert
to authenticated
with check (auth.uid() = student_id or public.is_teacher_or_admin());

drop policy if exists "essays_update_own_or_staff" on public.essays;
create policy "essays_update_own_or_staff"
on public.essays
for update
to authenticated
using (auth.uid() = student_id or public.is_teacher_or_admin())
with check (auth.uid() = student_id or public.is_teacher_or_admin());

drop policy if exists "essays_delete_own_or_staff" on public.essays;
create policy "essays_delete_own_or_staff"
on public.essays
for delete
to authenticated
using (auth.uid() = student_id or public.is_teacher_or_admin());

drop policy if exists "essay_scores_select_own_or_staff" on public.essay_scores;
create policy "essay_scores_select_own_or_staff"
on public.essay_scores
for select
to authenticated
using (
  exists (
    select 1
    from public.essays
    where public.essays.id = essay_scores.essay_id
      and (public.essays.student_id = auth.uid() or public.is_teacher_or_admin())
  )
);

drop policy if exists "essay_scores_insert_own_or_staff" on public.essay_scores;
create policy "essay_scores_insert_own_or_staff"
on public.essay_scores
for insert
to authenticated
with check (
  exists (
    select 1
    from public.essays
    where public.essays.id = essay_scores.essay_id
      and (public.essays.student_id = auth.uid() or public.is_teacher_or_admin())
  )
);

drop policy if exists "essay_scores_update_own_or_staff" on public.essay_scores;
create policy "essay_scores_update_own_or_staff"
on public.essay_scores
for update
to authenticated
using (
  exists (
    select 1
    from public.essays
    where public.essays.id = essay_scores.essay_id
      and (public.essays.student_id = auth.uid() or public.is_teacher_or_admin())
  )
)
with check (
  exists (
    select 1
    from public.essays
    where public.essays.id = essay_scores.essay_id
      and (public.essays.student_id = auth.uid() or public.is_teacher_or_admin())
  )
);

drop policy if exists "usage_limits_select_authenticated" on public.usage_limits;
create policy "usage_limits_select_authenticated"
on public.usage_limits
for select
to authenticated
using (true);

drop policy if exists "usage_limits_modify_admin_only" on public.usage_limits;
create policy "usage_limits_modify_admin_only"
on public.usage_limits
for all
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "usage_events_select_own_or_staff" on public.usage_events;
create policy "usage_events_select_own_or_staff"
on public.usage_events
for select
to authenticated
using (auth.uid() = profile_id or public.is_teacher_or_admin());

drop policy if exists "usage_events_insert_own_or_staff" on public.usage_events;
create policy "usage_events_insert_own_or_staff"
on public.usage_events
for insert
to authenticated
with check (auth.uid() = profile_id or public.is_teacher_or_admin());

drop policy if exists "usage_events_update_staff_only" on public.usage_events;
create policy "usage_events_update_staff_only"
on public.usage_events
for update
to authenticated
using (public.is_teacher_or_admin())
with check (public.is_teacher_or_admin());
