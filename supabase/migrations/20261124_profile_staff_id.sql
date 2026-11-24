alter table public.profiles add column staff_id text
  check (staff_id is null or (staff_id = btrim(staff_id) and length(staff_id) between 1 and 80));

create unique index profiles_staff_id_unique on public.profiles (lower(staff_id))
  where staff_id is not null;
