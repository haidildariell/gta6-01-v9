// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps, the renderer paints what is there, and the HUD mirrors the player's state. The
// game moves between title, play, paused and the wasted/busted screen; progress (cash,
// missions, radio station) is saved to this browser and restored on the next visit.
//
// ?seed=N fixes the city's seed. ?shot=cover|drive|mission|boat (with &seed=N) stages
// that scene instead of running the loop, paints it and sets window.__shotReady.
import { RADIO_STATIONS, SAVE_KEY, STEP, WEAPONS } from './config.js';
import { createRandom } from './random.js';
import {
  createWorld, enterVehicle, exitVehicle, MISSION_DEFS, nearestVehicle, playerShoot,
  respawn, stepWorld, wrapAngle,
} from './world.js';
import {
  ACTION_CONFIRM, ACTION_INTERACT, ACTION_MISSIONS, ACTION_PAUSE, ACTION_RADIO,
  ACTION_WEAPON_1, ACTION_WEAPON_2, ACTION_WEAPON_3, ACTION_WEAPON_4, createInput,
} from './input.js';
import { createRenderer, drawMinimap } from './render.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const status = $('status');
const hudEl = $('hud');
const titleEl = $('title');
const overEl = $('over');
const pauseEl = $('pause');
const objectiveEl = $('objective');
const mapCtx = $('minimap').getContext('2d');

const state = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
renderer.buildCity(state);
const input = createInput(canvas);
const audio = createAudio();

const SCREEN_TITLE = 'title';
const SCREEN_PLAY = 'play';
const SCREEN_PAUSED = 'paused';
const SCREEN_OVER = 'over';

function announce(message) { status.textContent = message; }

/* ---------------- save / restore ---------------- */
function loadSave() {
  try { return JSON.parse(window.localStorage.getItem(SAVE_KEY) || '{}'); } catch { return {}; }
}
function persist() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: state.player.cash, missionDone: state.missionDone, station: stationIdx,
    }));
  } catch { /* private windows: progress lasts the visit */ }
}
let stationIdx = 0;
if (!shot) {
  const save = loadSave();
  if (Number.isFinite(save.cash)) state.player.cash = save.cash;
  if (Number.isFinite(save.missionDone)) state.missionDone = save.missionDone;
  if (Number.isFinite(save.station)) stationIdx = Math.min(RADIO_STATIONS.length - 1, Math.max(0, save.station));
}

/* ---------------- HUD ---------------- */
const starEls = Array.from(document.querySelectorAll('#stars .star'));
let bannerTimer = 0;
let toastTimer = 0;
let radioTimer = 0;

function showBanner(title, sub) {
  $('banner-title').textContent = title;
  $('banner-sub').textContent = sub || '';
  $('banner').style.opacity = 1;
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => { $('banner').style.opacity = 0; }, 2900);
}
function showToast(text) {
  const el = $('toast');
  el.textContent = text;
  el.style.opacity = 1;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.style.opacity = 0; }, 2100);
}
function showRadio() {
  const el = $('radio');
  el.textContent = '♪ ' + RADIO_STATIONS[stationIdx].name;
  el.style.opacity = 1;
  window.clearTimeout(radioTimer);
  radioTimer = window.setTimeout(() => { el.style.opacity = 0; }, 1800);
}

