import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { healthReminder, todayInBeirut } from "./notification-rules.mjs";

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Machine-only endpoint. No browser/user JWT can trigger bulk reminders.
// Called by a scheduled GitHub Action using an existing repository secret.
Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supplied = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!key || !supplied || supplied !== key) return reply({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
  if (!url) return reply({ error: "Missing Supabase URL" }, 503);

  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    // Only active Admin and Superuser accounts receive health-card alerts.
    const [adminsResult, employeesResult, cardsResult] = await Promise.all([
      db.from("profiles").select("id,role").eq("active", true).in("role", ["admin", "superuser"]),
      db.from("profiles").select("id,full_name,role,active").eq("active", true)
        .neq("role", "superuser"),
      db.from("employee_health_cards").select("employee_id,expires_on"),
    ]);
    if (adminsResult.error || employeesResult.error || cardsResult.error) {
      console.error("Health card lookup failed",
        adminsResult.error?.code, employeesResult.error?.code, cardsResult.error?.code);
      return reply({ error: "Health-card data is not ready; apply migration first" }, 503);
    }

    const date = todayInBeirut();
    const employees = new Map((employeesResult.data || []).map((p: { id: string }) => [p.id, p]));
    const reminders = (cardsResult.data || []).map((card: { employee_id: string; expires_on: string }) => {
      const employee = employees.get(card.employee_id);
      if (!employee) return null;
      return healthReminder({ ...employee, health_card_expiry: card.expires_on }, date);
    }).filter(Boolean);
    const admins = adminsResult.data || [];
    const pendingRows = reminders.flatMap((reminder: Record<string, unknown>) => admins.map((admin: { id: string }) => ({
      recipient_id: admin.id,
      title: reminder.title,
      body: reminder.body,
      event_key: reminder.event_key,
    })));

    if (!pendingRows.length) return reply({ ok: true, date, eligible: 0, newlyQueued: 0, pushed: 0 });

    // Duplicate keys are ignored; one 10-day and one 3-day notification per card and admin.
    // If expiry date is renewed, the database date-change trigger clears old reminders.
    const { data: queued, error: insertError } = await db.from("notifications")
      .upsert(pendingRows, { onConflict: "recipient_id,event_key", ignoreDuplicates: true })
      .select("id");
    if (insertError) {
      console.error("Health-card notification queue failed", insertError.code);
      return reply({ error: "Unable to queue health-card alerts" }, 500);
    }

    // Retry unsent pushes while the card is in its relevant reminder window.
    // Do not resend successfully delivered events.
    const keys = [...new Set(reminders.map((r: { event_key: string }) => r.event_key))];
    const { data: events, error: eventError } = await db.from("notifications")
      .select("id,recipient_id,title,body,event_key,push_sent_at")
      .in("event_key", keys).is("push_sent_at", null);
    if (eventError) return reply({ error: "Unable to load queued alerts" }, 500);

    let pushed = 0, failed = 0, staleRemoved = 0;
    if (events?.length && vapidPublic && vapidPrivate) {
      webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
      const recipientIds = [...new Set(events.map((row: { recipient_id: string }) => row.recipient_id))];
      const { data: subscriptions, error: subError } = await db.from("push_subscriptions")
        .select("id,user_id,subscription").in("user_id", recipientIds);
      if (subError) return reply({ error: "Unable to load push subscriptions" }, 500);

      const byUser = new Map<string, Array<{ id: string; subscription: Record<string, unknown> }>>();
      for (const sub of subscriptions || []) {
        const list = byUser.get(sub.user_id) || [];
        list.push(sub);
        byUser.set(sub.user_id, list);
      }
      const stale = new Set<string>();
      for (const notice of events) {
        let successfullySent = false;
        for (const sub of byUser.get(notice.recipient_id) || []) {
          try {
            await webpush.sendNotification(sub.subscription, JSON.stringify({
              title: notice.title, body: notice.body,
              tag: "tips-ledger-" + notice.event_key,
              url: "https://raphaeltt1.github.io/tips-ledger/",
            }));
            pushed++;
            successfullySent = true;
          } catch (error) {
            failed++;
            const code = (error as { statusCode?: number })?.statusCode;
            if (code === 404 || code === 410) stale.add(sub.id);
            console.error("Health-card push failed", code || "unknown");
          }
        }
        if (successfullySent) {
          const { error: markError } = await db.from("notifications")
            .update({ push_sent_at: new Date().toISOString() }).eq("id", notice.id).is("push_sent_at", null);
          if (markError) console.error("Health-card push receipt marking failed", markError.code);
        }
      }
      if (stale.size) {
        const { error: deleteError } = await db.from("push_subscriptions").delete().in("id", [...stale]);
        if (!deleteError) staleRemoved = stale.size;
      }
    }
    return reply({
      ok: true, date, eligible: pendingRows.length, newlyQueued: queued?.length || 0,
      pushed, failed, staleRemoved, pushConfigured: Boolean(vapidPublic && vapidPrivate),
    });
  } catch (error) {
    console.error("health-card-reminders failed", error);
    return reply({ error: "Health-card reminder dispatch failed" }, 500);
  }
});
