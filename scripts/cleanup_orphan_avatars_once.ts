// One-time, fail-closed cleanup of the two orphaned 2026-10-31 test avatars.
// Exact object path hashes—not private photo URLs—are recorded in GitHub.
// No SQL mutation: all removal is via Supabase's supported Storage API.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const PROJECT = "qvwgmybocjyhldwnrqqt";
const BUCKET = "tips-ledger-avatars";
const TARGET_HASHES = new Set([
  "7f9fabf28877ad1ae52f9ca9da9fff6f9e04ce0d5f43c05908e0dd96d65604ab",
  "f29aa89abb131f73dacf2606fbd2dae1ea61b2cb55090ed8494f8b92bed983f0",
]);
const PRESERVE_HASH = "7df8a026a116180dd7c12c3427c9dd10002cadd20988e87c39946ce9dba822ec";
const DRY_RUN = Deno.env.get("DRY_RUN") !== "false";
const SECRET = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!SECRET || SECRET.length < 25) throw new Error("Service role secret not configured");
const client = createClient("https://" + PROJECT + ".supabase.co", SECRET, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jpeg = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/i;
const digest = async (path: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path)))]
    .map((n) => n.toString(16).padStart(2, "0")).join("");

function assert(ok: unknown, msg: string): asserts ok { if (!ok) throw new Error(msg); }

async function listing(folder: string) {
  const {data, error} = await client.storage.from(BUCKET).list(folder, {
    limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" },
  });
  if (error) throw new Error("Storage enumeration failed");
  assert(Array.isArray(data) && data.length < 1000, "Unexpected or incomplete Storage listing");
  return data;
}

const { data: profiles, error: profileError } =
  await client.from("profiles").select("id,role,active,avatar_path").limit(1000);
if (profileError) throw new Error("Could not verify existing accounts");
assert(profiles.length > 0 && profiles.length < 1000, "Profile listing incomplete");
const activeSuperusers = profiles.filter((p) => p.active && p.role === "superuser");
assert(activeSuperusers.length === 1, "Expected exactly one active Superuser");
assert(await digest(activeSuperusers[0].avatar_path || "") === PRESERVE_HASH,
  "Superuser photo changed; cleanup aborted");

const activeIds = new Set(profiles.map((p) => p.id));
const folders = await listing("");
const objects = [];
for (const folder of folders) {
  assert(folder.id === null && uuid.test(folder.name), "Unexpected item at Storage root");
  const contents = await listing(folder.name);
  for (const file of contents) {
    assert(file.id && jpeg.test(file.name), "Unexpected nested path or object");
    objects.push({folder: folder.name, path: folder.name + "/" + file.name});
  }
}
const hashes = await Promise.all(objects.map((x) => digest(x.path)));
assert(hashes.includes(PRESERVE_HASH), "Superuser photo not found in Storage");
const targets = objects.filter((_, i) => TARGET_HASHES.has(hashes[i]));
assert(targets.length === 2 &&
       new Set(targets.map((x) => x.folder)).size === 2 &&
       new Set(targets.map((x) => x.path)).size === 2,
       "Expected exactly two unique orphaned target files");
for (const hash of TARGET_HASHES) assert(hashes.includes(hash), "Expected orphaned object missing");
assert(!targets.some((t) => activeIds.has(t.folder) || t.folder === activeSuperusers[0].id),
  "Target file belongs to an existing profile");
for (const t of targets) {
  const { data, error } = await client.auth.admin.getUserById(t.folder);
  assert(!data?.user && Number(error?.status) === 404,
    "Target has an active Auth identity or identity lookup failed");
}
console.log("Preflight passed: exactly 2 specified orphan photos; Superuser photo protected.");
if (DRY_RUN) {
  console.log("DRY RUN: no files modified.");
  Deno.exit(0);
}

// Validate the user account list again as close to the write as possible.
const { data: freshProfiles, error: freshError } =
  await client.from("profiles").select("id,role,active,avatar_path").limit(1000);
assert(!freshError && Array.isArray(freshProfiles), "Could not recheck active profiles");
assert(freshProfiles.some((p) =>
  p.active && p.role === "superuser" && p.id === activeSuperusers[0].id &&
  p.avatar_path === activeSuperusers[0].avatar_path), "Superuser protection changed");
assert(!targets.some((t) => freshProfiles.some((p) => p.id === t.folder)),
  "A formerly deleted account was recreated");
const { data: removed, error: removeError } =
  await client.storage.from(BUCKET).remove(targets.map((t) => t.path));
if (removeError) throw new Error("Storage API deletion failed");
console.log("Storage API deletion submitted; verifying target folders.");
for (const t of targets) {
  assert((await listing(t.folder)).length === 0, "An orphaned object still exists");
}
const current = await listing(activeSuperusers[0].id);
assert(current.some((x) => activeSuperusers[0].id + "/" + x.name ===
  activeSuperusers[0].avatar_path), "Superuser photo missing after cleanup");
console.log("SUCCESS: both orphaned photos removed, active Superuser photo preserved.");
