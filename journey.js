// ======================================================================
// JOURNEY — save, wallet and progression.
//
// Three things live here:
//   1. Persistence: one versioned save object in IndexedDB, with a
//      migration function so the schema can change without wiping saves.
//   2. Wallet: coins as an append-only ledger. The ledger is the source of
//      truth; the balance is a cache derived from it.
//   3. Progression: where the matatu is on the route, and what it costs
//      to move it.
//
// Nothing here reads the clock to gate anything. Ledger entries carry a
// timestamp so a future feature can display history, but no rule anywhere
// depends on that timestamp being honest — the device is offline and its
// clock can say anything.
// ======================================================================
"use strict";

/* ======================================================================
   PERSISTENCE — IndexedDB, one versioned record
   ====================================================================== */

const DB_NAME = "safari_ya_matatu";
const DB_VERSION = 1;
const STORE = "save";
const SAVE_KEY_IDB = "current";

// Bump when the shape of the save object changes, and add a step to
// migrateSave() below. Never wipe a save on version change.
const SAVE_VERSION = 3;

// The pre-journey game persisted here. Read once, migrated, then left
// alone (not deleted — an older build of the game may still be installed).
const LEGACY_LS_KEY = "safari_ya_matatu_v1";

function openDB() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in self)) return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(key) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbSet(key, value) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

function idbDelete(key) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

/* ======================================================================
   SAVE SHAPE
   ====================================================================== */

function defaultSave() {
  return {
    version: SAVE_VERSION,

    // Where the matatu is. stopIndex is the last stop ARRIVED at, so a
    // fresh save sits at Nairobi (index 0) having paid nothing.
    journey: {
      stopIndex: 0,
      levelsDoneThisLeg: 0,
    },

    // Append-only. Balance is derived from this, never stored as truth.
    ledger: [],

    // Word-search state, keyed by puzzle levelId.
    levels: {},

    // Next puzzle to serve. Separate from journey position because a leg
    // costs N levels but each level is a distinct puzzle.
    levelCursor: 1,

    // Scoreboard fields. Stored now, while the board is single-player, so
    // that adding a real leaderboard later needs no migration.
    stats: {
      furthestStopIndex: 0,
      hintsUsed: 0,
      levelsPlayed: 0,
      levelsReplayed: 0,
    },

    // Cosmetic / preferences / identity.
    profile: {
      soundOn: true,
      matatuName: null, // filled by the game on first boot
      skinIdx: 0,
      // Onboarding + cloud account.
      //
      // `phone` is the account key: one number, one account, one username,
      // and the same journey on any device. It is collected BEFORE the
      // username, and stays null until the player signs in.
      //
      // `playerId` predates phone sign-in and is now only a local device
      // tag. Nothing keys off it any more; kept so old saves stay readable.
      phone: null,
      username: null,
      playerId: newId(),
      firstSeen: null,
    },
  };
}

/* ======================================================================
   MIGRATION

   Runs on every load, for any version below current. Each step upgrades
   by exactly one version so the chain composes. A save from any past
   version must survive; wiping is never an acceptable migration.
   ====================================================================== */

