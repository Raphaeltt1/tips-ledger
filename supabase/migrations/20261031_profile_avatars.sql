-- Tips Ledger: optional avatar photos for all authenticated roles.
-- Backward compatible: existing profiles retain their initials (NULL avatar_path).
-- Photos are JPEG-compressed client-side and saved in each user's own folder.
-- File URLs in this intentionally public avatar bucket can be viewed by anyone
-- who has the exact URL; upload, removal and profile changes require the owner.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_path text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tips-ledger-avatars', 'tips-ledger-avatars', true, 2097152, ARRAY['image/jpeg']::text[])
ON CONFLICT (id) DO UPDATE SET
 public=EXCLUDED.public,
 file_size_limit=EXCLUDED.file_size_limit,
 allowed_mime_types=EXCLUDED.allowed_mime_types;

CREATE POLICY "tl_avatar_insert_own_jpeg"
 ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (
   bucket_id='tips-ledger-avatars'
   AND (storage.foldername(name))[1]=(SELECT auth.uid()::text)
   AND name ~ ('^'||(SELECT auth.uid()::text)||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
   AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.active)
 );

CREATE POLICY "tl_avatar_select_own"
 ON storage.objects FOR SELECT TO authenticated
 USING (
  bucket_id='tips-ledger-avatars'
  AND (storage.foldername(name))[1]=(SELECT auth.uid()::text)
 );

CREATE POLICY "tl_avatar_delete_own"
 ON storage.objects FOR DELETE TO authenticated
 USING (
  bucket_id='tips-ledger-avatars'
  AND (storage.foldername(name))[1]=(SELECT auth.uid()::text)
 );

CREATE OR REPLACE FUNCTION public.set_my_avatar_path(p_avatar_path text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $func$
DECLARE
 actor uuid := auth.uid();
BEGIN
 IF actor IS NULL THEN
  RAISE EXCEPTION 'You must be signed in to edit your photo.';
 END IF;

 IF p_avatar_path IS NOT NULL THEN
  IF p_avatar_path !~ (
   '^'||actor::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
  ) THEN
   RAISE EXCEPTION 'Photo path must belong to your own account.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id='tips-ledger-avatars' AND name=p_avatar_path
  ) THEN
   RAISE EXCEPTION 'Upload your photo before saving it to your profile.';
  END IF;
 END IF;

 UPDATE public.profiles
 SET avatar_path=p_avatar_path
 WHERE id=actor AND active=true;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Active user profile not found.';
 END IF;
 RETURN p_avatar_path;
END
$func$;

REVOKE ALL ON FUNCTION public.set_my_avatar_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_avatar_path(text) TO authenticated;
