// The world of Bahía Rosa: its streets and buildings, and everything that moves in them.
// This module holds the whole simulation — the player on foot and in vehicles, traffic that
// follows the street plan, pedestrians, the police and their wanted system, missions,
// pickups and breakable props — with no drawing and no browser in it. The renderer reads
// the state and paints it; step() advances one fixed step and leaves notes in state.events
// ('shot', 'crash', 'cash', ...) for the caller to turn into sound and banners.
import {
  BOAT_SPEC, CAR_TYPES, CAUSEWAY, FOOT, HOSPITAL, ISLAND, MARINA, NORTH, PLAYER_START,
  POLICE_STATION, ROAD_WIDTH, SHORE_X, SOUTH, START_HOUR, DAY_LENGTH, STEP, STREETS_X,
  STREETS_Z, WATER_Y, WEAPONS, WEST,
} from './config.js';

const TAU = Math.PI * 2;

export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
export function turnToward(current, target, maxTurn) {
  const diff = wrapAngle(target - current);
  if (Math.abs(diff) <= maxTurn) return target;
  return current + Math.sign(diff) * maxTurn;
}
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/** Is this point on dry land (mainland, the causeway, the port island or the marina pier)? */
export function landAt(x, z) {
  if (x >= WEST && x <= SHORE_X && z >= NORTH && z <= SOUTH) return true;
  if (Math.abs(z) <= CAUSEWAY.zHalf && x >= CAUSEWAY.fromX && x <= CAUSEWAY.toX) return true;
  if (x >= ISLAND.minX && x <= ISLAND.maxX && z >= ISLAND.minZ && z <= ISLAND.maxZ) return true;
  if (x >= SHORE_X && x <= MARINA.pierX + 6 && z >= MARINA.pierZ - 6 && z <= MARINA.pierZ + 12) return true;
  return false;
}

/** The streets a car may drive on the mainland, plus the port island's little loop. */
const ALL_X = [...STREETS_X, 700, 800];
const ALL_Z = [...STREETS_Z, -120, 120];
function streetsFor(x) { return x >= ISLAND.minX - 40 ? [700, 800] : STREETS_X; }

/** Snap a point to the nearest street centre line; used for spawns and roadblocks. */
export function nearestStreet(x, z) {
  let best = { x, z, d: Infinity };
  for (const sx of ALL_X) {
    const d = Math.abs(sx - x);
    if (d < best.d) best = { x: sx, z, d };
  }
  for (const sz of ALL_Z) {
    const d = Math.abs(sz - z);
    if (d < best.d) best = { x, z: sz, d };
  }
  return best;
}

const SIGN_TEXTS = ['HOTEL SOLSTICE', 'CAFÉ ROSA', 'CLUB NEON', 'BAR OCÉANO', 'CINE LUNA', 'HOTEL PALMS', 'CASINO SOL', 'DISCO FUEGO', 'BANCO ROSA', 'JOYERÍA LUNA'];
const PARKED_SPOTS = [];

/** Grow the static city: buildings (with colliders), palms, lamps, hydrants and signs. */
function growCity(state, rng) {
  const B = state.buildings;
  const C = state.colliders;
  function addBuilding(x, z, w, d, h, facade) {
    const b = { x, z, w, d, h, facade, tone: rng.range(-0.06, 0.06), seed: rng.int(0, 9999) };
    B.push(b);
    C.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
    return b;
  }
  const zones = [];
  for (let i = 0; i < STREETS_X.length - 1; i += 1) {
    for (let j = 0; j < STREETS_Z.length - 1; j += 1) {
      zones.push({ x0: STREETS_X[i] + ROAD_WIDTH / 2 + 3, x1: STREETS_X[i + 1] - ROAD_WIDTH / 2 - 3, z0: STREETS_Z[j] + ROAD_WIDTH / 2 + 3, z1: STREETS_Z[j + 1] - ROAD_WIDTH / 2 - 3 });
    }
  }
  for (const zone of zones) {
    const cx = (zone.x0 + zone.x1) / 2;
    const cz = (zone.z0 + zone.z1) / 2;
    if (cx > 95 && cx < 195) continue; // the Ocean Drive strip belongs to the hotel row below
    const w = zone.x1 - zone.x0;
    const d = zone.z1 - zone.z0;
    const downtown = cx > -370 && cx < -110 && cz > -210 && cz < 210;
    const roll = rng.next();
    if (roll < 0.09) { state.parks.push({ x: cx, z: cz, w, d }); continue; }
    if (roll < 0.16) { // a parking lot: asphalt, a few stealable cars, no building
      state.lots.push({ x: cx, z: cz, w, d });
      for (let k = 0; k < 3; k += 1) PARKED_SPOTS.push({ x: zone.x0 + 8 + k * 9, z: cz + rng.range(-6, 6), yaw: Math.PI / 2 });
      continue;
    }
    if (downtown) {
      addBuilding(cx + rng.range(-6, 6), cz + rng.range(-6, 6), w * rng.range(0.62, 0.8), d * rng.range(0.62, 0.8), rng.range(38, 96), rng.pick(['glass', 'office', 'glass', 'deco']));
    } else if (roll < 0.45) {
      addBuilding(cx, cz, w * 0.78, d * 0.78, rng.range(10, 30), rng.pick(['brick', 'office', 'pastel', 'deco']));
    } else {
      const cols = 2;
      const rows = 2;
      for (let a = 0; a < cols; a += 1) {
        for (let bIdx = 0; bIdx < rows; bIdx += 1) {
          if (rng.chance(0.18)) continue;
          addBuilding(zone.x0 + (a + 0.5) * (w / cols), zone.z0 + (bIdx + 0.5) * (d / rows), w / cols * 0.72, d / rows * 0.72, rng.range(6, 17), rng.pick(['pastel', 'brick', 'motel', 'deco']));
        }
      }
    }
  }
  // The west strip and the Ocean Drive hotel row, west of the road, signs facing the beach.
  for (let z = NORTH + 40; z < SOUTH - 20; z += 62) {
    if (rng.chance(0.2)) continue;
    const hotel = addBuilding(160, z + rng.range(-6, 6), 30, 44, rng.range(17, 30), 'deco');
    state.signs.push({ x: 177.4, z: hotel.z, y: hotel.h * 0.72, text: SIGN_TEXTS[state.signs.length % SIGN_TEXTS.length], color: rng.pick(['#ff2e88', '#22d3ee', '#ffd166', '#7dff9a']) });
  }
  for (let z = NORTH + 50; z < SOUTH - 30; z += 95) {
    addBuilding(-566, z, 44, 60, rng.range(8, 20), rng.pick(['brick', 'office', 'pastel']));
  }
  // Port island: warehouses, container stacks (colliders) and cranes.
  for (let i = 0; i < 7; i += 1) {
    addBuilding(rng.range(690, 870), rng.pick([-150, 150]) + rng.range(-12, 12), rng.range(28, 46), 26, rng.range(10, 16), 'warehouse');
  }
  for (let i = 0; i < 26; i += 1) {
    const x = rng.range(676, 892);
    const z = rng.range(-160, 160);
    if (Math.abs(z) < 20 || Math.abs(z - 120) < 16 || Math.abs(z + 120) < 16) continue;
    const w = 12;
    const d = 5;
    const h = rng.pick([2.6, 5.2]);
    state.containers.push({ x, z, w, d, h, yaw: rng.pick([0, Math.PI / 2]), color: rng.pick([0xc0392b, 0x2471a3, 0x229954, 0xca6f1e, 0x616a6b]) });
    C.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
  }
  state.cranes.push({ x: 700, z: -168 }, { x: 812, z: 168 });

  // Palms along Ocean Drive and the beach, in the parks and around the marina.
  for (let z = NORTH + 16; z < SOUTH; z += rng.range(15, 24)) state.palms.push({ x: 216 + rng.range(-2, 2), z, s: rng.range(0.85, 1.25), lean: rng.range(-0.08, 0.08) });
  for (let i = 0; i < 46; i += 1) state.palms.push({ x: rng.range(252, 298), z: rng.range(NORTH + 20, SOUTH - 20), s: rng.range(0.8, 1.3), lean: rng.range(-0.12, 0.12) });
  for (const park of state.parks) for (let i = 0; i < 7; i += 1) state.palms.push({ x: park.x + rng.range(-park.w / 2, park.w / 2), z: park.z + rng.range(-park.d / 2, park.d / 2), s: rng.range(0.85, 1.2), lean: rng.range(-0.08, 0.08) });
  // Street lamps on every corner grid, hydrants near the corners.
  for (const sx of STREETS_X) for (let z = NORTH + 24; z < SOUTH; z += 38) state.lamps.push({ x: sx + ROAD_WIDTH / 2 + 1.6, z });
  for (const sz of STREETS_Z) for (let x = WEST + 30; x < 190; x += 42) state.lamps.push({ x, z: sz + ROAD_WIDTH / 2 + 1.6 });
  for (const sx of STREETS_X) for (const sz of STREETS_Z) {
    if (rng.chance(0.55)) state.props.push({ kind: 'hydrant', x: sx + 10.5, z: sz + 10.5, broken: false });
  }
  // Stunt ramps: three wedges the city kids built and never took down.
  state.ramps.push(
    { x: 196, z: -238, yaw: Math.PI, label: 'Ocean Drive Ramp' },
    { x: -44, z: 246, yaw: -Math.PI / 2, label: 'Downtown Ramp' },
    { x: 668, z: 60, yaw: Math.PI / 2, label: 'Port Ramp' },
  );
}

