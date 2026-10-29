# Tips Ledger — secure backend plan

The existing index.html is a **local-only prototype**. Its Admin/Manager/Runner buttons are NOT authentication. Do not enter real payroll or tips data.

## Recommended stack
- Supabase Auth (email invitation + password), Postgres, Row Level Security (RLS)
- Static frontend hosted separately (e.g. Vercel), with public Supabase URL and anon/publishable key only
- Never commit Supabase service-role keys or credentials.

## Roles
- **admin**: only role allowed to invite/create accounts, set runner rates, and assign roles.
- **manager**: can publish weekly records for assigned runners; cannot change rates, invite users, or impersonate runners.
- **runner**: can read only their own records and confirm receipt of their own published payments.

## Data model
- profiles (id UUID references auth.users, role, display_name, employee_id)
- runner_rates (runner_id, hourly_rate, effective_from, changed_by)
- weekly_tips (id, runner_id, week_start, hours, gross_tips, advance, net_tips, rate_snapshot, status, published_by, published_at)
- receipt_confirmations (weekly_tips_id unique, runner_id, confirmed_at)
- audit_log (actor_id, action, record_id, occurred_at)

## Security requirements
- Enable RLS on every exposed table. Use auth.uid() and server-side role checks; never trust a role chosen in the browser.
- Create users via a trusted server-side admin endpoint with verified admin authorization, not the browser or a public signup flow.
- Enforce unique (runner_id, week_start); nonnegative amounts; advance <= gross; validate hours and week date.
- Make published records immutable except through audited correction workflows.
- Confirmations must be authenticated, bound to the caller's runner ID, and one-time only.
- Financial calculations and authorization must run in the database or trusted backend, not solely in JavaScript.
- Test cross-user isolation, unauthorized rate edits, duplicate weeks, and receipt replay before deployment.

## Next step
Create a Supabase project owned by Raphael and connect it to the repository through deployment environment variables. No production credentials or real financial records should be used until RLS and integration tests pass.
