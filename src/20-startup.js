// 20-startup.js - wires the title card, the loading bar and the pause states
// to the game. Called from the page shell once every module is defined.
(function (SB) {
  'use strict';

  // The artifact host owns the document head, so the viewport meta is adjusted
  // here rather than declared. Without this a phone renders the page at a
  // desktop width and the controls land off screen.
  function prepareViewport() {
    var vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement('meta');
      vp.setAttribute('name', 'viewport');
      document.head.appendChild(vp);
    }
    vp.setAttribute('content',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');

    // iOS pinch-zoom and double-tap-zoom over the canvas.
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (n) {
      document.addEventListener(n, function (e) { e.preventDefault(); }, { passive: false });
    });
    var lastTap = 0;
    document.addEventListener('touchend', function (e) {
      // Native menu controls need normal taps, including quick consecutive
      // choices. Zoom suppression applies to the play surface only.
      if (e.target && e.target.closest && e.target.closest('button,input,select,#explorePanel, .life-dialog')) return;
      var now = Date.now();
      if (now - lastTap < 320) e.preventDefault();
      lastTap = now;
    }, { passive: false });
    document.addEventListener('touchmove', function (e) {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });
  }

  function goFullscreen() {
    var el = document.documentElement;
    var req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) {
      try {
        var p = req.call(el);
        if (p && p.catch) p.catch(function () { });
      } catch (e) { /* iPhone Safari refuses; the game still works */ }
    }
    if (screen.orientation && screen.orientation.lock) {
      try {
        var q = screen.orientation.lock('landscape');
        if (q && q.catch) q.catch(function () { });
      } catch (e) { /* not supported on iOS */ }
    }
  }

  SB.startup = function () {
    prepareViewport();
    var bar = document.getElementById('barFill');
    var msg = document.getElementById('bootMsg');
    var boot = document.getElementById('boot');
    var startBtn = document.getElementById('startBtn');
    var help = document.getElementById('help');
    var paused = document.getElementById('paused');
    var perfBtn = document.getElementById('perfBtn');
    var perf = document.getElementById('performance');
    var perfStatus = document.getElementById('perfStatus');
    var perfStats = document.getElementById('perfStats');
    var perfClose = document.getElementById('perfClose');
    var errEl = document.getElementById('err');
    var continueBtn = document.getElementById('continueBtn');
    var saveInfo = document.getElementById('saveInfo');

    function fail(err) {
      errEl.style.display = 'block';
      var detail = String(err && err.message ? err.message : err);
      var graphics = /WebGL|graphics context/i.test(detail);
      msg.textContent = graphics ? '3D graphics unavailable' : 'Loading interrupted';
      startBtn.disabled = true;
      errEl.textContent = graphics
        ? 'This browser could not start 3D graphics. Open this link directly in Safari or Chrome, close other graphics-heavy tabs, and try again.'
        : 'The city could not finish loading. Check your connection and reload the page.';
      if (/(^|[#,&])dev/.test(location.hash)) errEl.textContent += '\n\n' + (err && err.stack ? err.stack : detail);
      var retry = document.createElement('button');
      retry.type = 'button'; retry.textContent = 'Reload game';
      retry.style.cssText = 'display:block;min-height:48px;margin-top:16px;padding:10px 18px;font:inherit;cursor:pointer';
      retry.addEventListener('click', function () { location.reload(); });
      errEl.appendChild(retry);
    }

    var game = SB.boot(
      function (frac, label) {
        bar.style.width = Math.round(frac * 100) + '%';
        msg.textContent = label;
      },
      function (g) {
        bar.style.width = '100%';
        msg.textContent = 'Ready';
        startBtn.classList.add('on');
        wire(g);
      },
      fail);

    function wire(g) {
      var started = false;
      var perfWasPaused = false;

      var touchMode = !!(SB.Q && SB.Q.touch);

      perfBtn.classList.add('on');
      perfStats.checked = !!(SB.Q && SB.Q.showStats);

      function refreshPerformance() {
        if (!perfStatus) return;
        var s = SB.Q && SB.Q.status ? SB.Q.status(g) : null;
        if (!s || !g.loop) {
          perfStatus.textContent = 'Ready to measure after entering the city';
          return;
        }
        var cap = s.refreshRate ? (s.refreshRate + ' Hz display') : 'detecting display';
        var limit = s.displayLimited ? ' · display-limited' : ' · 100 FPS target';
        perfStatus.textContent = s.fps + ' FPS · ' + cap + limit + ' · ' +
          s.quality + ' · ' + Math.round(s.scale * 100) + '% resolution · ' +
          s.frameMs.toFixed(1) + ' ms · ' + s.renderMs.toFixed(1) + ' ms render · ' +
          s.drawCalls + ' draws';
        var choices = perf.querySelectorAll('[data-quality]');
        for (var i = 0; i < choices.length; i++) {
          choices[i].classList.toggle('selected', choices[i].dataset.quality ===
            (SB.Q.mode === 'auto' ? 'auto' : SB.Q.tier));
        }
      }

      function openPerformance() {
        if (!perf) return;
        if (g.uiBlocking || (g.activities && g.activities.open)) return;
        if (g.started) {
          perfWasPaused = g.paused;
          g.setPaused(true);
        }
        g.uiBlocking = true;
        if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
        perf.classList.add('on');
        refreshPerformance();
      }

      function closePerformance() {
        if (!perf) return;
        perf.classList.remove('on');
        g.uiBlocking = false;
        if (g.started && !perfWasPaused) { g.setPaused(false); g.input.requestLock(); }
      }

      perfBtn.addEventListener('click', openPerformance);
      perfClose.addEventListener('click', closePerformance);
      perf.querySelectorAll('[data-quality]').forEach(function (button) {
        button.addEventListener('click', function () {
          SB.Q.set(button.dataset.quality, true);
          SB.Q.apply(g);
          refreshPerformance();
        });
      });
      perfStats.addEventListener('change', function () {
        SB.Q.showStats = perfStats.checked;
        try { localStorage.setItem('sunsetbay.stats', perfStats.checked ? '1' : '0'); } catch (e) { }
      });
      window.addEventListener('keydown', function (e) {
        if (e.code === 'F2' && started) {
          e.preventDefault();
          if (perf.classList.contains('on')) closePerformance();
          else openPerformance();
        }
      });
      setInterval(refreshPerformance, 250);
      refreshPerformance();

      // A save on disk turns the title card into a choice. Continue restores
      // the run before the loop starts, so the first frame the player sees is
      // already their game rather than a fresh one that then jumps.
      var saved = SB.Save && SB.Save.available ? SB.Save.read() : null;
      if (saved) {
        var sum = SB.Save.summary(saved);
        var chain = (SB.Missions && SB.Missions.CHAIN) ? SB.Missions.CHAIN.length : 8;
        saveInfo.textContent = 'Saved run · rank ' + sum.rank + ' ' + sum.rankName +
          ' · ' + SB.formatMoney(sum.money) + ' · ' + Math.min(sum.missions, chain) + '/' + chain +
          ' jobs · ' + sum.minutes + ' min played';
        continueBtn.classList.add('on');
        startBtn.textContent = 'New game';
        document.querySelector('.boot-actions').classList.add('has-save');
      }

      function begin(restore) {
        if (started) return;
        started = true;
        if (restore && saved) {
          try { SB.Save.apply(g, saved); }
          catch (err) { console.warn('[save] could not restore, starting fresh', err); }
          // The coastal expansion keeps its own half of the run - race
          // records, discoveries, speed-trap bests, looted rooms, deliveries
          // and city life - under a separate key. Restore it on the same
          // choice so the two halves can never disagree about which run the
          // player is in.
          if (g.saveGame) {
            try { g.saveGame.restore(); }
            catch (err2) { console.warn('[save] activity progress did not restore', err2); }
          }
        } else {
          // Starting a new game deliberately drops the old run, otherwise the
          // first autosave silently overwrites it anyway and the player never
          // got the choice. Both halves go.
          if (SB.Save && SB.Save.available) SB.Save.clear();
          if (g.saveGame) g.saveGame.clear();
        }
        if (touchMode) goFullscreen();
        boot.classList.add('gone');
        setTimeout(function () { boot.style.display = 'none'; }, 750);
        g.start();
        if (g.audio) g.audio.resume();
        if (restore && g.hud) g.hud.toast('Run restored', '#8fe0a8');
      }

      startBtn.addEventListener('click', function () { begin(false); });
      startBtn.addEventListener('touchend', function (e) { e.preventDefault(); begin(false); });
      continueBtn.addEventListener('click', function () { begin(true); });
      continueBtn.addEventListener('touchend', function (e) { e.preventDefault(); begin(true); });
      window.addEventListener('keydown', function (e) {
        if (!started && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); begin(!!saved); }
        if (!started) return;

        if (e.code === 'F1') {
          e.preventDefault();
          help.classList.toggle('on');
        }
      });

      if (touchMode) {
        // No pointer lock on a touch device: pausing is the button, and the
        // paused card itself is the way back in.
        paused.querySelector('p').textContent = 'Tap here to get back in.';
        paused.addEventListener('pointerdown', function (e) {
          e.preventDefault();
          g.setPaused(false);
        });
        // Coming back from the app switcher or a lock screen should not drop
        // you straight into a chase.
        document.addEventListener('visibilitychange', function () {
          if (document.hidden && started) g.setPaused(true);
        });
      } else {
        // Pointer lock is the pause signal: losing it pauses, clicking resumes.
        g.input.onLockChange = function (locked) {
          if (!started) return;
          g.setPaused(!locked || !!g.uiBlocking);
        };
        document.addEventListener('click', function () {
          if (started && !g.input.locked && !g.uiBlocking) g.input.requestLock();
        });
      }

      // Show the controls card once, briefly, on the first run. On touch the
      // buttons are labelled on screen, so a single hint about the two things
      // that are not buttons is enough.
      if (!touchMode) {
        help.classList.add('on');
        setTimeout(function () { help.classList.remove('on'); }, 9000);
      } else {
        setTimeout(function () {
          if (g.hud) {
            g.hud.toast('Left thumb to move, drag the right side to look');
            setTimeout(function () { g.hud.toast('Approach any vehicle and press GET IN'); }, 3600);
          }
        }, 900);
      }
    }
  };

})(window.SB = window.SB || {});
