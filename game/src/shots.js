// The screenshot scenes behind ?shot=cover|drive|mission|boat. Each one arranges the real
// world — the same city, cars and rules as play — steps it forward with scripted inputs so
// the frame is a genuine moment of the game, then locks the camera where the shot reads
// best. The cover wears the title screen; the others wear the full HUD.
import { CAR_TYPES } from './config.js';
import { enterVehicle, MISSION_DEFS, stepWorld } from './world.js';

const IDLE = { throttle: () => 0, steer: () => 0, sprint: () => false, handbrake: () => false, firing: () => false };
function scripted(throttle, steer, handbrake) {
  return { throttle: () => throttle, steer: () => steer, sprint: () => false, handbrake: () => handbrake, firing: () => false };
}

function runSteps(state, renderer, input, steps) {
  for (let i = 0; i < steps; i += 1) {
    stepWorld(state, input, 1 / 60);
    if (i % 3 === 0) renderer.draw(state, 'play'); // let smoke, spray and skid marks build up
  }
}

/** Turn a traffic car into a cruiser and park it in the shot. */
function toPolice(state, v, x, z, yaw) {
  v.kind = 'police';
  v.spec = CAR_TYPES.police;
  v.driver = 'police';
  v.color = 0xf4f6ff;
  v.x = x;
  v.z = z;
  v.yaw = yaw;
  v.vx = 0;
  v.vz = 0;
  v.route = null;
  v.health = 100;
  v.dead = false;
}

function heroCar(state) {
  return state.vehicles.find((v) => v.kind === 'supercar' && v.driver === 'parked' && v.color === 0xff2e88);
}

/**
 * Stage the named scene in `state` and lock the renderer's camera for it.
 * Returns the screen to draw ('title' for the cover, 'play' for the rest).
 */
export function stageShot(name, state, renderer) {
  const p = state.player;
  if (name === 'drive') return stageDrive(state, renderer);
  if (name === 'mission') return stageMission(state, renderer);
  if (name === 'boat') return stageBoat(state, renderer);
  return stageCover(state, renderer);
}

/** The cover: golden hour on Ocean Drive, the hero car, neon hotels, the title over it all. */
function stageCover(state, renderer) {
  const p = state.player;
  state.hour = 18.45;
  const car = heroCar(state);
  if (car) {
    car.x = 215;
    car.z = 307;
    car.yaw = 2.55;
    car.vx = 0;
    car.vz = 0;
  }
  p.x = 208;
  p.z = 301;
  p.yaw = 2.5;
  state.camYaw = 2.5;
  runSteps(state, renderer, IDLE, 40);
  renderer.setCamLock({ x: 243, y: 3.6, z: 318, tx: 198, ty: 8.5, tz: 252 });
  return 'title';
}

/** Downtown after dark: a drift in progress, three stars, the law closing in, HUD blazing. */
function stageDrive(state, renderer) {
  const p = state.player;
  state.hour = 20.7;
  const car = heroCar(state);
  car.x = -157;
  car.z = 30;
  car.yaw = 0.42;
  car.vx = Math.sin(car.yaw) * 19;
  car.vz = Math.cos(car.yaw) * 19;
  enterVehicle(state, car);
  state.stars = 3;
  state.crimeTimer = 0;
  p.cash = 4875;
  p.armor = 65;
  p.health = 82;
  state.mission = {
    def: MISSION_DEFS[1], stage: 1, idx: 1, timer: null, target: null,
    points: [{ x: -286, z: 246, label: 'Steal the gold Vesper' }, { x: -46, z: -354, label: 'Deliver it to the garage' }],
  };
  // Two cruisers fall in behind; a third holds the cross street ahead.
  const traffic = state.vehicles.filter((v) => v.driver === 'traffic');
  toPolice(state, traffic[0], -166, 2, 0.35);
  toPolice(state, traffic[1], -148, -14, 0.5);
  toPolice(state, traffic[2], -120, 96, -2.4);
  state.camYaw = car.yaw;
  runSteps(state, renderer, scripted(1, 0.7, true), 30);
  const fx = Math.sin(car.yaw);
  const fz = Math.cos(car.yaw);
  const rx = Math.cos(car.yaw);
  const rz = -Math.sin(car.yaw);
  // A front-quarter view: the car drifts toward the lens, the cruisers loom behind it.
  renderer.setCamLock({
    x: car.x + fx * 8 - rx * 10.5, y: 2.5, z: car.z + fz * 8 - rz * 10.5,
    tx: car.x - fx * 3, ty: 1.1, tz: car.z - fz * 3,
  });
  state.camYaw = car.yaw;
  return 'play';
}

/** Golden light at the marina: Rosa, the Midnight Run beacon, and the boat that runs it. */
function stageMission(state, renderer) {
  const p = state.player;
  state.hour = 18.5;
  p.x = 332;
  p.z = 336;
  p.yaw = 0.9;
  p.cash = 1320;
  state.camYaw = 0.9;
  // No mission running: the beacon itself must be in the frame, lit and waiting, with
  // the speedboat floating in open water south of the pier. The HUD prompt tells the story.
  const boat = state.vehicles.find((v) => v.kind === 'boat');
  if (boat) {
    boat.x = 378;
    boat.z = 350;
    boat.yaw = -0.9;
    boat.vx = 0;
    boat.vz = 0;
  }
  runSteps(state, renderer, IDLE, 30);
  renderer.setCamLock({ x: 318, y: 3, z: 344, tx: 356, ty: 1.6, tz: 340 });
  return 'play';
}

/** The Midnight Run itself: the speedboat planing across the bay, the city lit behind it. */
function stageBoat(state, renderer) {
  const p = state.player;
  state.hour = 18.85;
  const boat = state.vehicles.find((v) => v.kind === 'boat');
  boat.x = 520;
  boat.z = -30;
  boat.yaw = -1.28;
  boat.vx = Math.sin(boat.yaw) * 15;
  boat.vz = Math.cos(boat.yaw) * 15;
  enterVehicle(state, boat);
  p.cash = 2650;
  state.camYaw = boat.yaw;
  runSteps(state, renderer, scripted(1, 0.06, false), 52);
  const fx = Math.sin(boat.yaw);
  const fz = Math.cos(boat.yaw);
  const rx = Math.cos(boat.yaw);
  const rz = -Math.sin(boat.yaw);
  renderer.setCamLock({
    x: boat.x - fx * 12 + rx * 5.5, y: 4.4, z: boat.z - fz * 12 + rz * 5.5,
    tx: boat.x + fx * 14, ty: 1.4, tz: boat.z + fz * 14,
  });
  state.camYaw = boat.yaw;
  return 'play';
}
