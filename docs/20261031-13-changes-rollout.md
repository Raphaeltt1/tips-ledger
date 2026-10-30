# Tips Ledger — 13 Changes rollout (staged, not live)

> **Safety:** The Supabase migration was applied and the `send-push` function was deployed through the connected Supabase project before publishing the website. The checked-in `create-employee-` and `delete-employee` files have been reconciled with the live deployed versions; do not deploy them unnecessarily.

## Changes in this feature branch

1. Rename Runner Weekly Summary to Summary.
2. Add a persistent Runner payment table below payment cards, querying only the signed-in Runner's published payments.
3. Replace the Runner's latest-week Payments count with the week-start date.
4. Add actual XLSX export (SheetJS loaded from a pinned version) to Manager/Admin/Superuser views, respecting the current payment filters.
5. Add an employee + current hourly-rate table with editing for active Runners (Admin/Superuser only).
6. Remove the Effective From field; new rate RPC supplies the Lebanon calendar date automatically. Existing stored payment records are not retroactively recalculated.
7. Add notification read/delete controls; add a signed-in test push, push delivery messages, re-registration UI, and include Superuser in push recipients.
8. Add SVG icons beside navigation labels.
9. Add side-by-side Sun/Moon theme selectors with saved appearance.
10. Remove successful-login "Connected as..." duplicate.
11. Show Summary only to Runners.
12. Force explicit employee role selection; no default Runner.
13. Add Audit Log action, employee, actor, and UTC date-range filters.

## Deployment order (important)

1. Back up the production Supabase database. GitHub backup ref: `backup/tips-ledger-before-13-2026-10-31`.
2. ✅ Confirmed RLS was already enabled and applied the notification-deletion/hourly-rate migration. Explicitly revoked `anon` access to the new rate RPC after verifying grants.
3. ✅ Deployed **only** `supabase/functions/send-push/index.ts` (live version 3). Synced `create-employee-` and `delete-employee` GitHub copies to their live version 4 source, without redeploying them.
4. Verify Supabase Edge Function secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (never paste private keys into chat or GitHub). Public key must match the website's VAPID public key.
5. Test the Edge Function `test` event using the in-app "Send test push" action from an installed Home Screen PWA with notifications enabled; inspect server logs if `sent=0` or delivery fails.
6. Merge this feature branch into `main` to publish the website. Hard refresh/reopen the Home Screen PWA.
7. Verify roles, Runner-only data, hourly rate UI, XLSX export, notification deletion, and audit filters.

## Hourly-rate semantics

The date input is removed, but rates remain effective-dated in the database because `create_weekly_tips_draft` selects the rate most recently effective **on or before the week's start**. Saving a rate today affects new drafts for week starts on/after today; it never changes existing payment rows. A new same-day edit updates the existing same-day rate instead of duplicating it. A pre-scheduled future rate causes a controlled error rather than silent overwriting. Old salary calculations and existing weekly payment data are left untouched.

## Push caveat

iPhone web push requires a supported iOS version, the app added to the Home Screen and launched from its icon, notification permission granted in that installed app, and valid VAPID server-side credentials. Even with the correct software, push delivery is best-effort and can be delayed or suppressed by device settings. The in-app "Send test push" button provides a controlled, non-payment test.

## Tests completed before merge

- JavaScript syntax checks for all inline scripts: passed.
- Duplicate HTML ID scan: no duplicates.
- Literal DOM references scan: no missing element IDs.
- Verified Runner payment queries include both `runner_id = profile.id` and `published = true`.
- Verified Excel visibility is restricted to `manager`, `admin`, `superuser`.

**Done:** Live Supabase migration and Edge Function deployment. **Not yet completed:** Browser-based UI testing, device push test, and GitHub Pages release. A successful push gateway response is not proof a device displays the alert. Do not label the full change set as fully tested before these steps.
