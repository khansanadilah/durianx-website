// Dark globe — no overlays, no markers. Plain slow rotation + drag.
// Registers <cobe-globe>.
(function () {

  function loadCOBE() {
    if (window.__createGlobe) return Promise.resolve(window.__createGlobe);
    if (window.__cobeP) return window.__cobeP;
    // Re-read the source each attempt and retry: in a large offline bundle
    // window.__resources is only populated after unpack, which can take seconds.
    const src = () => (window.__resources && window.__resources.cobeMod) || 'https://esm.sh/cobe';
    const attempt = (triesLeft) =>
      import(src()).then(m => {
        window.__createGlobe = m.default;
        return m.default;
      }).catch(err => {
        if (triesLeft > 0) {
          return new Promise(res => setTimeout(res, 700)).then(() => attempt(triesLeft - 1));
        }
        window.__cobeP = null;
        throw err;
      });
    window.__cobeP = attempt(40);
    return window.__cobeP;
  }

  const SPEED = 0.0012;

  class CobeGlobe extends HTMLElement {
    async connectedCallback() {
      if (this._built) return;
      this._built = true;
      this.style.cssText = 'display:block;position:relative;width:100%;height:100%;user-select:none;';

      // ── Canvas ───────────────────────────────────────────────────────
      const cv = document.createElement('canvas');
      cv.style.cssText = [
        'position:absolute;inset:0;',
        'width:100%;height:100%;',
        'cursor:grab;opacity:0;',
        'transition:opacity 1.2s ease;',
        'border-radius:50%;touch-action:none;',
      ].join('');
      this.appendChild(cv);

      // ── Interaction state ────────────────────────────────────────────
      let pointerInteracting = null;
      const dragOffset       = { phi: 0, theta: 0 };
      let phiOffset          = 0;
      let thetaOffset        = 0;
      let isPaused           = false;

      cv.addEventListener('pointerdown', (e) => {
        pointerInteracting = { x: e.clientX, y: e.clientY };
        cv.style.cursor = 'grabbing';
        isPaused = true;
      });

      const onMove = (e) => {
        if (!pointerInteracting) return;
        dragOffset.phi   = (e.clientX - pointerInteracting.x) / 300;
        dragOffset.theta = (e.clientY - pointerInteracting.y) / 1000;
      };

      const onUp = () => {
        if (pointerInteracting) {
          phiOffset   += dragOffset.phi;
          thetaOffset += dragOffset.theta;
          dragOffset.phi = dragOffset.theta = 0;
        }
        pointerInteracting = null;
        cv.style.cursor = 'grab';
        isPaused = false;
      };

      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerup',   onUp,   { passive: true });

      // ── Globe ────────────────────────────────────────────────────────
      let createGlobe = null;

      const init = () => {
        const width = this.clientWidth || this.offsetWidth;
        if (width === 0) return;

        let phi    = 0;
        let animId = null;
        let running = false;

        const globe = createGlobe(cv, {
          devicePixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
          width,
          height:          width,
          phi:             0,
          theta:           0.2,
          dark:            1,
          diffuse:         1.5,
          mapSamples:      12000,
          mapBrightness:   10,
          baseColor:       [0.5, 0.5, 0.5],
          markerColor:     [0.2, 0.8, 0.9],
          glowColor:       [0.05, 0.05, 0.05],
          markerElevation: 0,
          markers:         [],
          arcs:            [],
          arcColor:        [0.3, 0.85, 0.95],
          arcWidth:        0.5,
          arcHeight:       0.25,
          opacity:         0.7,
        });

        const animate = () => {
          animId = requestAnimationFrame(animate);
          if (!isPaused) phi += SPEED;
          globe.update({
            phi:   phi + phiOffset + dragOffset.phi,
            theta: 0.2 + thetaOffset + dragOffset.theta,
          });
        };
        const start = () => { if (!running) { running = true; animId = requestAnimationFrame(animate); } };
        const stop  = () => { running = false; cancelAnimationFrame(animId); };

        start();
        setTimeout(() => { if (cv) cv.style.opacity = '1'; });

        // Pause rendering while scrolled out of view.
        this._io = new IntersectionObserver((ents) => {
          ents[0] && ents[0].isIntersecting ? start() : stop();
        }, { rootMargin: '120px' });
        this._io.observe(this);

        this._globeCleanup = () => {
          stop();
          this._io && this._io.disconnect();
          globe?.destroy();
        };
      };

      const startWhenSized = () => {
        if ((this.clientWidth || this.offsetWidth) > 0) {
          init();
        } else {
          const ro = new ResizeObserver(entries => {
            if (entries[0]?.contentRect.width > 0) { ro.disconnect(); init(); }
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
        createGlobe = await loadCOBE();
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
        window.removeEventListener('pointerup',   onUp);
      };
    }

    disconnectedCallback() { this._cleanup?.(); }
  }

  if (!customElements.get('cobe-globe')) customElements.define('cobe-globe', CobeGlobe);
})();
