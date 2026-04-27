update public.usage_limits
set
  weekly_saved_essays = 10,
  weekly_corrections = 10,
  updated_at = timezone('utc', now())
where role = 'student';