let nextId = 1;
function makeVehicle(state, kind, x, z, yaw, driver) {
  const spec = kind === 'boat' ? BOAT_SPEC : CAR_TYPES[kind];
  const v = {
    id: nextId += 1, kind, spec, x, z, y: kind === 'boat' ? WATER_Y + 0.55 : 0, yaw,
    vx: 0, vz: 0, vy: 0, speed: 0, steerVis: 0, driver, health: 100, dead: false,
    route: null, blockRole: false, stolen: false, sirenPhase: Math.random() * 6,
    color: kind === 'boat' ? 0xf4f6ff : (spec.colors ? spec.colors[state.rng.int(0, spec.colors.length - 1)] : 0x888888),
    airTime: 0, wasAirborne: false,
  };
  state.vehicles.push(v);
  return v;
}

function seedTraffic(state, rng) {
  const kinds = ['sedan', 'sedan', 'sedan', 'muscle', 'van', 'supercar'];
  for (let i = 0; i < 17; i += 1) {
    const onIsland = i >= 14;
    const sx = onIsland ? rng.pick([700, 800]) : rng.pick(STREETS_X);
    const sz = onIsland ? rng.pick([-120, 0, 120]) : rng.pick(STREETS_Z);
    const v = makeVehicle(state, onIsland ? rng.pick(['van', 'truck']) : rng.pick(kinds), sx, sz, 0, 'traffic');
    v.route = newRoute(state, v, sx, sz);
    placeOnRoute(v);
  }
  for (const spot of PARKED_SPOTS.slice(0, 24)) {
    const v = makeVehicle(state, rng.pick(['sedan', 'sedan', 'muscle', 'supercar', 'van']), spot.x, spot.z, spot.yaw, 'parked');
    v.color = CAR_TYPES[v.kind].colors[rng.int(0, CAR_TYPES[v.kind].colors.length - 1)];
  }
  // The hero car by the player's start, and the marina speedboat.
  const hero = makeVehicle(state, 'supercar', 190.5, 252, Math.PI, 'parked');
  hero.color = 0xff2e88;
  hero.stolen = true; // it is Rosa's own car: taking it is not a crime
  makeVehicle(state, 'boat', MARINA.boatX, MARINA.boatZ, MARINA.boatYaw, 'parked');
}

function newRoute(state, v, atX, atZ) {
  const rng = state.rng;
  const vertical = rng.chance(0.5);
  if (vertical) {
    const line = streetsFor(atX).includes(atX) ? atX : rng.pick(streetsFor(atX));
    const dir = rng.chance(0.5) ? 1 : -1;
    const targets = (line >= 660 ? ALL_Z : STREETS_Z).filter((z) => (dir > 0 ? z > atZ + 4 : z < atZ - 4));
    return { vertical: true, line, dir, target: targets.length ? rng.pick(targets) : atZ + dir * 200 };
  }
  const line = (ALL_Z.includes(atZ) ? atZ : rng.pick(ALL_Z));
  const dir = rng.chance(0.5) ? 1 : -1;
  const targets = (line === 0 || atX >= 640 ? ALL_X : STREETS_X).filter((x) => (dir > 0 ? x > atX + 4 : x < atX - 4));
  return { vertical: false, line, dir, target: targets.length ? rng.pick(targets) : atX + dir * 200 };
}

