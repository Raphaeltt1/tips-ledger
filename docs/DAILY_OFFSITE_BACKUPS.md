# Tips Ledger — Daily offsite backups (browser-only setup)

This workflow is active on `main` following a successful manual test on
2026-10-31. The verified run exported PostgreSQL, downloaded 3 Storage files,
uploaded a private encrypted R2 archive, downloaded and authenticated it,
and completed successfully. **Daily scheduled backups are enabled**, subject
to GitHub's best-effort scheduler.

## What is backed up?

* PostgreSQL 17 custom-format dump of **public**, **auth**, and **storage** schemas:
  employees, payment details, receipts, tips, audit events, user logins, table
  definitions, RPC functions, RLS policies, indexes and triggers.
* Actual Supabase Storage files in all **public** buckets, including employee avatars.
  If any private bucket exists, add `SUPABASE_SERVICE_ROLE_KEY` to GitHub Secrets
  or the backup **fails rather than silently skipping files**.
* An internal manifest with hashes and backup date, inside a private encrypted archive.

Each archive is AES-256-GCM encrypted with a unique random nonce and salt,
using a key derived with scrypt from `BACKUP_ENCRYPTION_PASSPHRASE`.
Data never goes into repository commits, GitHub Actions artifacts, or logs.
Archives are stored in a private Cloudflare R2 Standard bucket. The script
verifies upload by downloading and decrypting the entire archive.

### Backup time — 23:00 Lebanon local time

After activation, GitHub Actions will attempt to run once daily at **11:00 PM**
using the `Asia/Beirut` timezone, automatically handling summer/winter time.
GitHub's scheduled runs are best-effort; some runs can start late or be skipped.
Check the successful run history regularly.

### 7-day retention and cost ceiling

A successful, verified backup deletes *older-than-7-day* archives in the dedicated
`tips-ledger/daily/` prefix. The script refuses to upload if stored backup
objects plus the new backup would exceed 8 GB, avoiding the 10 GB-month free
storage allowance for these backup objects. **This is not a hard R2
account-wide spending cap.** Other buckets, uploads, and operations can incur
charges; review Cloudflare Billing separately. Only use Standard storage class.
GitHub Actions uses a standard free runner for this PUBLIC repository.

## Step 1: Create Cloudflare R2

Visit https://dash.cloudflare.com/ > **Storage & databases** > **R2**.
If R2 prompts for a payment method or an R2 subscription, decide whether to
accept the billing terms; do not assume it is always free.
Create a **private** Standard-class bucket named `tips-ledger-daily-backups`.
Do not attach a public domain or enable `r2.dev` public access.
Go to **Manage R2 API tokens** > Create token > **Object Read & Write**,
**Apply to specific buckets only** > select that bucket.
Copy the one-time **Access Key ID** and **Secret Access Key**, as well as the
**S3 endpoint URL** (including jurisdiction if relevant).
Do not post the keys in chat, issues, code, or pull requests.

## Step 2: Connect GitHub Secrets and Variables in the browser

Visit https://github.com/Raphaeltt1/tips-ledger/settings/secrets/actions

Under **Repository secrets** > **New repository secret**, create:

| Secret name | Value |
| --- | --- |
| `SUPABASE_DB_URL` | Supabase > Project > Connect > **Session pooler** URI, port 5432. Replace `[YOUR-PASSWORD]` with the real DB password locally. Do NOT use the transaction pooler port 6543. |
| `R2_ACCESS_KEY_ID` | Cloudflare token Access Key ID |
| `R2_SECRET_ACCESS_KEY` | Cloudflare token Secret Access Key |
| `BACKUP_ENCRYPTION_PASSPHRASE` | Unique random password/passphrase, 20+ characters; **save another copy outside GitHub & Supabase** (password manager or offline). Without it, backups cannot be decrypted. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional for today's public avatar bucket. Required if private Storage buckets are added. This is a very privileged credential: use only if necessary. |

Under **Repository variables** > **New repository variable**, create:

| Variable name | Value |
| --- | --- |
| `R2_BUCKET` | `tips-ledger-daily-backups` |
| `R2_ENDPOINT` | S3 endpoint shown by Cloudflare, e.g. `https://ACCOUNTID.r2.cloudflarestorage.com` |

Supabase pooler URI: https://supabase.com/dashboard/project/qvwgmybocjyhldwnrqqt
GitHub Secrets: https://github.com/Raphaeltt1/tips-ledger/settings/secrets/actions

Important: The database connection string may contain URL-reserved characters
in its password; use the URL-encoded connection URI from Supabase and ensure
any manual replacement of the password is URL-encoded. Keep SSL enabled as
recommended by Supabase.

## Step 3: Verify and monitor the active backups

The initial manual backup passed on 2026-10-31:
https://github.com/Raphaeltt1/tips-ledger/actions/runs/41168792669 (attempt 3).
The archive was confirmed by the script's R2 read-back and decryption verification.
The scheduled workflow is enabled at 23:00 Asia/Beirut. The **first future
scheduled run is not yet verified**, and scheduled GitHub Actions jobs can
be delayed or occasionally skipped. Check Actions history and the private R2
bucket periodically. You can also manually use **GitHub > Actions >
Tips Ledger - Encrypted Daily Offsite Backup > Run workflow**, branch `main`.
Do not add a repository variable named `TIPS_LEDGER_BACKUP_ENABLED`;
the initial activation guard has been removed following the verified test.

## Restore overview

1. Find the latest `.tlbak` file in your private R2 bucket and download it
   to a trusted computer.
2. With the saved passphrase, decrypt using the exact `TLB1` protocol in
   `scripts/daily_offsite_backup.py` (salt bytes 4:20, nonce 20:32,
   ciphertext 32:, scrypt N=32768,r=8,p=1, AES-256-GCM and the
   `tips-ledger-offsite-backup-v1` associated data).
3. Extract `backup.tar.gz` after authentication, verify `manifest.json`
   against database.dump and storage file checksums.
4. Create a **new Supabase project**, apply applicable platform configuration,
   and restore using PostgreSQL 17 `pg_restore` in a staged and documented
   procedure. Existing Supabase-managed `auth` and `storage` schemas can
   conflict with a full dump, so test the restore against a **separate project**
   first; do not run `pg_restore --clean` on the working project.
5. Upload the Storage files into their respective buckets. Reconfigure
   GitHub Pages Supabase endpoints, Edge Functions, notifications/VAPID, API
   secrets, Auth settings, SMTP, and provider settings. These settings are not
   embedded in the PostgreSQL dump.

**Recovery caveat:** This is a consistent *database dump*, but downloaded
storage objects may change during the export; a live PostgreSQL and Storage
export is not guaranteed to be a fully atomic point-in-time snapshot.
No write operations are performed against your live Supabase project.

This backup procedure is independent from the approved-stable code branch:
https://github.com/Raphaeltt1/tips-ledger/tree/stable-approved-20261031

## Never do these

- Never push `.dump`, `.tlbak`, or `backup.tar.gz` into GitHub (the repo is public).
- Never share a database password, R2 API secret, service-role key, or
  backup encryption passphrase in chat.
- Never turn on bucket public access. The backup includes password hashes.
- Do not delete older backups before checking a newly uploaded one.
