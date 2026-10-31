-- Fix avatar profile attachment by using deterministic UUID-folder comparison
-- instead of the previous interpolated regular expression.
-- No historical photos or account records are altered.
CREATE OR REPLACE FUNCTION public.set_my_avatar_path(p_avatar_path text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $avatar$
DECLARE
  actor uuid := auth.uid();
  candidate text := NULLIF(btrim(p_avatar_path), '');
  object_name text;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Please sign in again to update your profile picture.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=actor AND p.active) THEN
    RAISE EXCEPTION 'Active user profile not found.';
  END IF;

  IF candidate IS NOT NULL THEN
    -- The first folder must match the authenticated principal literally.
    IF split_part(candidate, '/', 1) IS DISTINCT FROM actor::text THEN
      RAISE EXCEPTION 'Photo account does not match your signed-in account. Sign out and sign in again.';
    END IF;

    -- Accept only the same UUID/JPEG structure enforced by the Storage upload policy.
    IF candidate !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.]jpg$'
      OR split_part(candidate, '/', 3) <> '' THEN
      RAISE EXCEPTION 'Invalid profile photo filename. Please choose your photo again.';
    END IF;

    SELECT o.name INTO object_name
    FROM storage.objects o
    WHERE o.bucket_id='tips-ledger-avatars'
      AND o.name=candidate
      AND (storage.foldername(o.name))[1]=actor::text
    LIMIT 1;

    IF object_name IS NULL THEN
      RAISE EXCEPTION 'Uploaded photo not found in your account. Please retry.';
    END IF;
  END IF;

  UPDATE public.profiles
  SET avatar_path=candidate
  WHERE id=actor AND active=true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active user profile not found.';
  END IF;

  RETURN candidate;
END
$avatar$;

REVOKE ALL ON FUNCTION public.set_my_avatar_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_avatar_path(text) TO authenticated;
