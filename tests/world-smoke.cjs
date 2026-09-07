'use strict';
// Optional geometry/simulation integration check. Requires @napi-rs/canvas.
// It exercises real Three.js meshes/colliders without claiming GPU/FPS QA.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createCanvas, Image } = require('@napi-rs/canvas');
const ROOT = path.resolve(__dirname, '..');
const THREE = require(path.join(ROOT, 'vendor/three.min.js'));
function element(canvas = false) {
  const el = canvas ? createCanvas(1280, 720) : {};
  Object.assign(el, { hidden: false, dataset: {}, style: { setProperty() {} }, children: [], textContent: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    showModal() { this.open = true; }, close() { this.open = false; },
    appendChild(child) { this.children.push(child); return child; }, append(...children) { this.children.push(...children); },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, focus() {},
    replaceChildren() { this.children = []; }, querySelectorAll() { return []; },
    querySelector() { return element(); }, getBoundingClientRect() { return { x: 0, y: 0, width: 1280, height: 720 }; } });
  return el;
}
const elements = new Map();
const document = { body: element(), head: element(), hidden: false,
  createElement: name => element(name === 'canvas'), addEventListener() {}, querySelector() { return null; },
  getElementById(id) { if (!elements.has(id)) elements.set(id, element(id === 'hud')); return elements.get(id); } };
const window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  screen: { width: 1280, height: 720 }, matchMedia() { return { matches: false }; }, addEventListener() {} };
const context = { THREE, window, document, console, Image, performance, Date, Math, Number,
  location: { hash: '#quality=low' }, navigator: { hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0 },
  getComputedStyle() { return { getPropertyValue() { return '0'; } }; },
  localStorage: { getItem() { return null; }, setItem() {} }, setTimeout() {}, setInterval() {}, requestAnimationFrame() {} };
vm.createContext(context);
for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js')).sort()) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), context, { filename: f });
}
const SB = window.SB, game = new SB.Game(element());
game.scene = new THREE.Scene(); game.camera = new THREE.PerspectiveCamera(62, 1280 / 720, 0.35, 1000);
game.input = new SB.Input(element()); game.input.locked = true;
game.layout = SB.Roads.build();
game.layout.playBounds = { minX: -1260, maxX: 1100, minZ: -1100, maxZ: 1100 };
game.world = new SB.World(); game.world.beachX = game.layout.beachX;
game.sky = { setWeather() {}, setSwimmer() {}, setHour() {}, lampFactor() { return 0.5; },
  rain: 0, wetness: 0, night: 0, water: new THREE.Mesh(new THREE.PlaneGeometry(10, 10, 25, 25)),
  uniforms: { uSun: { value: new THREE.Vector3(1, 1, 1) }, uTime: { value: 0 } } };
