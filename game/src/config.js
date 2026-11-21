// Every shared number for Neon Shores in one place: the map's skeleton (which streets exist,
// where the beach, causeway and port island sit), the tuning for feet, cars and boats, and the
// names that make Bahía Rosa its own place. The world, the renderer and the minimap all read
// the street plan from here, so they can never disagree about the shape of the city.

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** Seconds of real time in one full day-night cycle. */
export const DAY_LENGTH = 300;
/** The hour the game (and every screenshot scene) opens at: golden sunset over the bay. */
export const START_HOUR = 18.35;

/** North–south streets, by their x coordinate. The last one is Ocean Drive, along the beach. */
export const STREETS_X = [-520, -400, -280, -160, -40, 80, 200];
/** East–west streets, by their z coordinate. */
export const STREETS_Z = [-480, -360, -240, -120, 0, 120, 240, 360, 480];
export const ROAD_WIDTH = 16;
/** The mainland's edges: land runs from WEST to the shoreline at SHORE_X. */
export const WEST = -600;
export const SHORE_X = 306;
export const NORTH = -580;
export const SOUTH = 580;
/** The sea surface's height; land sits at 0. */
export const WATER_Y = -1.35;

/** The causeway to the port: a straight bridge road east along z = 0. */
export const CAUSEWAY = { zHalf: 11, fromX: SHORE_X, toX: 660 };
/** Puerto Alba, the port island: cranes, containers, warehouses and the armored trucks. */
export const ISLAND = { minX: 660, maxX: 905, minZ: -175, maxZ: 175 };
/** The marina pier on the south shore, where the speedboat waits. */
export const MARINA = { pierX: 352, pierZ: 338, boatX: 372, boatZ: 392, boatYaw: Math.PI * 0.78 };
/** The police station (busted respawn) and the hospital (wasted respawn). */
export const POLICE_STATION = { x: -34, z: -108 };
export const HOSPITAL = { x: -154, z: 132 };
/** Where Rosa steps out of the title screen: Ocean Drive, facing the sunset sea. */
export const PLAYER_START = { x: 188, z: 268, yaw: Math.PI / 2 };

export const FOOT = { walk: 4.4, sprint: 7.6, radius: 0.55, turnRate: 11 };

/** Car archetypes: the traffic pool, the hero cars and the law all draw from this table. */
export const CAR_TYPES = {
  sedan:    { label: 'Solana Sedan',    topSpeed: 38, accel: 13, grip: 5.2, mass: 1.0, colors: [0xb8bec9, 0x5b8dd9, 0x9e2b25, 0x2f4858, 0xd9a441, 0x3f7d53] },
  supercar: { label: 'Vesper Cheetah',  topSpeed: 57, accel: 21, grip: 6.4, mass: 0.9, colors: [0xff2e88, 0xffd166, 0x22d3ee, 0xf4f6ff] },
  muscle:   { label: 'Bravo Stallion',  topSpeed: 47, accel: 18, grip: 4.4, mass: 1.15, colors: [0xe36414, 0x5f0f40, 0x0f4c5c, 0xfb8b24] },
  van:      { label: 'Cargo Van',       topSpeed: 32, accel: 10, grip: 4.6, mass: 1.4, colors: [0xd8d8d8, 0x7fb069, 0x4361ee] },
  truck:    { label: 'Armored Truck',   topSpeed: 30, accel: 8, grip: 4.2, mass: 2.2, colors: [0x3d405b] },
  police:   { label: 'BPD Interceptor', topSpeed: 50, accel: 19, grip: 6.0, mass: 1.05, colors: [0xf4f6ff] },
};
export const BOAT_SPEC = { topSpeed: 26, accel: 9, grip: 0.85, label: 'Marlin Speedboat' };

export const WEAPONS = [
  { label: 'FISTS', damage: 12, rate: 0.42, range: 2.2, auto: false },
  { label: 'PISTOL', damage: 34, rate: 0.34, range: 70, auto: false },
  { label: 'SMG', damage: 15, rate: 0.095, range: 60, auto: true },
  { label: 'SHOTGUN', damage: 64, rate: 0.95, range: 34, auto: false },
];

export const RADIO_STATIONS = [
  { name: 'SOLSTICE FM', style: 'synthwave' },
  { name: 'NEON WAVE 104.2', style: 'funk' },
  { name: 'BAHÍA LATINA', style: 'latin' },
  { name: 'MIDNIGHT DRIVE', style: 'chill' },
  { name: 'RADIO OFF', style: 'off' },
];

export const CITY_NAME = 'Bahía Rosa';
export const GAME_TITLE = 'Neon Shores';
/** Where progress is kept between visits (this browser only). */
export const SAVE_KEY = 'neon-shores.save.v1';
