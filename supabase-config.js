/* Matatu ya Maneno — Supabase connection.
 *
 * Fill in the two values below from:
 *   Supabase Dashboard -> Project Settings -> API
 *
 * The "anon" / "publishable" key belongs here and is safe to commit — it is
 * designed to ship in client-side code, and Row Level Security (see
 * supabase/schema.sql) is what actually protects the data.
 *
 * NEVER put the "service_role" key in this file. It bypasses every RLS policy.
 * It is a server-only secret and must never reach the browser or the repo.
 *
 * If both values are left blank the game runs exactly as before: fully
 * offline, no scoreboard, no telemetry, nothing broken.
 */
window.SUPABASE_CONFIG = {
  url:     "https://uhdxrmkqrdzhmdauxuxd.supabase.co",
  anonKey: "sb_publishable_yP9cR_MRHKnkCbhhvN4v2g_mw_pCQMh",
};
