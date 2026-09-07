// Guided walks use an existing pedestrian and a short trail of player footsteps.
(function (SB) {
  'use strict';
  var M = SB.M;
  function Neighbors(game) {
    this.game = game; this.active = null; this.completed = 0; this.scan = 0;
    var self = this;
    ['busted', 'playerRespawned', 'interiorEntered', 'vehicleEntered'].forEach(function (event) {
      game.bus.on(event, function () { self.cancel('Walk cancelled. Your neighbor will make their own way.'); });
    });
  }
  Neighbors.prototype.offer = function (person) {
    var g = this.game, p = g.player;
    if (!person || person.role !== 'Tourist' || person.helped || person.dead || person.state === 'flee' ||
      !g.peds.list.includes(person) || g.interiors.current || p.mode !== 'foot' || p.dead ||
      M.dist2(p.pos.x,p.pos.z,person.x,person.z) > 4*4 || Math.abs(p.pos.y-person.y)>2) return null;
    var doors = g.interiors.doors.filter(function (d) {
      var distance = M.dist(p.pos.x,p.pos.z,d.x,d.z);
      return distance>65 && distance<260 && Math.abs((d.y||0)-p.pos.y)<8;
    });
    if (!doors.length) return null;
    var door = doors[(this.completed*7)%doors.length];
    return { person: person, door: door, reward: Math.round(180+M.dist(p.pos.x,p.pos.z,door.x,door.z)) };
  };
  Neighbors.prototype.accept = function (offer) {
    var g = this.game;
    if (this.active || !offer || !this.offer(offer.person) || !g.interiors.doors.includes(offer.door) ||
      (g.activities && g.activities.active) || (g.deliveries && g.deliveries.active) || (g.missions && g.missions.active)) return false;
    this.active = { person: offer.person, generation: offer.person.generation || 0, door: offer.door,
      reward: offer.reward, trail: [], last: { x:g.player.pos.x,z:g.player.pos.z }, far:0 };
    offer.person.followTarget = this.active.last; this.track(); return true;
  };
  Neighbors.prototype.track = function () {
    if (!this.active) return;
    var d = this.active.door;
    this.game.hud.setDestination({id:'neighbor',name:'Walk together · '+d.name,x:d.x,z:d.z,color:'#ffdca6',icon:'♧',kind:'waypoint'});
  };
  Neighbors.prototype.release = function () {
    var a = this.active; if (!a) return;
    this.active = null;
    var p = a.person, manager = this.game.peds;
    if ((p.generation||0) === a.generation) {
      p.followTarget = null;
      // Resume the nearest sidewalk segment, rather than an old distant target.
      if (manager.nearestBlock && !p.dead) {
        var block = manager.nearestBlock(p.x,p.z), loop = SB.Roads.sidewalkLoop(block,2.2);
        if (loop && loop.length>2) {
          var best=Infinity, segment=0, t=0;
          loop.forEach(function (v,i) {
            var w=loop[(i+1)%loop.length],dx=w.x-v.x,dz=w.z-v.z;
            var u=M.clamp(((p.x-v.x)*dx+(p.z-v.z)*dz)/(dx*dx+dz*dz||1),.01,.99);
            var dd=M.dist2(p.x,p.z,v.x+u*dx,v.z+u*dz);
            if(dd<best){best=dd;segment=i;t=u;}
          });
          p.block=block;p.loop=loop;p.seg=segment;p.t=t;
        }
      }
    }
    var h=this.game.hud;
    if(h.destination && h.destination.id==='neighbor'){h.destination=null;if(h.navigation)h.navigation.points=[];}
    if(this.panel)this.panel.hidden=true;
  };
  Neighbors.prototype.cancel = function (message) {
    if (!this.active) return false;
    this.release(); if(message)this.game.hud.toast(message); return true;
  };
  Neighbors.prototype.fixed = function (dt) {
    var a=this.active;if(!a)return;var g=this.game,p=g.player,n=a.person;
    if(p.dead || p.mode!=='foot' || g.interiors.current || n.dead || n.state==='flee' ||
      (n.generation||0)!==a.generation || !g.peds.list.includes(n)) {this.cancel('Your neighbor cannot continue the walk.');return;}
    var distance=M.dist(p.pos.x,p.pos.z,n.x,n.z);
    a.far=distance>40 || Math.abs(p.pos.y-n.y)>4 ? a.far+dt : 0;
    if(a.far>8) {this.cancel('You left your neighbor behind. Stay closer on the next walk.');return;}
    if(M.dist2(a.last.x,a.last.z,p.pos.x,p.pos.z)>2.25) {
      a.last={x:p.pos.x,z:p.pos.z};a.trail.push(a.last);if(a.trail.length>96)a.trail.shift();
    }
    while(a.trail.length && M.dist2(n.x,n.z,a.trail[0].x,a.trail[0].z)<1.2*1.2)a.trail.shift();
    n.followTarget=a.trail[0] || (distance>2.3 ? p.pos : {x:n.x,z:n.z});
    if(M.dist2(p.pos.x,p.pos.z,a.door.x,a.door.z)<4*4 && M.dist2(n.x,n.z,a.door.x,a.door.z)<6*6 &&
      Math.abs(p.pos.y-(a.door.y||0))<3 && Math.abs(n.y-(a.door.y||0))<3) {
      n.helped=true;g.player.money+=a.reward;this.completed++;
      g.cityLife.reputation=Math.min(100,g.cityLife.reputation+5);
      var message='Arrived together · +$'+a.reward+' · Local trust +5. Thank you for showing me the way!';
      this.release();if(g.saveGame)g.saveGame.save();g.hud.toast(message);
    }
  };
  Neighbors.prototype.menu = function (person) {
    var self=this,g=this.game,life=g.cityLife,a=this.active;
    if(a) {life.show('Walking together','Destination: '+a.door.name+'\nWalk at a steady pace and keep your neighbor close. Wait outside the entrance together to collect $'+a.reward+' and 5 local trust.',
      [['Track destination',function(){self.track();life.close();}],['Cancel walk',function(){self.cancel('Walk cancelled.');life.close();}]]);return;}
    var offer=this.offer(person);
    if(offer) {life.show('Could you show me the way?','I am looking for '+offer.door.name+'. Walk there with me and I will pay you $'+offer.reward+'.\n\nStay on foot and use clear sidewalks. I will follow your path and wait for approaching traffic. Finish other routes first.',
      [['Walk together',function(){if(self.accept(offer)){life.close();g.hud.toast('Your neighbor is following. Walk; avoid sprinting too far ahead.');}else life.show('Finish your current route','Complete or cancel your current race, delivery or mission first.',[]);}]]);return;}
    life.show('Meet the neighbors','Talk to a Tourist on the street and ask “Need a guide?” to start a paid walk. They follow your footsteps, watch traffic and build local trust when you arrive together.\n\nWalks completed: '+this.completed,
      [['Find a tourist nearby',function(){
        var target=null,dist=Infinity;
        g.peds.list.forEach(function(n){if(n.role!=='Tourist'||n.helped||n.dead||n.state==='flee')return;var dd=M.dist2(n.x,n.z,g.player.pos.x,g.player.pos.z);if(dd<dist){dist=dd;target=n;}});
        life.close();if(target)g.hud.setDestination({id:'meet-neighbor',name:'Tourist · last seen here',x:target.x,z:target.z,color:'#ffdca6',icon:'♧',kind:'waypoint'});
        g.hud.toast(target?'Meet the tourist near the marked location. They may keep walking.':'No tourist nearby yet. Explore another block.');
      }]]);
  };
  Neighbors.prototype.render = function (dt) {
    var g=this.game,a=this.active;
    if(!a){if(this.panel)this.panel.hidden=true;return;}
    if(!this.panel){this.panel=document.createElement('div');this.panel.className='neighbor-status';this.panel.style.cssText='position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 78px);transform:translateX(-50%);max-width:55vw;padding:8px 12px;background:#101c25e6;border:1px solid #b69466;color:#ffe4be;border-radius:10px;font:12px/1.4 system-ui;pointer-events:none;z-index:15;text-align:center';document.body.appendChild(this.panel);}
    this.panel.hidden=g.paused || g.hud.mapOpen || !!g.hud.shop;
    this.scan-=dt;if(this.scan>0)return;this.scan=.2;
    var distance=Math.round(M.dist(g.player.pos.x,g.player.pos.z,a.person.x,a.person.z));
    var text=(distance>12?'Wait for your neighbor':'Walking together')+' · '+distance+'m away · '+a.door.name;
    if(this.panel.textContent!==text)this.panel.textContent=text;
  };
  Neighbors.prototype.snapshot=function(){return {completed:this.completed};};
  Neighbors.prototype.restore=function(data){this.completed=data&&Number.isInteger(data.completed)?M.clamp(data.completed,0,100000):0;};
  SB.Neighbors=Neighbors;
})(window.SB=window.SB||{});
