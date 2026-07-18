// ======================================================================
// ECONOMY — every balance number in the game lives here.
//
// Tuning scarcity later should be a matter of changing numbers in this
// file, never of changing structure. Nothing here reads the clock: the
// device is offline and its clock is not trustworthy, so there are no
// timed refills, energy gates or daily lockouts anywhere in the game.
//
// v1 stance: coins are DELIBERATELY not scarce. The player should never
// be blocked from boarding the next matatu. The hint/fare plumbing is
// real so that a later version can tighten the numbers without a rewrite.
// ======================================================================
"use strict";

const ECONOMY = {
  // --- Starting position -------------------------------------------------
  // Enough to cover the first fare plus a few hints before the player has
  // earned anything. Early puzzles are 3-letter levels and pay very little.
  STARTING_BALANCE: 120,

  // --- Earning -----------------------------------------------------------
  // Per grid answer. Scales with tile count so longer words feel better.
  // 3 tiles = 14, 7 tiles = 26.
  answerCoins: (tiles) => 5 + tiles * 3,

  // Per bonus word (valid Swahili word that isn't in this level's grid).
  // Paid better than a grid answer — finding these is optional effort.
  bonusCoins: (tiles) => 8 + tiles * 4,

  // Flat bonus for finishing a level, paid on top of the word rewards.
  //
  // This exists to flatten the earn curve. Level 1 pays only 28 coins from
  // answers alone while level 20 pays 202, so without a flat component the
  // opening legs would be by far the tightest part of the game — exactly
  // where a new player can least afford to be squeezed. With it, the
  // first leg earns ~147 against a 40-coin fare.
  LEVEL_COMPLETION_BONUS: 40,

  // --- Spending ----------------------------------------------------------
  // Reveals one random unfilled letter. Priced low but non-zero: the cost
  // must exist so it can be raised later, but in v1 it should never be the
  // reason a player stalls. Roughly one grid answer's worth.
  HINT_COST: 20,

  // --- Replays -----------------------------------------------------------
  // Replaying an already-completed level pays nothing. Without this the
  // cheapest level in the act would be an infinite coin faucet, which would
  // make every other number here meaningless. Replays still cost hints if
  // the player buys them, and are counted as a scoreboard tiebreak.
  REPLAY_PAYS_COINS: false,
};

// Fares live on each stop in route.js (`fareFromPrevious`), because a fare
// is a property of a leg rather than a global rate. They are denominated in
// the same coins the player earns — there is no second currency.