function migrateSave(raw) {
  if (!raw || typeof raw !== "object") return defaultSave();

  let s = raw;

  // v1 -> v2: the pre-journey shape. A bare `sarafu` integer becomes an
  // opening ledger entry, and journey position is inferred from how many
  // levels the player had already cleared.
  if (!s.version || s.version < 2) {
    const d = defaultSave();
    const legacyLevels = s.levels && typeof s.levels === "object" ? s.levels : {};
    const clearedCount = Object.values(legacyLevels).filter((l) => l && l.completed).length;

    // Read everything off the old object BEFORE `s` is reassigned below —
    // the replacement has no `sarafu` field, so reading it afterwards
    // silently drops the player's balance.
    const legacyCoins = Number(s.sarafu);

    s = {
      ...d,
      levels: legacyLevels,
      levelCursor: Math.max(1, Number(s.currentLevelId) || clearedCount + 1),
      journey: journeyFromLevelsCompleted(clearedCount),
      profile: {
        soundOn: s.soundOn !== false,
        matatuName: s.matatuName || null,
        skinIdx: Number(s.skinIdx) || 0,
        // The pre-IndexedDB build already collected these, so a player who
        // onboarded there keeps their name and scoreboard identity.
        username: s.username || null,
        playerId: s.playerId || newId(),
        firstSeen: s.firstSeen || null,
      },
      stats: {
        ...d.stats,
        levelsPlayed: clearedCount,
      },
    };

    // Carry the old balance across as a single opening entry rather than
    // silently minting it, so the ledger still explains the balance.
    const opening = Number.isFinite(legacyCoins) ? legacyCoins : ECONOMY.STARTING_BALANCE;
    s.ledger = [makeEntry(opening, "bonus", { migratedFrom: "v1" })];
    s.journey.stopIndex = Math.min(s.journey.stopIndex, STOPS.length - 1);
    s.stats.furthestStopIndex = s.journey.stopIndex;
    s.version = 2;
  }

  // v2 -> v3: phone-number sign-in. Existing players keep their name and all
  // their progress; `phone` starts null, so the next boot asks them for a
  // number and adopts this save into the account they sign into.
  if (s.version < 3) {
    s.profile = { ...(s.profile || {}), phone: (s.profile && s.profile.phone) || null };
    s.version = 3;
  }

  // Future steps go here:
  // if (s.version < 4) { ...; s.version = 4; }

  // Defensive fill — a save written by a build that crashed mid-write, or
  // hand-edited via the debug panel, should still boot.
  const d = defaultSave();
  s.journey = { ...d.journey, ...(s.journey || {}) };
  s.stats = { ...d.stats, ...(s.stats || {}) };
  s.profile = { ...d.profile, ...(s.profile || {}) };
  s.levels = s.levels || {};
  s.ledger = Array.isArray(s.ledger) ? s.ledger : [];
  s.journey.stopIndex = clamp(s.journey.stopIndex, 0, STOPS.length - 1);
  s.version = SAVE_VERSION;
  return s;
}

function clamp(n, lo, hi) {
  n = Number(n) || 0;
  return Math.max(lo, Math.min(hi, n));
}

// Walk the route consuming a flat count of completed levels, so a legacy
// save that only knew "12 levels cleared" lands on the right stop.
function journeyFromLevelsCompleted(n) {
  let remaining = Math.max(0, n);
  let stopIndex = 0;
  for (let i = 1; i < STOPS.length; i++) {
    const cost = STOPS[i].levelsToAdvance;
    if (remaining >= cost) {
      remaining -= cost;
      stopIndex = i;
    } else break;
  }
  return { stopIndex, levelsDoneThisLeg: remaining };
}

/* ======================================================================
   LOAD / SAVE
   ====================================================================== */

let SAVE = defaultSave();

async function loadJourney() {
  let raw = null;
  try {
    raw = await idbGet(SAVE_KEY_IDB);
  } catch (e) {
    raw = null; // private mode, blocked storage — fall through to legacy/default
  }

  // First run on a device that played the pre-journey build.
  if (!raw) {
    try {
      const legacy = localStorage.getItem(LEGACY_LS_KEY);
      if (legacy) raw = JSON.parse(legacy);
    } catch (e) {
      /* ignore */
    }
  }

  SAVE = migrateSave(raw);

  // A brand-new save opens its ledger with the starting balance, so that
  // even the first coin the player has is explained by an entry.
  if (SAVE.ledger.length === 0) {
    SAVE.ledger.push(makeEntry(ECONOMY.STARTING_BALANCE, "bonus", { opening: true }));
  }

  recomputeBalance();
  persist();
  return SAVE;
}

// Write-behind. The game calls this from synchronous code paths on every
// coin and every found word, so it must never block gameplay; coalesce
// into one write per frame-ish.
let writeTimer = null;
function persist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    idbSet(SAVE_KEY_IDB, SAVE).catch(() => {
      // Storage refused the write. Gameplay continues from memory; the
      // next successful persist() picks up the whole object anyway.
    });
  }, 150);
}

async function resetJourney() {
  SAVE = defaultSave();
  SAVE.ledger.push(makeEntry(ECONOMY.STARTING_BALANCE, "bonus", { opening: true }));
  recomputeBalance();
  try {
    await idbDelete(SAVE_KEY_IDB);
  } catch (e) {
    /* ignore */
  }
  try {
    localStorage.removeItem(LEGACY_LS_KEY);
  } catch (e) {
    /* ignore */
  }
  persist();
}

