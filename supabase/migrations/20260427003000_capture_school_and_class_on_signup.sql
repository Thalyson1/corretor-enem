create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, school_name, class_group)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    'student',
    nullif(trim(new.raw_user_meta_data ->> 'school_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'class_group'), '')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    school_name = coalesce(excluded.school_name, public.profiles.school_name),
    class_group = coalesce(excluded.class_group, public.profiles.class_group),
    updated_at = timezone('utc', now());

  return new;
end;
$$;
