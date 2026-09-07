// Four playable interior challenges. The world pauses; only this small UI ticks.
(function (SB) {
  'use strict';
  var M = SB.M;
  var THEMES = {
    diner: ['orders', 'Dinner rush', ['COFFEE', 'SOUP', 'SALAD', 'TOAST']],
    store: ['orders', 'Stockroom sprint', ['DAIRY', 'FRUIT', 'BREAD', 'DRINKS']],
    warehouse: ['orders', 'Dispatch desk', ['CRATE A', 'CRATE B', 'CRATE C', 'CRATE D']],
    clinic: ['orders', 'Supply sorting', ['MASKS', 'GLOVES', 'GAUZE', 'TAPE']],
    club: ['timing', 'Soundcheck', ['LOCK THE BEAT']],
    gunshop: ['timing', 'Precision trainer', ['LOCK TARGET']],
    office: ['circuit', 'Circuit breaker', []], bank: ['circuit', 'Restore the terminal', []],
    hotel: ['memory', 'Concierge recall', ['ROOM 1', 'ROOM 2', 'ROOM 3', 'ROOM 4']],
    safehouse: ['memory', 'Radio frequencies', ['CH 1', 'CH 2', 'CH 3', 'CH 4']]
  };
  function Session(kind, seed) {
    this.kind = kind; this.rng = M.rng(seed); this.elapsed = 0; this.limit = kind === 'orders' ? 75 : 100;
    this.done = false; this.won = false; this.score = 0; this.mistakes = 0; this.moves = 0; this.round = 0; this.index = 0;
    this.board = Array(9).fill(false); this.phase = 'watch'; this.phaseTime = 0; this.sequence = [];
    this.needle = .5; this.target = .5; this.points = 0; this.lastHit = -1;
    if (kind === 'circuit') {
      for (var i = 0; i < 7; i++) this.flip(this.rng.int(0,8));
      if (this.board.every(function (v) { return !v; })) this.flip(4);
    } else if (kind === 'memory') {
      for (var j = 0; j < 6; j++) this.sequence.push(this.rng.int(0,3));
    } else if (kind === 'orders') this.nextOrder();
    else if (kind === 'timing') this.target = this.rng.range(.25,.75);
  }
  Session.prototype.flip = function (n) {
    var row = Math.floor(n/3), col = n%3, self = this;
    [[row,col],[row-1,col],[row+1,col],[row,col-1],[row,col+1]].forEach(function (p) {
      if (p[0]>=0 && p[0]<3 && p[1]>=0 && p[1]<3) { var at=p[0]*3+p[1]; self.board[at]=!self.board[at]; }
    });
  };
  Session.prototype.nextOrder = function () {
    this.sequence = []; this.index = 0;
    for(var i=0;i<3+(this.round%2);i++) this.sequence.push(this.rng.int(0,3));
  };
  Session.prototype.finish = function (won) {
    if (this.done) return;
    this.done = true; this.won = !!won;
    if (!won) { this.score = 0; return; }
    this.score = Math.round(M.clamp(this.kind === 'timing' ? this.points/8*1000 :
      1000-this.elapsed*2-this.mistakes*60-this.moves*8, 0, 1000));
  };
  Session.prototype.step = function (dt) {
    if (this.done || !Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt; this.phaseTime += dt;
    if (this.elapsed >= this.limit) { this.finish(false); return; }
    this.needle = (Math.sin(this.elapsed*2.5)+1)/2;
    if (this.kind === 'memory' && this.phase === 'watch' && this.phaseTime >= (this.round+2)*.85+.6) {
      this.phase = 'repeat'; this.index = 0;
    }
  };
  Session.prototype.hit = function (n) {
    if(this.done || !Number.isInteger(n)) return false;
    if(this.kind === 'circuit') {
      if(n<0 || n>8) return false;
      this.flip(n); this.moves++;
      if(this.board.every(function (v) { return !v; })) this.finish(true);
    } else if(this.kind === 'memory') {
      if(n<0 || n>3 || this.phase !== 'repeat') return false;
      if(n!==this.sequence[this.index]) { this.mistakes++; this.index=0; this.phase='watch'; this.phaseTime=0; if(this.mistakes>=3) this.finish(false); }
      else if(++this.index===this.round+2) {
        if(++this.round===5) this.finish(true);
        else { this.phase='watch'; this.phaseTime=0; this.index=0; }
      }
    } else if(this.kind === 'orders') {
      if(n<0 || n>3) return false;
      if(n!==this.sequence[this.index]) { this.mistakes++; this.elapsed+=3; this.index=0; if(this.elapsed>=this.limit) this.finish(false); }
      else if(++this.index===this.sequence.length) { if(++this.round===6) this.finish(true); else this.nextOrder(); }
    } else if(this.kind === 'timing') {
      if(n!==0 || this.elapsed-this.lastHit < .35) return false;
      this.lastHit=this.elapsed;
      this.points += Math.max(0,1-Math.abs(this.needle-this.target)/.22);
      if(++this.round===8) this.finish(true); else this.target=this.rng.range(.25,.75);
    }
    return true;
  };
  function Pastimes(game) { this.game=game; this.best={}; this.run=null; this.attempt=0; this.frame=null; }
  Pastimes.prototype.theme = function(room) { return THEMES[room.service] || THEMES.office; };
  Pastimes.prototype.menu = function() {
    var self=this, g=this.game;
    if(g.interiors.current) { this.open(g.interiors.current); return; }
    var choices=['diner','hotel','office','club'].map(function(service){
      return [THEMES[service][1],function(){
        var best=null, distance=Infinity;
        g.interiors.doors.forEach(function(d){
          if(d.room.service!==service)return;
          var dd=M.dist2(d.x,d.z,g.player.pos.x,g.player.pos.z);
          if(dd<distance){distance=dd;best=d;}
        });
        if(best) { g.hud.setDestination({id:'pastime',name:THEMES[service][1]+' · '+best.name,x:best.x,z:best.z,color:'#acb5ff',icon:'▦',kind:'waypoint'});g.cityLife.close();g.hud.toast('Enter the marked building, then talk to staff or use GO → After hours.'); }
        else g.cityLife.show('No venue nearby','Try another activity.',[['Choose an activity',function(){self.menu();}]]);
      }];
    });
    g.cityLife.show('After hours','Pick a challenge to find the nearest venue. Enter the building and talk to someone, use its green wall tablet, or open GO / Explore → After hours.\n\nEvery venue has a personal best. Improving it pays up to $200 per address, plus local shift and story rewards.',choices);
  };
  Pastimes.prototype.stop = function() {
    if(this.frame!==null) cancelAnimationFrame(this.frame);
    this.frame=null; this.run=null;
  };
  Pastimes.prototype.award = function(room, session) {
    if(!session.done || !session.won || session.paid) return 0;
    session.paid=true;
    var key=room.index+':'+session.kind, previous=this.best[key]||0;
    var payout=Math.floor(Math.max(0,session.score-previous)/5);
    this.best[key]=Math.max(previous,session.score);
    this.game.player.money+=payout;
    if(this.game.saveGame) this.game.saveGame.save();
    return payout;
  };
  Pastimes.prototype.open = function(room) {
    if(!room || this.game.interiors.current!==room) return false;
    var self=this, life=this.game.cityLife, theme=this.theme(room);
    var instructions={circuit:'Turn every tile dark. A tap flips that tile and its horizontal/vertical neighbors.',
      memory:'Watch the numbered pads light up, then repeat the sequence. Complete five rounds; three mistakes end the game.',
      orders:'Tap each item in the ticket from left to right. Finish six orders. A wrong item resets that ticket and costs three seconds.',
      timing:'Tap when the marker crosses the green target zone. You get eight attempts; closer hits earn more points.'};
    life.show(theme[1], instructions[theme[0]]+'\nBeat your personal best to earn money. A score of 650+ also completes this venue’s local shift.', []);
    var session=new Session(theme[0],48271+room.index*997+(++this.attempt)*31); this.run=session;
    life.panel.classList.add('pastime-active');
    life.onViewClose=function(){self.stop();life.panel.classList.remove('pastime-active');};
    var arena=document.createElement('section'); arena.className='pastime'; arena.setAttribute('aria-label',theme[1]);
    var status=document.createElement('p'); status.setAttribute('role','status'); arena.appendChild(status);
    var visual=document.createElement('div'); visual.className='pastime-visual'; arena.appendChild(visual);
    var grid=document.createElement('div'); grid.className='pastime-grid '+(theme[0]==='circuit'?'nine':''); arena.appendChild(grid);
    if(!document.getElementById('pastime-style')) {
      var style=document.createElement('style');style.id='pastime-style';
      style.textContent='.life-dialog.pastime-active{max-height:94dvh;padding:14px}.pastime-active>small{display:none}.pastime-active h2{font-size:20px;margin:0 0 8px}.pastime-active details{font-size:14px}.pastime-active summary{cursor:pointer;min-height:44px;display:flex;align-items:center;color:#bce9df}.pastime{border-top:1px solid #537482;margin-top:8px;padding-top:4px}.pastime>p{margin:4px 0}.pastime-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.pastime-grid.nine{grid-template-columns:repeat(3,minmax(0,1fr))}.pastime-grid button{margin:0!important;min-height:48px!important;padding:8px!important;text-align:center!important;touch-action:manipulation}.pastime-grid button.lit{background:#78dfaa!important;color:#08241d!important}.pastime-grid button:disabled{opacity:.8}.pastime-visual{position:relative;min-height:42px;margin:8px 0;background:#09151d;border-radius:8px;padding:8px;box-sizing:border-box}.pastime-needle{position:absolute;top:0;bottom:0;width:4px;background:#fff;transform:translateX(-2px)}.pastime-target{position:absolute;top:0;bottom:0;background:#3c9864;opacity:.8}';
      document.head.appendChild(style);
    }
    var buttons=[], total=theme[0]==='circuit'?9:theme[0]==='timing'?1:4;
    for(var i=0;i<total;i++) (function(n){
      var button=document.createElement('button'); button.type='button';
      button.textContent=theme[0]==='circuit'?String(n+1):theme[2][n];
      button.onclick=function(){ if(self.run===session) { session.hit(n); paint(); } };
      grid.appendChild(button);buttons.push(button);
    })(i);
    var target,needle;
    if(theme[0]==='timing') {
      target=document.createElement('span');target.className='pastime-target';visual.appendChild(target);
      needle=document.createElement('span');needle.className='pastime-needle';visual.appendChild(needle);
    }
    var rules=life.panel.querySelector('p'), leave=life.panel.querySelector('button');
    var help=document.createElement('details'), summary=document.createElement('summary');summary.textContent='How to play';
    help.appendChild(summary);help.appendChild(rules);life.panel.appendChild(help);
    life.panel.appendChild(arena);life.panel.appendChild(leave);leave.textContent='Leave challenge';
    arena.tabIndex=-1;
    // Start explicitly: memory pads must be visible before the first sequence.
    var playing=false;
    var start=document.createElement('button');start.type='button';start.textContent='Start challenge';
    start.onclick=function(){playing=true;start.hidden=true;last=performance.now();arena.focus();if(arena.scrollIntoView)arena.scrollIntoView({block:'start'});};
    arena.appendChild(start);start.focus();
    var previousStatus='';
    function paint() {
      if(self.run!==session) return;
      if(session.done) { self.complete(room,session,theme); return; }
      var remaining=Math.max(0,Math.ceil(session.limit-session.elapsed));
      var statusText=remaining+'s · '+(theme[0]==='circuit'?session.moves+' moves':theme[0]==='timing'?session.round+'/8 hits':session.round+'/'+(theme[0]==='orders'?6:5)+' rounds · '+session.mistakes+' mistakes');
      if(statusText!==previousStatus){status.textContent=statusText;previousStatus=statusText;}
      buttons.forEach(function(b,n){
        var lit=theme[0]==='circuit'?session.board[n]:theme[0]==='memory' && session.phase==='watch' && Math.floor(session.phaseTime/.85)<session.round+2 && session.phaseTime%.85<.6 && session.sequence[Math.floor(session.phaseTime/.85)]===n;
        b.classList.toggle('lit',!!lit); b.setAttribute('aria-pressed',String(!!lit));
        b.disabled=!playing || (theme[0]==='memory' && session.phase==='watch');
      });
      if(theme[0]==='timing') { target.style.left=(session.target-.09)*100+'%';target.style.width='18%';needle.style.left=session.needle*100+'%'; }
      else if(theme[0]==='orders') visual.textContent=session.sequence.map(function(n,i){return (i<session.index?'✓ ':'')+theme[2][n];}).join(' → ');
      else if(theme[0]==='memory') visual.textContent=session.phase==='watch'?'Watch the sequence · '+(session.round+2)+' pads':'Your turn · '+session.index+' / '+(session.round+2);
      else visual.textContent=session.board.filter(Boolean).length+' tiles still lit';
    }
    var last=performance.now(), budget=0;
    function frame(now) {
      if(self.run!==session || !life.open) return;
      var dt=Math.min(.1,Math.max(0,(now-last)/1000));last=now;
      if(!document.hidden) { if(playing)session.step(dt);budget+=dt;if(budget>=1/30){budget=0;paint();} }
      if(self.run===session) self.frame=requestAnimationFrame(frame);
    }
    paint(); this.frame=requestAnimationFrame(frame); return true;
  };
  Pastimes.prototype.complete = function(room,session,theme) {
    var self=this, life=this.game.cityLife, pay=this.award(room,session);
    var text=session.won?'Score: '+session.score+'/1000 · Personal-best reward: $'+pay+'.':'Time to try another approach. No money was charged.';
    var result;
    if(session.won && session.score>=650) { result=life.finishJob(room,life.job(room)[4]);text+='\n\n'+result.text; }
    var actions=[['Play again',function(){self.open(room);}]];
    if(result && result.finale) actions=[['Publish with Mara',function(){life.chooseEnding('published');life.journal();}],['Choose an independent audit',function(){life.chooseEnding('audited');life.journal();}]];
    else actions.push(['Open investigation journal',function(){life.journal();}]);
    life.show(theme[1]+' · '+(session.won?'Complete':'Try again'),text,actions);
  };
  Pastimes.prototype.snapshot=function(){return this.best;};
  Pastimes.prototype.restore=function(data){
    this.best={};if(!data || typeof data!=='object')return;var self=this;
    this.game.interiors.rooms.forEach(function(room){var key=room.index+':'+self.theme(room)[0],score=data[key];if(Number.isInteger(score)&&score>=0&&score<=1000)self.best[key]=score;});
  };
  SB.PastimeSession=Session;SB.Pastimes=Pastimes;
})(window.SB=window.SB||{});