function formatClock(hour) {
  const hh = Math.floor(hour);
  const mm = Math.floor((hour - hh) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}
function formatTimer(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function refreshHUD() {
  const p = state.player;
  $('cash').textContent = '$' + p.cash.toLocaleString('en-US');
  $('clock').textContent = formatClock(state.hour);
  starEls.forEach((el, i) => el.classList.toggle('on', i < state.stars));
  $('stars').classList.toggle('blink', state.stars > 0 && state.crimeTimer > 16 && state.seenTimer > 5);
  $('weapon').textContent = p.mode === 'foot' ? WEAPONS[p.weapon].label : (p.vehicle ? p.vehicle.spec.label.toUpperCase() : '');
  $('healthbar').firstElementChild.style.width = Math.max(0, p.health) + '%';
  $('armorbar').firstElementChild.style.width = Math.max(0, p.armor) + '%';
  $('speed').innerHTML = p.mode === 'foot' || !p.vehicle
    ? '0 <small>KM/H</small>'
    : Math.round(Math.abs(p.vehicle.speed) * 3.6) + ' <small>KM/H</small>';
  $('crosshair').classList.toggle('hidden', !(p.mode === 'foot' && p.weapon > 0));
  // The objective panel.
  const m = state.mission;
  if (m) {
    objectiveEl.classList.remove('hidden');
    $('obj-title').textContent = m.def.name;
    let text;
    let sub = 'Reward $' + m.def.reward.toLocaleString('en-US');
    if (m.def.id === 'armored' && m.stage === 0 && m.target) {
      text = 'Stop the armored truck';
      sub = 'Truck armor ' + Math.max(0, Math.round(m.target.health / 3.4)) + '%';
    } else {
      const point = m.points[m.idx];
      text = point ? point.label : '';
      if (m.def.id === 'race') text += '  (' + (m.idx + 1) + '/' + m.points.length + ')';
    }
    if (m.timer !== null) sub += '  •  ' + formatTimer(m.timer) + ' left';
    $('obj-text').textContent = text;
    $('obj-sub').textContent = sub;
  } else objectiveEl.classList.add('hidden');
  // The context prompt.
  let prompt = '';
  if (p.mode === 'foot') {
    const v = nearestVehicle(state, 4.6);
    if (v) prompt = '<span class="key">F</span> Enter ' + v.spec.label;
    else {
      for (const def of MISSION_DEFS) {
        const dx = p.x - def.beacon.x;
        const dz = p.z - def.beacon.z;
        if (dx * dx + dz * dz < 30 * 30) { prompt = 'Mission: <b>' + def.name + '</b> — step into the light to start'; break; }
      }
    }
  } else prompt = '<span class="key">F</span> Exit  •  <span class="key">Space</span> Handbrake';
  $('prompt').innerHTML = prompt;
  drawMinimap(mapCtx, state);
}

/* ---------------- events → sound, banners, shake ---------------- */
let pendingOver = null;
function drainEvents() {
  for (const ev of state.events) {
    switch (ev.type) {
      case 'shot': audio.shot(); break;
      case 'crash': audio.crash(ev.strength); renderer.shake(ev.strength * 0.8); break;
      case 'explosion': audio.crash(1); renderer.shake(1.3); break;
      case 'splash': audio.crash(0.25); break;
      case 'prop': audio.crash(0.3); break;
      case 'pedhit': case 'peddown': audio.crash(0.35); break;
      case 'pickup':
        audio.pickup();
        if (ev.kind === 'health') showToast('+ HEALTH');
        else if (ev.kind === 'armor') showToast('+ ARMOR');
        else showToast(ev.kind === 'mission-cash' ? '+ $400' : '+ $50');
        break;
      case 'checkpoint': audio.pickup(); showToast('Checkpoint!'); break;
      case 'stunt': state.player.cash += 150; audio.cash(); showToast('STUNT BONUS + $150'); persist(); break;
      case 'stolen': showToast('Stole the ' + ev.label); break;
      case 'stars-down': if (state.stars > 0) showToast('The heat is dying down…'); break;
      case 'mission-start': audio.mission(); showBanner(ev.def.name, ev.def.blurb); break;
      case 'mission-pass': audio.mission(); showBanner('Mission Passed', ev.def.name + '  +$' + ev.def.reward.toLocaleString('en-US')); persist(); break;
      case 'mission-fail': showBanner('Mission Failed', ev.why || ''); break;
      case 'toast': showToast(ev.text); break;
      case 'wasted': pendingOver = 'wasted'; break;
      case 'busted': pendingOver = 'busted'; break;
      default: break;
    }
  }
}

/* ---------------- screens & the loop ---------------- */
const IDLE_INPUT = { throttle: () => 0, steer: () => 0, sprint: () => false, handbrake: () => false, firing: () => false };
let screen = shot ? SCREEN_PLAY : SCREEN_TITLE;
let lastMouseAt = 0;

function startGame() {
  if (screen !== SCREEN_TITLE) return;
  audio.unlock();
  audio.setStation(RADIO_STATIONS[stationIdx]);
  screen = SCREEN_PLAY;
  renderer.clearCamLock();
  titleEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  announce('Playing Neon Shores.');
  if (canvas.requestPointerLock) {
    try {
      const pending = canvas.requestPointerLock();
      if (pending && pending.catch) pending.catch(() => { /* headless: no lock, mouse still works */ });
    } catch { /* the click still counts */ }
  }
}

function showOver(kind) {
  screen = SCREEN_OVER;
  overEl.classList.remove('hidden');
  overEl.classList.toggle('busted', kind === 'busted');
  $('over-text').textContent = kind === 'busted' ? 'BUSTED' : 'WASTED';
  $('over-sub').textContent = kind === 'busted'
    ? 'The BPD impound your pride. Fine: $200.'
    : 'Bahía Rosa General patches you up. Bill: $150.';
  announce(kind === 'busted' ? 'Busted.' : 'Wasted.');
  window.setTimeout(() => {
    respawn(state, kind === 'busted');
    overEl.classList.add('hidden');
    screen = SCREEN_PLAY;
    pendingOver = null;
    persist();
  }, 2300);
}

function togglePause(force) {
  if (screen === SCREEN_PLAY && force !== false) {
    screen = SCREEN_PAUSED;
    $('pause-stats').innerHTML =
      'Cash <b>$' + state.player.cash.toLocaleString('en-US') + '</b> • Missions done <b>' + state.missionDone + '</b> • Wanted <b>' + state.stars + '★</b>';
    pauseEl.classList.remove('hidden');
    if (document.exitPointerLock) document.exitPointerLock();
  } else if (screen === SCREEN_PAUSED && force !== true) {
    screen = SCREEN_PLAY;
    pauseEl.classList.add('hidden');
  }
}

$('play').addEventListener('click', startGame);
titleEl.addEventListener('pointerdown', (event) => { if (event.target === titleEl) startGame(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === SCREEN_PLAY) togglePause(true);
});

function handleActions() {
  const actions = input.takeActions();
  if (screen === SCREEN_TITLE) {
    if (actions & ACTION_CONFIRM) startGame();
    return;
  }
  if (screen === SCREEN_PAUSED) {
    if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) togglePause(false);
    return;
  }
  if (screen !== SCREEN_PLAY) return;
  const p = state.player;
  if (actions & ACTION_PAUSE) { togglePause(true); return; }
  if (actions & ACTION_INTERACT) {
    if (p.mode === 'foot') {
      const v = nearestVehicle(state, 4.6);
      if (v) enterVehicle(state, v);
    } else exitVehicle(state);
  }
  if (actions & ACTION_RADIO) {
    stationIdx = (stationIdx + 1) % RADIO_STATIONS.length;
    audio.setStation(RADIO_STATIONS[stationIdx]);
    showRadio();
    persist();
  }
  if (actions & ACTION_MISSIONS) {
    let nearest = null;
    let best = Infinity;
    for (const def of MISSION_DEFS) {
      const d = (p.x - def.beacon.x) ** 2 + (p.z - def.beacon.z) ** 2;
      if (d < best) { best = d; nearest = def; }
    }
    if (nearest) showToast(nearest.name + ' — ' + Math.round(Math.sqrt(best)) + 'm • $' + nearest.reward);
  }
  if (p.mode === 'foot') {
    if (actions & ACTION_WEAPON_1) p.weapon = 0;
    if (actions & ACTION_WEAPON_2) p.weapon = 1;
    if (actions & ACTION_WEAPON_3) p.weapon = 2;
    if (actions & ACTION_WEAPON_4) p.weapon = 3;
  }
}

function runGame() {
  let accumulator = 0;
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, 0.25);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE) {
      // The city lives behind the title: traffic rolls, palms sway, the sun goes down.
      while (accumulator >= STEP) { stepWorld(state, IDLE_INPUT, STEP); accumulator -= STEP; }
      const sway = Math.sin(now * 0.00007) * 7;
      renderer.setCamLock({ x: 243 + sway, y: 3.6, z: 318, tx: 188, ty: 6, tz: 252 });
      renderer.draw(state, SCREEN_TITLE);
      return;
    }
    if (screen === SCREEN_PAUSED || screen === SCREEN_OVER) {
      accumulator = 0;
      renderer.draw(state, screen);
      return;
    }
    // Playing: steer the camera, then step the world in fixed steps.
    const mouse = input.takeMouse();
    if (mouse.dx || mouse.dy) {
      renderer.cam.yaw -= mouse.dx * 0.0031;
      renderer.cam.pitch = Math.max(-0.32, Math.min(1.05, renderer.cam.pitch + mouse.dy * 0.0027));
      lastMouseAt = now;
    }
    const p = state.player;
    if (p.mode !== 'foot' && p.vehicle && Math.abs(p.vehicle.speed) > 4 && now - lastMouseAt > 1400) {
      const diff = wrapAngle(p.vehicle.yaw - renderer.cam.yaw);
      renderer.cam.yaw += diff * 0.045;
    }
    state.camYaw = renderer.cam.yaw;
    state.aiming = input.firing();
    while (accumulator >= STEP && screen === SCREEN_PLAY) {
      stepWorld(state, input, STEP);
      drainEvents();
      accumulator -= STEP;
      if (input.firing() && p.mode === 'foot' && p.weapon > 0) {
        const ray = renderer.aimRay();
        playerShoot(state, ray.origin, ray.dir);
      }
      if (pendingOver) { showOver(pendingOver); break; }
    }
    // Sound follows the action: engine from speed, sirens from the nearest cruiser.
    let siren = 0;
    if (p.mode !== 'foot' && p.vehicle) {
      for (const v of state.vehicles) {
        if (v.kind !== 'police' || v.dead) continue;
        const d = Math.hypot(v.x - p.vehicle.x, v.z - p.vehicle.z);
        siren = Math.max(siren, Math.max(0, 1 - d / 130));
      }
    }
    audio.update(STEP, p.mode !== 'foot' && p.vehicle ? p.vehicle.speed / p.vehicle.spec.topSpeed : 0, p.mode !== 'foot', siren);
    renderer.draw(state, SCREEN_PLAY);
    refreshHUD();
  }
  announce('Neon Shores. Press Play to start.');
  requestAnimationFrame(frame);
}

function runShot(name) {
  const screenName = stageShot(name, state, renderer);
  if (screenName === SCREEN_PLAY) {
    titleEl.classList.add('hidden');
    hudEl.classList.remove('hidden');
    refreshHUD();
  }
  renderer.draw(state, screenName);
  renderer.draw(state, screenName);
  window.__shotReady = true;
}

if (shot) runShot(shot);
else runGame();
