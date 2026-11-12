-- Employee Ledger: annually recurring, employee-scoped Training records.
-- A training assigned once automatically appears each year from start_year onward.
-- Attendance is separate per calendar year; only Admin/Superuser may modify it.
BEGIN;

CREATE TABLE IF NOT EXISTS public.training_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 800),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS training_courses_name_ci_unique
  ON public.training_courses ((lower(btrim(name))));
CREATE INDEX IF NOT EXISTS training_courses_order
  ON public.training_courses (name);

CREATE TABLE IF NOT EXISTS public.employee_training_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  training_id uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE RESTRICT,
  start_year integer NOT NULL CHECK (start_year BETWEEN 2020 AND 2100),
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_training_assignment_unique UNIQUE(employee_id,training_id),
  CONSTRAINT employee_training_assignment_pair UNIQUE(employee_id,training_id)
);

CREATE TABLE IF NOT EXISTS public.employee_training_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  training_id uuid NOT NULL,
  training_year integer NOT NULL CHECK (training_year BETWEEN 2020 AND 2100),
  attended boolean NOT NULL DEFAULT false,
  recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_one_record_per_year UNIQUE(employee_id,training_id,training_year),
  CONSTRAINT attendance_belongs_to_assignment FOREIGN KEY (employee_id,training_id)
    REFERENCES public.employee_training_assignments(employee_id,training_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS training_assignments_employee_idx
  ON public.employee_training_assignments(employee_id,start_year);
CREATE INDEX IF NOT EXISTS training_attendance_year_idx
  ON public.employee_training_attendance(training_year,employee_id);

ALTER TABLE public.training_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_training_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_training_attendance ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.training_courses,public.employee_training_assignments,
  public.employee_training_attendance FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.training_courses TO authenticated;
GRANT SELECT,INSERT ON public.employee_training_assignments TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.employee_training_attendance TO authenticated;

-- Course names aren't sensitive; authenticated active accounts may view catalog.
DROP POLICY IF EXISTS "Active users view training course catalog" ON public.training_courses;
CREATE POLICY "Active users view training course catalog"
  ON public.training_courses FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) IS NOT NULL);

DROP POLICY IF EXISTS "Only admins create training courses" ON public.training_courses;
CREATE POLICY "Only admins create training courses"
  ON public.training_courses FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin())
    AND created_by=(SELECT auth.uid()));

DROP POLICY IF EXISTS "Employees view own annual training assignments" ON public.employee_training_assignments;
CREATE POLICY "Employees view own annual training assignments"
  ON public.employee_training_assignments FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()) OR
     (employee_id=(SELECT auth.uid()) AND (SELECT public.current_user_role()) IS NOT NULL));

DROP POLICY IF EXISTS "Only admins assign trainings" ON public.employee_training_assignments;
CREATE POLICY "Only admins assign trainings"
  ON public.employee_training_assignments FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin()) AND assigned_by=(SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.profiles p
       WHERE p.id=employee_id AND p.active=true));

DROP POLICY IF EXISTS "Employees view own yearly training attendance" ON public.employee_training_attendance;
CREATE POLICY "Employees view own yearly training attendance"
  ON public.employee_training_attendance FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()) OR
    (employee_id=(SELECT auth.uid()) AND (SELECT public.current_user_role()) IS NOT NULL));

DROP POLICY IF EXISTS "Only admins record yearly training attendance" ON public.employee_training_attendance;
CREATE POLICY "Only admins record yearly training attendance"
  ON public.employee_training_attendance FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin()) AND recorded_by=(SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.employee_training_assignments a
      WHERE a.employee_id=employee_id AND a.training_id=training_id
        AND a.start_year<=training_year));

DROP POLICY IF EXISTS "Only admins update yearly training attendance" ON public.employee_training_attendance;
CREATE POLICY "Only admins update yearly training attendance"
  ON public.employee_training_attendance FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()) AND recorded_by=(SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.employee_training_assignments a
      WHERE a.employee_id=employee_id AND a.training_id=training_id
        AND a.start_year<=training_year));

-- Keep these immutable: attendance is per-year, and an assignment's effective
-- year should not be silently rewritten, preserving previous years' history.
-- Staff are never granted update/delete permissions to any Training table.
-- An attendance correction updates just one employee/training/year.

COMMIT;
