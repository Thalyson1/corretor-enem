update public.usage_limits
set
  weekly_saved_essays = 20,
  updated_at = timezone('utc', now())
where role = 'student';