const timings = {};
for (const method of ['stepTerrain', 'stepFreeway', 'stepCity', 'stepProps', 'stepRail', 'stepRooftops', 'stepInteriors', 'stepSystems', 'stepExpansion']) {
  const start = performance.now(); game[method](); timings[method] = Math.round(performance.now() - start);
  console.log(method, timings[method] + 'ms');
}
assert(game.interiors.rooms.length === game.city.buildings.length);
assert(game.interiors.rooms.every(room => !room.group), 'no rooms materialized at startup');
const initialBoxes = game.world.boxes.length;
const room = game.interiors.rooms[0];
const identity = game.interiors.doors.find(d => d.room === room);
const start = performance.now(); game.interiors.ensureRoom(room); timings.firstRoom = performance.now() - start;
assert(room.group && room.hotspots.length >= 2); assert.equal(identity.room, room);
const boxCount = game.world.boxes.length; game.interiors.ensureRoom(room); assert.equal(game.world.boxes.length, boxCount);
assert(boxCount > initialBoxes); assert.equal(game.interiors.rooms.filter(r => r.group).length, 1);
// Every new deck can actually be reached within player bounds.
const coast = game.coast;
assert(coast.center.x > game.layout.playBounds.minX);
const deck = game.world.surfaceAt(coast.center.x, coast.center.z, 6, 3);
assert(Math.abs(deck.y - 4.8) < 0.01, 'boardwalk render/physics height');
const top = coast.lookout.top;
assert(Math.abs(game.world.surfaceAt(top.x, top.z, top.y + 1, 2).y - top.y) < 0.01, 'lookout platform');
for (const tier of ['low', 'medium', 'high']) {
  SB.Q.set(tier, false); game.camera.position.set(coast.center.x + 30, 15, coast.center.z);
  coast.render(1 / 60, 0.8);
  assert.equal(coast.boardwalk.visible, true);
  assert.equal(coast.skyline.visible, tier !== 'low');
  for (let i = 0; i < coast.cabins.instanceMatrix.array.length; i++) assert(Number.isFinite(coast.cabins.instanceMatrix.array[i]));
}
SB.Q.set('low', false);
// Lookout lift, time-trial state transitions and exactly-once payouts.
game.player.mode = 'foot'; game.player.pos.copy(coast.lookout.entry);
game.input.pressed.KeyE = true; game.activities.fixed(1 / 60); game.input.endTick();
assert.equal(coast.lookout.inside, true); assert.equal(game.player.pos.y, top.y);
game.input.pressed.KeyE = true; game.activities.fixed(1 / 60); game.input.endTick(); assert.equal(coast.lookout.inside, false);
const activities = game.activities, course = activities.courses[0];
activities.select(course);
game.player.mode = 'car'; game.player.vehicle = game.player.ownedCar;
game.player.vehicle.u = 0; game.player.vehicle.v = 0;
game.player.pos.set(course.checkpoints[0].x, course.checkpoints[0].y, course.checkpoints[0].z);
for (let i = 0; i < 190; i++) activities.fixed(1 / 60);
assert.equal(activities.active.state, 'racing');
for (const cp of course.checkpoints.slice(1)) {
  game.player.pos.set(cp.x, cp.y, cp.z); activities.fixed(1 / 60);
}
assert.equal(activities.active, null); assert(activities.records[course.id]);
const wallet = game.player.money; activities.fixed(1 / 60); assert.equal(game.player.money, wallet);
game.player.mode = 'foot'; game.player.vehicle = null; game.player.pos.set(-14, 1, 20);
for (let i = 0; i < 600; i++) game.fixed(1 / 60, i / 60);
assert([game.player.pos.x, game.player.pos.y, game.player.pos.z].every(Number.isFinite));
// No non-finite attributes in the new geometry.
let meshes = 0, vertices = 0;
coast.root.traverse(object => {
  if (!object.geometry) return; meshes++;
  for (const attribute of Object.values(object.geometry.attributes)) {
    for (const value of attribute.array) assert(Number.isFinite(value));
  }
  vertices += object.geometry.attributes.position.count;
});
// Representative interiors stay lazy, retain distinct work and reuse residents.
const residentLife = game.cityLife;
const representatives = Object.keys(SB.CityLifeJobs).map(service => game.interiors.rooms.find(r => r.service === service)).filter(Boolean);
assert.equal(representatives.length, 10);
let residents;
for (const r of representatives) {
  game.interiors.ensureRoom(r);
  assert(r.detailVertices > 1000);
  assert(r.hotspots.some(h => h.kind === 'localwork'));
  residentLife.enter(r);
  assert.equal(residentLife.people.length, 3);
  if (residents) assert(residentLife.people.every((p, i) => p.char === residents[i]));
  residents = residentLife.people.map(p => p.char);
  residentLife.render(.016);
  assert(residentLife.people.every(p => [p.x,p.y,p.z].every(Number.isFinite)));
}
residentLife.enter(representatives[0]); game.paused = false;
residentLife.talk(residentLife.people[0]); assert(game.paused && game.uiBlocking && residentLife.open);
residentLife.close(); assert(!game.paused && !game.uiBlocking && !residentLife.open);
residentLife.enter(null); assert(residentLife.people.every(p => !p.char.root.visible));
console.log('PASS: world construction, lazy-room identity/colliders, boardwalk and lookout surfaces, three quality tiers, lift, complete race, single payout, 600 fixed steps and finite expansion geometry.');
console.log(JSON.stringify({ buildings: game.city.buildings.length, interiorsMaterialized: game.interiors.rooms.filter(r => r.group).length, expansionMeshes: meshes, expansionVertices: vertices, timings }, null, 2));
if (process.env.SUNSET_BENCHMARK_INTERIORS === '1') {
  const { execFileSync } = require('node:child_process');
  const original = execFileSync('git', ['show', '47098f4:src/16-interiors.js'], { cwd: ROOT, encoding: 'utf8' });
  vm.runInContext(original, context, { filename: 'baseline-interiors.js' });
  const baselineGame = { ...game, scene: new THREE.Scene(), world: new SB.World() };
  const baselineStart = performance.now();
  const baseline = new SB.Interiors(baselineGame);
  const baselineMs = performance.now() - baselineStart;
  let oldObjects = 0; baseline.root.traverse(() => oldObjects++);
  console.log(JSON.stringify({ interiorStartupComparison: { originalMs: Math.round(baselineMs), newMs: timings.stepInteriors,
    originalRoomObjects: oldObjects - 1, newRoomObjectsAtBoot: 0,
    note: 'Same generated buildings; CPU construction only, not browser FPS.' } }, null, 2));
}
