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

    function fail(err) {
      errEl.style.display = 'block';
      errEl.textContent = 'Sunset Bay failed to start:\n\n' + (err && err.stack ? err.stack : err);
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
          choices[i].classList.toggle('selected', choices[i].dataset.quality === SB.Q.mode ||
            (SB.Q.mode === 'auto' && choices[i].dataset.quality === 'auto'));
        }
      }

      function openPerformance() {
        if (!perf) return;
        if (g.started) {
          perfWasPaused = g.paused;
          g.setPaused(true);
        }
        g.uiBlocking = true;
        perf.classList.add('on');
        refreshPerformance();
      }

      function closePerformance() {
        if (!perf) return;
        perf.classList.remove('on');
        g.uiBlocking = false;
        if (g.started && !perfWasPaused) g.setPaused(false);
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

      function begin() {
        if (started) return;
        started = true;
        if (touchMode) goFullscreen();
        boot.classList.add('gone');
        setTimeout(function () { boot.style.display = 'none'; }, 750);
        g.start();
        if (g.audio) g.audio.resume();
      }

      startBtn.addEventListener('click', begin);
      startBtn.addEventListener('touchend', function (e) { e.preventDefault(); begin(); });
      window.addEventListener('keydown', function (e) {
        if (!started && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); begin(); }
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
          g.setPaused(!locked);
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
