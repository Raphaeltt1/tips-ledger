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
    if (!["published", "received", "test"].includes(eventType) || (eventType !== "test" && !weeklyTipId)) {
      return json({ error: "Invalid event" }, 400);
    }

    let recipientIds: string[] = [];
    let title = "";
    let message = "";
    if (eventType === "test") {
      // A signed-in user may only test notifications to their own devices.
      recipientIds = [profile.id];
      title = "🔔 Tips Ledger Test";
      message = "Background push is working on this device.";
    } else if (eventType === "published") {
      if (!["admin", "superuser", "manager"].includes(profile.role)) return json({ error: "Not authorized to publish notifications" }, 403);
      const { data: payment, error } = await admin.from("weekly_tips")
        .select("id,runner_id,week_start,published").eq("id", weeklyTipId).maybeSingle();
      if (error || !payment?.published) return json({ error: "Published payment not found" }, 404);
      recipientIds = [payment.runner_id];
      title = "💰 Your Weekly Tips Are Ready!";
      message = "Your payment for this week has been published. Open Tips Ledger to review it.";
    } else {
      if (profile.role !== "runner") return json({ error: "Only the runner can confirm receipt" }, 403);
      const { data: receipt, error } = await admin.from("receipt_confirmations")
        .select("weekly_tip_id,runner_id").eq("weekly_tip_id", weeklyTipId)
        .eq("runner_id", profile.id).maybeSingle();
      if (error || !receipt) return json({ error: "Receipt confirmation not found" }, 404);
      const { data: admins, error: adminsError } = await admin.from("profiles")
        .select("id").in("role", ["admin", "superuser"]).eq("active", true);
      if (adminsError) return json({ error: "Could not load administrators" }, 500);
      recipientIds = (admins || []).map((x: { id: string }) => x.id);
      title = "✅ Payment Received";
      message = `Runner ${profile.full_name || "Unknown"} confirmed receiving their weekly payment.`;
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
    await Promise.all((subscriptions || []).map(async (row: { id: string; endpoint: string; subscription: Record<string, unknown> }) => {
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify({
          title, body: message, tag: `tips-ledger-${eventType}-${weeklyTipId || profile.id}`,
          url: "https://raphaeltt1.github.io/tips-ledger/"
        }));
        sent++;
      } catch (err) {
        failed++;
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) staleIds.push(row.id);
        console.error("Push send failed", status || "unknown");
      }
    }));
    if (staleIds.length) await admin.from("push_subscriptions").delete().in("id", staleIds);
    return json({ sent, failed, reason: sent === 0 ? "All push attempts failed. Check Supabase Edge Function logs and VAPID configuration." : null, staleSubscriptionsRemoved: staleIds.length });
  } catch (error) {
    console.error("send-push failed", error);
    return json({ error: "Push notification delivery failed" }, 500);
  }
});
