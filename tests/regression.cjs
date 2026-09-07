'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const THREE = require(path.join(ROOT, 'vendor/three.min.js'));
const modules = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js')).sort();
for (const f of modules) new vm.Script(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), { filename: f });
let now = 1000, callbacks = [], storage = new Map();
const context = {
  THREE, console, Number, Date, Math, performance: { now: () => now },
  window: { addEventListener() {} }, document: { addEventListener() {}, hidden: false },
  // removeItem is part of the real Storage API and both save modules call it;
  // without it here, clear() silently no-ops and a cleared save still loads.
  localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
  requestAnimationFrame: fn => callbacks.push(fn)
};
vm.createContext(context);
function load(file) { vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', file), 'utf8'), context, { filename: file }); }
load('00-core.js'); load('02b-islands.js'); load('02-layout.js'); load('34-activities.js'); load('35-save.js');
const SB = context.window.SB;
function pressProbe(intervals, touch = false) {
  now = 1000; callbacks = [];
  const input = new SB.Input({ addEventListener() {} });
  input.locked = !touch; input.touch.enabled = touch;
  let hits = 0;
  const loop = new SB.Loop(1 / 60, () => { if (input.actHit('weather')) hits++; input.endTick(); }, () => input.endFrame());
  loop.start();
  if (touch) input.touch.hit.weather = true; else input.pressed.KeyT = true;
  for (const ms of intervals) { now += ms; callbacks.shift()(); }
  loop.stop(); return hits;
}
for (const touch of [false, true]) {
  assert.equal(pressProbe([8, 9], touch), 1, 'fast renders must retain a press');
  assert.equal(pressProbe([50], touch), 1, 'catch-up ticks must not repeat a press');
}
now = 1000; callbacks = [];
const paused = new SB.Loop(1 / 60, () => false, () => {}); paused.start();
for (let i = 0; i < 60; i++) { now += 1000 / 60; callbacks.shift()(); }
assert.equal(paused.time, 0, 'paused simulation clock'); paused.stop();
// The map generator itself is exercised, not a second copy of its algorithm.
const started = Date.now(), L = SB.Roads.build();
const courses = SB.ActivityRoutes.briefs.map(b => SB.ActivityRoutes.buildCourse(L, b));
assert.equal(courses.filter(Boolean).length, 4);
for (const c of courses) {
  assert(c.length > 200); assert(c.checkpoints.length >= 3); assert(c.gold < c.silver && c.silver < c.bronze);
  assert(c.checkpoints.every(p => [p.x, p.y, p.z].every(Number.isFinite)));
}
const unreachable = { nodes: [{ edges: [] }, { edges: [] }], edges: [] };
assert.equal(SB.ActivityRoutes.roadPath(unreachable, 0, 1).length, 0);
assert.equal(SB.ActivityRoutes.sweptDistance({ x: -30, z: 0 }, { x: 30, z: 0 }, { x: 0, z: 0 }), 0);
// Save/restore validates only known course/weapon IDs and bounded numbers.
SB.WEAPONS = [{ id: 'fist' }, { id: 'pistol', clip: 15, ammoMax: 180 }];
const game = { dev: false, bus: new SB.Bus(), player: { money: 1234, armor: 20 },
  missions: { index: 2, completed: ['a', 'b'], refreshBlips() {} },
  combat: { owned: { fist: true, pistol: true }, ammo: { pistol: 55 }, clip: { pistol: 9 }, index: 1, equip(i) { this.index = i; } },
  activities: { courses, records: { 'coast-run': { time: 88, medal: 'GOLD' } }, discoveries: { boardwalk: true }, traps: [], trapRecords: {} },
  coast: { landmarks: [{ id: 'boardwalk' }] }, interiors: { rooms: [{ index: 0, robbed: true, stashTaken: true }] }, hud: { toast() {} } };
const save = new SB.SaveGame(game);
assert.equal(save.save(), true);
// Ownership split. SB.Save (34-save.js) already persisted money, armour,
// mission progress and weapons before this expansion arrived, and two
// systems writing the same fields under two different keys meant whichever
// restored last won - and that "New game" still inherited the old run.
// SaveGame now owns only what is unique to the expansion. This asserts both
// halves of that contract: its own fields come back, and it leaves the
// fields SB.Save owns untouched.
game.player.money = 0;
game.activities.records['coast-run'] = null;
game.interiors.rooms[0].robbed = false;
assert.equal(save.restore(), true);
assert.equal(game.activities.records['coast-run'].time, 88);
assert.equal(game.interiors.rooms[0].robbed, true);
assert.equal(game.activities.discoveries.boardwalk, true);
assert.equal(game.player.money, 0, 'activity save must not write money');
assert.equal(game.missions.index, 2, 'activity save must not write mission progress');
// clear() drops this half of the run, for the New game path.
save.clear(); assert.equal(save.restore(), false);
assert.equal(save.save(), true);
storage.set('sunsetbay.progress.v1', '{broken'); assert.equal(save.restore(), false);
storage.set('sunsetbay.progress.v1', JSON.stringify({ version: 999, money: 12 })); assert.equal(save.restore(), false);
context.localStorage.setItem = () => { throw new Error('quota'); }; assert.equal(save.save(), false);
// Quality switches must release post targets and resize the water budget.
load('06-sky.js'); load('22-post.js'); load('23-quality.js');
context.window.innerWidth = 800; context.window.innerHeight = 600;
const renderer = { getSize: v => v.set(800, 600), getPixelRatio: () => 1,
  setPixelRatio() {}, shadowMap: {} };
const sky = { sun: new THREE.DirectionalLight(), water: { geometry: new THREE.PlaneGeometry(100, 100, 2, 2), userData: {} },
  setBudget: SB.Sky.prototype.setBudget };
const graphics = { renderer, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), sky };
SB.Q.set('low', false); SB.Q.apply(graphics); assert(!graphics.post);
assert.equal(sky.water.geometry.parameters.widthSegments, 28);
SB.Q.set('high', false); SB.Q.apply(graphics); assert(graphics.post && graphics.post.enabled);
assert.equal(sky.water.geometry.parameters.widthSegments, 64);
let disposed = 0;
graphics.post.sceneRT.addEventListener('dispose', () => disposed++);
SB.Q.set('low', false); SB.Q.apply(graphics); assert.equal(graphics.post, null); assert.equal(disposed, 1);
SB.Q.set('medium', false); SB.Q.apply(graphics); assert(graphics.post && !graphics.post.useSSR);
graphics.post.dispose(); sky.water.geometry.dispose();
// Authored jobs, story sequence and saved progress have real one-time rewards.
load('36-city-life.js');
const lifeRooms = Object.keys(SB.CityLifeJobs).map((service, index) => ({ service, index }));
const lifeGame = { bus: new SB.Bus(), player: { money: 0 }, interiors: { rooms: lifeRooms }, saveGame: { save() {} } };
const life = new SB.CityLife(lifeGame);
for (const chapter of SB.CityLifeStory) {
  const room = lifeRooms.find(r => r.service === chapter[0]);
  const job = SB.CityLifeJobs[room.service], before = lifeGame.player.money;
  assert.equal(life.finishJob(room, (job[4]+1)%3).ok, false);
  assert.equal(lifeGame.player.money, before);
  assert.equal(life.finishJob(room, job[4]).ok, true);
  const paid = lifeGame.player.money;
  life.finishJob(room, job[4]); assert.equal(lifeGame.player.money, paid, 'no repeated shift or chapter payment');
}
assert.equal(life.chapter, 7);
life.room = lifeRooms.find(r => r.service === 'safehouse');
assert.equal(life.chooseEnding('published'), true);
const finaleMoney = lifeGame.player.money;
assert.equal(life.chooseEnding('audited'), false); assert.equal(lifeGame.player.money, finaleMoney);
const restoredLife = new SB.CityLife(lifeGame); restoredLife.restore(JSON.parse(JSON.stringify(life.snapshot())));
assert.equal(restoredLife.chapter, 8); assert.equal(restoredLife.ending, 'published');
assert.equal(Object.keys(restoredLife.completed).length, 8);
restoredLife.restore({ chapter: -99, reputation: Infinity, completed: { 999999: true } });
assert.equal(restoredLife.chapter, 0); assert.equal(restoredLife.reputation, 0); assert.equal(Object.keys(restoredLife.completed).length, 0);
load('13-peds.js');
const crossingPed = { state: 'cross', trafficWait: 0, x: 10, z: 0, speed: 2 };
SB.Peds.prototype.stepPed.call({ game: { traffic: { grid: { queryPoint() { return [{ pos: { x: 0, z: 0 }, yaw: 0, speed: () => 10 }]; } }, _stamp: 1, _q: [] } }, checkRunOver() {} }, crossingPed, .016, 0, 0);
assert.equal(crossingPed.speed, 0); assert(crossingPed.trafficWait > 0, 'yield to approaching vehicle');
// Real courier contract lifecycle: geography, foot handoff, timeout, rewards and saves.
load('37-deliveries.js');
const deliveryDoor = { x: 300, y: 22, z: 0, name: 'Clinic', room: { service: 'clinic', index: 4 } };
const deliveryGame = { bus: new SB.Bus(), player: { pos: { x: 0, y: 0, z: 0 }, money: 0, mode: 'foot' },
  interiors: { doors: [deliveryDoor], current: null, fadeDir: 0 }, activities: { active: null },
  hud: { toast() {}, setDestination(d) { this.destination = d; }, navigation: { points: [] } },
  cityLife: { reputation: 0 }, saveGame: { save() {} } };
