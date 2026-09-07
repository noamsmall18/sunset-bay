// City life: authored encounters, persistent local work and the Undertow story.
(function (SB) {
  'use strict';
  var M = SB.M;
  var JOBS = {
    store: ['Stock clerk', 'Stock the cold case', 'The delivery labels read KEEP CHILLED. Where should the dairy go?', ['Refrigerated shelf', 'Window display', 'Dry storeroom'], 0, 'The cold chain is intact. The owner signs off your shift.'],
    diner: ['Cook', 'Complete a dinner order', 'Table four ordered a vegetable plate and reported a nut allergy. What comes first?', ['Use the shared chopping board', 'Clean the station and check ingredients', 'Remove the garnish'], 1, 'The cook checks the ticket and sends a safely prepared order.'],
    club: ['Sound engineer', 'Restore the sound system', 'The speakers hum even with the music muted. What should you check first?', ['Turn the gain all the way up', 'Replace every speaker', 'Mute the channel and inspect its cable'], 2, 'The hum disappears. The dance floor comes alive again.'],
    warehouse: ['Dock worker', 'Reconcile a shipment', 'The manifest lists 12 crates. Nine are on the floor and two are on the truck. How many are missing?', ['One crate', 'Two crates', 'Three crates'], 0, 'The supervisor records the discrepancy before signing the delivery.'],
    office: ['Analyst', 'Audit an invoice', 'An invoice has a new bank account and an urgent payment demand. What do you do?', ['Pay immediately', 'Verify through the supplier’s known contact', 'Reply with the company password'], 1, 'The supplier confirms the account change was fraudulent.'],
    clinic: ['Receptionist', 'Organize the supply room', 'Which stock should be placed at the front of the shelf?', ['The brightest packaging', 'The newest delivery', 'The earliest unexpired stock'], 2, 'The inventory rotation is complete. Staff can find supplies quickly.'],
    hotel: ['Concierge', 'Resolve a booking', 'A guest has a prepaid reservation but the room is occupied. What should you do?', ['Verify the booking and offer an equivalent room', 'Charge the guest again', 'Give them an occupied room key'], 0, 'The guest settles into a replacement room and thanks the desk.'],
    bank: ['Auditor', 'Check a transfer', 'Two transfers share the same invoice number. What happens next?', ['Approve both', 'Flag the duplicate for review', 'Delete the audit log'], 1, 'The duplicate is held and the audit trail stays intact.'],
    gunshop: ['Range officer', 'Inspect the range', 'Before maintenance begins, how should the range be secured?', ['Leave the firing line open', 'Only dim the lights', 'Call a ceasefire and verify the line is clear'], 2, 'The range is secured for maintenance.'],
    safehouse: ['Neighbor', 'Restore the radio', 'The receiver is silent and its battery contacts are corroded. What is the first step?', ['Disconnect power before cleaning', 'Pour water into the receiver', 'Bridge the terminals'], 0, 'A harbor weather bulletin crackles through the repaired radio.']
  };
  var STORY = [
    ['diner', 'A seat at the counter', 'Mara, a harbor reporter, is tracing suspicious waterfront buyouts. The diner’s night deliveries may be the first lead.', 'Mara: Three businesses received identical eviction notices. Help the people here and they will talk. Start with the dinner shift.'],
    ['warehouse', 'The missing crate', 'The diner’s supplier sent a shipment through the old warehouse. Reconcile its cargo manifest.', 'Ivo: One crate never arrived. The replacement paperwork bears an Undertow project code.'],
    ['office', 'Paper trail', 'A downtown invoice links the missing cargo to a shell company. Check its payment records.', 'Leena: These accounts buy storm equipment, then bill the city twice. Someone is funding the waterfront takeover with the difference.'],
    ['club', 'After hours', 'The club hosted an Undertow fundraiser. Help the engineer restore the booth and hear what was recorded.', 'Sol: The backstage mic caught a promise to close the public pier. I kept a copy, but a recording alone will not prove the money trail.'],
    ['hotel', 'Room for a witness', 'A visiting contractor is staying at a hotel. Help the desk resolve a booking before asking for the witness statement.', 'Nico: The contractor confirms the storm barriers were diverted. Their signed delivery receipt matches your manifest.'],
    ['clinic', 'When the water rises', 'The clinic depends on those missing storm supplies. Help organize its stock and document the shortage.', 'Dr. Vale: We have the dated requests and rejection letters. Publish those alongside the contract, not patients’ records.'],
    ['bank', 'Follow the money', 'An auditor can connect the duplicate invoices to the buyout fund. Complete a transfer check.', 'Amir: The transfer IDs match. You now have documents, a witness, and a traceable payment chain. Mara can use this.'],
    ['safehouse', 'The bay belongs to everyone', 'Return to a safehouse, restore the radio, and decide what happens to the evidence.', 'Mara: We can publish the full investigation or first deliver the evidence to an independent auditor. Both protect the witnesses. Which path do you choose?']
  ];
  function Life(game) {
    this.game = game; this.chapter = 0; this.reputation = 0; this.completed = {}; this.ending = '';
    this.people = []; this.room = null; this.scan = 0; this.near = null; this.open = false;
    var self = this;
    game.bus.on('interiorEntered', function (room) { self.enter(room); });
    game.bus.on('interiorLeft', function () { self.enter(null); });
    window.addEventListener('keydown', function (e) {
      if (e.code !== 'KeyJ' || e.repeat || !game.started || game.paused || game.uiBlocking) return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      e.preventDefault(); self.journal();
    });
  }
  Life.prototype.job = function (room) { return JOBS[room.service] || JOBS.office; };
  Life.prototype.save = function () { if (this.game.saveGame) this.game.saveGame.save(); };
  Life.prototype.snapshot = function () { return { chapter: this.chapter, reputation: this.reputation, completed: this.completed, ending: this.ending }; };
  Life.prototype.restore = function (data) {
    if (!data || typeof data !== 'object') return;
    this.chapter = Number.isInteger(data.chapter) ? M.clamp(data.chapter, 0, STORY.length) : 0;
    this.reputation = Number.isFinite(data.reputation) ? M.clamp(data.reputation, 0, 100) : 0;
    this.ending = ['published', 'audited'].indexOf(data.ending) >= 0 ? data.ending : '';
    this.completed = {};
    var self = this;
    this.game.interiors.rooms.forEach(function (r) { if (data.completed && data.completed[r.index] === true) self.completed[r.index] = true; });
  };
  Life.prototype.enter = function (room) {
    this.room = room; this.near = null;
    this.people.forEach(function (p) { p.char.root.visible = false; });
    if (!room) return;
    // Reuse just three character rigs across all addresses; never 3,000 rigs.
    var labels = [this.job(room)[0], 'Regular', 'Courier'];
    for (var i = 0; i < 3; i++) {
      if (!this.people[i]) {
        var char = new SB.Character({ rng: M.rng(921 + i), shirt: [0x427f87, 0xd6aa6b, 0x56618b][i] });
        this.game.scene.add(char.root); this.people.push({ char: char });
      }
      var p = this.people[i];
      p.role = labels[i]; p.x = room.spawn.x + (i - 1) * 1.45; p.z = room.spawn.z - 2.1;
      var out = {};
      if (this.game.world.resolveCircle(p.x, p.z, .35, .2, 1.8, out)) { p.x = out.x; p.z = out.z; }
      p.y = 0.02; p.anchorX = p.x; p.anchorZ = p.z; p.walkPhase = i; p.char.root.visible = true;
    }
  };
  Life.prototype.navigate = function () {
    if (this.chapter >= STORY.length) return;
    var service = STORY[this.chapter][0], g = this.game, best = null, distance = Infinity;
    var point = g.interiors.current ? g.interiors.returnPoint || g.player.pos : g.player.pos;
    g.interiors.doors.forEach(function (d) {
      if (d.room.service !== service) return;
      var dd = M.dist2(d.x, d.z, point.x, point.z);
      if (dd < distance) { distance = dd; best = d; }
    });
    if (best) { g.hud.setDestination({ id: 'undertow', name: best.name, x: best.x, z: best.z, color: '#f4c271', icon: '◆', kind: 'waypoint' }); }
    return best;
  };
  Life.prototype.finishJob = function (room, choice) {
    var job = this.job(room);
    if (choice !== job[4]) return { ok: false, text: 'That would not solve the problem. Read the details and try again.' };
    var fresh = !this.completed[room.index];
    if (fresh) { this.completed[room.index] = true; this.game.player.money += 180; this.reputation = Math.min(100, this.reputation + 2); }
    var chapter = STORY[this.chapter], advance = chapter && chapter[0] === room.service;
    var text = job[5] + (fresh ? ' +$180 · Local trust +2.' : ' This shift has already been paid.');
    if (advance && this.chapter < STORY.length - 1) {
      text += '\n\n' + chapter[3]; this.chapter++; this.game.player.money += 350; text += '\n\nLead secured: +$350. Open the journal for your next destination.';
    }
    this.save(); return { ok: true, text: text, finale: advance && this.chapter === STORY.length - 1 && room.service === 'safehouse' };
  };
  Life.prototype.chooseEnding = function (ending) {
    if (this.chapter !== STORY.length - 1 || !this.room || this.room.service !== 'safehouse' || !this.completed[this.room.index]) return false;
    if (['published', 'audited'].indexOf(ending) < 0) return false;
    this.ending = ending; this.chapter = STORY.length; this.game.player.money += 2000; this.reputation = Math.min(100, this.reputation + 15); this.save(); return true;
  };
  Life.prototype.ensureUI = function () {
    if (this.panel) return;
    var self = this, panel = document.createElement('dialog'); panel.className = 'life-dialog';
    panel.setAttribute('aria-labelledby', 'life-title');
    var style = document.createElement('style');
    style.textContent = '.life-dialog{box-sizing:border-box;width:min(620px,94vw);max-height:86dvh;overflow:auto;background:#101c25;color:#eaf2f5;border:1px solid #68818e;border-radius:18px;padding:26px;font:16px/1.6 system-ui;touch-action:pan-y}.life-dialog::backdrop{background:#020811c9}.life-dialog h2{font-size:26px;margin:8px 0}.life-dialog p{white-space:pre-line;color:#c9d9df}.life-dialog button{display:block;width:100%;min-height:48px;text-align:left;padding:12px;margin:10px 0;background:#203847;color:white;border:1px solid #527282;border-radius:9px;font:inherit;cursor:pointer}.life-dialog button:focus-visible{outline:3px solid #f4c271}.life-dialog small{color:#f4c271;letter-spacing:.12em}';
    document.head.appendChild(style); document.body.appendChild(panel); this.panel = panel;
    panel.addEventListener('cancel', function (e) { e.preventDefault(); self.close(); });
  };
  Life.prototype.show = function (title, text, choices) {
    this.clearView();
    this.ensureUI(); var self = this, g = this.game;
    if (!this.open) {
      this.previousFocus = document.activeElement; this.wasPaused = g.paused;
      this.open = true; g.uiBlocking = true; g.setPaused(true);
      if (g.touch) g.touch.releaseAll();
      if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
      this.panel.showModal();
    }
    this.panel.replaceChildren();
    var tag = document.createElement('small'); tag.textContent = 'SUNSET BAY · LOCAL TRUST ' + this.reputation;
    var h = document.createElement('h2'); h.id = 'life-title'; h.textContent = title;
    var p = document.createElement('p'); p.textContent = text;
    this.panel.append(tag, h, p);
    choices.concat([['Back to the city', function () { self.close(); }]]).forEach(function (choice) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = choice[0]; b.onclick = choice[1]; self.panel.appendChild(b);
    });
    this.panel.querySelector('button').focus();
  };
  Life.prototype.clearView = function () {
    var cleanup = this.onViewClose; this.onViewClose = null;
    if (cleanup) cleanup();
  };
  Life.prototype.close = function () {
    if (!this.open) return;
    this.clearView();
    this.open = false; this.panel.close(); this.game.uiBlocking = false;
    this.game.setPaused(this.wasPaused);
    if (this.previousFocus && this.previousFocus.focus) this.previousFocus.focus();
    if (!this.wasPaused && !this.game.input.touch.enabled) this.game.input.requestLock();
  };
  Life.prototype.journal = function () {
    var self = this, c = STORY[this.chapter];
    this.show(c ? 'Undertow · ' + (this.chapter + 1) + '/' + STORY.length + ' · ' + c[1] : 'Undertow · Case closed',
      c ? c[2] : (this.ending === 'published' ? 'Mara publishes the investigation. The pier closure is suspended while the contracts are reviewed.' : 'The independent audit freezes the suspect transfers. The witnesses testify and the pier remains public.'),
      c ? [['Track the next lead', function () { var d = self.navigate(); self.close(); if (!d) self.game.hud.toast('No matching address found.'); }]] : []);
  };
  Life.prototype.work = function (room) {
    var self = this, job = this.job(room);
    this.show(job[1], job[2], job[3].map(function (label, i) { return [label, function () {
      var result = self.finishJob(room, i);
      if (!result.ok) { self.show('Check your approach', result.text, [['Try again', function () { self.work(room); }]]); return; }
      var options = [['Open investigation journal', function () { self.journal(); }]];
      if (result.finale) options = [['Publish with Mara', function () { self.chooseEnding('published'); self.journal(); }], ['Submit for independent audit', function () { self.chooseEnding('audited'); self.journal(); }]];
      self.show('Shift complete', result.text + (result.finale ? '\n\n' + STORY[7][3] : ''), options);
    }]; }));
  };
  Life.prototype.talk = function (person) {
    var self = this, room = this.room, role = person.role;
    person.conversations = (person.conversations || 0) + 1;
    var lines = {
      Regular: 'I have watched this neighborhood change for years. People remember who helps them. Ask the staff if they need a hand.',
      Courier: 'Every delivery leaves a paper trail. Start at the diner if you want to understand what is happening at the waterfront.',
      Medic: 'I can spare a first-aid kit for $40.', Tourist: 'The boardwalk and lighthouse are worth the trip. Open Explore to mark them on your map.',
      Commuter: 'Cross at the corners and watch the traffic. The bay gets busy after dark.',
      Vendor: 'Want to help the neighborhood? Local businesses have small jobs you can finish inside.',
      Mechanic: 'Bring a parked car and I can fit an engine tune, stronger brakes, sport tires or a fresh finish. Your build stays with that model.',
      Reporter: 'Mara is following the Undertow contracts. The investigation journal has the latest lead.'
    };
    var options = [['Ask about Undertow', function () { self.journal(); }]];
    if (role === 'Courier' && self.game.deliveries) options.unshift(['Courier dispatch', function () { self.game.deliveries.menu(); }]);
    if (room && person === this.people[0]) options.unshift(['Help with ' + this.job(room)[1].toLowerCase(), function () { self.work(room); }]);
    if (room && this.game.pastimes) options.unshift(['Play ' + this.game.pastimes.theme(room)[1], function () { self.game.pastimes.open(room); }]);
    if (!room && role === 'Tourist' && self.game.coast) options.unshift(['Show me the boardwalk', function () { self.game.hud.setDestination(self.game.coast.landmarks[0]); self.close(); }]);
    if (!room && role === 'Mechanic') options.unshift(['Show me the driving challenges', function () { self.close(); self.game.activities.toggle(true); }]);
    if (!room && role === 'Mechanic' && this.game.tuneShop) options.unshift(['Open Bay Garage', function () { self.game.tuneShop.menu(); }]);
    if (!room && role === 'Tourist' && this.game.neighbors) options.unshift(['Need a guide?', function () { self.game.neighbors.menu(person); }]);
    if (!room && role === 'Medic') options.unshift(['Buy first aid · $40', function () {
      var p = self.game.player;
      if (p.money < 40 || p.health >= p.maxHealth) { self.show('First aid', 'You either do not need treatment or cannot afford it.', []); return; }
      p.money -= 40; p.health = Math.min(p.maxHealth, p.health + 35); self.save(); self.show('First aid', 'Health restored by up to 35.', []);
    }]);
    this.show(role, (person.conversations > 1 ? 'Good to see you again. ' : '') + (lines[role] || ('Welcome to ' + room.name + '. We could use a careful pair of hands. Finish a shift and I will tell you what I know.')), options);
  };
  Life.prototype.fixed = function (dt) {
    if (this.open || this.game.uiBlocking) return;
    this.scan -= dt; if (this.scan > 0) return; this.scan = .12;
    var g = this.game, player = g.player; this.near = null;
    if (player.dead || player.mode !== 'foot' || g.interiors.fadeDir) return;
    if (this.room) {
      for (var ri = 1; ri < this.people.length; ri++) {
        var resident = this.people[ri];
        if (M.dist2(player.pos.x, player.pos.z, resident.x, resident.z) < 9) continue;
        resident.walkPhase += .12 * .3;
        var targetX = resident.anchorX + Math.sin(resident.walkPhase) * .7;
        var targetZ = resident.anchorZ + Math.cos(resident.walkPhase) * .7;
        var resolved = {};
        if (g.world.resolveCircle(targetX, targetZ, .35, .2, 1.8, resolved)) { targetX = resolved.x; targetZ = resolved.z; }
        resident.x = targetX; resident.z = targetZ;
      }
    }
    var list = this.room ? this.people : g.peds.list, best = 2.1 * 2.1;
    for (var i = 0; i < list.length; i++) {
      var p = list[i]; if (p.dead || p.state === 'flee' || Math.abs(player.pos.y - p.y) > 1.3) continue;
      var dd = M.dist2(player.pos.x, player.pos.z, p.x, p.z);
      if (dd < best) { best = dd; this.near = p; }
    }
  };
  Life.prototype.render = function (dt) {
    if (!this.room) return;
    var player = this.game.player;
    this.people.forEach(function (p) { p.char.setPos(p.x, p.y, p.z, Math.atan2(player.pos.z - p.z, player.pos.x - p.x)); p.char.animate(dt, 0, {}); });
  };
  // Hundreds of small objects, baked into one vertex-colored mesh per room.
  Life.decorate = function (interiors, room) {
    var qb = new SB.QB(), rng = M.rng(80001 + room.index), ox = room.x, oz = room.z;
    function box(x, y, z, w, h, d, color) { qb.setColor(color); qb.box(ox+x, y, oz+z, ox+x+w, y+h, oz+z+d, 1, 1, 1, {}); }
    for (var floor = 0; floor < room.levels; floor++) {
      var base = floor * room.levelHeight;
      // Wall-mounted shelving keeps all exits, stairs and furniture aisles clear.
      for (var shelf = 0; shelf < 3; shelf++) {
        var y = base + 1.65 + shelf * .48, z = -room.hd + .09;
        box(-room.hw+.7, y, z, room.hw*2-1.4, .055, .26, 0x6f5842);
        for (var x = -room.hw+1; x < room.hw-1; x += .36) {
          var medical = room.service === 'clinic', food = room.service === 'store' || room.service === 'diner';
          var h = medical ? .18 : rng.range(.16,.34), w = food ? .17 : .09;
          var color = medical ? 0xe4eeee : [0xc58251,0x629194,0xd5bd80,0x8f5b6b,0x50667f][Math.floor(rng()*5)];
          box(x,y+.055,z+.025,w,h,.16,color);
          box(x,y+.1,z+.19,w,.025,.006,0xeee6cc);
        }
      }
      // Framed prints, outlet plates, skirting, ventilation slats and ceiling beams.
      for (var side = -1; side <= 1; side += 2) {
        var wx = side < 0 ? -room.hw+.025 : room.hw-.1;
        for (var zz = -room.hd+2; zz < room.hd-2; zz += 3.2) {
          box(wx,base+1.7,zz,.075,.9,1.3,0x403a36);
          box(wx+(side<0?.076:-.01),base+1.78,zz+.08,.012,.72,1.14,0x719da3);
          box(wx,base+.35,zz,.08,.15,.12,0xdbd5c7);
        }
      }
      for(var slat=0;slat<8;slat++) box(-.5+slat*.13,base+room.levelHeight-.12,-1,.06,.04,1,0x252b31);
    }
    var service = room.service, ez = -room.hd + .38;
    for (var station = 0; station < 3; station++) {
      var ex = -room.hw + 1.5 + station * (room.hw - 1.5);
      if (['office','bank','hotel','safehouse'].indexOf(service) >= 0) {
        box(ex,1.15,ez,.7,.48,.08,0x202933);
        box(ex+.04,1.19,ez+.081,.62,.4,.008,0x568d9e);
        for(var line=0;line<5;line++) box(ex+.08,1.23+line*.055,ez+.09,.35+line*.03,.014,.008,0xbce9df);
      } else if (['store','diner','clinic'].indexOf(service) >= 0) {
        box(ex,1.15,ez,.55,.45,.3,0xd5dedb);
        box(ex+.07,1.21,ez+.301,.4,.3,.01,service==='clinic'?0x77b8aa:0x35444b);
        box(ex+.45,1.27,ez+.32,.035,.12,.02,0xefce78);
      } else {
        box(ex,1.15,ez,.55,.44,.25,0x31383e);
        for(var knob=0;knob<4;knob++) box(ex+.05+knob*.11,1.2,ez+.26,.055,.055,.035,0xb8ae8b);
        box(ex+.05,1.35,ez+.26,.44,.06,.01,0x7ec8b0);
      }
    }
    // A wall tablet marks the playable challenge without obstructing the aisle.
    var consoleX = room.hw - 2.4, consoleZ = room.hd - .14;
    box(consoleX, 1.15, consoleZ, .85, .6, .09, 0x182934);
    box(consoleX+.05, 1.21, consoleZ-.012, .75, .48, .01, 0x3f8e84);
    for (var pad=0;pad<4;pad++) box(consoleX+.11+(pad%2)*.32, 1.28+Math.floor(pad/2)*.18, consoleZ-.025, .22, .12, .01, 0xa6efc9);
    var mat = Life.detailMaterial || (Life.detailMaterial = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:.78 }));
    room.group.add(qb.mesh(mat,false,true)); room.detailVertices = qb.count;
    interiors.addHotspot(room, room.spawn.x+.8, room.spawn.z-1, 'Read local investigation journal', 'journal', 0);
    interiors.addHotspot(room, room.spawn.x-.8, room.spawn.z-1, 'Local work board', 'localwork', 0);
    interiors.addHotspot(room, ox+consoleX+.4, oz+consoleZ-.65, 'Play the venue challenge', 'pastime', 0);
  };
  SB.CityLife = Life; SB.CityLifeJobs = JOBS; SB.CityLifeStory = STORY;
})(window.SB = window.SB || {});
