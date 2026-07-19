/* Matatu ya Maneno — cloud sync (accounts + scoreboard + telemetry).
 *
 * DESIGN RULE: this file must never be able to break the game.
 * The game is offline-first. Every call here is best-effort and swallows its
 * own errors; if Supabase is unconfigured, unreachable, rate-limited or
 * broken, gameplay continues exactly as it did before this file existed.
 *
 * IDENTITY: the player's phone number is the account key. The same number on
 * any device loads the same username and the same saved journey. Supabase
 * Anonymous Auth is still used, but only to obtain a JWT — every table is
 * reachable solely through the security-definer RPCs in supabase/schema.sql,
 * so a client can never dump the phone list.
 *
 * There is no OTP: the number is a convenience key, not a credential. See the
 * TRUST note in supabase/schema.sql.
 */
window.Cloud = (function(){
  const CFG = window.SUPABASE_CONFIG || {};
  const QUEUE_KEY = "safari_ya_matatu_evtq";
  const enabled = !!(CFG.url && CFG.anonKey);

  let client = null;
  let authed = false;
  let readyPromise = null;

  function log(...a){ if(window.CLOUD_DEBUG) console.log("[cloud]", ...a); }

  /* ==================================================================
     PHONE NUMBERS

     Normalised to E.164 before they ever leave the device, so that
     "0712 345 678", "712345678" and "+254712345678" are one account and
     not three.

     There is no default country. The caller passes the calling code the
     player picked, and a number typed with an explicit + or 00 keeps
     whatever country it names regardless of that pick. Guessing a country
     for someone is how you hand two different people the same account —
     +254712345678 and +44712345678 are not the same phone.
     ================================================================== */

  // Known calling codes, longest first so "1868" wins over "1". Supplied by
  // the UI (which owns the country list) via setCallingCodes().
  let CALLING_CODES = [];
  function setCallingCodes(codes){
    CALLING_CODES = (codes || []).map(String).sort((a, b) => b.length - a.length);
  }

  function normalisePhone(raw, cc){
    let s = String(raw || "").trim();
    const intl = s.startsWith("+") || s.startsWith("00");
    s = s.replace(/[^0-9]/g, "");
    if(!s) return null;

    if(intl){
      // The number names its own country; the picker is irrelevant.
      s = s.replace(/^00/, "");
    }else{
      const code = String(cc || "").replace(/[^0-9]/g, "");
      if(!code) return null;          // nothing to resolve a local number against
      s = s.replace(/^0+/, "");       // national trunk prefix, e.g. 0712 -> 712
      if(!s) return null;
      // Someone who typed the full national number including their own
      // calling code should not get it twice.
      if(!(s.startsWith(code) && s.length > code.length + 5)) s = code + s;
    }

    // Must match the CHECK constraint on accounts.phone.
    if(!/^[1-9][0-9]{7,14}$/.test(s)) return null;
    return "+" + s;
  }

  // For display: +254712345678 -> +254 712 345 678. Splits the calling code
  // off when it is one we know, and otherwise just groups the digits.
  function prettyPhone(e164){
    const s = String(e164 || "");
    if(!s.startsWith("+")) return s;
    const digits = s.slice(1);
    const code = CALLING_CODES.find(c => digits.startsWith(c));
    const rest = code ? digits.slice(code.length) : digits;
    const head = code ? "+" + code + " " : "+";
    // Threes, except that a lone trailing digit joins the group before it —
    // national formats differ far too much to do better generically, but
    // "345 6" looks like a typo in any of them.
    const groups = rest.match(/\d{1,3}/g) || [];
    if(groups.length > 1 && groups[groups.length - 1].length === 1){
      groups[groups.length - 2] += groups.pop();
    }
    return (head + groups.join(" ")).trim();
  }

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
    if(!client || !authed) return;
    const q = readQueue();
    if(!q.length) return;
    // event_log takes one row at a time; a queue this small (<=200) is fine
    // to drain serially, and a partial drain just leaves the rest queued.
    const rest = [];
    for(const r of q){
      if(!r.phone){ continue; }                      // pre-signin event, undeliverable
      const { error } = await client.rpc("event_log", {
        p_phone: r.phone, p_type: r.type, p_level_id: r.level_id,
      });
      if(error){ rest.push(r); }
    }
    writeQueue(rest);
    log("flushed", q.length - rest.length, "events");
  }

  /* ---- init: sign in anonymously purely to get a JWT ---- */
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
      authed = !!(sess.session || sess).user;
      log("authenticated");
      return authed;
    }catch(e){
      // Most likely causes: anonymous sign-ins disabled in the dashboard, or
      // the 30-req/hour per-IP rate limit. Either way: play on.
      log("init failed — offline-only", e && e.message);
      client = null; authed = false;
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

  /* ==================================================================
     PUBLIC API — every one is safe to call unconditionally
     ================================================================== */

  /* Look up an account by phone.
   *
   * Returns:
   *   { ok:true,  found:true,  account:{username, save, ...scores} }
   *   { ok:true,  found:false }                — number is new, ask for a name
   *   { ok:false }                             — offline / unreachable
   *
   * The caller MUST distinguish ok:false from found:false. Treating an
   * offline lookup as "new player" would silently fork the account.
   */
  async function loadAccount(phone){
    if(!phone) return { ok:false };
    if(!await ready()) return { ok:false };
    try{
      const { data, error } = await client.rpc("account_load", { p_phone: phone });
      if(error) throw error;
      const row = (data || [])[0];
      return row ? { ok:true, found:true, account:row } : { ok:true, found:false };
    }catch(e){ log("loadAccount failed", e && e.message); return { ok:false }; }
  }

  // Create/refresh this player's account: identity, score and full save.
  // `save` is the whole journey.js save object, so another device with the
  // same number can resume from it.
  async function syncPlayer(state, save){
    if(!state || !state.phone || !state.username) return;
    if(!await ready()) return;
    try{
      const s = scoreFrom(state);
      const { error } = await client.rpc("account_sync", {
        p_phone:       state.phone,
        p_username:    state.username,
        p_save:        save || null,
        p_levels_done: s.levels_done,
        p_sarafu:      s.sarafu,
        p_bonus_words: s.bonus_words,
        p_best_level:  s.best_level,
      });
      if(error) throw error;
      await flushQueue();
    }catch(e){ log("syncPlayer failed", e && e.message); }
  }

  // Record a funnel/engagement event. Queues offline, never throws.
  async function track(type, levelId, phone){
    if(!enabled) return;
    const row = { type, level_id: (levelId == null ? null : levelId), phone: phone || null };
    // Events before sign-in have no account to hang off; drop them rather
    // than queue rows that event_log() would only ignore.
    if(!row.phone) return;
    if(!client || !authed){ enqueue(row); ready().then(ok => { if(ok) flushQueue(); }); return; }
    try{
      const { error } = await client.rpc("event_log", {
        p_phone: row.phone, p_type: row.type, p_level_id: row.level_id,
      });
      if(error) enqueue(row);
    }catch(e){ enqueue(row); }
  }

  /* Public leaderboard.
   *
   * Returns { ok, rows, reason? }. It deliberately does NOT collapse a
   * failure into an empty list: "nobody has played yet" and "the backend is
   * not answering" look identical to a player but need opposite responses
   * from us, and reporting the second as the first is how a broken
   * scoreboard sits unnoticed.
   *
   * Phone numbers are never returned by the RPC — `isMe` is computed
   * server-side from the number we pass in.
   */
  async function leaderboard(limit = 50, phone = null){
    if(!enabled)        return { ok:false, rows:[], reason:"unconfigured" };
    if(!await ready())  return { ok:false, rows:[], reason:"unreachable" };
    try{
      const { data, error } = await client.rpc("leaderboard_top", {
        lim: limit, p_phone: phone,
      });
      if(error) throw error;
      return { ok:true, rows:(data || []).map(r => ({ ...r, isMe: !!r.is_me })) };
    }catch(e){
      const msg = (e && e.message) || "";
      log("leaderboard failed", msg);
      // PostgREST reports a missing RPC as a schema-cache miss. That means
      // the database exists but schema.sql was never applied to it — a
      // deployment gap, not a network problem, so say so differently.
      const missing = /schema cache|does not exist/i.test(msg);
      return { ok:false, rows:[], reason: missing ? "schema" : "error" };
    }
  }

  // Retry queued events when the device comes back online.
  window.addEventListener("online", ()=>{ ready().then(ok => { if(ok) flushQueue(); }); });

  return {
    enabled, ready, loadAccount, syncPlayer, track, leaderboard, scoreFrom,
    normalisePhone, prettyPhone, setCallingCodes,
  };
})();