const courier = new SB.Deliveries(deliveryGame), offer = courier.offer();
assert(offer && offer.reward > 0); assert(courier.accept(offer)); assert(!courier.accept(offer));
assert(!courier.handoff());
deliveryGame.player.pos = { x: 300, y: 0, z: 0 }; assert(!courier.canHandoff(), 'cannot hand off from another elevation');
deliveryGame.player.pos.y = 22; deliveryGame.player.mode = 'car'; assert(!courier.handoff());
deliveryGame.player.mode = 'foot'; assert(courier.handoff());
const deliveryPay = deliveryGame.player.money;
assert(deliveryPay > offer.reward); assert(!courier.handoff()); assert.equal(deliveryGame.player.money, deliveryPay);
courier.fixed(16); assert(courier.accept(offer)); courier.fixed(offer.limit + 1);
assert(!courier.active); assert.equal(deliveryGame.player.money, deliveryPay);
const savedCourier = new SB.Deliveries(deliveryGame); savedCourier.restore(courier.snapshot());
assert.equal(savedCourier.completed, 1); assert.equal(savedCourier.earned, deliveryPay);
assert(!savedCourier.active, 'in-progress contracts never silently resume after reload');
// Generate the distributable twice; check assets and byte-for-byte stability.
execFileSync(process.execPath, ['build.js'], { cwd: ROOT, stdio: 'pipe' });
const first = fs.readFileSync(path.join(ROOT, 'dist/sunset-bay.html'));
const firstDev = fs.readFileSync(path.join(ROOT, 'index.html'));
execFileSync(process.execPath, ['build.js'], { cwd: ROOT, stdio: 'pipe' });
assert(first.equals(fs.readFileSync(path.join(ROOT, 'dist/sunset-bay.html'))));
assert(firstDev.equals(fs.readFileSync(path.join(ROOT, 'index.html'))));
const html = first.toString(); assert(html.startsWith('<!doctype html>')); assert(!html.includes('src="https://cdnjs'));
for (const file of fs.readdirSync(path.join(ROOT, 'assets'))) {
  assert(fs.readFileSync(path.join(ROOT, 'assets', file)).equals(fs.readFileSync(path.join(ROOT, 'dist/assets', file))));
}
for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
console.log('PASS: syntax, desktop/touch input timing, pause clock, four connected courses, swept checkpoints, save recovery, story endings, single-payment jobs, traffic yielding, quality disposal, offline packaging and deterministic builds.');
console.log(JSON.stringify({ roadNodes: L.nodes.length, roadEdges: L.edges.length, courses: courses.map(c => ({ name: c.name, metres: Math.round(c.length), checkpoints: c.checkpoints.length })), elapsedMs: Date.now() - started }, null, 2));