function placeOnRoute(v) {
  const r = v.route;
  if (r.vertical) { v.x = r.line - 4 * r.dir; v.yaw = r.dir > 0 ? 0 : Math.PI; }
  else { v.z = r.line + 4 * r.dir; v.yaw = r.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
}

/** Advance a traffic car's route: at each junction, mostly go straight, sometimes turn. */
function advanceRoute(state, v) {
  const r = v.route;
  const rng = state.rng;
  const pos = r.vertical ? v.z : v.x;
  const reached = r.dir > 0 ? pos >= r.target - 1 : pos <= r.target + 1;
  if (!reached) return;
  const junction = r.target;
  if (r.vertical) v.z = junction; else v.x = junction;
  const roll = rng.next();
  if (roll < 0.45) { // turn onto the crossing street
    if (r.vertical) {
      const dir = rng.chance(0.5) ? 1 : -1;
      const xs = v.x >= 640 ? ALL_X : STREETS_X;
      const targets = xs.filter((x) => (dir > 0 ? x > v.x + 4 : x < v.x - 4));
      if (targets.length) { v.route = { vertical: false, line: junction, dir, target: rng.pick(targets) }; return; }
    } else {
      const dir = rng.chance(0.5) ? 1 : -1;
      const zs = v.x >= 640 ? ALL_Z : STREETS_Z;
      const targets = zs.filter((z) => (dir > 0 ? z > v.z + 4 : z < v.z - 4));
      if (targets.length) { v.route = { vertical: true, line: junction, dir, target: rng.pick(targets) }; return; }
    }
  }
  // Straight on: pick the next junction along the same street, or turn around at the end.
  if (r.vertical) {
    const zs = v.x >= 640 ? ALL_Z : STREETS_Z;
    const targets = zs.filter((z) => (r.dir > 0 ? z > junction + 4 : z < junction - 4));
    if (targets.length) r.target = rng.pick(targets);
    else { r.dir *= -1; r.target = junction + r.dir * 200; }
  } else {
    const xs = v.x >= 640 ? ALL_X : STREETS_X;
    const targets = xs.filter((x) => (r.dir > 0 ? x > junction + 4 : x < junction - 4));
    if (targets.length) r.target = rng.pick(targets);
    else { r.dir *= -1; r.target = junction + r.dir * 200; }
  }
}

function seedPeds(state, rng) {
  const outfits = [
    { skin: 0xe8b08a, top: 0xff2e88, bottom: 0xf4f6ff },
    { skin: 0x8a5a3b, top: 0x22d3ee, bottom: 0x22304a },
    { skin: 0xf2c9a0, top: 0xffd166, bottom: 0x5f0f40 },
    { skin: 0x6e4426, top: 0x7dff9a, bottom: 0x333333 },
    { skin: 0xd99e73, top: 0xf4f6ff, bottom: 0xe36414 },
  ];
  for (let i = 0; i < 22; i += 1) {
    const vertical = rng.chance(0.55);
    const line = vertical ? rng.pick(STREETS_X) : rng.pick(STREETS_Z);
    const along = rng.range(-520, 520);
    const side = rng.chance(0.5) ? 1 : -1;
    const p = {
      id: nextId += 1, x: vertical ? line + side * 10.6 : along, z: vertical ? along : line + side * 10.6,
      yaw: rng.range(0, TAU), speed: 0, walkPhase: rng.range(0, 6), outfit: rng.pick(outfits),
      vertical, line, side, dir: rng.chance(0.5) ? 1 : -1, state: 'walk', timer: 0, health: 100,
    };
    state.peds.push(p);
  }
}

function seedPickups(state) {
  const spots = [
    { kind: 'health', x: HOSPITAL.x + 6, z: HOSPITAL.z },
    { kind: 'health', x: 250, z: -320 },
    { kind: 'armor', x: POLICE_STATION.x + 6, z: POLICE_STATION.z },
    { kind: 'armor', x: 700, z: 130 },
    { kind: 'cash', x: -100, z: -66 }, { kind: 'cash', x: 736, z: -60 },
    { kind: 'cash', x: 120, z: 306 }, { kind: 'cash', x: -460, z: 66 },
    { kind: 'health', x: MARINA.pierX - 8, z: MARINA.pierZ + 2 },
    { kind: 'cash', x: 196, z: -470 },
  ];
  for (const s of spots) state.pickups.push({ ...s, taken: false, timer: 0, phase: Math.random() * 6 });
}

export const MISSION_DEFS = [
  { id: 'race', name: 'Pink Slip Sprint', beacon: { x: 192, z: 140 }, blurb: 'Beat the clock through 5 checkpoints.', reward: 750 },
  { id: 'hot', name: 'Hot Hands', beacon: { x: -166, z: -104 }, blurb: 'Steal the marked Vesper and deliver it.', reward: 1200 },
  { id: 'armored', name: 'Armored & Dangerous', beacon: { x: 706, z: 14 }, blurb: 'Stop the armored truck. Take the cash.', reward: 1800 },
  { id: 'run', name: 'Midnight Run', beacon: { x: 344, z: 346 }, blurb: 'Collect 3 packages by boat, then come home.', reward: 1500 },
];

export function createWorld(rng) {
  const state = {
    rng,
    time: 0,
    hour: START_HOUR,
    buildings: [], colliders: [], containers: [], cranes: [], signs: [], palms: [], lamps: [],
    parks: [], lots: [], props: [], ramps: [],
    vehicles: [], peds: [], pickups: [], tracers: [], particles: [],
    events: [],
    player: {
      x: PLAYER_START.x, z: PLAYER_START.z, y: 0, yaw: PLAYER_START.yaw, vx: 0, vz: 0,
      health: 100, armor: 0, cash: 250, weapon: 1, mode: 'foot', vehicle: null,
      fireTimer: 0, hurtTimer: 0, dead: false,
    },
    stars: 0, crimeTimer: 99, seenTimer: 99, decayTimer: 0, shotCrimeTimer: 99,
    heli: { active: false, x: 0, y: 46, z: 0, yaw: 0, angle: 0 },
    mission: null, missionDone: 0, stuntTimer: 0,
    cameraHint: null,
  };
  growCity(state, rng);
  seedTraffic(state, rng);
  seedPeds(state, rng);
  seedPickups(state);
  return state;
}

/** Mark a crime: raises the wanted level (to at least `minStars`) and resets the heat timers. */
export function commitCrime(state, minStars) {
  state.stars = Math.max(state.stars, Math.min(5, minStars));
  state.crimeTimer = 0;
}

/** Circle-vs-buildings collision: push (x, z) out of every collider it overlaps. */
function collideBuildings(state, x, z, radius) {
  for (const c of state.colliders) {
    const nx = Math.max(c.minX, Math.min(x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
    const d2 = dist2(x, z, nx, nz);
    if (d2 < radius * radius) {
      if (d2 < 0.0001) { x = c.minX - radius; continue; }
      const d = Math.sqrt(d2);
      x = nx + ((x - nx) / d) * radius;
      z = nz + ((z - nz) / d) * radius;
    }
  }
  return { x, z };
}

function vehicleRadius(v) { return v.kind === 'truck' ? 3.4 : v.kind === 'boat' ? 3 : 2.3; }

/** Shared arcade vehicle physics: throttle, steering, grip and drift, gravity off ramps. */
function driveVehicle(state, v, throttle, steer, handbrake, dt) {
  const spec = v.spec;
  const forwardX = Math.sin(v.yaw);
  const forwardZ = Math.cos(v.yaw);
  const speedAlong = v.vx * forwardX + v.vz * forwardZ;
  if (throttle > 0) {
    const boost = v.kind !== 'boat' && state.player.vehicle === v && state.inputRef && state.inputRef.sprint() ? 1.25 : 1;
    const a = spec.accel * boost * (1 - Math.max(0, speedAlong) / (spec.topSpeed * boost));
    v.vx += forwardX * a * dt;
    v.vz += forwardZ * a * dt;
  } else if (throttle < 0) {
    const a = speedAlong > 0.5 ? -spec.accel * 1.4 : -spec.accel * 0.6 * (1 + Math.min(0, speedAlong) / 9);
    v.vx += forwardX * a * dt;
    v.vz += forwardZ * a * dt;
  }
  // Rolling drag and brakes.
  const drag = handbrake ? 1.6 : 0.25;
  v.vx -= v.vx * drag * dt * 0.6;
  v.vz -= v.vz * drag * dt * 0.6;
  // Steering: stronger at low speed, fading at very high speed; drifting loosens the rear.
  const spd = Math.hypot(v.vx, v.vz);
  const steerPower = (v.kind === 'boat' ? 0.55 : 1.05) * Math.min(1, spd / 6 + 0.25) / (1 + Math.max(0, spd - 24) * 0.012);
  const dirSign = speedAlong < -0.2 ? -1 : 1;
  v.yaw += steer * steerPower * dirSign * dt * (handbrake ? 1.5 : 1);
  // Grip: velocity swings toward the heading; handbrake (or a boat's hull) lets it slide.
  const grip = handbrake ? 1.7 : spec.grip;
  const nfx = Math.sin(v.yaw);
  const nfz = Math.cos(v.yaw);
  const along = v.vx * nfx + v.vz * nfz;
  const sideX = v.vx - nfx * along;
  const sideZ = v.vz - nfz * along;
  const keep = Math.exp(-grip * dt);
  v.vx = nfx * along + sideX * keep;
  v.vz = nfz * along + sideZ * keep;
  v.speed = along;
  v.drifting = Math.hypot(sideX, sideZ) > 4.2 && v.y >= 0 && v.kind !== 'boat';
  // Integrate, with gravity when a ramp has thrown the car into the air.
  v.x += v.vx * dt;
  v.z += v.vz * dt;
  const groundY = v.kind === 'boat'
    ? WATER_Y + 0.55 + Math.sin(state.time * 1.7 + v.id) * 0.07
    : (landAt(v.x, v.z) ? 0 : WATER_Y - 0.4); // off land, a car's floor is the harbour bottom
  if (v.kind === 'boat') { v.y = groundY; v.vy = 0; v.airTime = 0; }
  else if (v.y > groundY || v.vy > 0) {
    v.vy -= 24 * dt;
    v.y += v.vy * dt;
    v.airTime += dt;
    if (v.y <= groundY) {
      v.y = groundY;
      if (v.airTime > 0.85 && v.driver === 'player') state.events.push({ type: 'stunt', airTime: v.airTime });
      if (v.vy < -13) damageVehicle(state, v, (-v.vy - 13) * 2.2, true);
      v.vy = 0;
      v.airTime = 0;
    }
  } else v.y = groundY;
  v.steerVis = steer;
}

function damageVehicle(state, v, amount, byPlayer) {
  if (v.dead || v.disabled) return;
  v.health -= amount;
  if (v.health <= 0) {
    v.health = 0;
    if (v.armored) return; // the truck grinds to a halt instead of exploding; stepWorld disables it
    v.dead = true;
    state.events.push({ type: 'explosion', x: v.x, z: v.z });
    if (byPlayer && v.driver !== 'player') commitCrime(state, v.kind === 'police' ? 3 : 2);
  }
}

/** Crash response between a moving vehicle and the static world / other vehicles. */
function collideVehicle(state, v, dt) {
  const radius = vehicleRadius(v);
  const before = Math.hypot(v.vx, v.vz);
  // Buildings and containers.
  const fixed = collideBuildings(state, v.x, v.z, radius);
  if (fixed.x !== v.x || fixed.z !== v.z) {
    v.x = fixed.x;
    v.z = fixed.z;
    if (before > 7) {
      state.events.push({ type: 'crash', strength: Math.min(1, before / 30), x: v.x, z: v.z });
      damageVehicle(state, v, (before - 7) * 0.55, false);
      if (v.driver === 'player') hurtPlayer(state, (before - 7) * 0.5);
      v.vx *= -0.25;
      v.vz *= -0.25;
    } else { v.vx *= 0.4; v.vz *= 0.4; }
  }
  // Other vehicles: soft circles, with a crunch at speed.
  for (const other of state.vehicles) {
    if (other === v) continue;
    if ((other.kind === 'boat') !== (v.kind === 'boat')) continue;
    const rr = radius + vehicleRadius(other);
    const d2 = dist2(v.x, v.z, other.x, other.z);
    if (d2 < rr * rr && d2 > 0.001) {
      const d = Math.sqrt(d2);
      const push = (rr - d) / 2;
      const ux = (v.x - other.x) / d;
      const uz = (v.z - other.z) / d;
      v.x += ux * push;
      v.z += uz * push;
      if (other.driver !== 'player') { other.x -= ux * push; other.z -= uz * push; }
      const rel = Math.abs((v.vx - other.vx) * ux + (v.vz - other.vz) * uz);
      if (rel > 6) {
        state.events.push({ type: 'crash', strength: Math.min(1, rel / 26), x: v.x, z: v.z });
        damageVehicle(state, other, (rel - 6) * 0.8, v.driver === 'player');
        damageVehicle(state, v, (rel - 6) * 0.5, false);
        if (v.driver === 'player') {
          hurtPlayer(state, (rel - 6) * 0.4);
          if (other.kind === 'police') commitCrime(state, 2);
          else if (other.driver === 'traffic') commitCrime(state, 1);
          if (state.mission && state.mission.def.id === 'armored' && other === state.mission.target) {
            state.mission.ramBonus = true;
          }
        }
        const bounce = 0.3;
        v.vx += ux * rel * bounce;
        v.vz += uz * rel * bounce;
      }
    }
  }
  // Breakable props: palms and hydrants fold under a fast car.
  for (const prop of state.props) {
    if (prop.broken) continue;
    if (dist2(v.x, v.z, prop.x, prop.z) < 3.4 * 3.4 && before > 6) {
      prop.broken = true;
      v.vx *= 0.82;
      v.vz *= 0.82;
      state.events.push({ type: 'prop', x: prop.x, z: prop.z });
    }
  }
  for (let i = 0; i < state.palms.length; i += 1) {
    const palm = state.palms[i];
    if (palm.broken) continue;
    if (dist2(v.x, v.z, palm.x, palm.z) < 2.6 * 2.6 && before > 7) {
      palm.broken = true;
      v.vx *= 0.86;
      v.vz *= 0.86;
      state.events.push({ type: 'prop', x: palm.x, z: palm.z });
    }
  }
  // Stunt ramps launch a fast car.
  if (v.y === 0 && v.kind !== 'boat') {
    for (const ramp of state.ramps) {
      if (dist2(v.x, v.z, ramp.x, ramp.z) < 30 && before > 17) {
        const facing = Math.cos(wrapAngle(v.yaw - ramp.yaw));
        if (facing > 0.6 && state.stuntTimer <= 0) {
          v.vy = 8.5 + before * 0.14;
          v.y = 0.1;
          state.stuntTimer = 3;
        }
      }
    }
  }
  // Water is the end of the road for a car.
  if (v.kind !== 'boat' && !landAt(v.x, v.z)) {
    v.vx *= 0.92;
    v.vz *= 0.92;
    damageVehicle(state, v, dt * 14, false);
    if (v.driver === 'player') {
      hurtPlayer(state, dt * 9);
      state.events.push({ type: 'splash', x: v.x, z: v.z });
    }
  }
  // Boats stay in the water: the shore pushes them back out.
  if (v.kind === 'boat' && landAt(v.x, v.z) && !(Math.abs(v.z) < CAUSEWAY.zHalf + 4)) {
    const back = collideBuildings(state, v.x, v.z, radius);
    v.x = back.x;
    v.z = back.z;
    if (v.x < SHORE_X + 6 && v.z > 60) { v.x = SHORE_X + 8; }
    v.vx *= 0.5;
    v.vz *= 0.5;
  }
}

function hurtPlayer(state, amount) {
  const p = state.player;
  if (amount <= 0 || p.dead) return;
  if (p.armor > 0) {
    const absorbed = Math.min(p.armor, amount * 0.65);
    p.armor -= absorbed;
    amount -= absorbed;
  }
  p.health -= amount;
  p.hurtTimer = 0;
  if (p.health <= 0) {
    p.health = 0;
    p.dead = true;
    state.events.push({ type: 'wasted' });
  }
}

/** The nearest vehicle a player on foot could get into, or null. */
export function nearestVehicle(state, maxDist) {
  const p = state.player;
  let best = null;
  let bestD = maxDist * maxDist;
  for (const v of state.vehicles) {
    if (v.dead) continue;
    const d = dist2(p.x, p.z, v.x, v.z);
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}

export function enterVehicle(state, v) {
  const p = state.player;
  p.mode = v.kind === 'boat' ? 'boat' : 'car';
  p.vehicle = v;
  v.driver = 'player';
  v.route = null;
  if (!v.stolen && v.kind !== 'boat') {
    v.stolen = true;
    commitCrime(state, 1);
    state.events.push({ type: 'stolen', label: v.spec.label });
  }
  state.events.push({ type: 'enter', kind: v.kind });
}

export function exitVehicle(state) {
  const p = state.player;
  const v = p.vehicle;
  if (!v) return;
  v.driver = 'parked';
  if (v.kind === 'boat') {
    // Step off a boat onto the nearest dry land: walk west until the shore gives ground.
    let sx = v.x;
    while (sx > WEST && !landAt(sx, v.z)) sx -= 2;
    p.x = landAt(sx, v.z) ? sx : MARINA.pierX - 12;
    p.z = landAt(sx, v.z) ? v.z : MARINA.pierZ;
    p.mode = 'foot';
    p.vehicle = null;
    state.events.push({ type: 'exit' });
    return;
  }
  const sideX = Math.cos(v.yaw);
  const sideZ = -Math.sin(v.yaw);
  p.x = v.x + sideX * 2.6;
  p.z = v.z + sideZ * 2.6;
  const fixed = collideBuildings(state, p.x, p.z, FOOT.radius);
  p.x = fixed.x;
  p.z = fixed.z;
  if (!landAt(p.x, p.z)) { p.x = v.x; p.z = v.z; }
  p.mode = 'foot';
  p.vehicle = null;
  state.events.push({ type: 'exit' });
}

/** Fire the player's weapon along a ray; the renderer passes the camera's aim. */
export function playerShoot(state, origin, dir) {
  const p = state.player;
  const weapon = WEAPONS[p.weapon];
  if (p.fireTimer > 0 || p.mode !== 'foot') return false;
  p.fireTimer = weapon.rate;
  if (p.weapon === 0) return false;
  commitCrime(state, 1);
  state.shotCrimeTimer = 0;
  state.events.push({ type: 'shot' });
  let bestT = weapon.range;
  let bestTarget = null;
  let bestKind = null;
  function testPoint(x, y, z, radius, target, kind) {
    const ox = x - origin.x;
    const oy = y - origin.y;
    const oz = z - origin.z;
    const t = ox * dir.x + oy * dir.y + oz * dir.z;
    if (t < 0 || t > bestT) return;
    const px = origin.x + dir.x * t;
    const py = origin.y + dir.y * t;
    const pz = origin.z + dir.z * t;
    const d2 = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2;
    if (d2 < radius * radius) { bestT = t; bestTarget = target; bestKind = kind; }
  }
  for (const ped of state.peds) {
    if (ped.state === 'down') continue;
    testPoint(ped.x, 1.1, ped.z, 0.85, ped, 'ped');
  }
  for (const v of state.vehicles) {
    if (v.dead || v === p.vehicle) continue;
    testPoint(v.x, 0.9, v.z, vehicleRadius(v) + 0.4, v, 'vehicle');
  }
  const end = {
    x: origin.x + dir.x * bestT, y: origin.y + dir.y * bestT, z: origin.z + dir.z * bestT,
  };
  state.tracers.push({ x0: origin.x, y0: origin.y, z0: origin.z, x1: end.x, y1: end.y, z1: end.z, life: 0.07 });
  if (bestTarget) {
    if (bestKind === 'ped') {
      bestTarget.health -= weapon.damage;
      if (bestTarget.health <= 0) {
        bestTarget.state = 'down';
        bestTarget.timer = 7;
        commitCrime(state, bestTarget.cop ? 3 : 2);
        state.events.push({ type: 'peddown', x: bestTarget.x, z: bestTarget.z });
      }
    } else {
      damageVehicle(state, bestTarget, weapon.damage * 0.55, true);
      if (bestTarget.driver === 'traffic') bestTarget.fleeing = 6;
    }
  }
  return true;
}

/** One traffic car's brain: follow the route, brake for trouble, flee gunfire. */
function stepTraffic(state, v, dt) {
  advanceRoute(state, v);
  const r = v.route;
  const laneX = r.vertical ? r.line - 4 * r.dir : v.x;
  const laneZ = r.vertical ? v.z : r.line + 4 * r.dir;
  const targetX = r.vertical ? laneX : (r.dir > 0 ? Math.min(r.target, v.x + 60) : Math.max(r.target, v.x - 60));
  const targetZ = r.vertical ? (r.dir > 0 ? Math.min(r.target, v.z + 60) : Math.max(r.target, v.z - 60)) : laneZ;
  let throttle = 0.85;
  // Brake for anything ahead in the direction of travel.
  const fx = Math.sin(v.yaw);
  const fz = Math.cos(v.yaw);
  for (const other of state.vehicles) {
    if (other === v) continue;
    const relX = other.x - v.x;
    const relZ = other.z - v.z;
    const ahead = relX * fx + relZ * fz;
    const side = Math.abs(relX * fz - relZ * fx);
    if (ahead > 0 && ahead < 13 && side < 3.2) { throttle = ahead < 7 ? -0.4 : 0.1; break; }
  }
  const p = state.player;
  if (p.mode === 'foot') {
    const relX = p.x - v.x;
    const relZ = p.z - v.z;
    const ahead = relX * fx + relZ * fz;
    if (ahead > 0 && ahead < 10 && Math.abs(relX * fz - relZ * fx) < 3) throttle = -0.4;
  }
  if (v.fleeing > 0) { v.fleeing -= dt; throttle = 1; }
  const desired = Math.atan2(targetX - v.x, targetZ - v.z);
  const steer = Math.max(-1, Math.min(1, wrapAngle(desired - v.yaw) * 1.6));
  driveVehicle(state, v, throttle, steer, false, dt);
  collideVehicle(state, v, dt);
  // Respawn far-away traffic near the player so the city never empties.
  if (dist2(v.x, v.z, p.x, p.z) > 430 * 430) {
    const sx = state.rng.pick(STREETS_X);
    const sz = state.rng.pick(STREETS_Z);
    v.x = sx + state.rng.range(-2, 2);
    v.z = sz + state.rng.range(-2, 2);
    v.vx = 0; v.vz = 0; v.health = 100; v.dead = false;
    v.route = newRoute(state, v, v.x, v.z);
    placeOnRoute(v);
  }
}

/** One cruiser's brain: hunt the player, ram them, or hold a roadblock ahead of them. */
function stepPolice(state, v, dt) {
  const p = state.player;
  const px = p.mode === 'foot' ? p.x : p.vehicle.x;
  const pz = p.mode === 'foot' ? p.z : p.vehicle.z;
  let targetX = px;
  let targetZ = pz;
  let throttle = 1;
  if (v.blockRole) {
    const d = Math.hypot(px - v.x, pz - v.z);
    if (d < 30 || state.stars === 0) v.blockRole = false;
    else {
      targetX = v.blockX;
      targetZ = v.blockZ;
      throttle = Math.hypot(v.blockX - v.x, v.blockZ - v.z) > 3 ? 0.8 : 0;
      if (throttle === 0) {
        v.yaw = turnToward(v.yaw, v.blockYaw, dt * 2);
        v.vx *= 0.8; v.vz *= 0.8;
        v.x += v.vx * dt; v.z += v.vz * dt;
        return;
      }
    }
  }
  // Aim a little ahead of a moving target, and at its rear quarter when close (the PIT).
  const pvx = p.mode === 'foot' ? 0 : p.vehicle.vx;
  const pvz = p.mode === 'foot' ? 0 : p.vehicle.vz;
  targetX += pvx * 0.45;
  targetZ += pvz * 0.45;
  const desired = Math.atan2(targetX - v.x, targetZ - v.z);
  const steer = Math.max(-1, Math.min(1, wrapAngle(desired - v.yaw) * 2.2));
  const dist = Math.hypot(px - v.x, pz - v.z);
  if (dist < 5 && Math.abs(p.mode === 'foot' ? 0 : p.vehicle.speed) < 2) throttle = 0.2;
  const rubber = dist > 70 ? 1.18 : 1;
  const savedAccel = v.spec.accel;
  v.spec = { ...v.spec, accel: savedAccel * rubber };
  driveVehicle(state, v, throttle, steer, false, dt);
  v.spec = { ...v.spec, accel: savedAccel };
  collideVehicle(state, v, dt);
}

/** Keep the police fleet sized to the wanted level; hold a helicopter at four stars. */
function managePolice(state, dt) {
  const p = state.player;
  const px = p.mode === 'foot' ? p.x : p.vehicle.x;
  const pz = p.mode === 'foot' ? p.z : p.vehicle.z;
  const cops = state.vehicles.filter((v) => v.kind === 'police' && !v.dead);
  const desired = state.stars === 0 ? 0 : Math.min(6, state.stars + 1);
  state.policeTimer = (state.policeTimer || 0) - dt;
  if (cops.length < desired && state.policeTimer <= 0) {
    state.policeTimer = 2.2;
    const snap = nearestStreet(px + state.rng.range(-170, 170), pz + state.rng.range(-170, 170));
    if (Math.hypot(snap.x - px, snap.z - pz) > 70 && landAt(snap.x, snap.z)) {
      const v = makeVehicle(state, 'police', snap.x, snap.z, state.rng.range(0, TAU), 'police');
      if (state.stars >= 3 && state.rng.chance(0.4)) {
        const ahead = nearestStreet(px + Math.sin(p.yaw) * 85, pz + Math.cos(p.yaw) * 85);
        v.blockRole = true;
        v.blockX = ahead.x;
        v.blockZ = ahead.z;
        v.blockYaw = p.yaw + Math.PI / 2;
        v.x = snap.x;
        v.z = snap.z;
      }
    }
  }
  for (const v of cops) {
    if (Math.hypot(v.x - px, v.z - pz) > 460 && state.stars <= 1) {
      v.dead = true;
      v.driver = 'gone';
    }
  }
  state.vehicles = state.vehicles.filter((v) => v.driver !== 'gone');
  // The helicopter: circles above the player and keeps the spotlight on them.
  const heli = state.heli;
  heli.active = state.stars >= 4;
  if (heli.active) {
    heli.angle += dt * 0.35;
    heli.x = px + Math.cos(heli.angle) * 26;
    heli.z = pz + Math.sin(heli.angle) * 26;
    heli.y = 44;
    heli.yaw = Math.atan2(px - heli.x, pz - heli.z);
  }
  // Being watched: any live cruiser close by resets the "unseen" clock.
  let seen = false;
  for (const v of cops) if (Math.hypot(v.x - px, v.z - pz) < 85) { seen = true; break; }
  if (seen) state.seenTimer = 0;
}

/** Pedestrians stroll the sidewalks, run from gunfire, and fall when hit. */
function stepPeds(state, dt) {
  const p = state.player;
  for (const ped of state.peds) {
    if (ped.state === 'down') {
      ped.timer -= dt;
      if (ped.timer <= 0) { ped.state = 'walk'; ped.health = 60; }
      continue;
    }
    let speed = 1.5;
    if (ped.state === 'flee') {
      speed = 5.2;
      ped.timer -= dt;
      if (ped.timer <= 0) ped.state = 'walk';
    } else if (state.shotCrimeTimer < 1.2 && dist2(ped.x, ped.z, p.x, p.z) < 34 * 34) {
      ped.state = 'flee';
      ped.timer = 2.4;
      ped.yaw = Math.atan2(ped.x - p.x, ped.z - p.z);
    }
    if (ped.state === 'walk') {
      // Stroll along the sidewalk; turn around at the ends of the island of pavement.
      if (ped.vertical) ped.z += ped.dir * speed * dt;
      else ped.x += ped.dir * speed * dt;
      const along = ped.vertical ? ped.z : ped.x;
      if (along > 545 || along < -545) ped.dir *= -1;
      if (state.rng.chance(0.002)) ped.dir *= -1;
      ped.yaw = ped.vertical ? (ped.dir > 0 ? 0 : Math.PI) : (ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      ped.x = ped.vertical ? ped.line + ped.side * 10.6 : ped.x;
      ped.z = ped.vertical ? ped.z : ped.line + ped.side * 10.6;
    } else {
      ped.x += Math.sin(ped.yaw) * speed * dt;
      ped.z += Math.cos(ped.yaw) * speed * dt;
      const fixed = collideBuildings(state, ped.x, ped.z, 0.5);
      ped.x = fixed.x;
      ped.z = fixed.z;
    }
    ped.walkPhase += dt * speed * 2.4;
    // Traffic is dangerous: a car at speed knocks a pedestrian down.
    for (const v of state.vehicles) {
      if (v.kind === 'boat' || v.dead) continue;
      if (Math.hypot(v.vx, v.vz) > 5 && dist2(ped.x, ped.z, v.x, v.z) < 3 * 3) {
        ped.state = 'down';
        ped.timer = 6;
        ped.health = 40;
        state.events.push({ type: 'pedhit', x: ped.x, z: ped.z });
        if (v.driver === 'player') commitCrime(state, 2);
        break;
      }
    }
    // Keep the crowd near the player.
    if (dist2(ped.x, ped.z, p.x, p.z) > 380 * 380) {
      const vertical = state.rng.chance(0.55);
      ped.vertical = vertical;
      ped.line = vertical ? state.rng.pick(STREETS_X) : state.rng.pick(STREETS_Z);
      ped.side = state.rng.chance(0.5) ? 1 : -1;
      const along = Math.max(-540, Math.min(540, (vertical ? p.z : p.x) + state.rng.range(-160, 160)));
      ped.x = vertical ? ped.line + ped.side * 10.6 : along;
      ped.z = vertical ? along : ped.line + ped.side * 10.6;
      ped.state = 'walk';
    }
  }
}

/** The mission state machine: beacons, checkpoints, deliveries, the truck, the boat run. */
function stepMission(state, dt) {
  const p = state.player;
  const px = p.mode === 'foot' ? p.x : p.vehicle.x;
  const pz = p.mode === 'foot' ? p.z : p.vehicle.z;
  const m = state.mission;
  if (!m) {
    // Stepping into a beacon on foot starts its mission (driving through does not).
    if (p.mode !== 'foot') return;
    for (const def of MISSION_DEFS) {
      if (dist2(px, pz, def.beacon.x, def.beacon.z) < 4.2 * 4.2) {
        startMission(state, def);
        return;
      }
    }
    return;
  }
  if (m.timer !== null) {
    m.timer -= dt;
    if (m.timer <= 0) { failMission(state, 'Out of time.'); return; }
  }
  const target = m.points[m.idx];
  if (m.def.id === 'armored') {
    if (m.stage === 0) {
      if (m.target.dead || m.target.health <= 0 || (m.target.disabled)) {
        m.stage = 1;
        m.points = [{ x: m.target.x, z: m.target.z, label: 'Grab the cash' }];
        m.idx = 0;
        state.pickups.push({ kind: 'mission-cash', x: m.target.x + 3, z: m.target.z + 2, taken: false, timer: 0, phase: 0 });
        state.events.push({ type: 'toast', text: 'Truck stopped! Grab the cash.' });
      }
      return;
    }
  }
  if (!target) return;
  const reach = m.def.id === 'run' ? 13 : 7.5;
  if (dist2(px, pz, target.x, target.z) < reach * reach) {
    if (m.def.id === 'hot' && m.stage === 0) {
      // The marked car is here; the objective becomes "get in".
      if (p.vehicle === m.target) {
        m.stage = 1;
        m.idx = 1;
        commitCrime(state, 2);
        state.events.push({ type: 'toast', text: 'The owner called it in — move!' });
      }
      return;
    }
    if (m.def.id === 'run' && p.mode !== 'boat' && m.stage === 0) return; // packages need the boat
    m.idx += 1;
    state.events.push({ type: 'checkpoint', x: target.x, z: target.z });
    if (m.idx >= m.points.length) completeMission(state);
  }
}

function startMission(state, def) {
  const m = { def, stage: 0, idx: 0, timer: null, points: [], target: null };
  if (def.id === 'race') {
    m.points = [
      { x: 200, z: -120, label: 'Checkpoint 1' }, { x: -40, z: -120, label: 'Checkpoint 2' },
      { x: -40, z: 240, label: 'Checkpoint 3' }, { x: 80, z: 240, label: 'Checkpoint 4' },
      { x: 200, z: 120, label: 'Finish' },
    ];
    m.timer = 105;
  } else if (def.id === 'hot') {
    const car = makeVehicle(state, 'supercar', -286, 246, Math.PI / 2, 'parked');
    car.color = 0xffd166;
    car.marked = true;
    m.target = car;
    m.points = [
      { x: car.x, z: car.z, label: 'Steal the gold Vesper' },
      { x: -46, z: -354, label: 'Deliver it to the garage' },
    ];
  } else if (def.id === 'armored') {
    const truck = makeVehicle(state, 'truck', 800, 0, -Math.PI / 2, 'traffic');
    truck.health = 340;
    truck.armored = true;
    truck.route = { vertical: false, line: 0, dir: -1, target: 700 };
    m.target = truck;
    m.points = [{ x: 800, z: 0, label: 'Stop the armored truck' }];
  } else if (def.id === 'run') {
    m.points = [
      { x: 520, z: 180, label: 'Package 1' }, { x: 648, z: -150, label: 'Package 2' },
      { x: 466, z: 430, label: 'Package 3' }, { x: MARINA.boatX, z: MARINA.boatZ, label: 'Back to the marina' },
    ];
    m.timer = 170;
  }
  state.mission = m;
  state.events.push({ type: 'mission-start', def });
}

function completeMission(state) {
  const m = state.mission;
  state.player.cash += m.def.reward;
  state.missionDone += 1;
  state.events.push({ type: 'mission-pass', def: m.def });
  state.mission = null;
}

function failMission(state, why) {
  state.events.push({ type: 'mission-fail', why });
  if (state.mission && state.mission.target && state.mission.target.marked) state.mission.target.marked = false;
  state.mission = null;
}

/** Advance the whole simulation one fixed step. `input` is the input module's object. */
export function stepWorld(state, input, dt) {
  state.time += dt;
  state.hour = (state.hour + (24 / DAY_LENGTH) * dt) % 24;
  state.events.length = 0;
  state.inputRef = input;
  const p = state.player;
  state.crimeTimer += dt;
  state.seenTimer += dt;
  state.shotCrimeTimer += dt;
  if (state.stuntTimer > 0) state.stuntTimer -= dt;
  if (p.fireTimer > 0) p.fireTimer -= dt;
  if (p.hurtTimer < 99) p.hurtTimer += dt;
  if (p.health > 0 && p.health < 100 && p.hurtTimer > 9) p.health = Math.min(100, p.health + dt * 2.2);

  // Wanted decay: stay unseen and crime-free and the stars cool off, one at a time.
  if (state.stars > 0 && state.crimeTimer > 16 && state.seenTimer > 5) {
    state.decayTimer += dt;
    if (state.decayTimer > 13) {
      state.decayTimer = 0;
      state.stars -= 1;
      state.events.push({ type: 'stars-down', stars: state.stars });
    }
  } else state.decayTimer = 0;

  if (p.mode === 'foot') {
    // On foot: move relative to the camera yaw the renderer keeps on the player.
    const camYaw = state.camYaw || 0;
    const fwd = input.throttle();
    const strafe = input.steer();
    const speed = input.sprint() ? FOOT.sprint : FOOT.walk;
    let mx = 0;
    let mz = 0;
    if (fwd || strafe) {
      const len = Math.hypot(fwd, strafe);
      const sin = Math.sin(camYaw);
      const cos = Math.cos(camYaw);
      mx = (sin * (fwd / len) - cos * (strafe / len)) * speed;
      mz = (cos * (fwd / len) + sin * (strafe / len)) * speed;
      p.yaw = turnToward(p.yaw, Math.atan2(mx, mz), FOOT.turnRate * dt);
    }
    let nx = p.x + mx * dt;
    let nz = p.z + mz * dt;
    if (!landAt(nx, nz) && landAt(p.x, p.z)) { nx = p.x; nz = p.z; }
    const fixed = collideBuildings(state, nx, nz, FOOT.radius);
    p.x = fixed.x;
    p.z = fixed.z;
    p.moving = Math.hypot(mx, mz) > 0.1;
    p.walkPhase = (p.walkPhase || 0) + dt * Math.hypot(mx, mz) * 1.9;
    // Busted: a cruiser on top of a slow pedestrian for a few seconds ends the chase.
    let bust = 0;
    for (const v of state.vehicles) {
      if (v.kind === 'police' && !v.dead && dist2(p.x, p.z, v.x, v.z) < 4.6 * 4.6) bust += 1;
    }
    if (bust > 0 && Math.hypot(mx, mz) < 1.2) {
      state.bustTimer = (state.bustTimer || 0) + dt;
      if (state.bustTimer > 2.4 && state.stars > 0) {
        p.dead = true;
        state.events.push({ type: 'busted' });
      }
    } else state.bustTimer = 0;
  } else {
    const v = p.vehicle;
    const throttle = input.throttle();
    const steer = input.steer();
    driveVehicle(state, v, throttle, steer, input.handbrake(), dt);
    collideVehicle(state, v, dt);
    p.x = v.x;
    p.z = v.z;
    // Busted in a car: stopped, surrounded, out of options.
    if (Math.abs(v.speed) < 1 && state.stars > 0) {
      let near = 0;
      for (const o of state.vehicles) if (o.kind === 'police' && !o.dead && dist2(v.x, v.z, o.x, o.z) < 8 * 8) near += 1;
      if (near >= 2) {
        state.bustTimer = (state.bustTimer || 0) + dt;
        if (state.bustTimer > 3) {
          p.dead = true;
          state.events.push({ type: 'busted' });
        }
      } else state.bustTimer = 0;
    }
    if (v.dead && !p.dead) {
      // The car dies under the player: climb out of the wreck.
      exitVehicle(state);
    }
  }

  for (const v of state.vehicles) {
    if (v.driver === 'traffic' && !v.dead) stepTraffic(state, v, dt);
    else if (v.driver === 'police' && !v.dead) stepPolice(state, v, dt);
    else if ((v.driver === 'parked') && (v.vx !== 0 || v.vz !== 0)) {
      v.vx *= 0.9; v.vz *= 0.9;
      v.x += v.vx * dt; v.z += v.vz * dt;
    }
    if (v.armored && v.health <= 0 && !v.disabled) {
      v.disabled = true;
      v.dead = false;
      v.health = 0;
      v.driver = 'parked';
    }
  }
  managePolice(state, dt);
  stepPeds(state, dt);
  stepMission(state, dt);

  // Pickups: walk or drive over one to take it.
  const px = p.mode === 'foot' ? p.x : p.vehicle.x;
  const pz = p.mode === 'foot' ? p.z : p.vehicle.z;
  for (const pk of state.pickups) {
    if (pk.taken) {
      pk.timer -= dt;
      if (pk.timer <= 0 && pk.kind !== 'mission-cash') pk.taken = false;
      continue;
    }
    if (dist2(px, pz, pk.x, pk.z) < 3.4 * 3.4) {
      if (pk.kind === 'health' && p.health < 100) { p.health = Math.min(100, p.health + 45); }
      else if (pk.kind === 'armor' && p.armor < 100) { p.armor = 100; }
      else if (pk.kind === 'cash' || pk.kind === 'mission-cash') { p.cash += pk.kind === 'cash' ? 50 : 400; }
      else continue;
      pk.taken = true;
      pk.timer = 45;
      state.events.push({ type: 'pickup', kind: pk.kind, x: pk.x, z: pk.z });
      if (pk.kind === 'mission-cash' && state.mission && state.mission.def.id === 'armored') completeMission(state);
    }
  }
  // Tracers fade; particles are the renderer's, spawned from events.
  for (let i = state.tracers.length - 1; i >= 0; i -= 1) {
    state.tracers[i].life -= dt;
    if (state.tracers[i].life <= 0) state.tracers.splice(i, 1);
  }
  return state.events;
}

/** Respawn after wasted/busted: hospital or station, a fine, a clean record. */
export function respawn(state, busted) {
  const p = state.player;
  if (p.vehicle) { p.vehicle.driver = 'parked'; p.vehicle = null; }
  const spot = busted ? POLICE_STATION : HOSPITAL;
  p.x = spot.x;
  p.z = spot.z;
  p.mode = 'foot';
  p.health = 100;
  p.armor = 0;
  p.dead = false;
  p.cash = Math.max(0, p.cash - (busted ? 200 : 150));
  state.stars = 0;
  state.crimeTimer = 99;
  state.seenTimer = 99;
  for (const v of state.vehicles) if (v.kind === 'police') { v.dead = true; v.driver = 'gone'; }
  state.vehicles = state.vehicles.filter((v) => v.driver !== 'gone');
  state.heli.active = false;
  if (state.mission) failMission(state, busted ? 'Busted.' : 'Wasted.');
}
