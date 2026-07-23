// Hero globe — cinematic dark sphere with dotted landmass, slow rotation,
// arced transfer routes that rotate WITH the globe (Canvas 2D overlay synced
// to the same phi/theta as the WebGL sphere), pulsing connection points, and
// floating glass amount cards near active cities. Registers <hero-globe>.
(function () {

  function loadCOBE() {
    if (window.__createGlobe) return Promise.resolve(window.__createGlobe);
    if (window.__cobeP) return window.__cobeP;
    const attempt = (triesLeft) =>
      import((window.__resources && window.__resources.cobeMod) || 'https://esm.sh/cobe').then(m => {
        window.__createGlobe = m.default;
        return m.default;
      }).catch(err => {
        if (triesLeft > 0) {
          return new Promise(res => setTimeout(res, 1200)).then(() => attempt(triesLeft - 1));
        }
        window.__cobeP = null; // don't cache failure — next caller retries
        throw err;
      });
    window.__cobeP = attempt(2);
    return window.__cobeP;
  }

  // Slow clockwise-feel rotation
  const SPEED = -0.0022;
  const BASE_THETA = -0.42;      // tilted so Indonesia sits high on the visible dome
  const START_PHI = 2.849;       // Jakarta (106.8°E) faces the viewer on load
  // One-time intro spin: a single fast revolution, triggered by the page's
  // first scroll (window.__heroGlobeIntro = true). Ends exactly on Indonesia
  // with terminal velocity matched to the slow rotation → seamless handoff.
  const INTRO_DUR = 2400;               // ms for the full revolution
  const INTRO_TURN = Math.PI * 2;       // one revolution, same direction as SPEED
  const INTRO_K = 0.055;                // terminal-slope blend ≈ slow-rotation speed
  const introEase = (u) => 1 - Math.pow(1 - u, 3);   // fast launch → long decelerating settle

  const DEG = Math.PI / 180;
  // lat/lon → unit vector, matched to COBE's texture orientation (+90° lon offset).
  const LON_OFF = Math.PI / 2;
  const ll2v = (lat, lon) => {
    const la = lat * DEG, lo = lon * DEG + LON_OFF;
    return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
  };

  // Connection cities — each with a display currency + amount for the floating cards.
  const CITIES = [
    { ll: [ -6.2, 106.8], cur: 'IDR', amt: '15,000,000' },   // 0 Jakarta
    { ll: [ 25.2,  55.3], cur: 'AED', amt: '3,070.20'  },    // 1 Dubai
    { ll: [  1.35,103.8], cur: 'SGD', amt: '1,138.43'  },    // 2 Singapore
    { ll: [ 35.7, 139.7], cur: 'JPY', amt: '129,400'   },    // 3 Tokyo
    { ll: [-33.9, 151.2], cur: 'AUD', amt: '1,274.80'  },    // 4 Sydney
    { ll: [ 51.5,  -0.13],cur: 'GBP', amt: '662.06'    },    // 5 London
    { ll: [ 40.7, -74.0], cur: 'USD', amt: '835.93'    },    // 6 New York
    { ll: [ 37.8,-122.4], cur: 'USD', amt: '12,400.00' },    // 7 San Francisco
    { ll: [-23.5, -46.6], cur: 'BRL', amt: '4,210.55'  },    // 8 São Paulo
    { ll: [ 50.1,   8.7], cur: 'EUR', amt: '771.72'    },    // 9 Frankfurt
    { ll: [ 22.3, 114.2], cur: 'HKD', amt: '6,540.00'  },    // 10 Hong Kong
  ];

  // Long-distance routes — every transaction ORIGINATES from Jakarta (index 0).
  const ROUTES = [
    [0, 1],   // Jakarta → Dubai
    [0, 2],   // Jakarta → Singapore
    [0, 3],   // Jakarta → Tokyo
    [0, 4],   // Jakarta → Sydney
    [0, 5],   // Jakarta → London
    [0, 6],   // Jakarta → New York
    [0, 7],   // Jakarta → San Francisco
    [0, 8],   // Jakarta → São Paulo
    [0, 9],   // Jakarta → Frankfurt
    [0, 10],  // Jakarta → Hong Kong
  ];

  class HeroGlobe extends HTMLElement {
    async connectedCallback() {
      if (this._built) return;
      this._built = true;
      this.style.cssText = 'display:block;position:relative;width:100%;height:100%;user-select:none;';
      const noCards = this.hasAttribute('no-cards') || this.hasAttribute('nocards');   // suppress floating amount pills
      const noArcs = this.hasAttribute('no-arcs') || this.hasAttribute('noarcs');     // suppress transfer arcs + traveling pulses
      const isStatic = this.hasAttribute('static');    // no intro spin, no continuous rotation
      const _spinAttr = parseFloat(this.getAttribute('spin'));
      const STATIC_SPIN = Number.isFinite(_spinAttr) ? _spinAttr : 0;   // slow rotation while static
      // A fresh non-static mount must start from a clean intro state — otherwise a
      // stale window.__heroGlobeIntro left over from a previous page/render makes
      // the globe fire its intro spin immediately on load ("jump").
      if (!isStatic) window.__heroGlobeIntro = false;
      const _mapSamplesAttr = parseInt(this.getAttribute('mapsamples') || '', 10);
      const MAP_SAMPLES = Number.isFinite(_mapSamplesAttr) ? _mapSamplesAttr : 14000;
      const _phiAttr = parseFloat(this.getAttribute('phi'));
      const _thetaAttr = parseFloat(this.getAttribute('theta'));
      const startPhi = Number.isFinite(_phiAttr) ? _phiAttr : START_PHI;
      const baseTheta = Number.isFinite(_thetaAttr) ? _thetaAttr : BASE_THETA;

      const cv = document.createElement('canvas');
      cv.style.cssText = [
        'position:absolute;inset:0;',
        'width:100%;height:100%;',
        'cursor:grab;opacity:0;',
        'transition:opacity 1.4s ease;',
        'touch-action:none;',
      ].join('');
      this.appendChild(cv);

      // Arc overlay — drawn in the same rAF, rotates with the sphere.
      const ov = document.createElement('canvas');
      ov.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity 1.4s ease;';
      this.appendChild(ov);
      const ovx = ov.getContext('2d');

      // Floating glass amount cards (pooled, repositioned per frame).
      const cardPool = [];
      for (let i = 0; !noCards && i < 2; i++) {
        const el = document.createElement('div');
        el.style.cssText = 'position:absolute;left:0;top:0;opacity:0;transition:opacity 0.55s ease;pointer-events:none;z-index:5;transform:translate(-50%,-150%);will-change:left,top;';
        el.innerHTML = '<div style="background:rgba(255,255,255,0.12);backdrop-filter:blur(20px) saturate(160%);-webkit-backdrop-filter:blur(20px) saturate(160%);border:1px solid rgba(255,255,255,0.22);border-radius:11px;padding:8px 14px;box-shadow:0 4px 16px rgba(0,0,0,0.3),inset 0 1px 0 rgba(255,255,255,0.15);white-space:nowrap;font-family:\'Inter\',sans-serif;font-size:13px;font-weight:500;letter-spacing:0.04em;color:#fff;display:flex;align-items:center;gap:8px;"><span data-cur="" style="color:rgba(255,255,255,0.45);"></span><span data-amt=""></span></div>';
        this.appendChild(el);
        cardPool.push({ el, city: -1, until: 0, fading: false });
      }

      // ── Drag interaction ──
      let pointerInteracting = null;
      const dragOffset = { phi: 0, theta: 0 };
      let phiOffset = 0, thetaOffset = 0, isPaused = false;

      cv.addEventListener('pointerdown', (e) => {
        pointerInteracting = { x: e.clientX, y: e.clientY };
        cv.style.cursor = 'grabbing';
        isPaused = true;
      });
      const onMove = (e) => {
        if (!pointerInteracting) return;
        dragOffset.phi = (e.clientX - pointerInteracting.x) / 300;
        dragOffset.theta = (e.clientY - pointerInteracting.y) / 1000;
      };
      const onUp = () => {
        if (pointerInteracting) {
          phiOffset += dragOffset.phi;
          thetaOffset += dragOffset.theta;
          dragOffset.phi = dragOffset.theta = 0;
        }
        pointerInteracting = null;
        cv.style.cursor = 'grab';
        isPaused = false;
      };
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerup', onUp, { passive: true });

      let createGlobe = null;
      let phi = startPhi, animId = null, running = false;
      let introState = 0, introStart = 0, lastT = 0;   // 0 waiting · 1 playing · 2 done

      const init = () => {
        const width = this.clientWidth || this.offsetWidth;
        if (width === 0) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        ov.width = width * dpr;
        ov.height = width * dpr;

        // Top clip line of the overflow-hidden wrapper, in canvas px — arcs fade
        // out before reaching it instead of being sliced by the hidden edge.
        let clipTop = 0;
        const clipEl = this.closest('[data-globe-inner]');
        if (clipEl) {
          const ra = this.getBoundingClientRect(), rb = clipEl.getBoundingClientRect();
          if (ra.width > 0) clipTop = Math.max(0, (rb.top - ra.top) * (ov.width / ra.width));
        }
        const topFade = (yy) => Math.max(0, Math.min(1, (yy - clipTop - 6 * dpr) / (85 * dpr)));

        // ── Projection constants (calibrated against COBE's render) ──
        const RF = 0.4;
        const CX = ov.width / 2, CY = ov.height / 2, R = ov.width * RF;

        const cityV = CITIES.map(c => ll2v(c.ll[0], c.ll[1]));

        // Project unit vector p (optionally elevated) with rotation g and tilt t.
        const project = (p, g, t, elev) => {
          const cg = Math.cos(g), sg = Math.sin(g);
          const x1 = p[0] * cg + p[2] * sg;
          const z1 = -p[0] * sg + p[2] * cg;
          const ct = Math.cos(t), st = Math.sin(t);
          const y2 = p[1] * ct - z1 * st;
          const z2 = p[1] * st + z1 * ct;
          const k = R * (1 + (elev || 0));
          return { x: CX + k * x1, y: CY - k * y2, z: z2 };
        };

        // Great-circle interpolation between two unit vectors.
        const slerp = (A, B, t) => {
          let d = A[0] * B[0] + A[1] * B[1] + A[2] * B[2];
          d = d < -1 ? -1 : d > 1 ? 1 : d;
          const om = Math.acos(d), so = Math.sin(om);
          if (so < 1e-6) return A;
          const a = Math.sin((1 - t) * om) / so, b = Math.sin(t * om) / so;
          return [A[0] * a + B[0] * b, A[1] * a + B[1] * b, A[2] * a + B[2] * b];
        };

        const arcs = ROUTES.map(([s, e], i) => ({ A: cityV[s], B: cityV[e], a: s, b: e, off: i * 0.31 }));
        const SEG = 64;

        // ── Floating card scheduling ──
        let lastSpawn = 0, lastCity = -1;
        const scheduleCards = (g, t, now) => {
          // reposition + early-fade active cards
          for (const c of cardPool) {
            if (c.city < 0) continue;
            const p = project(cityV[c.city], g, t, 0.012);
            c.el.style.left = (p.x / dpr) + 'px';
            c.el.style.top = (p.y / dpr) + 'px';
            const gone = now > c.until || p.z < 0.08;
            if (gone && !c.fading) {
              c.fading = true;
              c.el.style.opacity = '0';
              const cc = c;
              setTimeout(() => { cc.city = -1; cc.fading = false; }, 600);
            }
          }
          // spawn a new card near a front-facing connected city
          if (now - lastSpawn < 2700) return;
          const free = cardPool.find(c => c.city < 0);
          if (!free) return;
          const candidates = [];
          for (let i = 0; i < CITIES.length; i++) {
            if (i === lastCity) continue;
            if (cardPool.some(c => c.city === i)) continue;
            const p = project(cityV[i], g, t, 0);
            if (p.z > 0.35) candidates.push(i);
          }
          if (!candidates.length) return;
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          lastSpawn = now; lastCity = pick;
          free.city = pick;
          free.until = now + 2000;
          free.el.querySelector('[data-cur]').textContent = CITIES[pick].cur;
          free.el.querySelector('[data-amt]').textContent = CITIES[pick].amt;
          const p = project(cityV[pick], g, t, 0.012);
          free.el.style.left = (p.x / dpr) + 'px';
          free.el.style.top = (p.y / dpr) + 'px';
          free.el.style.opacity = '1';
        };

        const drawArcs = (g, t, now) => {
          ovx.clearRect(0, 0, ov.width, ov.height);
          ovx.lineCap = 'butt';

          if (!noArcs) for (const arc of arcs) {
            // low, surface-hugging great-circle path — runs the full route
            let prev = null;
            for (let s = 0; s <= SEG; s++) {
              const ft = s / SEG;
              const elev = Math.sin(ft * Math.PI) * 0.06;
              const p = project(slerp(arc.A, arc.B, ft), g, t, elev);
              if (prev && (p.z > -0.34 || prev.z > -0.34)) {
                const depth = (p.z + prev.z) / 2;
                // wide, gradual limb fade — grows subtler as it wraps behind the globe
                let hz = Math.max(0, Math.min(1, (depth + 0.30) / 0.44));
                hz = hz * hz * (3 - 2 * hz);
                const a = hz * 0.42 * topFade((prev.y + p.y) / 2);
                if (a > 0.004) {
                  ovx.strokeStyle = 'rgba(198,166,255,' + a.toFixed(3) + ')';
                  ovx.lineWidth = 2.0 * dpr;
                  ovx.beginPath();
                  ovx.moveTo(prev.x, prev.y);
                  ovx.lineTo(p.x, p.y);
                  ovx.stroke();
                }
              }
              prev = p;
            }
            // traveling pulse along the arc
            const tp = ((now * 0.00006) + arc.off) % 1;
            const pp = project(slerp(arc.A, arc.B, tp), g, t, Math.sin(tp * Math.PI) * 0.06);
            if (pp.z > -0.02) {
              const pa = Math.max(0, Math.min(1, pp.z + 0.35)) * topFade(pp.y);
              ovx.beginPath();
              ovx.arc(pp.x, pp.y, 4.2 * dpr, 0, 6.2832);
              ovx.fillStyle = 'rgba(198,166,255,' + (0.14 * pa).toFixed(3) + ')';
              ovx.fill();
              ovx.beginPath();
              ovx.arc(pp.x, pp.y, 2.0 * dpr, 0, 6.2832);
              ovx.fillStyle = 'rgba(235,222,255,' + (0.9 * pa).toFixed(3) + ')';
              ovx.fill();
            }
          }

          // pulsing connection points (every unique city) — skipped when arcs are off (e.g. remittance page)
          if (!noArcs) for (let i = 0; i < cityV.length; i++) {
            const p = project(cityV[i], g, t, 0.004);
            if (p.z <= 0.02) continue;
            const vis = Math.min(1, p.z + 0.3) * topFade(p.y);
            const ph = now * 0.0032 + i * 1.7;
            const pulse = 0.5 + 0.5 * Math.sin(ph);
            // soft expanding halo
            ovx.beginPath();
            ovx.arc(p.x, p.y, (2.6 + pulse * 3.4) * dpr, 0, 6.2832);
            ovx.fillStyle = 'rgba(198,166,255,' + (0.10 * (1 - pulse) * vis).toFixed(3) + ')';
            ovx.fill();
            // core dot
            ovx.beginPath();
            ovx.arc(p.x, p.y, (1.5 + 0.5 * pulse) * dpr, 0, 6.2832);
            ovx.fillStyle = 'rgba(216,190,255,' + ((0.4 + 0.45 * pulse) * vis).toFixed(3) + ')';
            ovx.fill();
          }
        };

        const globe = createGlobe(cv, {
          devicePixelRatio: dpr,
          width,
          height:          width,
          phi:             startPhi,
          theta:           baseTheta,
          dark:            1,
          diffuse:         1.45,
          mapSamples:      MAP_SAMPLES,
          mapBrightness:   8.5,
          baseColor:       [0.46, 0.36, 0.68],
          markerColor:     [0.92, 0.85, 1],
          glowColor:       [0.20, 0.15, 0.35],
          markerElevation: 0,
          markers:         [],
          arcs:            [],
          opacity:         1,
        });

        const animate = (now) => {
          animId = requestAnimationFrame(animate);
          const tnow = now || performance.now();
          const dt = lastT ? Math.min(100, tnow - lastT) : 16.7;
          lastT = tnow;
          // Globe holds still on Indonesia until the page requests the intro.
          if (!isStatic && introState === 0 && window.__heroGlobeIntro) {
            introState = 1;
            introStart = tnow;
          }
          if (isPaused && introState === 1) introStart += dt; // drag pauses the intro clock
          if (!isPaused && !isStatic) {
            if (introState === 1) {
              const u = Math.min(1, (tnow - introStart) / INTRO_DUR);
              const e = (1 - INTRO_K) * introEase(u) + INTRO_K * u;
              phi = START_PHI - INTRO_TURN * e;
              if (u >= 1) { phi = START_PHI; introState = 2; }
            } else if (introState === 2) {
              phi += SPEED * (dt / 16.7);   // slow continuous rotation, from Indonesia
            }
          }
          if (!isPaused && isStatic && STATIC_SPIN) {
            phi += STATIC_SPIN * (dt / 16.7);   // slow continuous rotation for static globes
          }
          const g = phi + phiOffset + dragOffset.phi;
          const t = baseTheta + thetaOffset + dragOffset.theta;
          globe.update({ phi: g, theta: t });
          const ts = now || performance.now();
          drawArcs(g, t, ts);
          if (!noCards) scheduleCards(g, t, ts);
        };
        const start = () => { if (!running) { running = true; animId = requestAnimationFrame(animate); } };
        const stop  = () => { running = false; cancelAnimationFrame(animId); };
        start();
        setTimeout(() => { if (cv) { cv.style.opacity = '0.4'; ov.style.opacity = '1'; } });

        // Pause all render work while the globe is scrolled out of view.
        this._io = new IntersectionObserver((ents) => {
          ents[0] && ents[0].isIntersecting ? start() : stop();
        }, { rootMargin: '120px' });
        this._io.observe(this);

        this._globeCleanup = () => {
          stop();
          this._io && this._io.disconnect();
          globe && globe.destroy && globe.destroy();
        };
      };

      const startWhenSized = () => {
        if ((this.clientWidth || this.offsetWidth) > 0) {
          init();
        } else {
          const ro = new ResizeObserver(entries => {
            if (entries[0] && entries[0].contentRect.width > 0) { ro.disconnect(); init(); }
          });
          ro.observe(this);
          this._roCleanup = () => ro.disconnect();
        }
      };

      // Lazy boot: don't fetch COBE or build the globe until it's near the viewport.
      let booted = false;
      const boot = async () => {
        if (booted) return;
        booted = true;
        try {
          createGlobe = await loadCOBE();
        } catch (e) {
          await new Promise(res => setTimeout(res, 4000));
          createGlobe = await loadCOBE();
        }
        startWhenSized();
      };
      const bootIO = new IntersectionObserver((ents) => {
        if (ents[0] && ents[0].isIntersecting) { bootIO.disconnect(); boot(); }
      }, { rootMargin: '300px' });
      bootIO.observe(this);
      this._bootIO = bootIO;

      this._cleanup = () => {
        this._bootIO?.disconnect();
        this._globeCleanup?.();
        this._roCleanup?.();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
    }

    disconnectedCallback() { this._cleanup?.(); }
  }

  if (!customElements.get('hero-globe')) customElements.define('hero-globe', HeroGlobe);
})();