/* ======================================================================
   CLOUD SAVE — resuming a journey on a different device

   The account key is the phone number, so signing in on a new phone has
   to bring the journey with it. These two functions are the whole of
   that: rank a save by how far it got, and swap the in-memory save for
   the cloud copy when the cloud copy is further along.

   CONFLICT RULE: adopt the cloud save only if it is strictly AHEAD of
   what is on this device. That is right in both directions —

     * fresh device, empty local save  -> cloud wins, journey resumes;
     * existing player adding a phone  -> local wins, nothing is lost.

   Never the other way round. Silently overwriting local progress with a
   staler cloud copy is the one failure a player would never forgive.
   ====================================================================== */

// Ordered comparison key: levels completed, then coins, then bonus words.
// Same ordering the leaderboard uses, so "ahead" means the same thing in
// both places.
function progressRank(save) {
  if (!save || typeof save !== "object") return [-1, -1, -1];
  const levels = Object.values(save.levels || {});
  const ledger = Array.isArray(save.ledger) ? save.ledger : [];
  return [
    levels.filter((l) => l && l.completed).length,
    ledger.reduce((n, e) => n + (Number(e && e.delta) || 0), 0),
    levels.reduce((n, l) => n + (l && l.foundBonus ? l.foundBonus.length : 0), 0),
  ];
}

function saveIsAhead(candidate, current) {
  const a = progressRank(candidate);
  const b = progressRank(current);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false; // dead even — keep what is already on the device
}

/* Adopt a save fetched from the cloud for `phone`.
 *
 * Returns true if the cloud save replaced the local one. Runs the cloud
 * object through migrateSave() first: it may have been written by an
 * older build on the player's other phone.
 */
function adoptCloudSave(raw, phone) {
  if (!raw || typeof raw !== "object") return false;

  const incoming = migrateSave(raw);
  if (!saveIsAhead(incoming, SAVE)) return false;

  SAVE = incoming;
  // The number the player just signed in with is the truth, whatever the
  // cloud copy happened to have been saved with.
  SAVE.profile.phone = phone;
  if (SAVE.ledger.length === 0) {
    SAVE.ledger.push(makeEntry(ECONOMY.STARTING_BALANCE, "bonus", { opening: true }));
  }
  recomputeBalance();
  persist();
  return true;
}

/* ======================================================================
   WALLET — append-only ledger, cached balance

   LedgerEntry = { id, ts, delta, reason, meta? }
   reason: 'level_reward' | 'fare' | 'hint' | 'bonus' | 'debug'
   ====================================================================== */

let balanceCache = 0;

