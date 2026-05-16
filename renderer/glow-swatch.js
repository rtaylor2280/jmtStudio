/**
 * glow-swatch.js
 *
 * Animated lightsaber-style color swatches. Renders a diagonal blade
 * slice using a port of the JMT blade renderer pipeline (per-LED noise
 * shimmer, weighted blend kernel, core+whiten, polycarbonate tube,
 * bloom with H-blur, ambient wash) plus Proffie-style synced Pulsing.
 *
 * USAGE
 *
 *   const swatch = GlowSwatch.create({
 *     color: '#0080ff',           // or {r:0,g:128,b:255} or [0,128,255]
 *     width: 48,                  // optional, defaults to 48
 *     height: 48,                 // optional, defaults to 48
 *     animated: true,             // optional, defaults to true
 *   });
 *   document.body.appendChild(swatch.element);
 *
 *   swatch.setColor('#ff0000');   // change color anytime
 *   swatch.setAnimated(false);    // freeze / unfreeze animation
 *   swatch.destroy();             // remove from rAF loop and free buffers
 *
 * EXPORTS
 *
 *   - Browser global:   window.GlowSwatch
 *   - ES Module:        import GlowSwatch from './glow-swatch.js'
 *   - CommonJS:         const GlowSwatch = require('./glow-swatch.js')
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GlowSwatch = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ============================================================
  // TUNING — locked-in values from the final tester. These are
  // intentionally NOT exposed as constructor options — the visual
  // identity comes from this exact tuning. If you need different
  // tuning, fork the file rather than parameterizing.
  // ============================================================
  const TUNING = {
    angle: -25,
    ledCount: 20,
    sourceH: 200,

    brightness: 1.6,
    saturation: 1.2,
    coreWhiten: 1,
    whitenThresh: 0.4,
    coreWidth: 0.47,
    edgeSoft: 1.4,
    tubeWidth: 0.55,
    tubeOpacity: 0.75,
    blendRadius: 3,
    falloff: 0.65,

    bloomIntensity: 1,
    bloomRadius: 40,
    bloomSens: 1,
    bloomHBlur: 30,

    ambientWash: 0.14,
    ambientRadius: 600,
    linearColor: 1,

    intensity: 1,

    targetFps: 30,
  };

  // Scrolling rotoscope band pattern. Energy scales with TUNING.intensity.
  const BAND_LEVELS = [1.00, 1.00, 0.235, 1.00, 0.588];
  const BAND_WIDTH_UNITS = 14000;
  const BAND_GRAIN = 0.15;
  const BAND_REFERENCE_SCROLL = 1000;

  function bandLevelForPhase(p, periodLen) {
    const spacing = periodLen / BAND_LEVELS.length;
    const windowSize = spacing * 1.5;
    let total = 0;
    for (let i = 0; i < BAND_LEVELS.length; i++) {
      const center = spacing * (i + 0.5);
      let d = p - center;
      if (d > periodLen / 2) d -= periodLen;
      if (d < -periodLen / 2) d += periodLen;
      const ad = Math.abs(d);
      if (ad < windowSize / 2) {
        const w = Math.cos((ad / (windowSize / 2)) * (Math.PI / 2));
        total += BAND_LEVELS[i] * w * w;
      }
    }
    return total;
  }

  // ============================================================
  // COLOR HELPERS — accept hex string, {r,g,b} object, or [r,g,b]
  // ============================================================
  function normalizeColor(input) {
    if (typeof input === 'string') {
      const m = input.replace('#', '');
      if (!/^[0-9a-fA-F]{6}$/.test(m)) {
        throw new Error('GlowSwatch: invalid hex color "' + input + '"');
      }
      return {
        r: parseInt(m.substr(0, 2), 16) / 255,
        g: parseInt(m.substr(2, 2), 16) / 255,
        b: parseInt(m.substr(4, 2), 16) / 255,
      };
    }
    if (Array.isArray(input) && input.length >= 3) {
      return { r: input[0] / 255, g: input[1] / 255, b: input[2] / 255 };
    }
    if (input && typeof input === 'object' && 'r' in input) {
      return { r: input.r / 255, g: input.g / 255, b: input.b / 255 };
    }
    throw new Error('GlowSwatch: invalid color input');
  }

  function sRGBToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSRGB(c) {
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }

  // ============================================================
  // SHARED ANIMATION LOOP
  // One rAF for all animated swatches. Started lazily on first
  // animated swatch, stopped when none remain. Static swatches
  // never join the loop — they render once and freeze.
  // ============================================================
  const animatedSwatches = new Set();
  let rafHandle = null;
  let lastFrameT = 0;

  function tick(ts) {
    const t = ts * 0.001;
    const dt = t - lastFrameT;
    if (dt < 1 / TUNING.targetFps) {
      rafHandle = requestAnimationFrame(tick);
      return;
    }
    lastFrameT = t;
    animatedSwatches.forEach(function (s) { s._render(t); });
    if (animatedSwatches.size > 0) {
      rafHandle = requestAnimationFrame(tick);
    } else {
      rafHandle = null;
    }
  }

  function startLoopIfNeeded() {
    if (rafHandle === null && animatedSwatches.size > 0) {
      rafHandle = requestAnimationFrame(tick);
    }
  }

  // ============================================================
  // SWATCH INSTANCE — internal class. External API uses create()
  // which returns a controller object with the methods we choose
  // to expose.
  // ============================================================
  class _Swatch {
    constructor(opts) {
      const width = opts.width || 48;
      const height = opts.height || 48;
      this.color = normalizeColor(opts.color);
      this.animated = opts.animated !== false; // default true

      // Build canvas
      this.canvas = document.createElement('canvas');
      this.canvas.style.display = 'block';
      this.canvas.style.width = width + 'px';
      this.canvas.style.height = height + 'px';

      // Per-instance noise seeds (random per swatch so shimmer is unique)
      this.seeds = new Float32Array(300);
      for (let i = 0; i < 300; i++) {
        this.seeds[i] = Math.random() * Math.PI * 2;
      }
      this.leds = null;
      // Random per-instance start position desyncs swatches in a grid so the
      // rotoscope bands don't all march in lockstep.
      this.scrollPos = Math.random() * BAND_WIDTH_UNITS;
      this.lastBandT = 0;

      this.cssW = width;
      this.cssH = height;
      this._allocateBuffers();

      // Initial render — needed even for animated swatches so something
      // shows immediately before the first rAF fires
      this._render(0);

      if (this.animated) {
        animatedSwatches.add(this);
        startLoopIfNeeded();
      }
    }

    _allocateBuffers() {
      const dpr = window.devicePixelRatio || 1;
      this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.floor(this.cssW * dpr));
      this.canvas.height = Math.max(1, Math.floor(this.cssH * dpr));
      this.ctx = this.canvas.getContext('2d');
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Internal blade buffer at fixed pixel size — JMT pixel-based
      // values (bloomRadius=37, bloomHBlur=30, ambientRadius=600)
      // operate in this space, scaled down to the swatch at composite.
      const H = TUNING.sourceH | 0;
      const W = Math.max(H * 3, 600);
      this.srcW = W;
      this.srcH = H;
      this.bladeCanvas = document.createElement('canvas');
      this.bladeCanvas.width = W;
      this.bladeCanvas.height = H;
      this.bladeCtx = this.bladeCanvas.getContext('2d');
      this.bloomCanvas = document.createElement('canvas');
      this.bloomCanvas.width = W;
      this.bloomCanvas.height = H;
      this.bloomCtx = this.bloomCanvas.getContext('2d');
      this.imgData = this.bladeCtx.createImageData(W, H);
      this.pix = this.imgData.data;
      this.colR = new Float32Array(W);
      this.colG = new Float32Array(W);
      this.colB = new Float32Array(W);
      this.colLum = new Float32Array(W);
    }

    _generateLEDs(t) {
      const n = TUNING.ledCount;
      if (!this.leds || this.leds.length !== n * 3) {
        this.leds = new Float32Array(n * 3);
      }
      const c = this.color;
      const intensity = Math.max(0, TUNING.intensity);
      const bandMix = Math.min(0.9, intensity);
      const scrollPerSec = BAND_REFERENCE_SCROLL * intensity;
      if (this.lastBandT === 0) this.lastBandT = t;
      const dt = t - this.lastBandT;
      this.lastBandT = t;
      this.scrollPos += dt * scrollPerSec;
      const periodLen = Math.max(2, BAND_WIDTH_UNITS / 1000);
      for (let i = 0; i < n; i++) {
        let p = ((i + this.scrollPos) % periodLen);
        if (p < 0) p += periodLen;
        const bandLvl = bandLevelForPhase(p, periodLen);
        const grainSeed = this.seeds[i % 300];
        const grain = 1 - BAND_GRAIN + BAND_GRAIN * (0.5 + 0.5 * Math.sin(t * 7.3 + grainSeed * 5.7 + i * 0.91));
        const lvl = (1 - bandMix) + bandMix * bandLvl;
        const finalLvl = lvl * grain;
        this.leds[i * 3]     = c.r * finalLvl;
        this.leds[i * 3 + 1] = c.g * finalLvl;
        this.leds[i * 3 + 2] = c.b * finalLvl;
      }
    }

    _sampleLEDField() {
      const n = TUNING.ledCount;
      const W = this.srcW;
      const R = TUNING.blendRadius;
      const fo = TUNING.falloff;
      for (let px = 0; px < W; px++) {
        const ledPos = (px / W) * (n - 1);
        let wr = 0, wg = 0, wb = 0, wt = 0;
        const iMin = Math.max(0, Math.floor(ledPos - R));
        const iMax = Math.min(n - 1, Math.ceil(ledPos + R));
        for (let i = iMin; i <= iMax; i++) {
          const w = 1.0 / Math.pow(Math.abs(ledPos - i) + 0.5, fo);
          wr += this.leds[i * 3] * w;
          wg += this.leds[i * 3 + 1] * w;
          wb += this.leds[i * 3 + 2] * w;
          wt += w;
        }
        this.colR[px] = wr / wt;
        this.colG[px] = wg / wt;
        this.colB[px] = wb / wt;
        this.colLum[px] = Math.max(this.colR[px], this.colG[px], this.colB[px]);
      }
    }

    _renderBlade() {
      const W = this.srcW;
      const H = this.srcH;
      const cy = H / 2;
      const halfH = H / 2;
      const cw = TUNING.coreWidth;
      const es = TUNING.edgeSoft;
      const bri = TUNING.brightness;
      const cWh = TUNING.coreWhiten;
      const sat = TUNING.saturation;
      const useLinear = TUNING.linearColor >= 0.5;
      const wt = TUNING.whitenThresh;

      this.pix.fill(0);

      for (let px = 0; px < W; px++) {
        let r = this.colR[px] * bri;
        let g = this.colG[px] * bri;
        let b = this.colB[px] * bri;
        if (useLinear) {
          r = sRGBToLinear(Math.min(1, r));
          g = sRGBToLinear(Math.min(1, g));
          b = sRGBToLinear(Math.min(1, b));
        }
        r = Math.min(1, r);
        g = Math.min(1, g);
        b = Math.min(1, b);
        const sn = Math.max(r, g, b) * 0.5;
        r = sn + (r - sn) * sat;
        g = sn + (g - sn) * sat;
        b = sn + (b - sn) * sat;
        r = Math.max(0, Math.min(1, r));
        g = Math.max(0, Math.min(1, g));
        b = Math.max(0, Math.min(1, b));
        if (useLinear) {
          r = linearToSRGB(r);
          g = linearToSRGB(g);
          b = linearToSRGB(b);
        }
        let whitenMult = 1.0;
        if (wt > 0) {
          const lum = Math.max(r, g, b);
          const tt = Math.max(0, Math.min(1, (lum - wt) / (1.0 - wt + 0.001)));
          whitenMult *= tt * tt * (3 - 2 * tt);
        }
        const usableHalf = halfH;
        for (let py = 0; py < H; py++) {
          const absDy = Math.abs(py - cy);
          const dy = absDy / (usableHalf + 0.001);
          if (dy > 3.0) continue;
          const coreAlpha = Math.max(0, 1 - dy / cw);
          const outerAlpha = Math.exp(-Math.pow(dy / cw, es));
          const alpha = Math.max(coreAlpha, outerAlpha);
          const wh = coreAlpha * cWh * whitenMult;
          const fr = Math.min(1, (r + (1 - r) * wh) * alpha);
          const fg = Math.min(1, (g + (1 - g) * wh) * alpha);
          const fb = Math.min(1, (b + (1 - b) * wh) * alpha);
          const idx = (py * W + px) * 4;
          this.pix[idx] = fr * 255;
          this.pix[idx + 1] = fg * 255;
          this.pix[idx + 2] = fb * 255;
          this.pix[idx + 3] = 255;
        }
      }
      this.bladeCtx.putImageData(this.imgData, 0, 0);
    }

    _renderTube() {
      if (TUNING.tubeOpacity < 0.01) return;
      const W = this.srcW;
      const H = this.srcH;
      const cy = H / 2;
      const tubeHalf = (H / 2) * TUNING.tubeWidth;
      const op = TUNING.tubeOpacity;
      const bctx = this.bladeCtx;
      bctx.save();
      bctx.beginPath();
      bctx.rect(0, cy - tubeHalf, W, tubeHalf * 2);
      bctx.clip();
      const grad = bctx.createLinearGradient(0, cy - tubeHalf, 0, cy + tubeHalf);
      grad.addColorStop(0.0, 'rgba(180,180,180,' + (op * 0.35) + ')');
      grad.addColorStop(0.3, 'rgba(230,230,230,' + (op * 0.65) + ')');
      grad.addColorStop(0.5, 'rgba(255,255,255,' + (op * 0.85) + ')');
      grad.addColorStop(0.7, 'rgba(230,230,230,' + (op * 0.65) + ')');
      grad.addColorStop(1.0, 'rgba(180,180,180,' + (op * 0.35) + ')');
      bctx.fillStyle = grad;
      bctx.fillRect(0, cy - tubeHalf, W, tubeHalf * 2);
      bctx.restore();
    }

    _renderBloom() {
      if (TUNING.bloomIntensity < 0.01) return;
      const W = this.srcW;
      const H = this.srcH;
      const cy = H / 2;
      const bri = TUNING.brightness;
      const bctx = this.bloomCtx;
      const bRad = TUNING.bloomRadius;
      const bSens = TUNING.bloomSens;
      const bInt = TUNING.bloomIntensity;
      bctx.clearRect(0, 0, W, H);
      for (let px = 0; px < W; px++) {
        const lum = this.colLum[px] * bri;
        if (lum < 0.005) continue;
        const r = this.colR[px] * bri;
        const g = this.colG[px] * bri;
        const b = this.colB[px] * bri;
        const brad = bRad * Math.pow(Math.max(0.0001, lum), 1.0 / bSens);
        if (!isFinite(brad) || brad < 1) continue;
        const alpha = Math.min(1, lum * bInt * 0.4);
        const grad = bctx.createLinearGradient(px, cy - brad, px, cy + brad);
        const c = 'rgba(' + ((r * 255) | 0) + ',' + ((g * 255) | 0) + ',' + ((b * 255) | 0) + ',';
        grad.addColorStop(0, c + '0)');
        grad.addColorStop(0.5, c + alpha + ')');
        grad.addColorStop(1, c + '0)');
        bctx.fillStyle = grad;
        bctx.fillRect(px, cy - brad, 1, brad * 2);
      }
      if (TUNING.bloomHBlur > 0) {
        bctx.filter = 'blur(' + TUNING.bloomHBlur + 'px)';
        bctx.globalCompositeOperation = 'copy';
        bctx.drawImage(this.bloomCanvas, 0, 0);
        bctx.filter = 'none';
        bctx.globalCompositeOperation = 'source-over';
      }
    }

    _renderAmbient(targetCtx, srcCx, srcCy) {
      if (TUNING.ambientWash < 0.01) return;
      const W = this.srcW;
      let aR = 0, aG = 0, aB = 0, aC = 0;
      const stride = Math.max(1, Math.floor(W / 80));
      for (let px = 0; px < W; px += stride) {
        aR += this.colR[px];
        aG += this.colG[px];
        aB += this.colB[px];
        aC++;
      }
      if (aC === 0) return;
      aR /= aC; aG /= aC; aB /= aC;
      const peak = Math.max(aR, aG, aB);
      if (peak < 0.01) return;
      aR /= peak; aG /= peak; aB /= peak;
      const radius = TUNING.ambientRadius;
      const a = TUNING.ambientWash;
      const grad = targetCtx.createRadialGradient(srcCx, srcCy, 0, srcCx, srcCy, radius);
      const rgb = ((aR * 255) | 0) + ',' + ((aG * 255) | 0) + ',' + ((aB * 255) | 0);
      grad.addColorStop(0.0, 'rgba(' + rgb + ',' + a + ')');
      grad.addColorStop(0.5, 'rgba(' + rgb + ',' + (a * 0.4) + ')');
      grad.addColorStop(1.0, 'rgba(' + rgb + ',0)');
      targetCtx.globalCompositeOperation = 'screen';
      targetCtx.fillStyle = grad;
      targetCtx.fillRect(srcCx - radius, srcCy - radius, radius * 2, radius * 2);
      targetCtx.globalCompositeOperation = 'source-over';
    }

    _render(t) {
      this._generateLEDs(t);
      this._sampleLEDField();
      this._renderBlade();
      this._renderTube();
      this._renderBloom();

      const ctx = this.ctx;
      const W = this.cssW, H = this.cssH;
      const srcW = this.srcW, srcH = this.srcH;
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const minDim = Math.min(W, H);
      const scale = (minDim * 1.5) / srcH;
      ctx.translate(W / 2, H / 2);
      ctx.rotate(TUNING.angle * Math.PI / 180);
      ctx.scale(scale, scale);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.bladeCanvas, -srcW / 2, -srcH / 2);
      ctx.globalCompositeOperation = 'screen';
      ctx.drawImage(this.bloomCanvas, -srcW / 2, -srcH / 2);
      if (TUNING.ambientWash > 0.01) {
        this._renderAmbient(ctx, 0, 0);
      }
      ctx.restore();
    }

    // ----- public API -----
    setColor(input) {
      this.color = normalizeColor(input);
      // Re-render immediately for static swatches; animated swatches
      // will pick it up on next tick.
      if (!this.animated) this._render(0);
    }

    setAnimated(animated) {
      const want = animated !== false;
      if (want === this.animated) return;
      this.animated = want;
      if (want) {
        animatedSwatches.add(this);
        startLoopIfNeeded();
      } else {
        animatedSwatches.delete(this);
        // Render a final frozen frame so it doesn't sit mid-animation
        this._render(0);
      }
    }

    destroy() {
      animatedSwatches.delete(this);
      if (this.canvas.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
      }
      // Free buffers
      this.bladeCanvas = null;
      this.bloomCanvas = null;
      this.imgData = null;
      this.pix = null;
      this.colR = this.colG = this.colB = this.colLum = null;
      this.leds = null;
      this.seeds = null;
    }
  }

  // ============================================================
  // MOUNT HELPERS — for upgrading existing DOM elements (e.g. a
  // grid of CSS-colored cells) into glow-swatches. Reads the
  // computed background-color of each element as the source color.
  // ============================================================

  // Parse "rgb(r, g, b)" or "rgba(r, g, b, a)" into {r, g, b}.
  // getComputedStyle normalizes all CSS color forms into one of
  // these, so we don't need to handle hex/named/hsl directly.
  function parseRgbString(str) {
    const m = /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(str);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3] };
  }

  // Mount a glow-swatch INTO an existing element.
  // - Reads color from the element's computed background-color
  //   (unless opts.color is explicitly provided)
  // - Sizes the swatch to match the element's current dimensions
  //   (unless opts.width/height are explicitly provided)
  // - Sets up the element to host a canvas (overflow:hidden,
  //   line-height:0) so the canvas respects border-radius and
  //   doesn't introduce inline gaps
  // - Appends the canvas to the element
  // - Returns the controller (same shape as create())
  function mount(el, opts) {
    opts = opts || {};

    // Resolve color: explicit option wins, else read from CSS
    let color = opts.color;
    if (!color) {
      const bg = window.getComputedStyle(el).backgroundColor;
      const rgb = parseRgbString(bg);
      if (!rgb) {
        throw new Error('GlowSwatch.mount: element has no readable background-color and no opts.color');
      }
      color = rgb;
    }

    // Resolve dimensions: explicit option wins, else read from element
    const rect = el.getBoundingClientRect();
    const width = opts.width || Math.round(rect.width) || 48;
    const height = opts.height || Math.round(rect.height) || 48;

    // Make the host element a proper canvas container.
    // Don't override CSS that's already set — only set what the canvas
    // needs to render correctly inside.
    const cs = window.getComputedStyle(el);
    if (cs.overflow === 'visible') el.style.overflow = 'hidden';
    if (cs.lineHeight !== '0px' && cs.lineHeight !== '0') el.style.lineHeight = '0';

    const swatch = new _Swatch({
      color: color,
      width: width,
      height: height,
      animated: opts.animated !== false,
    });
    el.appendChild(swatch.canvas);

    return {
      element: swatch.canvas,
      host: el,
      setColor: function (c) { swatch.setColor(c); },
      setAnimated: function (a) { swatch.setAnimated(a); },
      destroy: function () { swatch.destroy(); },
    };
  }

  // Find all elements matching `selector` (within `root` if provided,
  // else document) and mount a glow-swatch into each.
  // Returns array of controllers.
  function mountAll(selector, opts) {
    const root = (opts && opts.root) || document;
    const els = root.querySelectorAll(selector);
    const controllers = [];
    els.forEach(function (el) {
      controllers.push(mount(el, opts));
    });
    return controllers;
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {
    /**
     * Create a new swatch as a standalone canvas element.
     *
     * @param {Object} opts
     * @param {string|Array|Object} opts.color  Required. Hex '#rrggbb',
     *   [r,g,b] array (0-255), or {r,g,b} object (0-255).
     * @param {number} [opts.width=48]
     * @param {number} [opts.height=48]
     * @param {boolean} [opts.animated=true]
     * @returns {Object} { element, setColor, setAnimated, destroy }
     */
    create: function (opts) {
      if (!opts || !opts.color) {
        throw new Error('GlowSwatch.create: opts.color is required');
      }
      const swatch = new _Swatch(opts);
      return {
        element: swatch.canvas,
        setColor: function (c) { swatch.setColor(c); },
        setAnimated: function (a) { swatch.setAnimated(a); },
        destroy: function () { swatch.destroy(); },
      };
    },

    /**
     * Mount a glow-swatch INTO an existing DOM element. Reads color
     * from the element's computed background-color (unless overridden),
     * sizes to match (unless overridden), and appends the canvas inside.
     *
     * Useful for upgrading existing CSS-colored UI like swatch grids:
     *
     *   GlowSwatch.mountAll('.preset-color-popup-cell');
     *
     * The host element keeps its existing classes, click handlers,
     * border, and selection state — the canvas just paints inside.
     *
     * @param {Element} el          target element to mount into
     * @param {Object}  [opts]
     * @param {*}       [opts.color]    override CSS color
     * @param {number}  [opts.width]    override element width
     * @param {number}  [opts.height]   override element height
     * @param {boolean} [opts.animated=true]
     * @returns {Object} { element, host, setColor, setAnimated, destroy }
     */
    mount: mount,

    /**
     * Mount glow-swatches into all elements matching `selector`.
     *
     * @param {string} selector
     * @param {Object} [opts]   same as mount() opts, plus:
     * @param {Element} [opts.root=document]   restrict query to this subtree
     * @returns {Array} array of controllers
     */
    mountAll: mountAll,
  };
}));
