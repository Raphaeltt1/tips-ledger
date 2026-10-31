# Tips Ledger — Production audit checkpoint (2026-10-31)

**Purpose:** Record the non-destructive audit results and their limits. No
customer/employee names, keys, passwords, or private payment values are in this
document.

## Verified

- Supabase project healthy; three Edge Functions deployed and active.
- Latest GitHub Pages deployment successful before this audit.
- Database grants and RLS verified on all seven application tables.
- Read-only queries under actual Superuser and Runner identities confirmed
  expected role-limited visibility; Runner cannot read audit records.
- Financial integrity query found no negative values, no advances above tips,
  no incorrect generated payouts, no invalid receipt ownership, and no orphaned
  payment/rate/notification records when inspected.
- Account creation, authenticated deletion, and send-push had successful
  requests in platform logs; unauthorized deletion requests were rejected.
- Previously verified offsite encrypted backup was downloaded, authenticated,
  checked against file hashes and a set of payment tables recovered to an
  isolated temporary PostgreSQL database. This is **not** a full disaster restore.
- Browser JavaScript, service-worker script, web manifest and deletion-function
  TypeScript passed automated syntax/type checks; no-auth deletion regression
  tests passed: https://github.com/Raphaeltt1/tips-ledger/actions/runs/41173412150

## Issue found and corrected for future account deletions

Account deletion did not explicitly remove objects under the employee's avatar
Storage folder. The Edge Function now lists/deletes the account's own JPEG
files through Supabase Storage API before deleting its Auth account, and
reports a cleanup warning if the operation fails. The frontend displays that
warning. The new code is type-checked; an actual deletion with an avatar still
needs a live authorized end-to-end test.

**Existing cleanup remains:** At audit time, there were two older avatar
Storage objects whose account folder no longer corresponded to an existing
profile. They were **not** deleted by this audit. Because the avatar bucket
is public, objects can be opened by anyone who knows their direct URL. Remove
unneeded old objects using the Storage API or Supabase Storage dashboard,
not by deleting rows from `storage.objects` with SQL.

## Warnings and limitations

- Supabase security advisor still flags privileged role-checked RPC functions,
  leaked-password protection (paid plan), and informational RLS-no-policy on
  the intentionally inaccessible private snapshot table.
- Performance advisor flags a duplicate unique index, overlapping permissive
  read policies, an unindexed receipt-confirmation foreign key and an unused
  audit-log index. No production performance problem was proven at this scale.
- The first scheduled 23:00 Asia/Beirut backup on October 31 is not verified
  yet; a **manual** backup and representative restore test have passed.
- Full Auth/Storage/Edge-Function disaster restoration is untested, and the
  production employee payment lifecycle was not re-executed from scratch as
  part of this non-destructive audit.
- Browser compatibility, real delivery on every device, and timing-dependent
  notification behavior cannot be guaranteed by static and API checks alone.
- The avatar bucket is intentionally public for profile display; its photos
  should not be considered private. The existing UI says that photos are
  shared with the team, but a direct file URL is publicly reachable.

## Production precautions

- Keep encryption passphrase outside GitHub and Supabase.
- Preserve a working rollback branch.
- Always test database and Edge Function changes before deployment.
- Do not make destructive changes to production financial records as part of
  recurring audits.
