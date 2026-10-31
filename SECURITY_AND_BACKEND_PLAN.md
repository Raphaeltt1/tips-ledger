# Tips Ledger — production security and recovery overview

_Last reviewed: 2026-10-31_

**Current status:** Tips Ledger is a deployed GitHub Pages app using Supabase
authentication, PostgreSQL, RLS, and server-side role-checked operations. The
earlier "local-only prototype" warning in this file was outdated.

- App: https://raphaeltt1.github.io/tips-ledger/
- Repository: https://github.com/Raphaeltt1/tips-ledger
- Production Supabase project: `qvwgmybocjyhldwnrqqt`
- Stable code rollback branch: `stable-approved-20261031`

## Authorization and financial data

- User identity comes from Supabase Auth; effective roles come from active
  `public.profiles` entries, not browser controls or editable user metadata.
- Roles include superuser, admin, manager and employee positions. The superuser
  can manage admins. Database operations enforce role checks server-side.
- Weekly tips and receipt confirmations use RLS. Employee payment visibility is
  restricted to the applicable role and identity.
- Sensitive changes are audited. Published payment records use protection
  logic and are not editable by ordinary employees.
- Privileged `SECURITY DEFINER` functions are intentionally callable by
  authenticated sessions where needed, with function-level role checks and
  explicit locked search paths. The security advisor still flags 12 functions
  for ongoing manual review; do not revoke them indiscriminately.

## Authentication and browser dependencies

- Supabase leaked-password blocking is not activated; the feature requires a
  paid tier. Strengthen password policies when doing so will not disrupt
  existing logins.
- CAPTCHA is not enabled because the frontend has not integrated a CAPTCHA
  challenge and token into login requests.
- Supabase client keys are publishable keys; no service-role credential belongs
  in `index.html`.
- Excel export uses the official SheetJS 0.20.3 pinned standalone browser
  bundle, which replaces the outdated npm-distributed 0.18.5 release.

## Backup and recovery

- A scheduled workflow exports `public`, `auth` and `storage` schema data,
  downloads Storage files, encrypts the archive using authenticated AES-256-GCM,
  and stores it in a **private** Cloudflare R2 bucket with 7-day retention.
- Workflow: `.github/workflows/daily-offsite-backup.yml`
- Configured schedule: 23:00 Asia/Beirut; GitHub schedules may start late or
  occasionally be skipped. Confirm the first scheduled success after it runs.
- Initial manual encrypted backup was verified on 2026-10-31.
- An isolated restore rehearsal passed on 2026-10-31, restoring 12 weekly
  payments, 7 confirmations, and 3 rate records, and verifying 3 Storage
  objects: https://github.com/Raphaeltt1/tips-ledger/actions/runs/41171669920
- The rehearsal tests representative table recovery; it does **not** prove a
  complete replacement Supabase environment can be restored. Separate
  disaster-recovery testing of Auth, storage upload, Edge Functions and secrets
  remains appropriate.
- Private table `tips_ledger_backups.approved_snapshots` has RLS enabled and
  remains inaccessible to `anon` and `authenticated`. No RLS policy is
  intentionally present for these client roles.

## Operational safeguards

- Do not commit credentials, employees' data, database dumps or R2 archives
  into this public repository.
- Never enable a private backup bucket's public-access setting.
- Preserve the backup encryption passphrase securely **outside** GitHub and
  Supabase; losing it renders the offsite archives unrecoverable.
- Use pull requests and small changes for production updates; verify the
  relevant GitHub Actions and app function after merging.
- Do not run a destructive restore against the production database.
