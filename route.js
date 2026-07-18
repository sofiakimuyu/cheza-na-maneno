// ======================================================================
// ROUTE — the full A109 corridor, Nairobi to Mombasa.
//
// Typed as plain data. Nothing in the game hardcodes a stop count, a fare
// or a level total — it all derives from this array.
//
// NOTE ON LENGTH vs CONTENT: 21 legs x 2 levels = 42 levels to reach
// Mombasa, but the word list only has 30 puzzles. A player therefore runs
// out of words at Bachuma Gate (stop 15) and meets the traffic jam screen.
// That is deliberate and handled in index.html — the route describes the
// whole road, and the content available decides how far you actually get.
// Adding puzzles to the CSV extends the playable distance with no code
// change here.
//
// Field notes:
//   kmFromNairobi    absolute, not per-leg. Leg distance is derived.
//   fareFromPrevious COINS, deducted automatically on departure. Scales
//                    roughly with leg distance. Nairobi is the origin, so
//                    its fare is 0 — you never pay to be where you started.
//   levelsToAdvance  how many levels this leg costs. 2 everywhere in v1,
//                    but stored per stop so later stops can cost 3-4
//                    without a schema change.
//   tier             'major' stops get the long celebratory arrival.
// ======================================================================
"use strict";

const STOPS = [
  {
    id: "nairobi",
    name: "Nairobi",
    kmFromNairobi: 0,
    fareFromPrevious: 0,
    levelsToAdvance: 0,
    tier: "major",
    blurb:
      "Stendi ya Machakos Country Bus, asubuhi na mapema. Makanga wanapiga kelele “Mombasa! Mombasa!” " +
      "na matatu haiondoki mpaka kiti cha mwisho kijae.",
  },
  {
    id: "mlolongo",
    name: "Mlolongo",
    kmFromNairobi: 18,
    fareFromPrevious: 50,
    levelsToAdvance: 2,
    tier: "minor",
    blurb:
      "Mji wa mizani — malori yanapanga foleni kupimwa uzito. Harufu ya nyama choma inatoka " +
      "vibandani kando ya barabara, na moshi wa mkaa unapanda juu.",
  },
  {
    id: "athi_river",
    name: "Athi River",
    kmFromNairobi: 30,
    fareFromPrevious: 50,
    levelsToAdvance: 2,
    tier: "minor",
    blurb:
      "Vumbi jeupe la saruji linatanda kila kitu. Viwanda vya simenti vinasimama juu ya " +
      "uwanda wa Athi, na ng'ombe wanachunga pembeni ya reli.",
  },
  {
    id: "kyumvi",
    name: "Kyumvi (Machakos Junction)",
    kmFromNairobi: 55,
    fareFromPrevious: 80,
    levelsToAdvance: 2,
    tier: "minor",
    blurb:
      "Hapa ndipo njia inagawanyika — kushoto kwenda Machakos mjini. Wauzaji wa matunda " +
      "wanakimbilia dirishani na ndizi, miwa na machungwa.",
  },
  {
    id: "salama",
    name: "Salama",
    kmFromNairobi: 80,
    fareFromPrevious: 80,
    levelsToAdvance: 2,
    tier: "minor",
    blurb:
      "Kituo kidogo cha biashara chenye jina zuri. Dere anasimama kidogo, abiria wananyoosha " +
      "miguu, na safari inaendelea kuelekea kusini.",
  },
  {
    id: "sultan_hamud",
    name: "Sultan Hamud",
    kmFromNairobi: 100,
    fareFromPrevious: 70,
    levelsToAdvance: 2,
    tier: "minor",
    blurb:
      "Mji wa zamani wa reli, uliopewa jina la sultani. Reli ya kale inapita karibu na barabara, " +
      "ikikumbusha safari za enzi nyingine.",
  },
  {
    id: "emali",
    name: "Emali",
    kmFromNairobi: 120,
    fareFromPrevious: 70,
    levelsToAdvance: 2,
    tier: "major",
    blurb:
      "Njia panda kubwa — kulia kwenda Loitokitok na Amboseli. Soko la Wamaasai lina shanga " +
      "nyekundu na bluu, na Kilimanjaro inaonekana siku ya hewa safi. Hapa safari inabadilika: " +
      "sasa unaingia nyanda za chini, joto linaanza kupanda.",
  },
  {
    id: "kiboko",
    name: "Kiboko",
    kmFromNairobi: 155,
    fareFromPrevious: 120,
    levelsToAdvance: 2,
    tier: "minor",
    blurb:
      "Kuna chemchemi hapa, na jina linatoka kwa viboko waliokuwa wakioga majini. " +
      "Miti ya kijani inasimama tofauti na nchi kavu inayoizunguka.",
  },
  {
    id: "makindu",
    name: "Makindu",
    kmFromNairobi: 170,
    fareFromPrevious: 60,
    levelsToAdvance: 2,
    tier: "minor",
    blurb:
      "Hekalu la Wasikh la Makindu limesimama hapa tangu 1926, na hulisha kila msafiri bure — " +
      "hakuna anayeulizwa dini wala kabila. Abiria wengi hushuka kunywa chai.",
  },
  {
    id: "kibwezi",
    name: "Kibwezi",
    kmFromNairobi: 195,
    fareFromPrevious: 90,
    levelsToAdvance: 2,
    tier: "minor",
    blurb:
      "Nchi kavu ya mibuyu na mikwaju. Wauzaji wanashika vikapu vya ukwaju na embe, " +
      "wakikimbia kando ya matatu inayopunguza mwendo.",
  },
  {
    id: "mtito_andei",
    name: "Mtito Andei",
    kmFromNairobi: 235,
    fareFromPrevious: 150,
    levelsToAdvance: 2,
    tier: "major",
    blurb:
      "Lango la Tsavo. Malori makubwa yanapumzika hapa usiku kucha, taa zikiwaka, na madereva " +
      "wanakunywa chai kabla ya kuendelea. Hapa ndipo katikati ya safari — Nairobi iko nyuma, " +
      "Mombasa inasubiri mbele. Mtito Andei: “msitu wa tembo”.",
  },
  {
    id: "manyani",
    name: "Manyani",
    kmFromNairobi: 275,
    fareFromPrevious: 150,
    levelsToAdvance: 2,
    tier: "minor",
    blurb:
      "Barabara inapita kando ya Tsavo Mashariki. Vumbi jekundu linapaka kila gari rangi moja, " +
      "na mara nyingine tembo huonekana mbali wakivuka nyika.",
  },
  {
    id: "tsavo",
    name: "Tsavo",
    kmFromNairobi: 295,
    fareFromPrevious: 80,
    levelsToAdvance: 2,
    tier: "minor",
    blurb:
      "Mto Tsavo na daraja la reli ya zamani. Hapa ndipo simba wawili wa Tsavo walipotia " +
      "hofu wajenzi wa reli mwaka 1898 — hadithi ambayo bado inasimuliwa hadi leo.",
  },
  {
    id: "voi",
    name: "Voi",
    kmFromNairobi: 330,
    fareFromPrevious: 130,
    levelsToAdvance: 2,
    tier: "major",
    blurb:
      "Mji mkubwa wa njia panda — hapa unaweza kugeuka kwenda Taveta na Moshi, au kuingia " +
      "Tsavo Mashariki. Hoteli, migahawa na maduka ya vipuri; kila msafiri husimama Voi. " +
      "Milima ya Taita inasimama bluu upande wa magharibi.",
  },
  {
    id: "maungu",
    name: "Maungu",
    kmFromNairobi: 360,
    fareFromPrevious: 110,
    levelsToAdvance: 2,
    tier: "minor",
    blurb:
      "Nchi ya mikonge na joto kali. Mji mdogo uliojengwa kando ya barabara, ambapo malori " +
      "husimama kupata maji baridi na kivuli.",
  },
  {
    id: "bachuma",
    name: "Bachuma Gate",
    kmFromNairobi: 385,
    fareFromPrevious: 90,
    levelsToAdvance: 2,
    tier: "minor",
    blurb:
      "Lango la kusini la Tsavo Mashariki. Askari wa wanyamapori wanaangalia magari yanayopita, " +
      "na uzio unatenganisha barabara na nyika kubwa.",
  },
  {
    id: "samburu",
    name: "Samburu",
    kmFromNairobi: 405,
    fareFromPrevious: 80,
    levelsToAdvance: 2,
    tier: "minor",
    blurb:
      "Kituo kidogo cha biashara — si Samburu ya kaskazini, bali cha hapa Pwani. " +
      "Vibanda vya matunda na maji ya madafu vinasubiri wasafiri.",
  },
  {
    id: "mackinnon_road",
    name: "Mackinnon Road",
    kmFromNairobi: 425,
    fareFromPrevious: 80,
    levelsToAdvance: 2,
    tier: "minor",
    blurb:
      "Kuna kaburi maarufu la Sheikh Sayyid Baghali hapa, lenye kuba nyeupe. Madereva wa malori " +
      "husimama kutoa heshima kabla ya kuendelea — desturi ya miaka mingi.",
  },
  {
    id: "mariakani",
    name: "Mariakani",
    kmFromNairobi: 455,
    fareFromPrevious: 110,
    levelsToAdvance: 2,
    tier: "major",
    blurb:
      "Mji wa maziwa na mizani ya malori. Hapa unajua umefika Pwani kweli: hewa inabadilika, " +
      "unyevu unaongezeka, na minazi inaanza kuonekana. Harufu ya bahari bado iko mbali, " +
      "lakini Mombasa sasa iko karibu.",
  },
  {
    id: "mazeras",
    name: "Mazeras",
    kmFromNairobi: 470,
    fareFromPrevious: 60,
    levelsToAdvance: 2,
    tier: "minor",
    blurb:
      "Barabara inashuka kutoka nyanda za juu. Bustani za miche na maua zinauzwa kando ya " +
      "njia, na minazi mirefu inasimama kila upande.",
  },
  {
    id: "changamwe",
    name: "Changamwe",
    kmFromNairobi: 480,
    fareFromPrevious: 50,
    levelsToAdvance: 2,
    tier: "minor",
    blurb:
      "Viwanda, kiwanda cha kusafisha mafuta, na foleni ndefu. Matatu inasonga polepole " +
      "kati ya malori yanayoelekea bandarini.",
  },
  {
    id: "mombasa",
    name: "Mombasa",
    kmFromNairobi: 487,
    fareFromPrevious: 50,
    levelsToAdvance: 2,
    tier: "major",
    blurb:
      "Umefika! Kisiwa cha Mombasa — Fort Jesus, mitaa ya Kale, na feri ya Likoni ikivuka " +
      "maji. Upepo wa bahari unagusa uso baada ya kilomita 487 za barabara. " +
      "Makanga anashusha mizigo: “Mwisho wa safari, karibu Mombasa!”",
  },
];

// ---- Derived helpers. Nothing below is hardcoded to act one. -------------

// Total levels needed to walk the whole route from the origin.
const ROUTE_TOTAL_LEVELS = STOPS.reduce((n, s) => n + s.levelsToAdvance, 0);

// Total fare for the whole route, used by the journey-end summary.
const ROUTE_TOTAL_FARE = STOPS.reduce((n, s) => n + s.fareFromPrevious, 0);

// Distance of the leg arriving at STOPS[i], in km.
function legDistanceKm(i) {
  if (i <= 0) return 0;
  return STOPS[i].kmFromNairobi - STOPS[i - 1].kmFromNairobi;
}
