// 36-rhythm.js - the city's daily rhythm.
//
// The world ran the same crowd at four in the morning as at nine: traffic and
// pedestrian density were fixed numbers, and `density` existed only as an
// on/off switch for walking into a building. A city that empties in the small
// hours, jams at rush hour and changes what is on the road at night is the
// single largest difference between a populated map and a living one.
(function (SB) {
  'use strict';

  var M = SB.M;

  // One value per hour, read as a loop and interpolated between. Kept as flat
  // tables because the shape of a day is data, not an equation - the evening
  // peak is not the morning peak mirrored, and midday is not the average of
  // the two.
  var TRAFFIC_BY_HOUR = [
    0.30, 0.22, 0.16, 0.13, 0.14, 0.25,   // 00-05  the city is asleep
    0.50, 0.85, 1.00, 0.88,               // 06-09  morning rush
    0.70, 0.68, 0.75, 0.72, 0.68, 0.72,   // 10-15  steady daytime
    0.88, 1.00, 0.95, 0.78,               // 16-19  evening rush
    0.62, 0.55, 0.48, 0.38                // 20-23  winding down
  ];

  // People clear the streets harder than cars do, and later.
  var PEDS_BY_HOUR = [
    0.22, 0.14, 0.09, 0.06, 0.07, 0.16,
    0.40, 0.75, 0.95, 0.85,
    0.80, 0.85, 1.00, 0.95, 0.85, 0.85,
    0.92, 1.00, 0.90, 0.80,
    0.62, 0.52, 0.42, 0.30
  ];

  // Parked cars run the other way: when nobody is driving, everybody is
  // parked. This is what stops a 3 a.m. city from looking abandoned rather
  // than asleep.
  var PARKED_BY_HOUR = [
    1.00, 1.00, 1.00, 1.00, 1.00, 0.95,
    0.86, 0.72, 0.60, 0.58,
    0.62, 0.64, 0.66, 0.64, 0.62, 0.62,
    0.66, 0.72, 0.82, 0.90,
    0.95, 1.00, 1.00, 1.00
  ];

  // What is actually on the road changes with the hour. Multipliers against
  // the base traffic mix, normalised by the picker.
  var MIX = {
    // 22:00-05:00 - cabs, deliveries starting, and people with fast cars
    night: { taxi: 2.8, truck: 1.5, supercar: 1.5, sports: 1.3, muscle: 1.3,
             compact: 0.7, hatchback: 0.7, van: 0.6, suv: 0.8 },
    // 05:00-07:00 - the city is supplied before it wakes up
    early: { truck: 2.6, van: 2.2, taxi: 1.4, pickup: 1.6,
             supercar: 0.3, sports: 0.5, muscle: 0.5 },
    // 07:00-09:00 and 16:00-19:00 - commuters
    rush:  { sedan: 1.3, compact: 1.3, hatchback: 1.25, suv: 1.15, taxi: 1.2,
             truck: 0.5, supercar: 0.5, rally: 0.6 },
    day:   {}
  };

  function periodFor(hour) {
    if (hour >= 22 || hour < 5) return 'night';
    if (hour < 7) return 'early';
    if ((hour >= 7 && hour < 10) || (hour >= 16 && hour < 19)) return 'rush';
    return 'day';
  }

  // Read a 24-slot table at a fractional hour, wrapping midnight.
  function sample(table, hour) {
    var h = ((hour % 24) + 24) % 24;
    var i = Math.floor(h);
    var f = h - i;
    return M.lerp(table[i], table[(i + 1) % 24], f);
  }

  function Rhythm(game) {
    this.game = game;
    this.traffic = 1;
    this.peds = 1;
    this.parked = 1;
    this.period = 'day';
    this.baseMaxParked = game.traffic ? game.traffic.maxParked : 0;
    // Re-read on the fixed step but only act a few times a second: nothing
    // here changes fast enough to be worth doing at 60 Hz.
    this.timer = 0;
    this.apply(true);
  }

  Rhythm.prototype.hour = function () {
    return this.game.sky ? this.game.sky.hour : 12;
  };

  // Weather keeps people indoors. Cars care much less than pedestrians do.
  Rhythm.prototype.weatherFactor = function () {
    var w = this.game.weather;
    if (!w) return { traffic: 1, peds: 1 };
    if (w.mode === 'rain') return { traffic: 0.92, peds: 0.55 };
    if (w.mode === 'snow') return { traffic: 0.80, peds: 0.40 };
    return { traffic: 1, peds: 1 };
  };

  Rhythm.prototype.apply = function (instant) {
    var g = this.game;
    var h = this.hour();
    var wx = this.weatherFactor();

    var wantTraffic = M.clamp(sample(TRAFFIC_BY_HOUR, h) * wx.traffic, 0.06, 1);
    var wantPeds = M.clamp(sample(PEDS_BY_HOUR, h) * wx.peds, 0.03, 1);
    var wantParked = M.clamp(sample(PARKED_BY_HOUR, h), 0.4, 1);

    // Ease toward the target so a weather change or a slept-through hour does
    // not make the street population jump between one frame and the next.
    var rate = instant ? 1 : 0.10;
    this.traffic = M.lerp(this.traffic, wantTraffic, rate);
    this.peds = M.lerp(this.peds, wantPeds, rate);
    this.parked = M.lerp(this.parked, wantParked, rate);

    var period = periodFor(h);
    if (period !== this.period || instant) {
      this.period = period;
      if (g.traffic) g.traffic.typeBias = MIX[period];
    }

    if (g.traffic) {
      g.traffic.rhythm = this.traffic;
      // maxParked is a hard cap the quality tier owns, so scale against the
      // tier's value rather than writing a number back into it and losing the
      // original.
      if (!this.baseMaxParked) this.baseMaxParked = g.traffic.maxParked;
      g.traffic.maxParked = Math.round(this.baseMaxParked * this.parked);
    }
    if (g.peds) g.peds.rhythm = this.peds;
  };

  Rhythm.prototype.fixed = function (dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    this.apply(false);
  };

  // A quality-tier change re-reads the budgets, so the rhythm has to forget
  // the cap it captured or it will keep scaling against the old tier's value.
  Rhythm.prototype.rebase = function () {
    this.baseMaxParked = 0;
    this.apply(true);
  };

  // Used by the HUD: a short description of what the city is doing.
  Rhythm.prototype.label = function () {
    var h = Math.floor(this.hour());
    if (this.period === 'night') return h < 5 ? 'QUIET' : 'NIGHT';
    if (this.period === 'early') return 'EARLY';
    if (this.period === 'rush') return 'RUSH HOUR';
    return 'DAYTIME';
  };

  Rhythm.TRAFFIC_BY_HOUR = TRAFFIC_BY_HOUR;
  Rhythm.PEDS_BY_HOUR = PEDS_BY_HOUR;
  Rhythm.PARKED_BY_HOUR = PARKED_BY_HOUR;
  Rhythm.MIX = MIX;
  Rhythm.periodFor = periodFor;
  Rhythm.sample = sample;
  SB.Rhythm = Rhythm;

})(window.SB = window.SB || {});
