import type { SpeciesId, SpeciesProfile } from "@/lib/ahanu/types";

/** August Northeast canyon habitat and tactics. Temperatures in °C, depths in metres. */
export const SPECIES: Record<SpeciesId, SpeciesProfile> = {
  bigeye: {
    id: "bigeye",
    common: "Bigeye tuna",
    scientific: "Thunnus obesus",
    sstMinC: 18,
    sstMaxC: 24,
    sstPrefC: [20, 22],
    depthMinM: 80,
    depthMaxM: 400,
    likesBreaks: true,
    likesChlEdge: false,
    likesWeed: false,
    nightBonus: 0.25,
    tactics:
      "Night program on the 100-fathom curve. Dump-and-wind 80-wides with squid chains, strobes, and chem lights; keep 1.5–3 knots between dumps so the baits swim, not spin. Sit a 20–22°C break where it pins the west wall — Veatch, Atlantis, or Hydro — and do not leave a mark to go looking. Daytime they drop into 200–400 m; trolling 7 knots over empty blue is a long way to learn that lesson.",
    idNotes:
      "Stockier than yellowfin, with a much larger eye and a short second dorsal and anal fin. Finlets are bright yellow; the trailing edge of the caudal is dusky. The liver is striated, which settles arguments at the dock. If the fish looks like a yellowfin but the long fins never grew, believe the eye.",
  },
  yellowfin: {
    id: "yellowfin",
    common: "Yellowfin tuna",
    scientific: "Thunnus albacares",
    sstMinC: 22,
    sstMaxC: 28,
    sstPrefC: [23, 26],
    depthMinM: 40,
    depthMaxM: 200,
    likesBreaks: true,
    likesChlEdge: true,
    likesWeed: true,
    nightBonus: 0.08,
    tactics:
      "Troll 6.5–8.5 knots with spreader bars, Ilanders, whalebone, and horse ballyhoo on the 40–200 m edges. They will sit a chlorophyll edge or a weedline as readily as a hard temperature break. Greensticks and squid dredges raise them; keep two pitch baits in the well. Live squid or a small skipjack on the lump in 23–26°C water is the August daytime bite when the spread goes quiet.",
    idNotes:
      "Long second dorsal and anal fins, slimmer waist, and a shallower tail notch than bigeye. A golden corset along the side is common on canyon fish. Small yellowfin can be mistaken for albacore until you see the pectoral — albacore pectorals reach past the second dorsal, and the albacore tail has a white rear margin.",
  },
  bluefin: {
    id: "bluefin",
    common: "Atlantic bluefin",
    scientific: "Thunnus thynnus",
    sstMinC: 14,
    sstMaxC: 22,
    sstPrefC: [16, 20],
    depthMinM: 20,
    depthMaxM: 120,
    likesBreaks: true,
    likesChlEdge: true,
    likesWeed: false,
    nightBonus: 0.05,
    tactics:
      "Work the 20–120 m lumps and the inshore side of a cool break, not the deep canyon axis. Troll 5.5–7 knots with large Ilanders, whalebone, and spreader bars in greens and dark blues; chunk herring or butterfish when they mark. School and large-school fish will eat a 50-wide; giants want an 80 and a plan for the boat. Know your category before the gaff comes out of the holder.",
    idNotes:
      "Short pectorals, a massive first dorsal, and a yellow-edged finlet row. The body is a torpedo, not a football. School bluefin in August can overlap yellowfin size — check the pectoral length and the shape of the liver. Regulations change by category; measure curved fork length on a straight, wet fish, not a story.",
  },
  mahi: {
    id: "mahi",
    common: "Mahi-mahi",
    scientific: "Coryphaena hippurus",
    sstMinC: 24,
    sstMaxC: 29,
    sstPrefC: [25, 28],
    depthMinM: 0,
    depthMaxM: 40,
    likesBreaks: true,
    likesChlEdge: true,
    likesWeed: true,
    nightBonus: 0,
    tactics:
      "Surface fish. Run the weedlines, sargassum mats, and any floating crate the Stream has claimed. Small ballyhoo, feathers, and 20–30s at 6–7 knots; once you raise a bull, circle the weed and pitch. They live in 24–29°C water and will abandon a spread that never comes off the 100-fathom tuna program. Keep a pitch rod rigged while the tuna spread is out — mahi pay for ice.",
    idNotes:
      "Brilliant green-gold in the water, fading fast in the box. Bulls have a steep vertical forehead; hens are longer in the snout. The single dorsal runs the length of the body. Do not confuse small mahi with juvenile tuna — the head shape and the continuous dorsal settle it in one look.",
  },
  white_marlin: {
    id: "white_marlin",
    common: "White marlin",
    scientific: "Kajikia albida",
    sstMinC: 22,
    sstMaxC: 26,
    sstPrefC: [23, 25],
    depthMinM: 50,
    depthMaxM: 150,
    likesBreaks: true,
    likesChlEdge: true,
    likesWeed: false,
    nightBonus: 0,
    tactics:
      "Light-tackle fish on the 50–150 m breaks and the clean side of a 22–26°C edge. Dredges and small ballyhoo, Ilanders in pink/white or green, 6.5–7.5 knots. 20–30s and 50s, circle hooks on natural bait, and a crew that can clear a spread without turning a white into a dead fish. They will crash a squid chain meant for tuna; be ready to drop back.",
    idNotes:
      "Rounded dorsal and anal lobes, spots on the dorsal fin, and a shorter bill than a blue. The pectoral tips are rounded. Roundscale spearfish look similar; unless you are sure, treat every white-class billfish as a release. Atlantic recreational retention of white marlin is closed — photograph, revive, let go.",
  },
  blue_marlin: {
    id: "blue_marlin",
    common: "Blue marlin",
    scientific: "Makaira nigricans",
    sstMinC: 25,
    sstMaxC: 29,
    sstPrefC: [26, 28],
    depthMinM: 80,
    depthMaxM: 400,
    likesBreaks: true,
    likesChlEdge: false,
    likesWeed: false,
    nightBonus: 0.04,
    tactics:
      "Warm, deep blue. 25–29°C water over 80–400 m, usually the offshore side of a sharp break or a warm-core filament. Large Ilanders, whalebone, horse ballyhoo, and a 130 on at least one rigger; 80-wides are the honest minimum. They are not an every-day Northeast fish in August, but when the Stream lays a 27°C ribbon over Atlantis or Hudson, pull something they can see. Circle hooks, and a release plan before you hook one.",
    idNotes:
      "Pointed dorsal and anal lobes, no spots on the dorsal, a rigid pectoral that will not fold flat against the body the way a white’s will. The bill is heavier. A small blue can be argued as a white until the dorsal lobe and the pectoral rigidity decide it. All Atlantic blues are release fish for the recreational canyon fleet.",
  },
  swordfish: {
    id: "swordfish",
    common: "Swordfish",
    scientific: "Xiphias gladius",
    sstMinC: 12,
    sstMaxC: 22,
    sstPrefC: [14, 18],
    depthMinM: 200,
    depthMaxM: 1400,
    likesBreaks: true,
    likesChlEdge: false,
    likesWeed: false,
    nightBonus: 0.3,
    tactics:
      "Two programs. Night: suspend squid and belly strips under chem lights and strobes along the 100–400 m edges, dump-and-wind or a slow drift. Day: deep-drop 300–800 fathoms with electric reels, a 10–15 lb lead, squid, and a light, and manage the drift in Gulf Stream current. They want 12–22°C at depth, not the surface reading on a 28°C afternoon. 80-wides, and a harness you actually wear.",
    idNotes:
      "No pelvic fins, a tall stiff first dorsal, and a flat, unbarbed bill. The eye is huge. Skin is dark bronze to black at night, brown by day. Do not confuse a small sword with a marlin — no pelvic fins is the five-second test. Recreational retention requires an HMS permit and a 47-inch lower-jaw fork length; everything else is a release.",
  },
  albacore: {
    id: "albacore",
    common: "Albacore",
    scientific: "Thunnus alalunga",
    sstMinC: 16,
    sstMaxC: 22,
    sstPrefC: [17, 20],
    depthMinM: 40,
    depthMaxM: 250,
    likesBreaks: true,
    likesChlEdge: true,
    likesWeed: false,
    nightBonus: 0.06,
    tactics:
      "Cooler water than yellowfin — 16–22°C, often the north side of a break or a mixed-water corner. Troll 7–8.5 knots with cedar plugs, small Ilanders, and single ballyhoo; they will also eat a spreader bar meant for yellowfin. 50-wides are plenty. In August they show in pulses on the 40–250 m edges when a cool filament lays over the canyon heads.",
    idNotes:
      "Very long pectoral fins that reach well past the second dorsal, a white rear margin on the tail, and no yellow finlets like a yellowfin. The body is cigar-shaped and the eye is larger than a yellowfin of the same length. Meat is the lightest of the canyon tunas. 27-inch curved fork length is the federal minimum with the BAYS tunas.",
  },
};

export const SPECIES_LABELS: Record<SpeciesId, string> = {
  bigeye: "Bigeye tuna",
  yellowfin: "Yellowfin tuna",
  bluefin: "Atlantic bluefin",
  mahi: "Mahi-mahi",
  white_marlin: "White marlin",
  blue_marlin: "Blue marlin",
  swordfish: "Swordfish",
  albacore: "Albacore",
};

const SPECIES_COLORS: Record<SpeciesId, string> = {
  bigeye: "#E4B56A",
  yellowfin: "#C49A52",
  bluefin: "#4ECDC4",
  mahi: "#3AA8A1",
  white_marlin: "#C5D4CE",
  blue_marlin: "#2D7F7A",
  swordfish: "#A89068",
  albacore: "#B8C9C4",
};

export function speciesColor(id: SpeciesId): string {
  return SPECIES_COLORS[id];
}
