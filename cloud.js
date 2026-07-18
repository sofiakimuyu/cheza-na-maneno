/* Matatu ya Maneno — cloud sync (scoreboard + telemetry).
 *
 * DESIGN RULE: this file must never be able to break the game.
 * The game is offline-first. Every call here is best-effort and swallows its
 * own errors; if Supabase is unconfigured, unreachable, rate-limited or
 * broken, gameplay continues exactly as it did before this file existed.
 *
 * Identity comes from Supabase Anonymous Auth, so auth.uid() is server-issued
 * and RLS can enforce "you may only write your own row". See supabase/schema.sql.
 */
window.Cloud = (function(){
  const CFG = window.SUPABASE_CONFIG || {};
  const QUEUE_KEY = "safari_ya_matatu_evtq";
  const enabled = !!(CFG.url && CFG.anonKey);

  let client = null;
  let uid = null;
  let readyPromise = null;

  function log(...a){ if(window.CLOUD_DEBUG) console.log("[cloud]", ...a); }

  /* ---- queue: events recorded while offline, flushed on next success ---- */
  function readQueue(){
    try{ return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; }catch(e){ return []; }
  }
  function writeQueue(q){
    // Cap it so a long offline streak can't grow localStorage without bound.
    try{ localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-200))); }catch(e){}
  }
  function enqueue(row){ const q = readQueue(); q.push(row); writeQueue(q); }

  async function flushQueue(){
    if(!client || !uid) return;
    const q = readQueue();
    if(!q.length) return;
    const rows = q.map(r => ({...r, player_id: uid}));
    const { error } = await client.from("events").insert(rows);
    if(error){ log("flush failed, keeping queue", error.message); return; }
    writeQueue([]);
    log("flushed", rows.length, "events");
  }

  /* ---- init: sign in anonymously, ensure a players row exists ---- */
  async function init(){
    if(!enabled){ log("not configured — running offline-only"); return false; }
    try{
      client = window.supabase.createClient(CFG.url, CFG.anonKey);

      let { data: sess } = await client.auth.getSession();
      if(!sess || !sess.session){
        const { data, error } = await client.auth.signInAnonymously();
        if(error) throw error;
        sess = data;
      }
      uid = (sess.session || sess).user.id;
      log("signed in", uid);
      return true;
    }catch(e){
      // Most likely causes: anonymous sign-ins disabled in the dashboard, or
      // the 30-req/hour per-IP rate limit. Either way: play on.
      log("init failed — offline-only", e && e.message);
      client = null; uid = null;
      return false;
    }
  }

  function ready(){
    if(!readyPromise) readyPromise = init();
    return readyPromise;
  }

  /* ---- score shape derived from the local save ---- */
  function scoreFrom(state){
    const levels = Object.entries(state.levels || {});
    const done = levels.filter(([,l]) => l && l.completed);
    return {
      levels_done: done.length,
      sarafu:      state.sarafu || 0,
      bonus_words: levels.reduce((n,[,l]) => n + ((l && l.foundBonus) ? l.foundBonus.length : 0), 0),
      best_level:  done.reduce((m,[id]) => Math.max(m, Number(id) || 0), 0),
    };
  }

  /* ---- public API — every one is safe to call unconditionally ---- */

  // Create/refresh this player's scoreboard row.
  async function syncPlayer(state){
    if(!await ready()) return;
    try{
      await client.from("players").upsert({
        id: uid,
        username: state.username,
        last_seen_at: new Date().toISOString(),
        ...scoreFrom(state),
      });
      // Mark today active (composite PK makes repeats a no-op).
      await client.from("player_days").insert({ player_id: uid }).select().maybeSingle();
      await flushQueue();
    }catch(e){ log("syncPlayer failed", e && e.message); }
  }

  // Record a funnel/engagement event. Queues offline, never throws.
  async function track(type, levelId){
    const row = { type, level_id: (levelId == null ? null : levelId) };
    if(!enabled) return;
    if(!client || !uid){ enqueue(row); ready().then(ok => { if(ok) flushQueue(); }); return; }
    try{
      const { error } = await client.from("events").insert({ ...row, player_id: uid });
      if(error) enqueue(row);
    }catch(e){ enqueue(row); }
  }

  // Public leaderboard. Returns [] on any failure so callers can render a
  // clean empty state rather than an error.
  async function leaderboard(limit = 50){
    if(!await ready()) return [];
    try{
      const { data, error } = await client
        .from("players")
        .select("id,username,levels_done,sarafu,bonus_words")
        .order("levels_done", { ascending: false })
        .order("sarafu",      { ascending: false })
        .order("bonus_words", { ascending: false })
        .limit(limit);
      if(error) throw error;
      return (data || []).map(r => ({ ...r, isMe: r.id === uid }));
    }catch(e){ log("leaderboard failed", e && e.message); return []; }
  }

  // Retry queued events when the device comes back online.
  window.addEventListener("online", ()=>{ ready().then(ok => { if(ok) flushQueue(); }); });

  return { enabled, ready, syncPlayer, track, leaderboard, scoreFrom };
})();