function newId() {
  if (self.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function makeEntry(delta, reason, meta) {
  const e = { id: newId(), ts: Date.now(), delta: Math.round(delta), reason };
  if (meta) e.meta = meta;
  return e;
}

// The only way coins move. Returns the new balance.
function postLedger(delta, reason, meta) {
  const entry = makeEntry(delta, reason, meta);
  SAVE.ledger.push(entry);
  balanceCache += entry.delta;
  persist();
  return balanceCache;
}

// Recompute the cache from the ledger. The ledger is authoritative, so
// this is the definition of the balance; everything else is an optimisation.
function recomputeBalance() {
  balanceCache = SAVE.ledger.reduce((n, e) => n + (Number(e.delta) || 0), 0);
  return balanceCache;
}

function coins() {
  return balanceCache;
}

function canAfford(cost) {
  return balanceCache >= cost;
}

/* ======================================================================
   PROGRESSION
   ====================================================================== */

function currentStop() {
  return STOPS[SAVE.journey.stopIndex];
}

// The stop being travelled toward, or null at the end of the act.
function nextStop() {
  return STOPS[SAVE.journey.stopIndex + 1] || null;
}

function isJourneyComplete() {
  return SAVE.journey.stopIndex >= STOPS.length - 1;
}

// 0..1 across the current leg. Drives the matatu's fractional position on
// the map so mid-leg progress is visible.
function legProgress() {
  const next = nextStop();
  if (!next || !next.levelsToAdvance) return 0;
  return Math.min(1, SAVE.journey.levelsDoneThisLeg / next.levelsToAdvance);
}

function levelsRemainingThisLeg() {
  const next = nextStop();
  if (!next) return 0;
  return Math.max(0, next.levelsToAdvance - SAVE.journey.levelsDoneThisLeg);
}

// Called when a level is finished for the first time. Records the level
// toward the current leg and reports whether that was enough to depart.
// Does NOT deduct the fare — departure is a separate, explicit step so the
// arrival screen can narrate it.
function creditLevelToLeg() {
  const next = nextStop();
  SAVE.stats.levelsPlayed += 1;
  if (!next) {
    persist();
    return { readyToDepart: false };
  }
  SAVE.journey.levelsDoneThisLeg += 1;
  persist();
  return { readyToDepart: SAVE.journey.levelsDoneThisLeg >= next.levelsToAdvance };
}

function noteReplay() {
  SAVE.stats.levelsReplayed += 1;
  persist();
}

function noteHintUsed() {
  SAVE.stats.hintsUsed += 1;
  persist();
}

// Depart for the next stop: fare is auto-deducted here, then the matatu
// arrives. Returns a receipt for the arrival screen.
//
// The fare is deducted even if it would overdraw. In v1 that is unreachable
// (earn rates dwarf fares), but the rule matters: the journey must never
// deadlock on a balance the player cannot recover, because there is no way
// to earn coins other than by moving forward. A later version that wants
// fares to bite should add a way to earn while stationary, not a block here.
function departToNextStop() {
  const from = currentStop();
  const to = nextStop();
  if (!to) return null;

  const fare = to.fareFromPrevious;
  postLedger(-fare, "fare", { from: from.id, to: to.id });

  SAVE.journey.stopIndex += 1;
  SAVE.journey.levelsDoneThisLeg = 0;
  SAVE.stats.furthestStopIndex = Math.max(SAVE.stats.furthestStopIndex, SAVE.journey.stopIndex);
  persist();

  return {
    from,
    to,
    farePaid: fare,
    coinsRemaining: coins(),
    legKm: legDistanceKm(SAVE.journey.stopIndex),
    isMajor: to.tier === "major",
    isFinal: isJourneyComplete(),
  };
}

/* ======================================================================
   SCOREBOARD

   scoreEntry() is the single place that describes "how far did this run get".
   The cloud leaderboard in cloud.js ranks players; this feeds the journey-end
   summary and is the shape a richer remote board would consume.

   Note: furthestStopIndex / hintsUsed / levelsReplayed have no column in the
   Supabase schema yet, so they do not appear on the cloud board. They are
   recorded locally and ready if that schema gains the columns.
   ====================================================================== */

function scoreEntry() {
  return {
    furthestStopIndex: SAVE.stats.furthestStopIndex,
    furthestStopId: STOPS[SAVE.stats.furthestStopIndex].id,
    furthestStopName: STOPS[SAVE.stats.furthestStopIndex].name,
    kmReached: STOPS[SAVE.stats.furthestStopIndex].kmFromNairobi,
    hintsUsed: SAVE.stats.hintsUsed,
    coinsRemaining: coins(),
    levelsPlayed: SAVE.stats.levelsPlayed,
    levelsReplayed: SAVE.stats.levelsReplayed,
    farePaid: totalFarePaid(),
  };
}

/* ======================================================================
   LEDGER QUERIES — the point of keeping entries rather than a total
   ====================================================================== */

function totalBy(reason) {
  return SAVE.ledger.reduce((n, e) => (e.reason === reason ? n + e.delta : n), 0);
}

function totalFarePaid() {
  return Math.abs(totalBy("fare"));
}

function totalHintSpend() {
  return Math.abs(totalBy("hint"));
}

function totalEarned() {
  return SAVE.ledger.reduce((n, e) => (e.delta > 0 ? n + e.delta : n), 0);
}

/* ======================================================================
   DEBUG — dev builds only. Gated in index.html by isDebugBuild().
   ====================================================================== */

const DEBUG_API = {
  jumpToStop(i) {
    SAVE.journey.stopIndex = clamp(i, 0, STOPS.length - 1);
    SAVE.journey.levelsDoneThisLeg = 0;
    SAVE.stats.furthestStopIndex = Math.max(SAVE.stats.furthestStopIndex, SAVE.journey.stopIndex);
    persist();
  },
  setBalance(n) {
    // Posted as a delta so the ledger still adds up to the balance.
    const target = Math.max(0, Math.round(Number(n) || 0));
    postLedger(target - coins(), "debug", { setBalanceTo: target });
  },
  addCoins(n) {
    postLedger(Number(n) || 0, "debug", {});
  },
  reset: resetJourney,
  dump: () => JSON.parse(JSON.stringify(SAVE)),
  verifyBalance: () => {
    const cached = balanceCache;
    const derived = SAVE.ledger.reduce((n, e) => n + e.delta, 0);
    return { cached, derived, ok: cached === derived };
  },
};
