// Drawing only: the world's state in, pixels out. Bahía Rosa is built once from the world's
// static data — canvas-painted facades and ground, instanced palms and lamps, neon signs —
// and every moving thing (cars, boats, people, the helicopter, particles, skid marks) is a
// mesh that gets synced to the simulation each frame. The light rig follows the time of
// day: a low orange sun at golden hour, lit windows and lamp glow after dark.
import {
  CAUSEWAY, ISLAND, MARINA, NORTH, SHORE_X, SOUTH, STREETS_X, STREETS_Z, WATER_Y, WEST,
} from './config.js';
import { MISSION_DEFS, wrapAngle } from './world.js';
import { createRandom } from './random.js';

const THREE = window.THREE;
const TAU = Math.PI * 2;

/** A canvas the game paints itself, turned into a texture: every image in the game is made like this. */
function makeTexture(width, height, paint, options) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.sRGBEncoding;
  texture.anisotropy = 4;
  if (options && options.repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  return texture;
}

/** Merge simple indexed geometries into one (for palm crowns and other repeated shapes). */
function mergeGeometries(geoms) {
  let vCount = 0;
  let iCount = 0;
  for (const g of geoms) { vCount += g.attributes.position.count; iCount += g.index.count; }
  const pos = new Float32Array(vCount * 3);
  const norm = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of geoms) {
    pos.set(g.attributes.position.array, vo * 3);
    norm.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    for (let i = 0; i < g.index.count; i += 1) idx[io + i] = g.index.array[i] + vo;
    vo += g.attributes.position.count;
    io += g.index.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

const FACADE_BASE = {
  glass: '#33566e', deco: '#f2dfc8', brick: '#8a4b38', motel: '#efe6da',
  office: '#67707e', pastel: '#e8c8d8', warehouse: '#757a80',
};
/** Paint one facade: a base coat, a grid of windows, and its lit-window twin for the emissive map. */
function facadeTextures(variant, seed) {
  const rng = createRandom(seed * 7919 + 13);
  const cols = 7;
  const rows = 12;
  const lit = [];
  for (let i = 0; i < cols * rows; i += 1) lit.push(rng.chance(0.42));
  const paintBase = (ctx, w, h, emissiveOnly) => {
    ctx.fillStyle = emissiveOnly ? '#000000' : FACADE_BASE[variant];
    ctx.fillRect(0, 0, w, h);
    if (!emissiveOnly) {
      if (variant === 'deco') {
        ctx.fillStyle = 'rgba(255,46,136,0.5)';
        ctx.fillRect(0, h * 0.16, w, 5);
        ctx.fillStyle = 'rgba(34,211,238,0.45)';
        ctx.fillRect(0, h * 0.2, w, 3);
      }
      if (variant === 'brick') { ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < h; y += 7) ctx.fillRect(0, y, w, 1); }
      if (variant === 'warehouse') {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(w * 0.2, h * 0.55, w * 0.6, h * 0.45);
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        for (let y = h * 0.58; y < h; y += 9) ctx.fillRect(w * 0.2, y, w * 0.6, 2);
      }
      if (variant === 'glass') {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, 'rgba(255,255,255,0.20)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.02)');
        grad.addColorStop(1, 'rgba(0,0,0,0.18)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
    }
    const cw = w / cols;
    const ch = h / rows;
    for (let cx = 0; cx < cols; cx += 1) {
      for (let cy = 0; cy < rows; cy += 1) {
        const x = cx * cw + cw * 0.22;
        const y = cy * ch + ch * 0.24;
        const ww = cw * 0.56;
        const wh = ch * 0.5;
        if (emissiveOnly) {
          if (!lit[cx * rows + cy]) continue;
          const warm = rng.pick(['#ffd9a0', '#ffb36b', '#aee9ff', '#ffc4dd']);
          ctx.fillStyle = warm;
          ctx.fillRect(x, y, ww, wh);
        } else {
          ctx.fillStyle = lit[cx * rows + cy] ? 'rgba(255,214,150,0.85)' : 'rgba(16,24,38,0.82)';
          ctx.fillRect(x, y, ww, wh);
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.fillRect(x, y, ww, 2);
        }
      }
    }
  };
  const map = makeTexture(128, 256, (ctx, w, h) => paintBase(ctx, w, h, false));
  const emissiveMap = makeTexture(128, 256, (ctx, w, h) => paintBase(ctx, w, h, true));
  return { map, emissiveMap };
}

/** The whole street plan painted onto one big ground texture: roads, sidewalks, beach, parks. */
function groundTexture(state) {
  const W = 2048;
  const H = 1608;
  const minX = -640;
  const minZ = -620;
  const scaleX = W / 1580;
  const scaleZ = H / 1240;
  const X = (x) => (x - minX) * scaleX;
  const Z = (z) => (z - minZ) * scaleZ;
  return makeTexture(W, H, (ctx) => {
    ctx.fillStyle = '#274b63';
    ctx.fillRect(0, 0, W, H); // the sea, wherever land is not drawn over it
    // Mainland slab and block concrete.
    ctx.fillStyle = '#4b5058';
    ctx.fillRect(X(WEST), Z(NORTH), (SHORE_X - WEST) * scaleX, (SOUTH - NORTH) * scaleZ);
    ctx.fillStyle = '#585d66';
    for (const park of state.parks) ctx.fillRect(X(park.x - park.w / 2), Z(park.z - park.d / 2), park.w * scaleX, park.d * scaleZ);
    ctx.fillStyle = '#3f7d4e';
    for (const park of state.parks) ctx.fillRect(X(park.x - park.w / 2) + 3, Z(park.z - park.d / 2) + 3, park.w * scaleX - 6, park.d * scaleZ - 6);
    // Parking lots with painted stalls.
    for (const lot of state.lots) {
      ctx.fillStyle = '#33363d';
      ctx.fillRect(X(lot.x - lot.w / 2), Z(lot.z - lot.d / 2), lot.w * scaleX, lot.d * scaleZ);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.4;
      for (let x = lot.x - lot.w / 2 + 6; x < lot.x + lot.w / 2 - 4; x += 9) {
        ctx.beginPath();
        ctx.moveTo(X(x), Z(lot.z - lot.d / 2 + 4));
        ctx.lineTo(X(x), Z(lot.z - lot.d / 2 + 13));
        ctx.stroke();
      }
    }
    // Sidewalk skirts, then asphalt, then the dashed centre lines.
    function road(x0, z0, x1, z1) {
      ctx.fillStyle = '#6d727b';
      ctx.fillRect(X(x0) - 3, Z(z0) - 3, (x1 - x0) * scaleX + 6, (z1 - z0) * scaleZ + 6);
      ctx.fillStyle = '#26282e';
      ctx.fillRect(X(x0), Z(z0), (x1 - x0) * scaleX, (z1 - z0) * scaleZ);
      ctx.strokeStyle = 'rgba(216,194,90,0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([14, 12]);
      ctx.beginPath();
      ctx.moveTo(X((x0 + x1) / 2), Z((z0 + z1) / 2));
      ctx.lineTo(X((x0 + x1) / 2) + (x1 - x0) * scaleX * 0 + (x1 > x0 && z1 === z0 ? (x1 - x0) * scaleX : 0), Z((z0 + z1) / 2) + (z1 > z0 && x1 === x0 ? (z1 - z0) * scaleZ : 0));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const sx of STREETS_X) road(sx - 8, NORTH, sx + 8, SOUTH);
    for (const sz of STREETS_Z) road(WEST, sz - 8, 200 + 8, sz + 8);
    // The beach.
    ctx.fillStyle = '#d9b77c';
    ctx.fillRect(X(216), Z(NORTH), (SHORE_X - 216) * scaleX, (SOUTH - NORTH) * scaleZ);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(X(300), Z(NORTH), 5 * scaleX, (SOUTH - NORTH) * scaleZ);
    // The causeway deck and the port island.
    ctx.fillStyle = '#3c4048';
    ctx.fillRect(X(CAUSEWAY.fromX), Z(-CAUSEWAY.zHalf), (CAUSEWAY.toX - CAUSEWAY.fromX) * scaleX, CAUSEWAY.zHalf * 2 * scaleZ);
    ctx.fillStyle = '#54584f';
    ctx.fillRect(X(ISLAND.minX), Z(ISLAND.minZ), (ISLAND.maxX - ISLAND.minX) * scaleX, (ISLAND.maxZ - ISLAND.minZ) * scaleZ);
    road(ISLAND.minX, -8, ISLAND.maxX, 8);
    road(ISLAND.minX, -128, ISLAND.maxX, -112);
    road(ISLAND.minX, 112, ISLAND.maxX, 128);
    road(692, ISLAND.minZ, 708, ISLAND.maxZ);
    road(792, ISLAND.minZ, 808, ISLAND.maxZ);
    // The marina pier: wooden planks reaching into the bay.
    ctx.fillStyle = '#8a6b48';
    ctx.fillRect(X(SHORE_X), Z(MARINA.pierZ - 6), (MARINA.pierX + 6 - SHORE_X) * scaleX, 18 * scaleZ);
  });
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xff9a5c);
  scene.fog = new THREE.Fog(0xf2a56b, 180, 1500);

  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 4200);
  const hemi = new THREE.HemisphereLight(0xbdd7ff, 0x51443a, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 1.1);
  scene.add(sun);
  scene.add(sun.target);
  const ambient = new THREE.AmbientLight(0xffffff, 0.14);
  scene.add(ambient);

  // Stars and the sun disc: sprites and points far away, faded by the time of day.
  const starGeo = new THREE.BufferGeometry();
  {
    const rng = createRandom(4242);
    const pts = [];
    for (let i = 0; i < 420; i += 1) {
      const a = rng.range(0, TAU);
      const e = rng.range(0.06, 1.4);
      pts.push(Math.cos(a) * Math.cos(e) * 3200, Math.sin(e) * 3200, Math.sin(a) * Math.cos(e) * 3200);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  }
  const starMat = new THREE.PointsMaterial({ color: 0xcfe4ff, size: 5, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);
  const glowTexture = makeTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xffc37a, transparent: true, fog: false, depthWrite: false }));
  sunSprite.scale.set(900, 900, 1);
  scene.add(sunSprite);
  const clouds = [];
  {
    const rng = createRandom(777);
    const cloudTex = makeTexture(256, 128, (ctx) => {
      for (let i = 0; i < 26; i += 1) {
        const x = rng.range(40, 216);
        const y = rng.range(44, 84);
        const r = rng.range(16, 42);
        const g = ctx.createRadialGradient(x, y, 1, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.16)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 256, 128);
      }
    });
    for (let i = 0; i < 9; i += 1) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
      s.position.set(rng.range(-1400, 1400), rng.range(170, 300), rng.range(-1400, 1400));
      s.scale.set(rng.range(420, 760), rng.range(90, 150), 1);
      clouds.push(s);
      scene.add(s);
    }
  }

  // A gradient sky dome: repainted as the day turns, so the horizon can burn orange
  // while the zenith is already violet — a flat background color never could.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 32;
  skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext('2d');
  const skyTexture = new THREE.CanvasTexture(skyCanvas);
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(3300, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  skyDome.renderOrder = -10;
  scene.add(skyDome);
  let skyPaintedAt = -1;
  function paintSky(top, mid, bottom) {
    const g = skyCtx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#' + top.getHexString());
    g.addColorStop(0.55, '#' + mid.getHexString());
    g.addColorStop(0.8, '#' + bottom.getHexString());
    g.addColorStop(1, '#' + bottom.getHexString());
    skyCtx.fillStyle = g;
    skyCtx.fillRect(0, 0, 32, 256);
    skyTexture.needsUpdate = true;
  }

  const facadeMats = [];
  const facadeSets = {};
  function facadeSet(variant, seed) {
    const key = variant + ':' + (seed % 4);
    if (!facadeSets[key]) {
      const { map, emissiveMap } = facadeTextures(variant, seed);
      const mat = new THREE.MeshPhongMaterial({ map, emissiveMap, emissive: 0xffc37a, emissiveIntensity: 0.35, shininess: 12 });
      facadeSets[key] = mat;
      facadeMats.push(mat);
    }
    return facadeSets[key];
  }
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x2e3138 });

  let worldState = null;
  const dynamic = {
    vehicles: new Map(), peds: new Map(), pickups: new Map(), beacons: [], markers: [],
    playerPed: null, heli: null, lampGlow: null, palmTrunks: null, palmCrowns: null,
    hydrants: null, skid: null, skidIdx: 0, tracers: null, sprays: [],
  };
  const cam = { yaw: Math.PI / 2, pitch: 0.3, lock: null, shake: 0 };

  /** Build every static mesh from the world's city data. Called once by main. */
  function buildCity(state) {
    worldState = state;
    // Ground and sea.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1580, 1240),
      new THREE.MeshLambertMaterial({ map: groundTexture(state) }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(150, 0, 0);
    scene.add(ground);
    const waterTex = makeTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#14607e';
      ctx.fillRect(0, 0, w, h);
      const rng = createRandom(99);
      for (let i = 0; i < 260; i += 1) {
        ctx.strokeStyle = 'rgba(160,225,255,' + rng.range(0.04, 0.16).toFixed(2) + ')';
        ctx.lineWidth = rng.range(1, 2.4);
        const x = rng.range(0, w);
        const y = rng.range(0, h);
        const len = rng.range(8, 34);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len, y + rng.range(-2, 2));
        ctx.stroke();
      }
    }, { repeat: true });
    waterTex.repeat.set(46, 46);
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(4600, 4600),
      new THREE.MeshPhongMaterial({ map: waterTex, color: 0x9fd4e8, shininess: 120, specular: 0xbfeaff, transparent: true, opacity: 0.93 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
    water.name = 'water';
    scene.add(water);
    dynamic.waterTex = waterTex;

    // Buildings, each a box wearing its painted facade, with a dark roof.
    for (const b of state.buildings) {
      const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
      const mat = facadeSet(b.facade, b.seed);
      const mesh = new THREE.Mesh(geo, [mat, mat, roofMat, roofMat, mat, mat]);
      mesh.position.set(b.x, b.h / 2, b.z);
      scene.add(mesh);
      if (b.h > 55) { // a red aircraft beacon on the towers
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff3355 }));
        beacon.position.set(b.x, b.h + 0.6, b.z);
        beacon.name = 'towerBeacon';
        scene.add(beacon);
      }
    }
    // Neon signs on the Ocean Drive hotels and downtown.
    for (const sign of state.signs) {
      const tex = makeTexture(512, 96, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.font = '900 54px "Arial Black", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = sign.color;
        ctx.shadowBlur = 26;
        ctx.fillStyle = sign.color;
        ctx.fillText(sign.text, w / 2, h / 2);
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.85;
        ctx.fillText(sign.text, w / 2, h / 2);
      });
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(17, 3.2),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }),
      );
      plane.position.set(sign.x, sign.y, sign.z);
      plane.rotation.y = Math.PI / 2;
      plane.name = 'sign';
      scene.add(plane);
    }
    // Palms: instanced trunks and crowns.
    const trunkGeo = new THREE.CylinderGeometry(0.13, 0.24, 5.6, 6);
    trunkGeo.translate(0, 2.8, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6b48 });
    dynamic.palmTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, state.palms.length);
    const leafTex = makeTexture(128, 128, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#2e7d32';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(4, 64);
      ctx.quadraticCurveTo(64, 44, 124, 78);
      ctx.stroke();
      ctx.lineWidth = 2;
      for (let i = 0; i < 9; i += 1) {
        const t = i / 9;
        const x = 10 + t * 108;
        const y = 62 - Math.sin(t * 2.4) * 14 + t * 14;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 6, y + 22);
        ctx.stroke();
      }
    });
    const fronds = [];
    for (let k = 0; k < 7; k += 1) {
      const p = new THREE.PlaneGeometry(3.4, 1.15);
      p.translate(1.5, 0, 0);
      p.rotateZ(-0.38);
      p.rotateY((k / 7) * TAU + k * 0.35);
      fronds.push(p);
    }
    const crownGeo = mergeGeometries(fronds);
    const crownMat = new THREE.MeshLambertMaterial({ map: leafTex, alphaTest: 0.4, side: THREE.DoubleSide, color: 0x9fd48a });
    dynamic.palmCrowns = new THREE.InstancedMesh(crownGeo, crownMat, state.palms.length);
    scene.add(dynamic.palmTrunks);
    scene.add(dynamic.palmCrowns);
    updatePalms(state, true);
    // Lamps: instanced poles, plus a points cloud for their night glow.
    const lampGeo = new THREE.CylinderGeometry(0.06, 0.09, 5.8, 5);
    lampGeo.translate(0, 2.9, 0);
    const lampMat = new THREE.MeshLambertMaterial({ color: 0x3a3f47 });
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, state.lamps.length);
    const m4 = new THREE.Matrix4();
    state.lamps.forEach((lamp, i) => {
      m4.makeTranslation(lamp.x, 0, lamp.z);
      lamps.setMatrixAt(i, m4);
    });
    scene.add(lamps);
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(state.lamps.flatMap((l) => [l.x, 5.9, l.z])), 3));
    const glowMat = new THREE.PointsMaterial({ map: glowTexture, color: 0xffc37a, size: 7, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    dynamic.lampGlow = new THREE.Points(glowGeo, glowMat);
    scene.add(dynamic.lampGlow);
    // Hydrants.
    const hydGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.16, 0.19, 0.55, 6).translate(0, 0.28, 0),
      new THREE.SphereGeometry(0.15, 6, 5).translate(0, 0.6, 0),
    ]);
    dynamic.hydrants = new THREE.InstancedMesh(hydGeo, new THREE.MeshLambertMaterial({ color: 0xd23b2e }), state.props.length);
    scene.add(dynamic.hydrants);
    updateProps(state, true);
    // Containers and cranes at the port.
    const containerMats = [0xc0392b, 0x2471a3, 0x229954, 0xca6f1e, 0x616a6b].map((c) => new THREE.MeshLambertMaterial({ color: c }));
    for (const box of state.containers) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(box.w, box.h, box.d), containerMats[state.containers.indexOf(box) % containerMats.length]);
      mesh.position.set(box.x, box.h / 2, box.z);
      mesh.rotation.y = box.yaw;
      scene.add(mesh);
    }
    const craneMat = new THREE.MeshLambertMaterial({ color: 0xe8a13a });
    for (const crane of state.cranes) {
      const g = new THREE.Group();
      const tower = new THREE.Mesh(new THREE.BoxGeometry(2.4, 34, 2.4), craneMat);
      tower.position.y = 17;
      const jib = new THREE.Mesh(new THREE.BoxGeometry(30, 1.4, 1.4), craneMat);
      jib.position.set(-8, 33.4, 0);
      const cable = new THREE.Mesh(new THREE.BoxGeometry(0.12, 15, 0.12), roofMat);
      cable.position.set(-20, 25, 0);
      const hook = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 2), roofMat);
      hook.position.set(-20, 16.6, 0);
      g.add(tower, jib, cable, hook);
      g.position.set(crane.x, 0, crane.z);
      scene.add(g);
    }
    // Stunt ramps: striped wedges (a sunk, tilted box reads perfectly as a ramp).
    const rampTex = makeTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#15161c';
      for (let i = -2; i < 6; i += 1) {
        ctx.save();
        ctx.translate(i * 32, 0);
        ctx.rotate(0.6);
        ctx.fillRect(0, -40, 15, 220);
        ctx.restore();
      }
    });
    for (const ramp of state.ramps) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.5, 6.4), new THREE.MeshLambertMaterial({ map: rampTex }));
      mesh.position.set(ramp.x, 0.55, ramp.z);
      mesh.rotation.set(-0.42, ramp.yaw, 0, 'YXZ'); // yaw first, then the tilt: the far end rears up
      scene.add(mesh);
    }
    // Mission beacons and the objective marker.
    const beaconColors = [0xff2e88, 0xffd166, 0x22d3ee, 0x7dff9a];
    MISSION_DEFS.forEach((def, i) => {
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(3.2, 3.2, 18, 20, 1, true),
        new THREE.MeshBasicMaterial({ color: beaconColors[i], transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
      );
      cyl.position.set(def.beacon.x, 9, def.beacon.z);
      scene.add(cyl);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.9), new THREE.MeshBasicMaterial({ color: beaconColors[i] }));
      gem.position.set(def.beacon.x, 6, def.beacon.z);
      scene.add(gem);
      dynamic.beacons.push({ cyl, gem, def });
    });
    const markerCyl = new THREE.Mesh(
      new THREE.CylinderGeometry(5.5, 5.5, 34, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff2e88, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
    );
    markerCyl.visible = false;
    scene.add(markerCyl);
    const markerGem = new THREE.Mesh(new THREE.OctahedronGeometry(1.2), new THREE.MeshBasicMaterial({ color: 0xff2e88 }));
    markerGem.visible = false;
    scene.add(markerGem);
    dynamic.marker = { cyl: markerCyl, gem: markerGem };
    // Pickups.
    for (const pk of state.pickups) dynamic.pickups.set(pk, buildPickupMesh(pk.kind));
    for (const [pk, mesh] of dynamic.pickups) { mesh.position.set(pk.x, 1.1, pk.z); scene.add(mesh); }
    // The player character and the helicopter.
    dynamic.playerPed = buildHumanoid({ skin: 0xd99e73, top: 0xff2e88, bottom: 0xf4f6ff, hair: 0x1d1210 });
    scene.add(dynamic.playerPed.group);
    dynamic.heli = buildHelicopter();
    dynamic.heli.group.visible = false;
    scene.add(dynamic.heli.group);
    // Skid marks: an instanced ribbon of dark quads, ring-buffered.
    const skidGeo = new THREE.BoxGeometry(0.32, 0.02, 1.15);
    dynamic.skid = new THREE.InstancedMesh(skidGeo, new THREE.MeshBasicMaterial({ color: 0x0c0c0e, transparent: true, opacity: 0.55 }), 600);
    dynamic.skid.count = 600;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < 600; i += 1) dynamic.skid.setMatrixAt(i, zero);
    scene.add(dynamic.skid);
    // Tracers.
    const tracerGeo = new THREE.BufferGeometry();
    tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(32 * 2 * 3), 3));
    dynamic.tracers = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 }));
    dynamic.tracers.frustumCulled = false;
    scene.add(dynamic.tracers);
    // Two particle pools: soft smoke and bright spray/sparks.
    dynamic.smoke = makeParticles(500, 3.4, 0x9aa0aa, 0.32, false);
    dynamic.sparks = makeParticles(400, 1.15, 0xffcf7a, 0.9, true);
    scene.add(dynamic.smoke.points);
    scene.add(dynamic.sparks.points);
  }

  function makeParticles(capacity, size, color, opacity, additive) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    const mat = new THREE.PointsMaterial({ map: glowTexture, color, size, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    const pool = { points, geo, capacity, items: [], cursor: 0 };
    for (let i = 0; i < capacity; i += 1) {
      pool.items.push({ life: 0, max: 1, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, grav: 0, drag: 0 });
      geo.attributes.position.setY(i, -50);
    }
    return pool;
  }

  function spawn(pool, x, y, z, vx, vy, vz, life, grav, drag) {
    const p = pool.items[pool.cursor];
    pool.cursor = (pool.cursor + 1) % pool.capacity;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.max = life; p.grav = grav; p.drag = drag;
  }

  function stepParticles(pool, dt) {
    const attr = pool.geo.attributes.position;
    for (let i = 0; i < pool.capacity; i += 1) {
      const p = pool.items[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { attr.setY(i, -50); continue; }
      p.vy += p.grav * dt;
      const keep = Math.exp(-p.drag * dt);
      p.vx *= keep; p.vz *= keep;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      attr.setXYZ(i, p.x, p.y, p.z);
    }
    attr.needsUpdate = true;
  }

  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _s = new THREE.Vector3(1, 1, 1);
  const _p = new THREE.Vector3();

  function updatePalms(state, force) {
    state.palms.forEach((palm, i) => {
      if (!force && palm._rendered === palm.broken) return;
      palm._rendered = palm.broken;
      if (palm.broken) {
        _e.set(1.35, i * 1.7, 0);
        _q.setFromEuler(_e);
        _p.set(palm.x, 0.4, palm.z);
        _s.set(palm.s, palm.s, palm.s);
        _m4.compose(_p, _q, _s);
        dynamic.palmTrunks.setMatrixAt(i, _m4);
        _p.y = 1.1;
        _m4.compose(_p, _q, _s);
        dynamic.palmCrowns.setMatrixAt(i, _m4);
      } else {
        _e.set(palm.lean, i * 2.39, palm.lean * 0.7);
        _q.setFromEuler(_e);
        _p.set(palm.x, 0, palm.z);
        _s.set(palm.s, palm.s, palm.s);
        _m4.compose(_p, _q, _s);
        dynamic.palmTrunks.setMatrixAt(i, _m4);
        _p.y = 5.5 * palm.s;
        _m4.compose(_p, _q, _s);
        dynamic.palmCrowns.setMatrixAt(i, _m4);
      }
    });
    dynamic.palmTrunks.instanceMatrix.needsUpdate = true;
    dynamic.palmCrowns.instanceMatrix.needsUpdate = true;
  }

  function updateProps(state, force) {
    state.props.forEach((prop, i) => {
      if (!force && prop._rendered === prop.broken) return;
      prop._rendered = prop.broken;
      if (prop.broken) _m4.makeScale(0.001, 0.001, 0.001);
      else _m4.makeTranslation(prop.x, 0, prop.z);
      dynamic.hydrants.setMatrixAt(i, _m4);
      if (prop.broken && !force) {
        dynamic.sprays.push({ x: prop.x, z: prop.z, t: 2.2 });
      }
    });
    dynamic.hydrants.instanceMatrix.needsUpdate = true;
  }

  function buildHumanoid(outfit) {
    const g = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: outfit.skin });
    const top = new THREE.MeshLambertMaterial({ color: outfit.top });
    const bottom = new THREE.MeshLambertMaterial({ color: outfit.bottom });
    const hair = new THREE.MeshLambertMaterial({ color: outfit.hair || 0x201510 });
    function limb(w, h, d, mat, x, y, z) {
      const geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(0, -h / 2, 0);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    }
    const legL = limb(0.17, 0.82, 0.19, bottom, -0.11, 0.84, 0);
    const legR = limb(0.17, 0.82, 0.19, bottom, 0.11, 0.84, 0);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.24), top);
    torso.position.y = 1.16;
    g.add(torso);
    const armL = limb(0.13, 0.72, 0.15, top, -0.31, 1.44, 0);
    const armR = limb(0.13, 0.72, 0.15, top, 0.31, 1.44, 0);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.3), skin);
    head.position.y = 1.66;
    g.add(head);
    const hairMesh = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.13, 0.33), hair);
    hairMesh.position.y = 1.86;
    g.add(hairMesh);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.42), new THREE.MeshLambertMaterial({ color: 0x17181c }));
    gun.position.set(0, -0.68, 0.24);
    gun.visible = false;
    armR.add(gun);
    return { group: g, legL, legR, armL, armR, gun };
  }

  function buildCarMesh(v) {
    const g = new THREE.Group();
    const paint = new THREE.MeshPhongMaterial({ color: v.color, shininess: 70, specular: 0x8899aa });
    const glass = new THREE.MeshPhongMaterial({ color: 0x101c2c, shininess: 90, specular: 0xaaccff });
    const dark = new THREE.MeshLambertMaterial({ color: 0x17181c });
    const kind = v.kind;
    const L = kind === 'truck' ? 6.4 : kind === 'van' ? 4.9 : 4.35;
    const Wd = kind === 'truck' ? 2.3 : 1.85;
    if (kind === 'boat') {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.75, 6.4), new THREE.MeshPhongMaterial({ color: 0xf4f6ff, shininess: 60 }));
      hull.position.y = 0.35;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.34, 0.2, 6.44), new THREE.MeshPhongMaterial({ color: 0xff2e88, shininess: 60 }));
      stripe.position.y = 0.55;
      const bow = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 1.16, 0.75, 4), hull.material);
      bow.rotation.y = Math.PI / 4;
      bow.scale.set(1, 1, 1.9);
      bow.position.set(0, 0.35, 3.9);
      const shield = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 0.08), glass);
      shield.position.set(0, 1.0, 0.7);
      shield.rotation.x = -0.3;
      const motor = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 0.4), dark);
      motor.position.set(0, 0.75, -3.3);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 1.6), new THREE.MeshLambertMaterial({ color: 0x22d3ee }));
      seat.position.set(0, 0.8, -0.9);
      g.add(hull, stripe, bow, shield, motor, seat);
      return { group: g, wheels: [], paint };
    }
    const bodyH = kind === 'van' ? 1.5 : kind === 'truck' ? 0.7 : kind === 'supercar' ? 0.42 : 0.55;
    const bodyY = kind === 'van' ? 1.05 : 0.62;
    const body = new THREE.Mesh(new THREE.BoxGeometry(Wd, bodyH, L), paint);
    body.position.y = bodyY;
    g.add(body);
    if (kind === 'truck') {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.15, 1.5), paint);
      cab.position.set(0, 1.05, 2.3);
      const boxArmor = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.15, 4.4), new THREE.MeshPhongMaterial({ color: 0x3d405b, shininess: 30 }));
      boxArmor.position.set(0, 1.45, -0.8);
      const stripeT = new THREE.Mesh(new THREE.BoxGeometry(2.34, 0.3, 4.44), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
      stripeT.position.set(0, 1.9, -0.8);
      const shieldT = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 0.06), glass);
      shieldT.position.set(0, 1.3, 3.06);
      g.add(cab, boxArmor, stripeT, shieldT);
    } else if (kind === 'van') {
      const shield = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.62, 0.06), glass);
      shield.position.set(0, 1.35, L / 2 + 0.01);
      g.add(shield);
    } else {
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(Wd * 0.86, 0.48, L * 0.46), glass);
      cabin.position.set(0, bodyY + bodyH / 2 + 0.22, -L * 0.05);
      g.add(cabin);
      if (kind === 'supercar') {
        const spoiler = new THREE.Mesh(new THREE.BoxGeometry(Wd * 0.94, 0.07, 0.42), dark);
        spoiler.position.set(0, 1.02, -L / 2 + 0.2);
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.08), dark);
        strut.position.set(0, 0.88, -L / 2 + 0.2);
        g.add(spoiler, strut);
      }
      if (kind === 'muscle') {
        const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.9), dark);
        scoop.position.set(0, bodyY + bodyH / 2 + 0.05, L * 0.22);
        g.add(scoop);
      }
    }
    if (kind === 'police') {
      const doorMat = new THREE.MeshLambertMaterial({ color: 0x17181c });
      for (const sideSign of [-1, 1]) {
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 1.7), doorMat);
        door.position.set(sideSign * (Wd / 2 + 0.01), 0.66, 0.1);
        g.add(door);
      }
      const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.09, 0.34), dark);
      barBase.position.set(0, 1.42, -0.2);
      const lightL = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.13, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2244 }));
      lightL.position.set(-0.33, 1.53, -0.2);
      const lightR = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.13, 0.3), new THREE.MeshBasicMaterial({ color: 0x2266ff }));
      lightR.position.set(0.33, 1.53, -0.2);
      g.add(barBase, lightL, lightR);
      g.userData.lightL = lightL;
      g.userData.lightR = lightR;
    }
    // Headlights and taillights.
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a33 });
    for (const sx of [-0.6, 0.6]) {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.13, 0.05), headMat);
      head.position.set(sx * (Wd / 1.85), 0.68, L / 2 + 0.01);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.05), tailMat);
      tail.position.set(sx * (Wd / 1.85), 0.7, -L / 2 - 0.01);
      g.add(head, tail);
    }
    // Wheels; the front pair steers.
    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.26, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheels = [];
    for (const [wx, wz, front] of [[-Wd / 2, L / 2 - 0.85, 1], [Wd / 2, L / 2 - 0.85, 1], [-Wd / 2, -L / 2 + 0.85, 0], [Wd / 2, -L / 2 + 0.85, 0]]) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, 0.35, wz);
      const wheel = new THREE.Mesh(wheelGeo, dark);
      pivot.add(wheel);
      g.add(pivot);
      wheels.push({ pivot, wheel, front });
    }
    // A soft headlight cone for the night, lit only for the player's ride (cheap and pretty).
    const coneGeo = new THREE.ConeGeometry(2.6, 13, 12, 1, true);
    coneGeo.translate(0, -6.5, 0);
    const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    cone.rotation.x = Math.PI / 2 + 0.1;
    cone.position.set(0, 0.65, L / 2);
    cone.visible = false;
    cone.name = 'headlightCone';
    g.add(cone);
    g.userData.cone = cone;
    return { group: g, wheels, paint };
  }

  function buildPickupMesh(kind) {
    const g = new THREE.Group();
    if (kind === 'health') {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshLambertMaterial({ color: 0xf4f6ff }));
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.84), new THREE.MeshBasicMaterial({ color: 0xff2a33 }));
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.84), new THREE.MeshBasicMaterial({ color: 0xff2a33 }));
      g.add(base, c1, c2);
    } else if (kind === 'armor') {
      const vest = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.85, 0.4), new THREE.MeshLambertMaterial({ color: 0x3a86ff }));
      g.add(vest);
    } else {
      const bill = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.5, 0.3), new THREE.MeshLambertMaterial({ color: kind === 'mission-cash' ? 0xffd166 : 0x2fa84f }));
      g.add(bill);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: kind === 'health' ? 0xff5a66 : kind === 'armor' ? 0x6fb3ff : 0x7dff9a, transparent: true, opacity: 0.55, depthWrite: false }));
    glow.scale.set(3.2, 3.2, 1);
    g.add(glow);
    return g;
  }

  function buildHelicopter() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshPhongMaterial({ color: 0x22242c, shininess: 40 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.9, 4.6), bodyMat);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.3, 1.4), new THREE.MeshPhongMaterial({ color: 0x101c2c, shininess: 90 }));
    nose.position.set(0, -0.1, 2.8);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 4.6), bodyMat);
    tail.position.set(0, 0.3, -4.4);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.5, 0.8), bodyMat);
    fin.position.set(0, 0.7, -6.6);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.06, 0.7), new THREE.MeshLambertMaterial({ color: 0x0c0c0e }));
    rotor.position.y = 1.25;
    const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.7, 0.3), rotor.material);
    tailRotor.position.set(0.32, 0.7, -6.6);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.4, 4.64), new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    stripe.position.y = -0.5;
    g.add(body, nose, tail, fin, rotor, tailRotor, stripe);
    const spot = new THREE.Mesh(new THREE.CircleGeometry(6.5, 20), new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
    spot.rotation.x = -Math.PI / 2;
    return { group: g, rotor, tailRotor, spot };
  }

  function syncVehicle(state, v) {
    let rec = dynamic.vehicles.get(v.id);
    if (!rec) {
      rec = buildCarMesh(v);
      dynamic.vehicles.set(v.id, rec);
      scene.add(rec.group);
    }
    rec.group.position.set(v.x, v.y, v.z);
    rec.group.rotation.y = v.yaw;
    if (v.dead) rec.paint.color.setHex(0x1c1c20);
    else if (v.marked) rec.paint.color.setHex(0xffd166);
    else rec.paint.color.setHex(v.color);
    for (const w of rec.wheels) {
      if (w.front) w.pivot.rotation.y = (v.steerVis || 0) * 0.42;
      w.wheel.rotation.x += (v.speed || 0) * 0.055;
    }
    if (v.kind === 'police' && rec.group.userData.lightL) {
      const phase = Math.sin(state.time * 11 + v.sirenPhase) > 0;
      rec.group.userData.lightL.material.color.setHex(phase ? 0xff2244 : 0x55101c);
      rec.group.userData.lightR.material.color.setHex(phase ? 0x112a55 : 0x2266ff);
    }
    if (rec.group.userData.cone) {
      rec.group.userData.cone.visible = dynamic.darkness > 0.45 && state.player.vehicle === v;
    }
    // Wrecks smoke; a hurt engine smokes a little.
    if ((v.dead || v.health < 35) && Math.random() < 0.5) {
      spawn(dynamic.smoke, v.x, v.y + 1.6, v.z, (Math.random() - 0.5) * 0.7, 2.4 + Math.random(), (Math.random() - 0.5) * 0.7, 1.4, 0.6, 0.4);
    }
    if (v.disabled && Math.random() < 0.3) {
      spawn(dynamic.sparks, v.x, v.y + 1, v.z, (Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2, 0.5, -3, 0);
    }
  }

  function syncPed(state, ped, rec) {
    rec.group.position.set(ped.x, ped.state === 'down' ? 0.25 : 0, ped.z);
    rec.group.rotation.y = ped.yaw;
    rec.group.rotation.x = ped.state === 'down' ? -Math.PI / 2 : 0;
    const swing = ped.state === 'down' ? 0 : Math.sin(ped.walkPhase) * (ped.state === 'flee' ? 0.85 : 0.55);
    rec.legL.rotation.x = swing;
    rec.legR.rotation.x = -swing;
    rec.armL.rotation.x = -swing * 0.8;
    rec.armR.rotation.x = swing * 0.8;
  }

  /** Paint one frame of the world. `screen` is title/play/paused/over; shots lock the camera. */
  function draw(state, screen) {
    if (!worldState) return;
    applyTimeOfDay(state);
    updatePalms(state, false);
    updateProps(state, false);
    // Vehicles and people.
    const seen = new Set();
    for (const v of state.vehicles) {
      seen.add(v.id);
      syncVehicle(state, v);
    }
    for (const [id, rec] of dynamic.vehicles) {
      if (!seen.has(id)) { scene.remove(rec.group); dynamic.vehicles.delete(id); }
    }
    for (const ped of state.peds) {
      let rec = dynamic.peds.get(ped.id);
      if (!rec) {
        rec = buildHumanoid(ped.outfit);
        dynamic.peds.set(ped.id, rec);
        scene.add(rec.group);
      }
      syncPed(state, ped, rec);
    }
    // The player: a body on foot, hidden in a vehicle (with a head at the wheel).
    const p = state.player;
    const pedRec = dynamic.playerPed;
    if (p.mode === 'foot') {
      pedRec.group.visible = true;
      pedRec.group.position.set(p.x, 0, p.z);
      pedRec.group.rotation.y = p.yaw;
      const swing = p.moving ? Math.sin(p.walkPhase || 0) * 0.7 : 0;
      pedRec.legL.rotation.x = swing;
      pedRec.legR.rotation.x = -swing;
      pedRec.armL.rotation.x = -swing * 0.8;
      const aiming = p.fireTimer > 0.18 || (state.aiming && p.weapon > 0);
      pedRec.armR.rotation.x = aiming ? -1.35 : swing * 0.8;
      pedRec.gun.visible = p.weapon > 0;
    } else {
      pedRec.group.visible = false;
    }
    // Helicopter and its spotlight pool on the ground.
    const heli = dynamic.heli;
    heli.group.visible = state.heli.active;
    if (state.heli.active) {
      heli.group.position.set(state.heli.x, state.heli.y, state.heli.z);
      heli.group.rotation.y = state.heli.yaw;
      heli.rotor.rotation.y += 0.9;
      heli.tailRotor.rotation.x += 1.3;
      if (!heli.spot.parent) scene.add(heli.spot);
      heli.spot.position.set(p.x, 0.06, p.z);
      heli.spot.material.opacity = 0.16 + dynamic.darkness * 0.2;
    } else if (heli.spot.parent) scene.remove(heli.spot);
    // Beacons breathe; the objective marker stands over the current target.
    for (const b of dynamic.beacons) {
      const active = !state.mission;
      b.cyl.visible = active;
      b.gem.visible = active;
      if (active) {
        b.cyl.material.opacity = 0.22 + Math.sin(state.time * 2.2) * 0.08;
        b.gem.position.y = 6 + Math.sin(state.time * 1.8) * 0.7;
        b.gem.rotation.y += 0.02;
      }
    }
    const marker = dynamic.marker;
    if (state.mission && state.mission.points[state.mission.idx]) {
      const target = state.mission.points[state.mission.idx];
      marker.cyl.visible = true;
      marker.gem.visible = true;
      marker.cyl.position.set(target.x, 17, target.z);
      marker.gem.position.set(target.x, 7 + Math.sin(state.time * 2.4) * 0.8, target.z);
      marker.gem.rotation.y += 0.04;
    } else {
      marker.cyl.visible = false;
      marker.gem.visible = false;
    }
    // Pickups bob and spin; taken ones hide.
    for (const [pk, mesh] of dynamic.pickups) {
      mesh.visible = !pk.taken;
      if (!pk.taken) {
        mesh.position.y = 1.1 + Math.sin(state.time * 2 + pk.phase) * 0.22;
        mesh.rotation.y += 0.025;
      }
    }
    // Tracers.
    {
      const attr = dynamic.tracers.geometry.attributes.position;
      let n = 0;
      for (const t of state.tracers) {
        if (n >= 32) break;
        attr.setXYZ(n * 2, t.x0, t.y0, t.z0);
        attr.setXYZ(n * 2 + 1, t.x1, t.y1, t.z1);
        n += 1;
      }
      for (let i = n * 2; i < 64; i += 1) attr.setXYZ(i, 0, -60, 0);
      attr.needsUpdate = true;
    }
    // Event-driven bursts, then the continuous emitters.
    for (const ev of state.events) {
      if (ev.type === 'crash' || ev.type === 'explosion') {
        const big = ev.type === 'explosion';
        for (let i = 0; i < (big ? 26 : 8); i += 1) {
          spawn(dynamic.sparks, ev.x, 1, ev.z, (Math.random() - 0.5) * 7, Math.random() * 5, (Math.random() - 0.5) * 7, big ? 0.9 : 0.45, -6, 0.6);
          spawn(dynamic.smoke, ev.x, 1.2, ev.z, (Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2, big ? 2.2 : 1, 0.5, 0.5);
        }
      } else if (ev.type === 'splash') {
        for (let i = 0; i < 10; i += 1) spawn(dynamic.sparks, ev.x, 0.4, ev.z, (Math.random() - 0.5) * 4, 3 + Math.random() * 3, (Math.random() - 0.5) * 4, 0.6, -7, 0.2);
      } else if (ev.type === 'pickup' || ev.type === 'checkpoint') {
        for (let i = 0; i < 10; i += 1) spawn(dynamic.sparks, ev.x, 1.4, ev.z, (Math.random() - 0.5) * 2.4, 1.6 + Math.random() * 2, (Math.random() - 0.5) * 2.4, 0.7, -2, 0.4);
      }
    }
    const pv = p.vehicle;
    if (pv && pv.kind !== 'boat' && pv.drifting) {
      for (const sideSign of [-0.85, 0.85]) {
        const bx = pv.x - Math.sin(pv.yaw) * 1.4 + Math.cos(pv.yaw) * sideSign;
        const bz = pv.z - Math.cos(pv.yaw) * 1.4 - Math.sin(pv.yaw) * sideSign;
        spawn(dynamic.smoke, bx, 0.3, bz, (Math.random() - 0.5), 0.8, (Math.random() - 0.5), 0.8, 0.4, 0.6);
        // Lay a skid mark.
        _e.set(0, pv.yaw, 0);
        _q.setFromEuler(_e);
        _p.set(bx, 0.03, bz);
        _s.set(1, 1, 1);
        _m4.compose(_p, _q, _s);
        dynamic.skid.setMatrixAt(dynamic.skidIdx, _m4);
        dynamic.skidIdx = (dynamic.skidIdx + 1) % 600;
        dynamic.skid.instanceMatrix.needsUpdate = true;
      }
    }
    if (pv && pv.kind === 'boat' && Math.abs(pv.speed) > 3) {
      const bx = pv.x - Math.sin(pv.yaw) * 3.2;
      const bz = pv.z - Math.cos(pv.yaw) * 3.2;
      for (let i = 0; i < 3; i += 1) {
        spawn(dynamic.sparks, bx + (Math.random() - 0.5) * 1.6, 0.1, bz + (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 2 - pv.vx * 0.14, 1.4 + Math.random(), (Math.random() - 0.5) * 2 - pv.vz * 0.14, 0.8, -3.4, 0.4);
      }
    }
    for (let i = dynamic.sprays.length - 1; i >= 0; i -= 1) {
      const spray = dynamic.sprays[i];
      spray.t -= 0.016;
      if (spray.t <= 0) { dynamic.sprays.splice(i, 1); continue; }
      for (let k = 0; k < 3; k += 1) spawn(dynamic.sparks, spray.x, 0.5, spray.z, (Math.random() - 0.5) * 1.6, 5.4 + Math.random() * 2, (Math.random() - 0.5) * 1.6, 0.8, -8, 0.1);
    }
    stepParticles(dynamic.smoke, 0.016);
    stepParticles(dynamic.sparks, 0.016);
    dynamic.waterTex.offset.set(state.time * 0.006, state.time * 0.004);
    for (const cloud of clouds) {
      cloud.position.x += 0.016 * 1.1;
      if (cloud.position.x > 1600) cloud.position.x = -1600;
      cloud.material.opacity = 0.25 + dynamic.dayness * 0.6;
    }
    updateCamera(state, screen);
    renderer.render(scene, camera);
  }

  const skyDay = new THREE.Color(0x7ec8e3);
  const skyDusk = new THREE.Color(0xff8a5c);
  const skyDusk2 = new THREE.Color(0xd6336c);
  const skyNight = new THREE.Color(0x0b1026);
  const _sky = new THREE.Color();
  const _skyTop = new THREE.Color();
  const _skyBottom = new THREE.Color();
  const _sunDir = new THREE.Vector3();

  function applyTimeOfDay(state) {
    const h = state.hour;
    const a = ((h - 6.5) / 12.67) * Math.PI;
    const elev = Math.sin(a);
    const dayness = Math.max(0, Math.min(1, elev * 1.7 + 0.22));
    const duskness = Math.max(0, 1 - Math.abs(elev) * 3.1) * (h > 12 || h < 6 ? 1 : 0.4);
    dynamic.dayness = dayness;
    dynamic.darkness = 1 - dayness;
    if (elev > 0.25) _sky.copy(skyDay).lerp(skyDusk, duskness * 0.7);
    else if (elev > -0.12) _sky.copy(skyDusk).lerp(skyDusk2, 0.45).lerp(skyNight, Math.max(0, -elev) * 5);
    else _sky.copy(skyNight);
    scene.background.copy(_sky);
    scene.fog.color.copy(_sky);
    scene.fog.near = 170 + dayness * 160;
    scene.fog.far = 950 + dayness * 700;
    _sunDir.set(Math.cos(a) * 900, Math.max(-160, elev * 700), -210);
    const px = state.player.x;
    const pz = state.player.z;
    if (Math.abs(h - skyPaintedAt) > 0.02) {
      skyPaintedAt = h;
      _skyTop.copy(_sky).lerp(skyNight, 0.35).multiplyScalar(0.8);
      _skyBottom.copy(_sky).lerp(skyDusk, Math.min(1, duskness * 0.7 + 0.15));
      paintSky(_skyTop, _sky, _skyBottom);
    }
    skyDome.position.set(px, 0, pz);
    sun.position.set(px + _sunDir.x, Math.max(24, _sunDir.y), pz + _sunDir.z);
    sun.target.position.set(px, 0, pz);
    sun.intensity = 0.3 + Math.max(0, elev) * 1.0;
    sun.color.setHex(elev < 0.3 ? 0xff9a4d : 0xfff1d6);
    hemi.intensity = 0.38 + dayness * 0.45;
    starMat.opacity = Math.max(0, 0.9 - dayness * 1.6);
    stars.position.set(px, 0, pz);
    sunSprite.position.set(px + _sunDir.x * 3.1, _sunDir.y * 3.1 + 30, pz + _sunDir.z * 3.1);
    sunSprite.material.opacity = Math.max(0, Math.min(1, elev * 2.4 + 0.4)) * (0.55 + duskness * 0.45);
    sunSprite.material.color.setHex(elev < 0.25 ? 0xff7a3c : 0xffd9a0);
    const emissive = 0.22 + (1 - dayness) * 1.25;
    for (const mat of facadeMats) mat.emissiveIntensity = emissive;
    if (dynamic.lampGlow) dynamic.lampGlow.material.opacity = Math.max(0, (1 - dayness) - 0.12) * 0.85;
  }

  function updateCamera(state, screen) {
    const p = state.player;
    if (cam.lock) {
      camera.position.set(cam.lock.x, cam.lock.y, cam.lock.z);
      camera.lookAt(cam.lock.tx, cam.lock.ty, cam.lock.tz);
      return;
    }
    const target = { x: p.x, y: 1.5, z: p.z };
    let dist = 6.4;
    let height = 0;
    if (p.mode !== 'foot' && p.vehicle) {
      dist = (p.vehicle.kind === 'boat' ? 11.5 : 9.6) + Math.abs(p.vehicle.speed) * 0.07;
      target.y = 1.35;
      height = 1.1;
    }
    const cp = Math.cos(cam.pitch);
    const fx = Math.sin(cam.yaw) * cp;
    const fz = Math.cos(cam.yaw) * cp;
    const fy = Math.sin(cam.pitch);
    const cx = target.x - fx * dist;
    const cz = target.z - fz * dist;
    let cy = target.y + height + fy * dist + 0.7;
    if (cy < 0.6) cy = 0.6;
    camera.position.set(cx, cy, cz);
    if (cam.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * cam.shake;
      camera.position.y += (Math.random() - 0.5) * cam.shake;
      cam.shake = Math.max(0, cam.shake - 0.05);
    }
    camera.lookAt(target.x, target.y + 0.35, target.z);
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /** The camera's aim ray, for shooting: origin at the camera, direction through its centre. */
  function aimRay() {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    return { origin: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, dir: { x: dir.x, y: dir.y, z: dir.z } };
  }

  resize();
  window.addEventListener('resize', resize);

  return {
    buildCity,
    draw,
    aimRay,
    cam,
    setCamLock(lock) { cam.lock = lock; },
    clearCamLock() { cam.lock = null; },
    shake(amount) { cam.shake = Math.min(1.4, cam.shake + amount); },
    spawnSparks(x, y, z, n) {
      for (let i = 0; i < n; i += 1) spawn(dynamic.sparks, x, y, z, (Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3, 0.7, -2, 0.4);
    },
  };
}

/** The minimap: streets, water, the island, blips for the law and a pink mission marker. */
export function drawMinimap(ctx, state) {
  const S = 216;
  const RANGE = 150;
  const p = state.player;
  const px = p.mode === 'foot' ? p.x : p.vehicle.x;
  const pz = p.mode === 'foot' ? p.z : p.vehicle.z;
  const scale = S / (RANGE * 2);
  const X = (x) => (x - px) * scale + S / 2;
  const Z = (z) => (z - pz) * scale + S / 2;
  ctx.fillStyle = '#17384f';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#3d434c';
  ctx.fillRect(X(WEST), Z(NORTH), (SHORE_X - WEST) * scale, (SOUTH - NORTH) * scale);
  ctx.fillStyle = '#d9b77c';
  ctx.fillRect(X(216), Z(NORTH), (SHORE_X - 216) * scale, (SOUTH - NORTH) * scale);
  ctx.fillStyle = '#3d434c';
  ctx.fillRect(X(CAUSEWAY.fromX), Z(-CAUSEWAY.zHalf), (CAUSEWAY.toX - CAUSEWAY.fromX) * scale, CAUSEWAY.zHalf * 2 * scale);
  ctx.fillRect(X(ISLAND.minX), Z(ISLAND.minZ), (ISLAND.maxX - ISLAND.minX) * scale, (ISLAND.maxZ - ISLAND.minZ) * scale);
  ctx.strokeStyle = 'rgba(230,234,240,0.55)';
  ctx.lineWidth = 3;
  for (const sx of STREETS_X) {
    ctx.beginPath();
    ctx.moveTo(X(sx), Z(NORTH));
    ctx.lineTo(X(sx), Z(SOUTH));
    ctx.stroke();
  }
  for (const sz of STREETS_Z) {
    ctx.beginPath();
    ctx.moveTo(X(WEST), Z(sz));
    ctx.lineTo(X(SHORE_X), Z(sz));
    ctx.stroke();
  }
  // Mission marker: the active objective, or every beacon when free-roaming.
  ctx.fillStyle = '#ff2e88';
  function blip(x, z, r) {
    const bx = Math.max(6, Math.min(S - 6, X(x)));
    const bz = Math.max(6, Math.min(S - 6, Z(z)));
    ctx.beginPath();
    ctx.arc(bx, bz, r, 0, TAU);
    ctx.fill();
  }
  if (state.mission && state.mission.points[state.mission.idx]) {
    const t = state.mission.points[state.mission.idx];
    blip(t.x, t.z, 5.5);
  } else {
    for (const def of MISSION_DEFS) blip(def.beacon.x, def.beacon.z, 4);
  }
  // Traffic as pale dots, police as flashing blue.
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (const v of state.vehicles) {
    if (v.kind === 'police' || v.dead) continue;
    if (Math.abs(v.x - px) > RANGE || Math.abs(v.z - pz) > RANGE) continue;
    ctx.fillRect(X(v.x) - 1.6, Z(v.z) - 1.6, 3.2, 3.2);
  }
  const flash = Math.sin(state.time * 9) > 0;
  for (const v of state.vehicles) {
    if (v.kind !== 'police' || v.dead) continue;
    if (Math.abs(v.x - px) > RANGE || Math.abs(v.z - pz) > RANGE) continue;
    ctx.fillStyle = flash ? '#3a86ff' : '#ff2a33';
    // The view cone: a wedge in the cruiser's heading.
    ctx.save();
    ctx.translate(X(v.x), Z(v.z));
    ctx.rotate(Math.atan2(Math.cos(v.yaw), Math.sin(v.yaw)));
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 17, -0.5, 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillRect(-2.6, -2.6, 5.2, 5.2);
    ctx.restore();
  }
  // The player arrow, turned to the player's heading (north up).
  const heading = p.mode === 'foot' ? p.yaw : p.vehicle.yaw;
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(-heading);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, 8);
  ctx.lineTo(-5.4, -6);
  ctx.lineTo(0, -2.6);
  ctx.lineTo(5.4, -6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '800 11px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', S / 2, 14);
}
