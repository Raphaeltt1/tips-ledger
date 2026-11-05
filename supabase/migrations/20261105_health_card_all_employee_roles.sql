-- Extend the existing guarded setter to all active employee accounts except the Superuser.
CREATE OR REPLACE FUNCTION public.set_employee_health_card_expiry(
  p_employee_id uuid, p_expiry_date date
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_employee public.profiles%ROWTYPE;
BEGIN
  IF (SELECT public.current_user_role()) NOT IN ('admin','superuser') THEN
    RAISE EXCEPTION 'Admin or Superuser access required';
  END IF;
  SELECT * INTO v_employee FROM public.profiles WHERE id=p_employee_id
    AND active AND role <> 'superuser';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active employee not found'; END IF;
  IF p_expiry_date IS NULL THEN
    DELETE FROM public.employee_health_cards WHERE employee_id=p_employee_id;
  ELSE
    INSERT INTO public.employee_health_cards (employee_id,expires_on,updated_by)
    VALUES (p_employee_id,p_expiry_date,(SELECT auth.uid()))
    ON CONFLICT (employee_id) DO UPDATE SET
      expires_on=EXCLUDED.expires_on,updated_by=EXCLUDED.updated_by,updated_at=now()
    WHERE public.employee_health_cards.expires_on IS DISTINCT FROM EXCLUDED.expires_on;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_employee_health_card_expiry(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_employee_health_card_expiry(uuid,date) TO authenticated;
