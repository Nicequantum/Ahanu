import type { LatLon, SpeciesId } from "@/lib/ahanu/types";

export type RegEntry = {
  id: string;
  title: string;
  body: string;
  species?: SpeciesId;
};

export type ClosedArea = {
  id: string;
  name: string;
  ring: LatLon[];
};

/**
 * Educational HMS snapshot for August 2026 canyon trips out of Rhode Island.
 * Not legal advice — limits, categories, and closed areas move. Verify with
 * NOAA HMS and the current Atlantic HMS Recreational Compliance Guide before
 * you leave the dock.
 */
export const REGS: RegEntry[] = [
  {
    id: "disclaimer",
    title: "Not legal advice — verify before you leave the dock",
    body:
      "This is an educational August 2026 snapshot for Rhode Island canyon captains, not a substitute for the NOAA Office of Sustainable Fisheries Highly Migratory Species division. Size limits, bag limits, category quotas, gear rules, and closed areas change in-season, sometimes with a few hours’ notice. Before you drop a bait: (1) hold a valid Atlantic HMS Angling or Charter/Headboat permit if you intend to fish for tunas, billfish, swordfish, or sharks; (2) read the current Atlantic HMS Recreational Compliance Guide; (3) check HMS News for in-season bluefin actions; (4) confirm whether your intended ground sits inside the Northeast Canyons and Seamounts Marine National Monument or a pelagic-longline closed area. Recreational trolling is generally not the same as commercial pelagic longline closures, but the Monument and some gear rules still apply to you. When in doubt, release the fish, log the interaction, and call NOAA. Not legal advice — verify with NOAA HMS before you leave the dock.",
  },
  {
    id: "hms-permit",
    title: "Atlantic HMS permit",
    body:
      "An Atlantic HMS Angling permit (or Charter/Headboat if you take passengers for hire) is required to fish for, retain, or possess Atlantic tunas, swordfish, billfish, and sharks in federal waters. State waters have their own overlay — Rhode Island, Massachusetts, New York, and New Jersey all expect you to know both. Permits are issued through NOAA Fisheries, not at the fuel dock. Charter captains need the Charter/Headboat permit and must follow the more restrictive of the two rule sets when passengers are aboard. Selling fish off an Angling permit is a commercial act and a fast way to lose the boat. Carry the permit number in the wheelhouse with the EPIRB hex and the float plan. Not legal advice — verify with NOAA HMS before you leave the dock.",
  },
  {
    id: "yellowfin-size-bag",
    title: "Yellowfin tuna — size and bag (August 2026 snapshot)",
    species: "yellowfin",
    body:
      "Atlantic yellowfin tuna (a BAYS tuna: bigeye, albacore, yellowfin, skipjack) carry a 27-inch curved fork length (CFL) federal minimum. Measure from the tip of the upper jaw to the fork of the tail, following the contour of the body — not a straight stick held above a thrashing fish. Recreational federal bag in the Atlantic has been three yellowfin per person per day in recent seasons; some states are more restrictive, and a vessel limit may apply when you step back into state waters. Count the people who are actually fishing, not the names on the float plan. School yellowfin under 27 inches CFL go back, even if they ate an Ilander meant for a hundred-pounder. Landings reports and tournament weigh-ins still need the HMS permit number. Not legal advice — verify with NOAA HMS before you leave the dock.",
  },
  {
    id: "bigeye-size-bag",
    title: "Bigeye tuna — size and bag (August 2026 snapshot)",
    species: "bigeye",
    body:
      "Atlantic bigeye tuna share the BAYS 27-inch curved fork length federal minimum. There is no separate federal recreational bag limit specific to bigeye in most recent Atlantic seasons, which is not an invitation to fill the fish box until the scuppers run soy sauce — you are still bound by yellowfin bag if the two species are mixed in a trip-limit interpretation, by state rules, and by the duty not to waste fish. Identify the fish before it hits the ice: bigeye are the night 100-fathom fish, stockier, bigger eye, short second dorsal. If you are unsure at 0200, treat it as yellowfin for bag math and sort it at first light. ICCAT and NOAA can close or adjust BAYS fisheries; check HMS News the morning you leave Point Judith. Not legal advice — verify with NOAA HMS before you leave the dock.",
  },
  {
    id: "albacore-size",
    title: "Albacore — size (August 2026 snapshot)",
    species: "albacore",
    body:
      "Atlantic albacore are a BAYS tuna with the same 27-inch curved fork length federal minimum as yellowfin and bigeye. They show on cooler 16–22°C water and are easy to misidentify in a rush — long pectorals past the second dorsal, white rear tail margin, no yellowfin-style long sickle fins. No separate albacore bag has been the recent federal pattern, but state rules and any in-season ICCAT action still bind you. Not legal advice — verify with NOAA HMS before you leave the dock.",
  },
  {
    id: "bluefin-categories",
    title: "Bluefin tuna — trophy, general, and school categories (August 2026 snapshot)",
    species: "bluefin",
    body:
      "Atlantic bluefin are managed by size class and permit category, and the daily retention limit can change overnight. Educational snapshot of the size classes used in U.S. Atlantic recreational rules: school 27 to less than 47 inches CFL; large school 47 to less than 59; small medium 59 to less than 73; large medium 73 to less than 81; giant 81 inches CFL and greater. Angling category typically covers school, large school, and small medium with a daily limit that NOAA sets in-season (often one school/large-school per vessel and a separate small-medium allowance — read the live notice). Trophy / Angling trophy is generally one fish 73 inches CFL or larger per vessel per year, and it may be closed before August is over. General category is a commercial-leaning quota that some vessels hold; it is not a free extra fish for an Angling boat. Charter/Headboat has its own table. Measure CFL on a wet, straight fish; a bent tail and a hopeful tape have started more dock arguments than the fish is worth. If the category is closed, the fish is a release — period. Report landings as required. Not legal advice — verify with NOAA HMS before you leave the dock.",
  },
  {
    id: "billfish-release",
    title: "Atlantic billfish — release (white, blue, sailfish, roundscale)",
    species: "white_marlin",
    body:
      "Atlantic white marlin, blue marlin, sailfish, and roundscale spearfish are catch-and-release only for the U.S. recreational fishery. You may not retain them. Circle hooks are required when fishing for billfish with natural bait (see the circle-hook note). Fight them on tackle that can land them while they still have a pulse, leave them in the water, remove the hook or cut the leader close, revive them at the transom until they kick, and let go. Gaffing a white or a blue to get the photo is how a release fish becomes a dead fish and a case. Swordfish are the exception among billfish-shaped animals: they are not in the no-retention billfish set, and may be retained with a permit and a size (see swordfish). If you cannot tell a small blue from a white from a roundscale at night, you do not need to — they all go back. Not legal advice — verify with NOAA HMS before you leave the dock.",
  },
  {
    id: "blue-marlin-release",
    title: "Blue marlin — recreational release",
    species: "blue_marlin",
    body:
      "Atlantic blue marlin may not be retained by U.S. recreational anglers. The 80-wide and the 130 in the spread are for the fight and the photo in the water, not the dock. Non-offset circle hooks on natural bait, a crew that can clear lines without wrapping the fish in the props, and a revival at the transom. Report billfish interactions if your permit or tournament requires it. Not legal advice — verify with NOAA HMS before you leave the dock.",
  },
  {
    id: "swordfish-size-bag",
    title: "Swordfish — permit, size, and bag (August 2026 snapshot)",
    species: "swordfish",
    body:
      "Swordfish may be retained recreationally with a valid HMS Angling or Charter/Headboat permit. Federal recreational minimum is 47 inches lower jaw fork length (LJFL) — tip of the lower jaw to the fork, not curved along the body the way tuna CFL is measured. Recent Atlantic recreational bag has been one swordfish per person per trip, not to exceed four per vessel, but this is exactly the kind of number NOAA can adjust. Night suspend and daytime deep-drop both count. Small swords go back with the light still on the leader. Commercial swordfish rules, buoy-gear endorsements, and pelagic-longline closed areas are a different permit world — do not copy a longliner’s program onto an Angling boat. Recreational trolling and rod-and-reel are generally not the same as commercial longline closures. Not legal advice — verify with NOAA HMS before you leave the dock.",
  },
  {
    id: "circle-hooks-billfish",
    title: "Circle hooks for billfish",
    body:
      "When fishing for Atlantic billfish with natural bait, NOAA requires non-offset circle hooks. That covers ballyhoo, squid, strip baits, and live bait meant for whites and blues. J-hooks on a tuna Ilander are a different conversation; J-hooks on a naked ballyhoo in white-marlin water are how you deep-hook a release species. Tournament rules often match or exceed the federal circle-hook requirement — read the sheet before first light. Offset circle hooks that have been bent into a J do not count. Rig the hook so the point rides into the corner of the jaw, not the gut, and do not reef on a white the way you reef on a yellowfin. Not legal advice — verify with NOAA HMS before you leave the dock.",
  },
  {
    id: "pelagic-longline-closed",
    title: "Pelagic longline closed areas and canyon monument awareness",
    body:
      "Pelagic longline (PLL) closed areas exist in the U.S. Atlantic to cut billfish, turtle, and bluefin interactions by the commercial longline fleet. A recreational trolling, chunking, or rod-and-reel boat is generally not bound by those PLL closures the way a longliner is — you may troll a spread through water a longliner cannot set in. That is not a hall pass. Two things still stop you: (1) the Northeast Canyons and Seamounts Marine National Monument, which prohibits commercial fishing and has its own recreational terms — know the polygon around Oceanographer, Gilbert, and Lydonia before you run east of Hydrographer; (2) any gear, species, or in-season HMS closure that is written to all permit holders, not just PLL. AIS targets that look like longliners sitting on a line are a hint you are near a commercial program, not a hint that the water is closed to you. Draw the Monument and the illustrative HMS awareness box on the plotter, leave them on, and do not cut the corner in the fog. Recreational trolling is generally not the same as commercial longline closures. Not legal advice — verify with NOAA HMS before you leave the dock.",
  },
  {
    id: "monument",
    title: "Northeast Canyons and Seamounts Marine National Monument",
    body:
      "The Canyon Unit of the Northeast Canyons and Seamounts Marine National Monument sits over Oceanographer, Gilbert, and Lydonia Canyons, roughly 40.2–40.8 N and 67.2–68.4 W on this plotter’s simplified polygon. Commercial fishing is prohibited in the Monument. Recreational fishing has been allowed under the restored monument terms, but gear, species, and access rules are federal and can be written tighter than a canyon Saturday. Do not assume a white-marlin dredge program is welcome on every square mile of a national monument. The Seamounts Unit lies farther southeast and is not on a typical Point Judith overnight. If your Hydrographer night program slides east toward Oceanographer, you are in the conversation — check the closed-area overlay before you set the alarm for 100 fathoms. Recreational trolling is generally not the same as commercial longline closures. Not legal advice — verify with NOAA HMS before you leave the dock.",
  },
  {
    id: "mahi-note",
    title: "Mahi-mahi (dolphin) — state overlay",
    species: "mahi",
    body:
      "Mahi-mahi are not an HMS tuna or billfish, but they are the weedline fish you will put in the box on a canyon trip and they are managed by the South Atlantic and Mid-Atlantic councils plus the states. Federal bag and size have moved in recent years (a 20-inch fork-length conversation and a per-person bag that is not unlimited). Rhode Island and the states you land in may be tighter. Treat mahi as a counted fish, not a free garnish on a tuna trip. Not legal advice — verify with NOAA HMS and the landing state before you leave the dock.",
  },
];

/** Simplified awareness polygons — not survey-grade closure coordinates. */
export const CLOSED_AREAS: ClosedArea[] = [
  {
    id: "necsm-canyon-unit",
    name: "NE Canyons & Seamounts Monument (Canyon Unit, simplified)",
    ring: [
      { lat: 40.8, lon: -68.4 },
      { lat: 40.78, lon: -67.85 },
      { lat: 40.62, lon: -67.22 },
      { lat: 40.28, lon: -67.2 },
      { lat: 40.2, lon: -67.55 },
      { lat: 40.22, lon: -68.28 },
      { lat: 40.48, lon: -68.42 },
      { lat: 40.8, lon: -68.4 },
    ],
  },
  {
    id: "hms-pll-awareness-box",
    name: "Illustrative HMS closed-area awareness box",
    ring: [
      { lat: 39.72, lon: -72.55 },
      { lat: 39.72, lon: -72.05 },
      { lat: 39.38, lon: -72.05 },
      { lat: 39.38, lon: -72.55 },
      { lat: 39.72, lon: -72.55 },
    ],
  },
];
