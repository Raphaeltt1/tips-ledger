# Tips Ledger — Working Version Recovery Kit

**Stable application release:** 31 October 2026  
**Repository:** `Raphaeltt1/tips-ledger`  
**Immutable reference commit:** `f8991407d81dd174e2316631cc1dd754cef51d61`  
**Unchanged app backup branch:** `backup/tips-ledger-STABLE-WORKING-2026-10-31`  
**This recovery-kit branch:** `recovery/tips-ledger-clean-rebuild-2026-10-31`  
**Live Supabase project at time of snapshot:** `qvwgmybocjyhldwnrqqt`

## Goal

Recover the specific version of Tips Ledger that was working on 31 October 2026, even if that means starting with **no staff accounts, payments, or audit entries**. This kit contains **application source, Edge Function source and schema-recreation SQL**. It **does not** contain a full physical database backup, current logins/passwords, historical records, private Supabase keys or VAPID private keys.

**Never apply the clean-rebuild script to a running Supabase database.** It creates tables and functions and is designed for a newly created, empty Supabase project.

## Recovery option A — App-only rollback (existing Supabase still compatible)

If a future UI update breaks something while Supabase has not undergone incompatible changes:

1. Preserve the current `main` branch separately for investigation. **Do not overwrite the stable backup branch.**
2. Restore the website and source files from commit `f8991407d81dd174e2316631cc1dd754cef51d61`, for example by opening a pull request from the stable backup or by reverting later commits.
3. Deploy the resulting `main` through the normal GitHub Pages workflow.
4. Only if Edge Function code changed, redeploy the **matching backed-up versions** of the functions from the stable branch, keeping their exact slugs and JWT settings as listed below. Check configuration/secrets before redeploying.
5. Verify sign-in, account roles, payments, graph, Audit Log and actual iPhone push delivery.

This approach normally retains all current team and payment data. **If later changes also modified database tables, SQL functions, policies, or other backend configuration, code rollback alone may not be enough.** In that case compare the backend with this snapshot or follow option B.

## Recovery option B — Start completely fresh (no old records required)

1. **Save anything you decide not to lose.** Creating a fresh project will not recover old employee logins, payments, rate history or audit records.
2. Create a **new Supabase project**. Its default `auth.users`, `auth.uid()`, roles and schemas must be installed by Supabase.
3. Open the new project's **SQL Editor**. Run `recovery/clean-rebuild-schema.sql` **once**, on the empty project. Do not also run old partial migration scripts on top of it. It recreates the seven tables, constraints, indexes, 15 database functions, 18 RLS policies and eight triggers.
4. In **Authentication → Users**, create your new login with a strong password of at least 12 characters. After the Auth user exists, add its profile with role `superuser` (illustrative SQL below). Only one Superuser profile is allowed by the schema.
5. In the website's `index.html`, update `URL` and `KEY` to the **new project's** Supabase Project URL and **public/anon** API key. Never put a service-role or secret key in browser code.
6. Deploy these three Edge Functions from the backed-up source directory, **using their exact spelling**:

   | Function folder / slug | JWT verification |
   |---|---|
   | `create-employee-` (trailing hyphen matters!) | OFF — function itself checks the authenticated caller |
   | `send-push` | ON |
   | `delete-employee` | ON |

7. Configure the Edge Function environment. Expected names: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and optionally `VAPID_SUBJECT`. Some Supabase-provided values may already be injected automatically. **Never commit private secrets to GitHub.** Generate a valid new VAPID key pair if you cannot securely restore the old one; copy the **matching VAPID public key** into `index.html`'s `VAPID_PUBLIC_KEY` constant. Existing devices must register again in the Home Screen app after a key/project change.
8. Publish the site with GitHub Pages using the restored source, manifest, service worker and assets. GitHub Pages should use the repo's intended branch/folder.
9. Sign in as Superuser; create new Admin, Manager and Runner accounts through the app and assign Runner rates. Confirm the full checklist below.

### Create the first Superuser (new project only)

After creating the login in Supabase Authentication, use SQL Editor in the **new project** and replace the two placeholders:

```sql
INSERT INTO public.profiles (id, full_name, role, active)
SELECT id, 'YOUR DISPLAY NAME', 'superuser', true
FROM auth.users
WHERE email = 'YOUR NEW LOGIN EMAIL';
```

Check that this inserts exactly **one** profile. Do not store any password in SQL. The new project starts with no other user profiles.

## Minimum smoke tests before calling a fresh rebuild complete

- [ ] Superuser can sign in; inactive account is denied appropriate access
- [ ] Create one disposable Admin, Manager and Runner using the app
- [ ] Superuser can activate/deactivate Admin, Manager and Runner; Admin can manage Manager and Runner only; Manager and Runner cannot manage accounts
- [ ] Enter and view a Runner's hourly rate
- [ ] Create a weekly draft; publish it; Runner sees only their own published payout and can confirm it
- [ ] Check Overview and Runner weekly graph; audit entries are generated; Audit Log has filters and shows 10 at a time with **Show 10 more**
- [ ] Test Excel export with a compatible spreadsheet viewer
- [ ] Test iPhone notifications from the Home Screen app: register, test push, payment publication and Runner confirmation
- [ ] Confirm dark/light theme, password reset and logout

**Testing warning:** These are recovery instructions; a brand-new Supabase project has **not** yet been provisioned or used for a full end-to-end restore test. The SQL was reconstructed from the live catalog and checked for matching object counts. Do not call a brand-new project production-ready until the smoke tests pass.

## Captured at backup time

- Seven public app tables: `profiles`, `audit_log`, `runner_rates`, `weekly_tips`, `receipt_confirmations`, `notifications`, `push_subscriptions`.
- 15 database functions, 18 RLS policies, eight triggers, and their indexes/constraints.
- Production Edge Function source matched GitHub for all three slugs when this snapshot was prepared.
- The new-project schema includes a `GRANT SELECT` on `weekly_tips` for signed-in users so the website can read it; RLS still restricts each account's rows. The captured live table ACL did not have this necessary grant.
- Existing app code remains pinned at the stable release; the recovery files do not modify running app behavior.

## Important limitations

- **No customer/team/payment data backed up:** this is intentionally a code-and-schema recovery kit, not point-in-time database data recovery.
- **No Auth users/passwords, device subscriptions or secrets backed up:** these need recreation or secure reconfiguration when starting from a new Supabase project.
- **No automatic rollback of later backend changes:** if you stay on the original project and later SQL changes break compatibility, restoring website code alone cannot undo them. Use the captured schema as a reference or rebuild an empty project.
- **No guarantee without smoke testing:** the full new-project rebuild procedure remains untested against a disposable fresh project. It is designed to make that rebuild feasible without reconstructing the schema from memory.

When making future changes, branch from a current working state, test before merging into `main`, and leave these two 2026-10-31 recovery branches unchanged.
