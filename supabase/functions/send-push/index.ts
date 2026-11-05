import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push";

const cors = {
  "Access-Control-Allow-Origin": "https://raphaeltt1.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
  if (!url || !anonKey || !serviceKey || !vapidPublic || !vapidPrivate) {
    return json({ error: "Push service is not configured yet" }, 503);
  }

  try {
    const token = authorization.slice("Bearer ".length);
    const authClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await admin
      .from("profiles").select("id,full_name,role,active")
      .eq("id", authData.user.id).maybeSingle();
    if (profileError || !profile?.active) return json({ error: "Active profile required" }, 403);

    const body = await req.json();
    const eventType = body?.event_type;
    const weeklyTipId = body?.weekly_tip_id;
    const schedulePublicationId = body?.schedule_publication_id;
    if (!["published", "received", "test", "schedule_published"].includes(eventType)
        || (["published", "received"].includes(eventType) && !weeklyTipId)
        || (eventType === "schedule_published" && !schedulePublicationId)) {
      return json({ error: "Invalid event" }, 400);
    }

    let recipientIds: string[] = [];
    let title = "";
    let message = "";
    const scheduleNoticeIds = new Map<string, string>();
    if (eventType === "test") {
      // A signed-in user may only test notifications to their own devices.
      recipientIds = [profile.id];
      title = "🔔 Tips Ledger Test";
      message = "Background push is working on this device.";
    } else if (eventType === "schedule_published") {
      if (!["admin", "superuser", "manager"].includes(profile.role)) {
        return json({ error: "Only management may send schedule publication notifications" }, 403);
      }
      // The DB is authoritative: a schedule must already be successfully published.
      // current_user_role also respects superuser MFA.
      const { data: callerRole, error: callerError } = await authClient.rpc("current_user_role");
      if (callerError || callerRole !== profile.role) return json({ error: "Role verification failed" }, 403);
      const { data: publication, error: publicationError } = await admin.from("schedule_publications")
        .select("id,department,week_start,published_at")
        .eq("id", schedulePublicationId).maybeSingle();
      if (publicationError || !publication?.published_at) {
        return json({ error: "Published schedule not found" }, 404);
      }
      const { data: unsent, error: noticeError } = await admin.from("notifications")
        .select("id,recipient_id").eq("event_key", "schedule:" + publication.id)
        .is("push_sent_at", null);
      if (noticeError) return json({ error: "Could not load schedule alerts" }, 500);
      recipientIds = (unsent || []).map((x: { recipient_id: string; id: string }) => {
        scheduleNoticeIds.set(x.recipient_id, x.id);
        return x.recipient_id;
      });
      title = "📅 Weekly Schedule";
      message = "Your weekly schedule has been published";
    } else if (eventType === "published") {
      if (!["admin", "superuser", "manager"].includes(profile.role)) return json({ error: "Not authorized to publish notifications" }, 403);
      const { data: payment, error } = await admin.from("weekly_tips")
        .select("id,runner_id,week_start,published").eq("id", weeklyTipId).maybeSingle();
      if (error || !payment?.published) return json({ error: "Published payment not found" }, 404);
      recipientIds = [payment.runner_id];
      title = "💰 Your Weekly Tips Are Ready!";
      message = "Your payment for this week has been published. Open Tips Ledger to review it.";
    } else {
      if (!["runner", "host_hostess", "counter", "expo", "kitchen_crew"].includes(profile.role)) return json({ error: "Only the paid team member can confirm receipt" }, 403);
      const { data: receipt, error } = await admin.from("receipt_confirmations")
        .select("weekly_tip_id,runner_id").eq("weekly_tip_id", weeklyTipId)
        .eq("runner_id", profile.id).maybeSingle();
      if (error || !receipt) return json({ error: "Receipt confirmation not found" }, 404);
      const { data: admins, error: adminsError } = await admin.from("profiles")
        .select("id").in("role", ["admin", "superuser"]).eq("active", true);
      if (adminsError) return json({ error: "Could not load administrators" }, 500);
      recipientIds = (admins || []).map((x: { id: string }) => x.id);
      title = "✅ Payment Received";
      message = `Team member ${profile.full_name || "Unknown"} confirmed receiving their weekly payment.`;
    }

    if (!recipientIds.length) return json({ sent: 0, failed: 0, reason: "No active recipients" });
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const { data: subscriptions, error: subError } = await admin.from("push_subscriptions")
      .select("id,user_id,endpoint,subscription").in("user_id", recipientIds);
    if (subError) return json({ error: "Could not load push subscriptions" }, 500);
    if (!subscriptions?.length) return json({sent: 0, failed: 0, reason: "No registered device subscriptions for the recipient(s). Enable or re-register push on each device."});

    let sent = 0;
    let failed = 0;
    const staleIds: string[] = [];
    const scheduleDelivered = new Set<string>();
    await Promise.all((subscriptions || []).map(async (row: { id: string; user_id: string; endpoint: string; subscription: Record<string, unknown> }) => {
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify({
          title, body: message, tag: `tips-ledger-${eventType}-${schedulePublicationId || weeklyTipId || profile.id}`,
          url: "https://raphaeltt1.github.io/tips-ledger/"
        }));
        sent++;
        if (eventType === "schedule_published") scheduleDelivered.add(row.user_id);
      } catch (err) {
        failed++;
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) staleIds.push(row.id);
        console.error("Push send failed", status || "unknown");
      }
    }));
    if (staleIds.length) await admin.from("push_subscriptions").delete().in("id", staleIds);
    if (eventType === "schedule_published") {
      // Mark successful per-recipient delivery to avoid repeated pushes on retries.
      await Promise.all([...scheduleDelivered].map(async userId => {
        const noticeId = scheduleNoticeIds.get(userId);
        if (!noticeId) return;
        const { error } = await admin.from("notifications")
          .update({ push_sent_at: new Date().toISOString() }).eq("id", noticeId).is("push_sent_at", null);
        if (error) console.error("Schedule delivery receipt update failed", error.code);
      }));
    }
    return json({ sent, failed, reason: sent === 0 ? "All push attempts failed. Check Supabase Edge Function logs and VAPID configuration." : null, staleSubscriptionsRemoved: staleIds.length });
  } catch (error) {
    console.error("send-push failed", error);
    return json({ error: "Push notification delivery failed" }, 500);
  }
});
