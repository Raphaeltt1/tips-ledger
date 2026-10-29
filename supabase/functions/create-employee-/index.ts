import { createClient } from "npm:@supabase/supabase-js@2";

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
  if (!url || !anonKey || !serviceKey) return json({ error: "Server is not configured" }, 503);

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
    const { data: actor, error: actorError } = await admin
      .from("profiles").select("id,role,active")
      .eq("id", authData.user.id).maybeSingle();
    if (actorError || !actor?.active || actor.role !== "admin") {
      return json({ error: "Admin access required" }, 403);
    }

    const body = await req.json();
    const fullName = typeof body?.full_name === "string" ? body.full_name.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const role = body?.role === "manager" ? "manager" : body?.role === "runner" ? "runner" : null;

    if (!fullName || fullName.length > 100) return json({ error: "Enter a valid full name (maximum 100 characters)." }, 400);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
    if (password.length < 12) return json({ error: "Password must be at least 12 characters." }, 400);
    if (!role) return json({ error: "Choose either Runner or Manager. Admin accounts cannot be created here." }, 400);

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createError || !created.user) {
      return json({ error: createError?.message || "Could not create login account." }, 400);
    }

    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id,
      full_name: fullName,
      role,
      active: true,
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      console.error("Profile creation failed:", profileError.message);
      return json({ error: "Could not create employee profile. The login creation was rolled back." }, 500);
    }

    return json({ success: true, employee: { id: created.user.id, full_name: fullName, role } }, 200);
  } catch (error) {
    console.error("create-employee failed:", error);
    return json({ error: "Employee creation failed." }, 500);
  }
});
