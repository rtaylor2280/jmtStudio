/**
 * bladeEval.js — Minimal ProffieOS style evaluator for JMT Studio
 *
 * Implements the run(blade)/getColor(led) pattern from ProffieOS.
 * Every style function has:
 *   run(blade)        — called once per frame; updates internal state
 *   getColor(led)     — called per LED; returns { r, g, b, a } in 0–1 range
 *
 * This is an independent implementation — no GPL code from Fredrik's evaluator.
 */

// ── Blade state object ────────────────────────────────────────────────────────

class Blade {
  constructor(ledCount = 132) {
    this.ledCount = ledCount;
    this.micros   = 0;       // microseconds elapsed (updated by tick)
    this.on       = false;   // blade power state
    this.clash    = false;
    this.lockup   = false;   // SaberBase::LOCKUP_NORMAL
    this.drag     = false;   // SaberBase::LOCKUP_DRAG
    this.melt     = false;   // SaberBase::LOCKUP_MELT
    this._effects = [];      // pending one-shot effects
  }

  addEffect(type, location = 0.5) {
    this._effects.push({ type, location, time: this.micros });
  }

  // If type is given, returns only matching events and removes them from the queue.
  // Called with no arg returns all events (clears queue) — backward compatible.
  consumeEffects(type) {
    if (!type) {
      const e = this._effects.slice();
      this._effects = [];
      return e;
    }
    const matching = this._effects.filter(e => e.type === type);
    this._effects  = this._effects.filter(e => e.type !== type);
    return matching;
  }
}

// ── Colour helpers ────────────────────────────────────────────────────────────

function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function mkColor(r, g, b, a = 1) {
  return { r: clamp(r), g: clamp(g), b: clamp(b), a: clamp(a) };
}

// Mix two colours by t (0 = all c1, 1 = all c2). Alpha is interpolated too so
// mixing with TRANSPARENT nodes doesn't produce opaque black.
function mixColors(c1, c2, t) {
  return mkColor(
    c1.r + (c2.r - c1.r) * t,
    c1.g + (c2.g - c1.g) * t,
    c1.b + (c2.b - c1.b) * t,
    c1.a + (c2.a - c1.a) * t,
  );
}

const BLACK = mkColor(0, 0, 0);

// ── Pulsing<A, B, periodMs> ───────────────────────────────────────────────────
class PulsingNode {
  constructor(a, b, ms) { this._a = a; this._b = b; this._ms = +ms || 1000; this._t = 0; }
  run(blade) { this._a.run(blade); this._b.run(blade); this._t = blade.micros / 1000; }
  getColor(led) {
    const t = 0.5 + 0.5 * Math.sin(this._t / this._ms * Math.PI * 2);
    return mixColors(this._a.getColor(led), this._b.getColor(led), t);
  }
}

// ── StripesX<widthNode, speedNode, C1, C2, ...> ──────────────────────────────
// Variable-width/speed Stripes — width and speed are value nodes.
class StripesXNode {
  constructor(widthNode, speedNode, colors) {
    this._widthNode = widthNode;
    this._speedNode = speedNode;
    this._colors    = colors;
    this._speed = 3000; this._t = 0; this._n = 132;
  }
  run(blade) {
    this._n = blade.ledCount;
    this._t = blade.micros / 1000000;
    if (this._widthNode.run)  this._widthNode.run(blade);
    if (this._speedNode.run)  this._speedNode.run(blade);
    this._speed = this._speedNode.getValue ? this._speedNode.getValue(0) * 32768 : 3000;
    this._colors.forEach(c => c.run(blade));
  }
  getColor(led) {
    const n = this._colors.length;
    if (n === 0) return BLACK;
    const scroll = this._t * this._speed * 0.001 * this._n;
    const posF   = ((led + scroll) % this._n + this._n) % this._n;
    const t      = posF / Math.max(1, this._n - 1);
    const seg    = Math.min(n - 2, Math.floor(t * (n - 1)));
    const tSeg   = t * (n - 1) - seg;
    return mixColors(this._colors[seg].getColor(led), this._colors[(seg + 1) % n].getColor(led), tSeg);
  }
}

// ── AlphaMixL<alphaFn, C1, C2> ───────────────────────────────────────────────
// Mixes C1 and C2 weighted by alphaFn.getValue(); result alpha = that weight.
class AlphaMixLNode {
  constructor(alphaFn, a, b) { this._alpha = alphaFn; this._a = a; this._b = b; }
  run(blade) { this._a.run(blade); this._b.run(blade); this._alpha.run(blade); }
  getColor(led) {
    const t  = this._alpha.getValue ? this._alpha.getValue(led) : 0;
    const ca = this._a.getColor(led);
    const cb = this._b.getColor(led);
    return mkColor(ca.r*(1-t)+cb.r*t, ca.g*(1-t)+cb.g*t, ca.b*(1-t)+cb.b*t, t);
  }
}

// ── Stripes<width, speed, C1, C2, ...> ───────────────────────────────────────
// Moving stripe pattern. Approximated as a scrolling gradient.
class StripesNode {
  constructor(width, speed, colors) {
    this._speed  = +speed  || 0;
    this._colors = colors;
    this._t = 0; this._n = 132;
  }
  run(blade) {
    this._n = blade.ledCount;
    this._t = blade.micros / 1000000; // seconds
    this._colors.forEach(c => c.run(blade));
  }
  getColor(led) {
    const n = this._colors.length;
    if (n === 0) return BLACK;
    const scroll  = this._t * this._speed * 0.001 * this._n;
    const posF    = ((led + scroll) % this._n + this._n) % this._n;
    const t       = posF / Math.max(1, this._n - 1);
    const seg     = Math.min(n - 2, Math.floor(t * (n - 1)));
    const tSeg    = t * (n - 1) - seg;
    return mixColors(this._colors[seg].getColor(led), this._colors[(seg + 1) % n].getColor(led), tSeg);
  }
}

// ── IsLessThan<x, threshold> ──────────────────────────────────────────────────
class IsLessThanNode {
  constructor(x, thresh) { this._x = x; this._thresh = thresh; }
  run(blade) { this._x.run(blade); this._thresh.run(blade); }
  getValue(led) {
    return (this._x.getValue ? this._x.getValue(led) : 0) <
           (this._thresh.getValue ? this._thresh.getValue(led) : 0) ? 1 : 0;
  }
}

// ── Transparent stub ──────────────────────────────────────────────────────────
// Returned for unrecognised nodes so they don't corrupt Layers blending.
const TRANSPARENT = Object.freeze({
  run(_b) {},
  getColor(_l) { return mkColor(0, 0, 0, 0); },
  getValue(_l) { return 0; },
});

// ── Primitive style nodes ─────────────────────────────────────────────────────

// Rgb<R, G, B>  — constant colour, 0-255 integer args
class RgbNode {
  constructor(r, g, b) {
    this._c = mkColor(r / 255, g / 255, b / 255);
  }
  run(_blade) {}
  getColor(_led) { return this._c; }
}

// Int<N> — integer constant (used as layer mix value, 0–32768 range in ProffieOS)
class IntNode {
  constructor(v) { this._v = v; }
  run(_blade) {}
  getValue(_led) { return this._v / 32768; } // normalise to 0–1
  getColor(_led) { return mkColor(0, 0, 0, 0); } // safe fallback if misused as color
}

// ── InOutFuncX<ignitionMs, retractionMs> ──────────────────────────────────────
// Returns a scalar 0–1 representing the in/out progress.
// Used by InOutHelperL to mask the blade length.
class InOutFuncXNode {
  constructor(ignMs, retMs) {
    this._ignMs = ignMs;
    this._retMs = retMs;
    this._t = 0;
    this._dir = 0; // 0=off, 1=igniting, -1=retracting, 2=on
  }
  run(blade) {
    const dt = blade._lastDeltaMs || 0;
    if (blade.on) {
      if (this._dir !== 2) {
        if (this._dir === 0) { this._t = 0; this._dir = 1; }
        this._t = Math.min(1, this._t + dt / this._ignMs);
        if (this._t >= 1) this._dir = 2;
      }
    } else {
      if (this._dir !== 0) {
        if (this._dir === 2) { this._t = 1; this._dir = -1; }
        if (this._dir === -1) {
          this._t = Math.max(0, this._t - dt / this._retMs);
          if (this._t <= 0) this._dir = 0;
        }
      }
    }
  }
  getValue() { return this._t; }
}

// ── AlphaL<layer, alphaFunc> ──────────────────────────────────────────────────
// Applies alphaFunc.getValue() as alpha multiplier to layer.getColor().
class AlphaLNode {
  constructor(layer, alphaFn) {
    this._layer   = layer;
    this._alphaFn = alphaFn;
  }
  run(blade) { this._layer.run(blade); this._alphaFn.run(blade); }
  getColor(led) {
    const a = this._alphaFn.getValue ? this._alphaFn.getValue(led) : 0;
    const c = this._layer.getColor(led);
    return mkColor(c.r * a, c.g * a, c.b * a, c.a * a);
  }
}

// ── InOutHelperL<inOutFunc> ───────────────────────────────────────────────────
// Masks LEDs: shows from base to `inOutFunc.getValue() * ledCount`.
class InOutHelperLNode {
  constructor(inOutFn) { this._fn = inOutFn; }
  run(blade) { this._ledCount = blade.ledCount; this._fn.run(blade); }
  getColor(led) {
    const lit = this._fn.getValue() * this._ledCount;
    if (led >= lit) return BLACK;
    // Smooth the lit/unlit boundary
    const edge = lit - led;
    if (edge < 1) return mkColor(0, 0, 0, 0); // handled by Layers below
    return mkColor(1, 1, 1); // full white mask (intended to be used via Layers)
  }
}

// ── Mix<amount, layer1, layer2> ───────────────────────────────────────────────
class MixNode {
  constructor(amount, a, b) { this._amount = amount; this._a = a; this._b = b; }
  run(blade) { this._a.run(blade); this._b.run(blade); this._amount.run(blade); }
  getColor(led) {
    const t = this._amount.getValue ? this._amount.getValue(led) : 0;
    return mixColors(this._a.getColor(led), this._b.getColor(led), t);
  }
}

// ── Layers<base, ...overlays> ────────────────────────────────────────────────
// Composite layers: each overlay blends over the base using its alpha channel.
class LayersNode {
  constructor(layers) { this._layers = layers; }
  run(blade) { this._layers.forEach(l => l.run(blade)); }
  getColor(led) {
    let out = this._layers[0].getColor(led);
    for (let i = 1; i < this._layers.length; i++) {
      const over = this._layers[i].getColor(led);
      const a = over.a;
      out = mkColor(
        out.r * (1 - a) + over.r * a,
        out.g * (1 - a) + over.g * a,
        out.b * (1 - a) + over.b * a,
      );
    }
    return out;
  }
}

// ── SimpleClashL<color> ───────────────────────────────────────────────────────
// Flashes the whole blade to <color> on a clash effect.
class SimpleClashLNode {
  constructor(color) {
    this._color = color;
    this._t     = 0;   // 0–1, fades out over ~200ms
  }
  run(blade) {
    const dt = blade._lastDeltaMs || 0;
    if (blade.consumeEffects?.('clash').length) this._t = 1;
    this._t = Math.max(0, this._t - dt / 200);
  }
  getColor(led) {
    if (this._t <= 0) return mkColor(0, 0, 0, 0);
    const c = this._color.getColor(led);
    return mkColor(c.r, c.g, c.b, this._t);
  }
}

// ── InOutHelper<style, ignitionMs, retractionMs> ──────────────────────────────
// Full ignition/retraction wrapper. Reads blade.on; masks LEDs from base→tip
// during ignition and tip→base during retraction.
class InOutHelperNode {
  constructor(inner, ignMs, retMs) {
    this._inner  = inner;
    this._ignMs  = ignMs  || 300;
    this._retMs  = retMs  || 800;
    this._t      = 0;     // 0=fully off, 1=fully on
    this._dir    = 0;     // 0=off, 1=igniting, 2=on, -1=retracting
    this._n      = 132;
  }
  run(blade) {
    const dt = blade._lastDeltaMs || 0;
    this._n = blade.ledCount;
    if (blade.on) {
      if (this._dir !== 2) {
        if (this._dir <= 0) { this._t = 0; this._dir = 1; }
        this._t = Math.min(1, this._t + dt / this._ignMs);
        if (this._t >= 1) this._dir = 2;
      }
    } else {
      if (this._dir !== 0) {
        if (this._dir >= 1) { if (this._dir === 2) this._t = 1; this._dir = -1; }
        this._t = Math.max(0, this._t - dt / this._retMs);
        if (this._t <= 0) this._dir = 0;
      }
    }
    this._inner.run(blade);
  }
  getColor(led) {
    if (this._t <= 0) return BLACK;
    const litLed = this._t * this._n;
    const dist   = litLed - led;
    if (dist <= 0) return BLACK;
    const c = this._inner.getColor(led);
    // 1-LED soft tip edge
    if (dist < 1) return mkColor(c.r * dist, c.g * dist, c.b * dist);
    return c;
  }
}

// ── EasyBlade<baseStyle, clashColor> ─────────────────────────────────────────
// Convenience wrapper: base style + SimpleClashL overlay.
class EasyBladeNode {
  constructor(base, clashColor) {
    this._base  = base;
    this._clash = new SimpleClashLNode(clashColor);
  }
  run(blade) { this._base.run(blade); this._clash.run(blade); }
  getColor(led) {
    const b = this._base.getColor(led);
    const c = this._clash.getColor(led);
    const a = c.a;
    return mkColor(b.r * (1 - a) + c.r * a, b.g * (1 - a) + c.g * a, b.b * (1 - a) + c.b * a);
  }
}

// ── SimpleClash<base, clashColor> ────────────────────────────────────────────
// Non-L version: complete style that flashes clashColor on clash events.
class SimpleClashNode {
  constructor(base, clashColor) {
    this._base  = base;
    this._clash = new SimpleClashLNode(clashColor);
  }
  run(blade) { this._base.run(blade); this._clash.run(blade); }
  getColor(led) {
    const b = this._base.getColor(led);
    const c = this._clash.getColor(led);
    const a = c.a;
    return mkColor(b.r*(1-a)+c.r*a, b.g*(1-a)+c.g*a, b.b*(1-a)+c.b*a);
  }
}

// ── Lockup<base, lockupColor, drag?, melt?> ───────────────────────────────────
// Shows lockupColor while blade.lockup (or drag/melt) is true, else base.
class LockupNode {
  constructor(base, lockupColor) {
    this._base   = base;
    this._lockup = lockupColor;
    this._on     = false;
  }
  run(blade) {
    this._on = !!(blade.lockup || blade.drag || blade.melt);
    this._base.run(blade);
    this._lockup.run(blade);
  }
  getColor(led) {
    return this._on ? this._lockup.getColor(led) : this._base.getColor(led);
  }
}

// ── Blast<base, blastColor, fadeMs=200> ──────────────────────────────────────
// Flashes blastColor on blast events, fades back to base.
class BlastNode {
  constructor(base, blastColor) {
    this._base  = base;
    this._blast = blastColor;
    this._t     = 0;
  }
  run(blade) {
    const dt = blade._lastDeltaMs || 0;
    if (blade.consumeEffects?.('blast').length) this._t = 1;
    this._t = Math.max(0, this._t - dt / 200);
    this._base.run(blade);
    this._blast.run(blade);
  }
  getColor(led) {
    if (this._t <= 0) return this._base.getColor(led);
    const b = this._base.getColor(led);
    const c = this._blast.getColor(led);
    return mkColor(b.r*(1-this._t)+c.r*this._t, b.g*(1-this._t)+c.g*this._t, b.b*(1-this._t)+c.b*this._t);
  }
}

// ── Sparkle<baseColor, density=200> ──────────────────────────────────────────
// Adds random white spark flashes to individual LEDs.
// density is 0–32768 (ProffieOS range); higher = more sparks.
class SparkleNode {
  constructor(color, density) {
    this._color   = color;
    this._density = density !== undefined ? +density : 200;
    this._sparks  = [];
  }
  run(blade) {
    this._color.run(blade);
    const n    = blade.ledCount;
    const prob = this._density / 32768;
    if (this._sparks.length !== n) this._sparks = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      this._sparks[i] = Math.max(0, this._sparks[i] - 0.08);
      if (Math.random() < prob) this._sparks[i] = 0.7 + Math.random() * 0.3;
    }
  }
  getColor(led) {
    const c = this._color.getColor(led);
    const s = this._sparks[led] || 0;
    if (s <= 0) return c;
    return mkColor(Math.min(1, c.r + s), Math.min(1, c.g + s), Math.min(1, c.b + s));
  }
}

// ── Rgb16<R, G, B> — 16-bit colour (0–65535 per channel) ─────────────────────
class Rgb16Node {
  constructor(r, g, b) { this._c = mkColor(r / 65535, g / 65535, b / 65535); }
  run(_blade) {}
  getColor(_led) { return this._c; }
}

// ── AudioFlicker<A, B> ────────────────────────────────────────────────────────
// Simulates audio-reactive flicker by randomly blending A and B each frame.
class AudioFlickerNode {
  constructor(a, b) { this._a = a; this._b = b; this._t = 0.5; }
  run(blade) { this._a.run(blade); this._b.run(blade); this._t = 0.3 + Math.random() * 0.7; }
  getColor(led) { return mixColors(this._a.getColor(led), this._b.getColor(led), 1 - this._t); }
}

// ── AudioFlickerL<color> ──────────────────────────────────────────────────────
class AudioFlickerLNode {
  constructor(color) { this._color = color; this._t = 1; }
  run(blade) { this._color.run(blade); this._t = 0.4 + Math.random() * 0.6; }
  getColor(led) {
    const c = this._color.getColor(led);
    return mkColor(c.r * this._t, c.g * this._t, c.b * this._t, c.a);
  }
}

// ── HumpFlicker<A, B, width> ──────────────────────────────────────────────────
class HumpFlickerNode {
  constructor(a, b, width) { this._a = a; this._b = b; this._w = +width || 10; this._vals = []; }
  run(blade) {
    this._a.run(blade); this._b.run(blade);
    const n = blade.ledCount;
    if (this._vals.length !== n) this._vals = new Array(n).fill(0);
    for (let i = 0; i < n; i++) this._vals[i] = Math.random();
  }
  getColor(led) { return mixColors(this._a.getColor(led), this._b.getColor(led), this._vals[led] || 0); }
}

// ── HumpFlickerL<layer, width> ────────────────────────────────────────────────
class HumpFlickerLNode {
  constructor(layer, width) { this._layer = layer; this._w = +width || 10; this._vals = []; }
  run(blade) {
    this._layer.run(blade);
    const n = blade.ledCount;
    if (this._vals.length !== n) this._vals = new Array(n).fill(0);
    for (let i = 0; i < n; i++) this._vals[i] = Math.random();
  }
  getColor(led) {
    const c = this._layer.getColor(led);
    const v = this._vals[led] || 0;
    return mkColor(c.r * v, c.g * v, c.b * v, c.a * v);
  }
}

// ── Gradient<C1, C2, ...> ─────────────────────────────────────────────────────
// Evenly-spaced multi-stop colour gradient along blade length.
class GradientNode {
  constructor(colors) { this._colors = colors; this._n = 132; }
  run(blade) { this._n = blade.ledCount; this._colors.forEach(c => c.run(blade)); }
  getColor(led) {
    const n = this._colors.length;
    if (n === 0) return BLACK;
    if (n === 1) return this._colors[0].getColor(led);
    const t   = led / Math.max(1, this._n - 1);
    const seg = Math.min(n - 2, Math.floor(t * (n - 1)));
    const ts  = t * (n - 1) - seg;
    return mixColors(this._colors[seg].getColor(led), this._colors[seg + 1].getColor(led), ts);
  }
}

// ── Bump<pos, width> ──────────────────────────────────────────────────────────
// Gaussian bump; returns a scalar via getValue() for use as AlphaL alpha.
// pos and width are value nodes normalised 0–1 (Int<N>/32768).
class BumpNode {
  constructor(pos, width) { this._pos = pos; this._width = width; this._n = 132; }
  run(blade) {
    this._n = blade.ledCount;
    this._pos.run(blade); this._width.run(blade);
  }
  getValue(led) {
    const pos   = this._pos.getValue   ? this._pos.getValue(led)   : 0.5;
    const width = (this._width.getValue ? this._width.getValue(led) : 0.15) + 0.001;
    const frac  = led / Math.max(1, this._n - 1);
    const d     = (frac - pos) / width;
    return Math.exp(-d * d * 2);
  }
  getColor(_led) { return mkColor(0, 0, 0, 0); }
}

// ── Scale<x, lo, hi> ─────────────────────────────────────────────────────────
class ScaleNode {
  constructor(x, lo, hi) { this._x = x; this._lo = lo; this._hi = hi; }
  run(blade) { this._x.run(blade); this._lo.run(blade); this._hi.run(blade); }
  getValue(led) {
    const t  = this._x.getValue  ? this._x.getValue(led)  : 0;
    const lo = this._lo.getValue ? this._lo.getValue(led) : 0;
    const hi = this._hi.getValue ? this._hi.getValue(led) : 1;
    return lo + (hi - lo) * t;
  }
}

// ── SmoothStep<pos, width> ────────────────────────────────────────────────────
class SmoothStepNode {
  constructor(pos, width) { this._pos = pos; this._width = width; this._n = 132; }
  run(blade) { this._n = blade.ledCount; this._pos.run(blade); this._width.run(blade); }
  getValue(led) {
    const pos   = this._pos.getValue   ? this._pos.getValue(led)   : 0.5;
    const width = (this._width.getValue ? this._width.getValue(led) : 0.1) + 0.001;
    const frac  = led / Math.max(1, this._n - 1);
    const t     = Math.max(0, Math.min(1, (frac - (pos - width)) / (width * 2)));
    return t * t * (3 - 2 * t);
  }
}

// ── Stub sensor/motion value nodes ───────────────────────────────────────────
// No hardware in simulator — return fixed neutral values.
class _StubVal {
  constructor(v = 0) { this._v = v; }
  run(_b) {}
  getValue(_l) { return this._v; }
  getColor(_l) { return mkColor(0, 0, 0, 0); }
}

// ── RandomFlicker<A, B> ───────────────────────────────────────────────────────
// Each LED independently flickers between A and B each frame.
class RandomFlickerNode {
  constructor(a, b) { this._a = a; this._b = b; this._vals = []; }
  run(blade) {
    this._a.run(blade); this._b.run(blade);
    const n = blade.ledCount;
    if (this._vals.length !== n) this._vals = new Array(n).fill(0);
    for (let i = 0; i < n; i++) this._vals[i] = Math.random();
  }
  getColor(led) {
    return mixColors(this._a.getColor(led), this._b.getColor(led), this._vals[led] || 0);
  }
}

// ── Ifon<A, B> ────────────────────────────────────────────────────────────────
// Returns A when blade is on, B when off.
class IfonNode {
  constructor(a, b) { this._a = a; this._b = b; this._on = false; }
  run(blade) { this._on = blade.on; this._a.run(blade); this._b.run(blade); }
  getColor(led) { return (this._on ? this._a : this._b).getColor(led); }
  getValue(led) {
    const src = this._on ? this._a : this._b;
    return src.getValue ? src.getValue(led) : 0;
  }
}

// ── Sin<periodMs> / Saw<periodMs> ────────────────────────────────────────────
// Oscillating scalar value nodes (0–1 range, normalised from ProffieOS 0–32768).
class SinNode {
  constructor(period) { this._ms = +period || 1000; this._t = 0; }
  run(blade) { this._t = blade.micros / 1000; }
  getValue(_l) { return 0.5 + 0.5 * Math.sin(this._t / this._ms * Math.PI * 2); }
  getColor(_l) { return mkColor(0, 0, 0, 0); }
}
class SawNode {
  constructor(period) { this._ms = +period || 1000; this._t = 0; }
  run(blade) { this._t = blade.micros / 1000; }
  getValue(_l) { return (this._t % this._ms) / this._ms; }
  getColor(_l) { return mkColor(0, 0, 0, 0); }
}

// ── Subtract<A, B> ────────────────────────────────────────────────────────────
// Scalar: A - B (clamped 0-1). Colour: pixel-wise subtract.
function _makeSubtractNode(a, b) {
  return {
    run(bl) { a.run(bl); b.run(bl); },
    getValue(l) { return Math.max(0, (a.getValue?.(l) ?? 0) - (b.getValue?.(l) ?? 0)); },
    getColor(l) {
      const ca = a.getColor(l), cb = b.getColor(l);
      return mkColor(ca.r - cb.r, ca.g - cb.g, ca.b - cb.b, ca.a);
    },
  };
}

// ── OnSparkL<color, fadeMs> ───────────────────────────────────────────────────
// White spark at tip on ignition, fades out quickly.
class OnSparkLNode {
  constructor(color, ms) { this._color = color; this._ms = +ms || 300; this._t = 0; this._fired = false; }
  run(blade) {
    const dt = blade._lastDeltaMs || 0;
    this._color.run(blade);
    if (blade.on && !this._fired) { this._t = 1; this._fired = true; }
    if (!blade.on) this._fired = false;
    this._t = Math.max(0, this._t - dt / this._ms);
  }
  getColor(led) {
    if (this._t <= 0) return mkColor(0, 0, 0, 0);
    const c = this._color.getColor(led);
    return mkColor(c.r, c.g, c.b, c.a * this._t);
  }
}

// ── SparkleL<color, density> ──────────────────────────────────────────────────
// Layer version of Sparkle — adds sparks over whatever is below.
class SparkleLNode {
  constructor(color, density) {
    this._color   = color;
    this._density = density !== undefined ? +density : 200;
    this._sparks  = [];
  }
  run(blade) {
    this._color.run(blade);
    const n    = blade.ledCount;
    const prob = this._density / 32768;
    if (this._sparks.length !== n) this._sparks = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      this._sparks[i] = Math.max(0, this._sparks[i] - 0.08);
      if (Math.random() < prob) this._sparks[i] = 0.7 + Math.random() * 0.3;
    }
  }
  getColor(led) {
    const s = this._sparks[led] || 0;
    if (s <= 0) return mkColor(0, 0, 0, 0);
    const c = this._color.getColor(led);
    return mkColor(c.r, c.g, c.b, s);
  }
}

// ── Strobe<A, B, rateHz, holdMs> ─────────────────────────────────────────────
// Alternates between A and B. ProffieOS rateHz is flashes-per-second.
class StrobeNode {
  constructor(a, b, rate) {
    this._a = a; this._b = b;
    this._rateHz = +rate || 10;
    this._phase = 0;
  }
  run(blade) {
    this._a.run(blade); this._b.run(blade);
    const periodMs = 1000 / this._rateHz;
    this._phase = (blade.micros / 1000) % periodMs / periodMs;
  }
  getColor(led) {
    return (this._phase < 0.5 ? this._a : this._b).getColor(led);
  }
}

// ── StrobeL<color, rateHz> ────────────────────────────────────────────────────
// Layer that strobes — returns color at full alpha or transparent.
class StrobeLNode {
  constructor(color, rate) { this._color = color; this._rateHz = +rate || 10; this._phase = 0; }
  run(blade) {
    this._color.run(blade);
    const periodMs = 1000 / this._rateHz;
    this._phase = (blade.micros / 1000) % periodMs / periodMs;
  }
  getColor(led) {
    if (this._phase >= 0.5) return mkColor(0, 0, 0, 0);
    return this._color.getColor(led);
  }
}

// ── ResponsiveLockupL<color, beginFn, endFn, sizeNode> ────────────────────────
// Shows color while lockup active, with size/position driven by motion.
class ResponsiveLockupLNode {
  constructor(color) { this._color = color; this._on = false; }
  run(blade) { this._on = blade.lockup; this._color.run(blade); }
  getColor(led) {
    if (!this._on) return mkColor(0, 0, 0, 0);
    return this._color.getColor(led);
  }
}

// ── ResponsiveMeltL<color, sizeNode> ─────────────────────────────────────────
// Shows color while melt/drag active.
class ResponsiveMeltLNode {
  constructor(color) { this._color = color; this._on = false; }
  run(blade) { this._on = blade.melt || blade.drag; this._color.run(blade); }
  getColor(led) {
    if (!this._on) return mkColor(0, 0, 0, 0);
    return this._color.getColor(led);
  }
}

// ── Transition nodes (TrFade, TrWipe, etc.) ───────────────────────────────────
// Carry a _ms duration so InOutTrL / LockupTrL can extract timing; otherwise
// behave as transparent stubs.
class TrNode {
  constructor(ms) { this._ms = Math.max(0, +ms || 0); }
  run(_b) {}
  getColor(_l) { return mkColor(0, 0, 0, 0); }
  getValue(_l) { return 0; }
}

// ── TrConcatNode — transition sequence that also carries a colour ─────────────
// TrConcat / TrJoin in TransitionEffectL contain colour nodes between Tr* nodes.
// This extracts the first colour node so TransitionEffectL can display it.
class TrConcatNode {
  constructor(ms, colorNode) { this._ms = ms; this._color = colorNode; }
  run(blade) { if (this._color.run) this._color.run(blade); }
  getColor(led) { return this._color.getColor ? this._color.getColor(led) : mkColor(0, 0, 0, 0); }
  getValue(_l) { return 0; }
}

// ── InOutTrL<TrIn, TrOut> ─────────────────────────────────────────────────────
// Wipe-reveal ignition/retraction layer.
// Off  → opaque black (hides base).  On → transparent (base shows through).
// Wipe front travels base→tip on ignition, tip→base on retraction.
class InOutTrLNode {
  constructor(trIn, trOut) {
    this._ignMs = trIn._ms  || 300;
    this._retMs = trOut._ms || 800;
    this._t     = 0;
    this._dir   = 0; // 0=off, 1=igniting, 2=on, -1=retracting
    this._n     = 132;
  }
  run(blade) {
    const dt = blade._lastDeltaMs || 0;
    this._n  = blade.ledCount;
    if (blade.on) {
      if (this._dir !== 2) {
        if (this._dir <= 0) { this._t = 0; this._dir = 1; }
        this._t = Math.min(1, this._t + dt / this._ignMs);
        if (this._t >= 1) this._dir = 2;
      }
    } else {
      if (this._dir !== 0) {
        if (this._dir >= 1) { if (this._dir === 2) this._t = 1; this._dir = -1; }
        this._t = Math.max(0, this._t - dt / this._retMs);
        if (this._t <= 0) this._dir = 0;
      }
    }
  }
  getColor(led) {
    if (this._t >= 1) return mkColor(0, 0, 0, 0);  // fully on: transparent
    if (this._t <= 0) return mkColor(0, 0, 0, 1);  // fully off: opaque black
    const litLed = this._t * this._n;
    const dist   = litLed - led;
    if (dist > 1)  return mkColor(0, 0, 0, 0);     // revealed: transparent
    if (dist <= 0) return mkColor(0, 0, 0, 1);     // hidden:   opaque black
    return mkColor(0, 0, 0, 1 - dist);             // soft edge
  }
}

// ── LockupTrL<inner, TrStart, TrEnd, type> ────────────────────────────────────
// Shows inner while the matching lockup state is active; transparent otherwise.
// type: 'lockup' (NORMAL), 'drag' (LOCKUP_DRAG), 'melt' (LOCKUP_MELT)
class LockupTrLNode {
  constructor(inner, type) {
    this._inner = inner;
    this._type  = type || 'lockup';
    this._on    = false;
  }
  run(blade) {
    this._on = this._type === 'drag' ? blade.drag
             : this._type === 'melt' ? blade.melt
             : blade.lockup;
    this._inner.run(blade);
  }
  getColor(led) {
    if (!this._on) return mkColor(0, 0, 0, 0);
    return this._inner.getColor(led);
  }
}

// ── TransitionEffectL<Tr, EFFECT> ─────────────────────────────────────────────
// Plays a brief transition when a matching effect fires.
// Simplified: fires on any matching effect type, fades out over _dur ms.
class TransitionEffectLNode {
  constructor(inner, effectType, dur) {
    this._inner  = inner;
    this._effect = effectType;
    this._dur    = dur || 600;
    this._alpha  = 0;
  }
  run(blade) {
    const dt = blade._lastDeltaMs || 0;
    // Peek at pending effects without consuming them (consumption is done by SimpleClashLNode)
    for (const e of (blade._effects || [])) {
      if (e.type === this._effect) { this._alpha = 1; break; }
    }
    this._alpha = Math.max(0, this._alpha - dt / this._dur);
    this._inner.run(blade);
  }
  getColor(led) {
    if (this._alpha <= 0) return mkColor(0, 0, 0, 0);
    const c = this._inner.getColor(led);
    return mkColor(c.r, c.g, c.b, c.a * this._alpha);
  }
}

// ── StylePtr<style> wrapper ───────────────────────────────────────────────────
// Top-level wrapper; the style string produces this.
class StylePtr {
  constructor(inner) { this._inner = inner; }
  run(blade) { this._inner.run(blade); }
  getColor(led) { return this._inner.getColor(led); }
}

// ── Argument nodes (stubs) ────────────────────────────────────────────────────
// RgbArg<argId, default> — return the default colour for now
class RgbArgNode {
  constructor(_argId, defaultColor) { this._c = defaultColor; }
  run(blade) { this._c.run(blade); }
  getColor(led) { return this._c.getColor(led); }
}
class IntArgNode {
  constructor(_argId, defaultVal) { this._v = defaultVal; }
  run(_blade) { if (this._v.run) this._v.run(_blade); }
  getValue(led) { return this._v.getValue ? this._v.getValue(led) : this._v / 32768; }
}

// ── Parser ────────────────────────────────────────────────────────────────────

function parseStyle(text) {
  // Strip the outermost () constructor call, then let buildNode handle everything
  return buildNode(text.trim().replace(/\(\s*\)\s*$/, ''));
}

// Bracket-counting tokenizer: splits any "Name<args...>" form without regex backtracking.
// Returns { name, args } — never throws on structurally odd input.
function _tokenize(expr) {
  expr = expr.trim().replace(/\(\s*\)\s*$/, ''); // strip any trailing () in nested exprs too
  const lt = expr.indexOf('<');
  if (lt === -1) return { name: expr, args: [] };
  const name = expr.slice(0, lt).trim();
  let depth = 0, close = -1;
  for (let i = lt; i < expr.length; i++) {
    if      (expr[i] === '<') depth++;
    else if (expr[i] === '>') { if (--depth === 0) { close = i; break; } }
  }
  const inner = expr.slice(lt + 1, close !== -1 ? close : expr.length);
  return { name, args: inner.trim() ? splitArgs(inner) : [] };
}

// Build a node tree from a ProffieOS style expression.
function buildNode(expr) {
  expr = expr.trim();

  // Numeric literal
  if (/^-?\d+(\.\d+)?$/.test(expr)) return new IntNode(+expr);

  const { name, args } = _tokenize(expr);

  // Must start with a valid identifier
  if (!name || !/^[A-Za-z_][A-Za-z0-9_:]*$/.test(name))
    throw new Error(`Cannot parse: ${expr.slice(0, 60)}`);

  return buildNodeByName(name, args);
}

function buildNodeByName(name, args) {
  // ── Scoped constants (SaberBase::LOCKUP_NORMAL) and EFFECT_* symbols ──────
  if (name.includes('::') || name.startsWith('EFFECT_')) return TRANSPARENT;

  switch (name) {
    // ── Colour constants ───────────────────────────────────────────────────
    case 'Rgb':         return new RgbNode(+args[0], +args[1], +args[2]);
    case 'Rgb16':       return new Rgb16Node(+args[0], +args[1], +args[2]);
    case 'Red':         return new RgbNode(255, 0, 0);
    case 'Green':       return new RgbNode(0, 255, 0);
    case 'Blue':        return new RgbNode(0, 0, 255);
    case 'White':       return new RgbNode(255, 255, 255);
    case 'Black':       return new RgbNode(0, 0, 0);
    case 'Cyan':        return new RgbNode(0, 255, 255);
    case 'Yellow':      return new RgbNode(255, 255, 0);
    case 'Orange':      return new RgbNode(255, 128, 0);
    case 'Magenta':     return new RgbNode(255, 0, 255);
    case 'Purple':      return new RgbNode(128, 0, 128);
    case 'Violet':      return new RgbNode(238, 130, 238);
    case 'Indigo':      return new RgbNode(75, 0, 130);
    case 'Pink':        return new RgbNode(255, 192, 203);
    case 'HotPink':     return new RgbNode(255, 105, 180);
    case 'DeepPink':    return new RgbNode(255, 20, 147);
    case 'DodgerBlue':  return new RgbNode(30, 144, 255);
    case 'DeepSkyBlue': return new RgbNode(0, 191, 255);
    case 'SkyBlue':     return new RgbNode(135, 206, 235);
    case 'SteelBlue':   return new RgbNode(70, 130, 180);
    case 'LightBlue':   return new RgbNode(173, 216, 230);
    case 'Turquoise':   return new RgbNode(64, 224, 208);
    case 'SpringGreen': return new RgbNode(0, 255, 127);
    case 'LightGreen':  return new RgbNode(144, 238, 144);
    case 'Lime':        return new RgbNode(0, 255, 0);
    case 'DarkOrange':  return new RgbNode(255, 140, 0);
    case 'OrangeRed':   return new RgbNode(255, 69, 0);
    case 'Gold':        return new RgbNode(255, 215, 0);
    case 'Crimson':     return new RgbNode(220, 20, 60);
    case 'DarkRed':     return new RgbNode(139, 0, 0);
    case 'Maroon':      return new RgbNode(128, 0, 0);
    case 'Silver':      return new RgbNode(192, 192, 192);
    case 'Gray':
    case 'Grey':        return new RgbNode(128, 128, 128);
    case 'DimGray':
    case 'DimGrey':     return new RgbNode(105, 105, 105);

    // ── Scalar constants ───────────────────────────────────────────────────
    case 'Int':         return new IntNode(+args[0]);

    // ── Named colour constants (extended) ─────────────────────────────────
    case 'Moccasin':    return new RgbNode(255, 228, 181);
    case 'PeachPuff':   return new RgbNode(255, 218, 185);
    case 'Wheat':       return new RgbNode(245, 222, 179);
    case 'Bisque':      return new RgbNode(255, 228, 196);
    case 'Coral':       return new RgbNode(255, 127, 80);
    case 'Salmon':      return new RgbNode(250, 128, 114);
    case 'Tomato':      return new RgbNode(255, 99, 71);
    case 'Chartreuse':  return new RgbNode(127, 255, 0);
    case 'Aqua':        return new RgbNode(0, 255, 255);
    case 'Teal':        return new RgbNode(0, 128, 128);
    case 'Navy':        return new RgbNode(0, 0, 128);
    case 'Azure':       return new RgbNode(240, 255, 255);
    case 'Lavender':    return new RgbNode(230, 230, 250);
    case 'Fuchsia':     return new RgbNode(255, 0, 255);
    case 'Brown':       return new RgbNode(165, 42, 42);
    case 'SaddleBrown': return new RgbNode(139, 69, 19);
    case 'Chocolate':   return new RgbNode(210, 105, 30);

    // ── Hue-rotation / variation — no hardware, ignore rotation ──────────
    // RotateColorsX<Variation, Color> → return Color unchanged (Variation=0)
    case 'RotateColorsX':
    case 'RotateColors': return args[1] ? buildNode(args[1]) : TRANSPARENT;
    case 'Variation':    return new _StubVal(0);

    // ── Sensor / motion stubs (no hardware in simulator) ──────────────────
    case 'BladeAngle':    return new _StubVal(0.5);
    case 'SwingSpeed':    return new _StubVal(0);
    case 'SwingAcceleration': return new _StubVal(0);
    case 'TwistAngle':    return new _StubVal(0);
    case 'BatteryLevel':  return new _StubVal(0.8);
    case 'VolumeLevel':   return new _StubVal(0.7);
    case 'SlowNoise':     return new _StubVal(0.5);
    case 'NoisySoundLevel': return new _StubVal(0.5);
    case 'ClashImpactF':  return new _StubVal(0);
    case 'EffectRandomF': return new _StubVal(0.5);
    case 'EffectPosition': return new _StubVal(0.5);
    case 'HoldPeakF':     return new _StubVal(0);
    case 'LockupPulseF':  return new _StubVal(0);
    case 'IsLessThan':    return new IsLessThanNode(buildNode(args[0]), buildNode(args[1]));
    case 'IsGreaterThan': return new IsLessThanNode(buildNode(args[1]), buildNode(args[0]));
    case 'Trigger':       return new _StubVal(0);
    case 'WavLen':        return new _StubVal(500 / 32768);
    case 'Sum': {
      const a = args[0] ? buildNode(args[0]) : new _StubVal(0);
      const b = args[1] ? buildNode(args[1]) : new _StubVal(0);
      return { run(bl) { a.run(bl); b.run(bl); },
               getValue(l) { return (a.getValue?.(l)??0) + (b.getValue?.(l)??0); },
               getColor(_l) { return mkColor(0,0,0,0); } };
    }
    case 'Mult': {
      const a = args[0] ? buildNode(args[0]) : new _StubVal(0);
      const b = args[1] ? buildNode(args[1]) : new _StubVal(1);
      return { run(bl) { a.run(bl); b.run(bl); },
               getValue(l) { return (a.getValue?.(l)??0) * (b.getValue?.(l)??1); },
               getColor(_l) { return mkColor(0,0,0,0); } };
    }

    // ── Transition timing nodes ───────────────────────────────────────────
    case 'TrInstant':       return new TrNode(0);
    case 'TrFade':
    case 'TrSmoothFade':
    case 'TrDelay':
    case 'TrWipe':
    case 'TrWipeIn':        return new TrNode(+args[0] || 300);
    // Variable-time wipe — build the ms node and call getValue() for actual timing
    case 'TrWipeX':
    case 'TrWipeInX': {
      if (!args[0]) return new TrNode(300);
      try {
        const n = buildNode(args[0]);
        const ms = n.getValue ? n.getValue(0) : (n._ms || 300);
        return new TrNode(Math.max(50, ms > 0 ? ms : 300));
      } catch(_) { return new TrNode(300); }
    }
    // Timing utility nodes — must expose getValue() so TrWipeX can use them
    case 'IgnitionTime': {
      const ms = +args[0] || 300;
      return { _ms: ms, run(){}, getValue(){ return ms; }, getColor(){ return mkColor(0,0,0,0); } };
    }
    case 'RetractionTime': {
      const ms = +args[0] > 0 ? +args[0] : 800;
      return { _ms: ms, run(){}, getValue(){ return ms; }, getColor(){ return mkColor(0,0,0,0); } };
    }
    case 'BendTimePowX': {
      // BendTimePowX<msNode, powerNode> — apply power curve to timing; sim uses msNode directly
      try {
        const n = args[0] ? buildNode(args[0]) : null;
        const ms = (n?.getValue?.(0) ?? n?._ms ?? 0);
        return { _ms: Math.max(50, ms > 0 ? ms : 800), run(){}, getValue(){ return Math.max(50, ms > 0 ? ms : 800); }, getColor(){ return mkColor(0,0,0,0); } };
      } catch(_) { return { _ms: 800, run(){}, getValue(){ return 800; }, getColor(){ return mkColor(0,0,0,0); } }; }
    }
    case 'TrWipeSparkTip':
    case 'TrWipeInSparkTip':return new TrNode(+args[1] || +args[0] || 300);
    case 'TrBoing':         return new TrNode(+args[0] || 300);
    case 'TrExtend': {
      const inner = args[1] ? (() => { try { return buildNode(args[1]); } catch(_) { return TRANSPARENT; } })() : TRANSPARENT;
      return new TrNode((+args[0] || 0) + (inner._ms || 0));
    }
    case 'TrWaveX': {
      // TrWaveX<color, waveSizeMs, waveWidthMs, spanMs, startPos>
      const ms = args[3] ? (parseInt(args[3].replace(/\D/g, '')) || 300) : 300;
      return new TrNode(ms);
    }
    case 'TrLoopIf':
    case 'TransitionLoopL': return new TrNode(+args[0] || 300);
    case 'TrJoin':
    case 'TrConcat': {
      // Sum durations; extract first actual colour node for use in TransitionEffectL.
      let ms = 0, colorNode = TRANSPARENT;
      for (const a of args) {
        try {
          const n = buildNode(a);
          ms += n._ms || 0;
          // First non-Tr, non-TRANSPARENT node becomes the displayed colour
          if (colorNode === TRANSPARENT && !(n instanceof TrNode) && n !== TRANSPARENT && n.getColor) {
            colorNode = n;
          }
        } catch(_) {}
      }
      return new TrConcatNode(ms || 300, colorNode);
    }

    // ── Core style nodes ───────────────────────────────────────────────────
    case 'InOutFuncX':       return new InOutFuncXNode(+args[0], +args[1]);
    case 'AlphaL':           return new AlphaLNode(buildNode(args[0]), buildNode(args[1]));
    case 'InOutHelperL':     return new InOutHelperLNode(buildNode(args[0]));
    case 'InOutHelper':      return new InOutHelperNode(buildNode(args[0]), +args[1], +args[2]);
    case 'InOutTrL':         return new InOutTrLNode(buildNode(args[0]), buildNode(args[1]));
    case 'Mix':              return new MixNode(buildNode(args[0]), buildNode(args[1]), buildNode(args[2]));
    case 'Layers':           return new LayersNode(args.map(buildNode));
    case 'SimpleClashL':     return new SimpleClashLNode(buildNode(args[0]));
    case 'SimpleClash':      return new SimpleClashNode(buildNode(args[0]), args[1] ? buildNode(args[1]) : new RgbNode(255,255,255));
    case 'Lockup':           return new LockupNode(buildNode(args[0]), args[1] ? buildNode(args[1]) : new RgbNode(255,255,255));
    case 'Blast':            return new BlastNode(buildNode(args[0]),  args[1] ? buildNode(args[1]) : new RgbNode(255,255,255));
    case 'EasyBlade':        return new EasyBladeNode(buildNode(args[0]), buildNode(args[1]));
    case 'Sparkle':          return new SparkleNode(buildNode(args[0]), args[1] !== undefined ? +args[1] : undefined);
    case 'AudioFlicker':     return new AudioFlickerNode(buildNode(args[0]), buildNode(args[1]));
    case 'AudioFlickerL':    return new AudioFlickerLNode(buildNode(args[0]));
    case 'HumpFlicker':      return new HumpFlickerNode(buildNode(args[0]), buildNode(args[1]), args[2]);
    case 'HumpFlickerL':     return new HumpFlickerLNode(buildNode(args[0]), args[1]);
    case 'BrownNoiseFlicker':
    case 'BrownNoiseFlickerL': return new AudioFlickerNode(buildNode(args[0]), buildNode(args[1]));
    case 'RandomPerLEDFlicker': return new HumpFlickerNode(buildNode(args[0]), buildNode(args[1]), undefined);
    case 'Blinking':         return buildNode(args[0]); // show first arg, ignore blink timing
    case 'BlinkingL':        return new AudioFlickerLNode(buildNode(args[0]));
    case 'Pulsing':          return new PulsingNode(buildNode(args[0]), buildNode(args[1]), +args[2] || 1000);
    case 'Gradient':         return new GradientNode(args.map(buildNode));
    case 'Stripes':          return new StripesNode(+args[0], +args[1], args.slice(2).map(buildNode));
    case 'StripesX':         return new StripesXNode(args[0] ? buildNode(args[0]) : new _StubVal(0.3), args[1] ? buildNode(args[1]) : new _StubVal(0), args.slice(2).map(buildNode));
    case 'AlphaMixL':        return new AlphaMixLNode(args[0] ? buildNode(args[0]) : new _StubVal(0), args[1] ? buildNode(args[1]) : TRANSPARENT, args[2] ? buildNode(args[2]) : TRANSPARENT);
    case 'Bump':             return new BumpNode(buildNode(args[0]), buildNode(args[1]));
    case 'Scale':            return new ScaleNode(buildNode(args[0]), buildNode(args[1]), buildNode(args[2]));
    case 'SmoothStep':       return new SmoothStepNode(buildNode(args[0]), buildNode(args[1]));
    case 'LockupTrL': {
      const typeStr = (args[3] || '').toLowerCase();
      const ltype   = typeStr.includes('drag') ? 'drag' : typeStr.includes('melt') ? 'melt' : 'lockup';
      return new LockupTrLNode(buildNode(args[0]), ltype);
    }
    case 'TransitionEffectL': {
      const inner = args[0] ? buildNode(args[0]) : TRANSPARENT;
      return new TransitionEffectLNode(inner, _effectName(args[1]), inner._ms || 600);
    }
    // TransitionEffect (no L) — static transition between two colours; show first colour
    case 'TransitionEffect': return args[0] ? buildNode(args[0]) : TRANSPARENT;
    // IgnitionDelay<delayMs, style> — skip delay, pass through to the inner style
    case 'IgnitionDelay':
    case 'RetractionDelay': return args[1] ? buildNode(args[1]) : (args[0] ? buildNode(args[0]) : TRANSPARENT);

    // StyleFire / Fire — approximate as gradient along blade
    case 'StyleFire':
    case 'Fire':             return args[0] ? buildNode(args[0]) : TRANSPARENT;
    case 'FireConfig':       return TRANSPARENT;

    // ── Arg nodes — use defaults ───────────────────────────────────────────
    case 'RgbArg':      return new RgbArgNode(args[0], buildNode(args[1]));
    case 'IntArg':      return new IntArgNode(args[0], buildNode(args[1]));

    // ── Top-level wrapper ──────────────────────────────────────────────────
    case 'StylePtr':      return new StylePtr(buildNode(args[0]));
    case 'StyleFirePtr':  return args[0] ? buildNode(args[0]) : TRANSPARENT;

    // ── Effect-reactive layers ─────────────────────────────────────────────
    case 'ResponsiveClashL':
      return new TransitionEffectLNode(args[0] ? buildNode(args[0]) : new RgbNode(255,255,255), 'clash', 300);
    case 'ResponsiveStabL':
      return new TransitionEffectLNode(args[0] ? buildNode(args[0]) : new RgbNode(255,165,0), 'stab', 400);
    case 'ResponsiveBlastL':
    case 'ResponsiveBlastWaveL':
    case 'ResponsiveBlastFadeL':
    case 'LocalizedClashL':
    case 'BlastL':
      return args[0] ? buildNode(args[0]) : new RgbNode(255, 255, 255);
    case 'EffectSequence': {
      // Trigger on EFFECT_* arg[0]; display first non-constant arg
      const etype = _effectName(args[0] || '');
      for (let i = 1; i < args.length; i++) {
        const a = args[i].trim();
        if (a.startsWith('EFFECT_') || a.startsWith('SaberBase')) continue;
        try {
          const n = buildNode(a);
          if (n !== TRANSPARENT) return new TransitionEffectLNode(n, etype, 400);
        } catch(_) {}
      }
      return TRANSPARENT;
    }
    // ── Transparent stubs — no sim state available ─────────────────────────
    case 'ResponsiveLightningBlockL':
      return TRANSPARENT;

    // ── Newly implemented: high-impact functions ───────────────────────────
    case 'RandomFlicker':
      return new RandomFlickerNode(buildNode(args[0]), buildNode(args[1]));
    case 'Ifon':
      return new IfonNode(
        args[0] ? buildNode(args[0]) : TRANSPARENT,
        args[1] ? buildNode(args[1]) : TRANSPARENT
      );
    case 'Sin':
    case 'Saw': {
      // Period arg is raw ms (Int<500> = 500ms), not a normalized 0-1 value.
      // IntNode._v holds the raw integer before our /32768 normalization.
      let ms = 1000;
      if (args[0]) {
        try {
          const n = buildNode(args[0]);
          ms = n._v !== undefined ? n._v        // IntNode raw value
             : n._ms !== undefined ? n._ms       // timing node
             : (n.getValue?.(0) ?? 0) * 32768 || 1000; // normalized → raw
        } catch(_) { ms = +args[0] || 1000; }
      }
      return name === 'Sin' ? new SinNode(ms) : new SawNode(ms);
    }
    case 'Subtract': {
      const a = args[0] ? buildNode(args[0]) : new _StubVal(0);
      const b = args[1] ? buildNode(args[1]) : new _StubVal(0);
      return _makeSubtractNode(a, b);
    }
    case 'OnSpark':
    case 'OnSparkL': {
      // OnSpark<base, color, fadeMs> / OnSparkL<color, fadeMs>
      const isOnSpark = (name === 'OnSpark');
      if (isOnSpark) {
        // OnSpark<base, color, fadeMs> — wrap base with spark overlay
        const base  = args[0] ? buildNode(args[0]) : TRANSPARENT;
        const color = args[1] ? buildNode(args[1]) : new RgbNode(255, 255, 255);
        const ms    = args[2] ? (+args[2] || 300) : 300;
        const spark = new OnSparkLNode(color, ms);
        return {
          run(bl) { base.run(bl); spark.run(bl); },
          getColor(l) {
            const s = spark.getColor(l);
            if (s.a <= 0) return base.getColor(l);
            const b = base.getColor(l);
            return mkColor(b.r*(1-s.a)+s.r*s.a, b.g*(1-s.a)+s.g*s.a, b.b*(1-s.a)+s.b*s.a);
          },
        };
      }
      return new OnSparkLNode(
        args[0] ? buildNode(args[0]) : new RgbNode(255,255,255),
        args[1] ? +args[1] : 300
      );
    }
    case 'SparkleL':
      return new SparkleLNode(
        args[0] ? buildNode(args[0]) : new RgbNode(255,255,255),
        args[1] !== undefined ? +args[1] : undefined
      );
    case 'Strobe': {
      // Strobe<A, B, rateHz, holdMs> — rate in Hz
      const a = args[0] ? buildNode(args[0]) : TRANSPARENT;
      const b = args[1] ? buildNode(args[1]) : TRANSPARENT;
      const rateHz = +args[2] || 10;
      return new StrobeNode(a, b, 1000 / rateHz);
    }
    case 'StrobeF':
    case 'StrobeL': {
      const color = args[0] ? buildNode(args[0]) : new RgbNode(255,255,255);
      const rateHz = args[1] ? (+args[1] || 10) : 10;
      return new StrobeLNode(color, 1000 / rateHz);
    }
    case 'ResponsiveLockupL':
      return new ResponsiveLockupLNode(args[0] ? buildNode(args[0]) : new RgbNode(255,255,255));
    case 'ResponsiveMeltL':
      return new ResponsiveMeltLNode(args[0] ? buildNode(args[0]) : new RgbNode(255,100,0));

    // ── Tr* timing aliases — only carry ms, no colour state ───────────────
    case 'TrBoingX':
    case 'TrFadeX':
    case 'TrSmoothFadeX':
    case 'TrDelayX':
    case 'TrBlink': {
      if (!args[0]) return new TrNode(300);
      try { const n = buildNode(args[0]); return new TrNode(n.getValue ? n.getValue(0) : (+args[0] || 300)); }
      catch(_) { return new TrNode(300); }
    }
    case 'TrCenterWipe':
    case 'TrCenterWipeIn':   return new TrNode(+args[0] || 300);
    case 'TrCenterWipeX':
    case 'TrCenterWipeInX': {
      if (!args[0]) return new TrNode(300);
      try { const n = buildNode(args[0]); return new TrNode(n.getValue ? n.getValue(0) : 300); }
      catch(_) { return new TrNode(300); }
    }
    case 'TrCenterWipeSparkX':
    case 'TrCenterWipeInSparkX':
    case 'TrWipeInSparkTipX':
    case 'TrWipeSparkTipX':
    case 'TrSparkX':         return new TrNode(+args[0] || 300);
    case 'TrExtendX': {
      if (!args[0]) return new TrNode(300);
      try { const n = buildNode(args[0]); return new TrNode(n.getValue ? n.getValue(0) : 300); }
      catch(_) { return new TrNode(300); }
    }
    case 'TrColorCycle':
    case 'TrColorCycleX':    return new TrNode(+args[0] || 800);
    case 'TrJoinR':          return new TrNode(+args[0] || 300);
    case 'TrLoopN':          return new TrNode((+args[0] || 1) * (+args[1] || 300));
    case 'TrRandom':         return new TrNode(300);
    case 'TrSelect':         return new TrNode(300);
    case 'TrDoEffectAlways':
    case 'TrDoEffectX': {
      // TrDoEffectX<Tr, EFFECT> — carries Tr timing, fires effect as side-effect
      if (args[0]) { try { return buildNode(args[0]); } catch(_) {} }
      return new TrNode(300);
    }
    case 'TransitionLoop':   return new TrNode(+args[0] || 300);
    case 'TransitionPulseL': return args[0] ? buildNode(args[0]) : TRANSPARENT;

    // ── Registry-based fallback ────────────────────────────────────────────
    default: {
      const status = _FN_STATUS[name];
      if (status === 'UNIMPLEMENTED') {
        // Track for consolidated error reporting
        if (_parseUnimplemented) _parseUnimplemented.add(name);
        // Graceful visual fallback: pass through first arg so style isn't black
        if (args.length > 0) { try { return buildNode(args[0]); } catch(_) {} }
        return TRANSPARENT;
      }
      // UNKNOWN (JMT custom) or truly unrecognized — pass through silently
      if (args.length > 0) { try { return buildNode(args[0]); } catch(_) {} }
      return TRANSPARENT;
    }
  }
}

// Map an EFFECT_* string argument to an effect type name used in blade.addEffect()
function _effectName(arg) {
  if (!arg) return '';
  const m = arg.trim().match(/^EFFECT_(\w+)$/);
  return m ? m[1].toLowerCase() : arg.toLowerCase();
}

/**
 * Split a comma-separated argument string respecting nested <> brackets.
 */
function splitArgs(s) {
  const result = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '<') depth++;
    else if (c === '>') depth--;
    else if (c === ',' && depth === 0) {
      result.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = s.slice(start).trim();
  if (last) result.push(last);
  return result;
}

// ── Function status registry ──────────────────────────────────────────────────
// Four statuses for every function name we know about:
//   IMPLEMENTED  — has real rendering logic
//   STUB         — hardware/sensor dependent; silent neutral value, no error
//   UNIMPLEMENTED — known ProffieOS function not yet supported; raises parse error
//   UNKNOWN      — JMT custom wrapper; silently passes through first arg

const _FN_STATUS = (() => {
  const I = 'IMPLEMENTED', S = 'STUB', U = 'UNIMPLEMENTED', X = 'UNKNOWN';
  return {
    // Implemented
    AlphaL:I, AlphaMixL:I, AudioFlicker:I, AudioFlickerL:I, BendTimePowX:I,
    Blast:I, BlastL:I, Blinking:I, BlinkingL:I, BrownNoiseFlicker:I,
    BrownNoiseFlickerL:I, Bump:I, EffectSequence:I, EasyBlade:I, FireConfig:I,
    Gradient:I, HumpFlicker:I, HumpFlickerL:I, IgnitionDelay:I, IgnitionTime:I,
    InOutFuncX:I, InOutHelper:I, InOutHelperL:I, InOutTrL:I, Int:I, IntArg:I,
    IsGreaterThan:I, IsLessThan:I, Layers:I, LocalizedClashL:I, Lockup:I,
    LockupTrL:I, Mix:I, Mult:I, Pulsing:I, RandomPerLEDFlicker:I,
    ResponsiveBlastFadeL:I, ResponsiveBlastL:I, ResponsiveBlastWaveL:I,
    ResponsiveClashL:I, ResponsiveStabL:I, RetractionDelay:I, RetractionTime:I,
    Rgb:I, Rgb16:I, RgbArg:I, RotateColors:I, RotateColorsX:I, Scale:I,
    SimpleClash:I, SimpleClashL:I, SmoothStep:I, Sparkle:I, Stripes:I,
    StripesX:I, StyleFire:I, StyleFirePtr:I, StylePtr:I, Sum:I,
    TransitionEffect:I, TransitionEffectL:I, TransitionLoop:I, TransitionLoopL:I,
    TransitionPulseL:I, TrBling:I, TrBoing:I, TrBoingX:I,
    TrCenterWipe:I, TrCenterWipeIn:I, TrCenterWipeInSparkX:I, TrCenterWipeInX:I,
    TrCenterWipeSparkX:I, TrCenterWipeX:I, TrColorCycle:I, TrColorCycleX:I,
    TrConcat:I, TrDelay:I, TrDelayX:I, TrDoEffectAlways:I, TrDoEffectX:I,
    TrExtend:I, TrExtendX:I, TrFade:I, TrFadeX:I, TrInstant:I, TrJoin:I,
    TrJoinR:I, TrLoopIf:I, TrLoopN:I, TrRandom:I, TrSelect:I,
    TrSmoothFade:I, TrSmoothFadeX:I, TrSparkX:I, TrWaveX:I, TrWipe:I,
    TrWipeIn:I, TrWipeInSparkTip:I, TrWipeInSparkTipX:I, TrWipeInX:I,
    TrWipeSparkTip:I, TrWipeSparkTipX:I, TrWipeX:I,
    // Newly implemented
    Ifon:I, OnSpark:I, OnSparkL:I, RandomFlicker:I, ResponsiveLockupL:I,
    ResponsiveMeltL:I, Saw:I, Sin:I, SparkleL:I, Strobe:I, StrobeF:I,
    StrobeL:I, Subtract:I,
    // Stubs (hardware/sensor — fixed neutral value, no error)
    BatteryLevel:S, BladeAngle:S, ClashImpactF:S, EffectPosition:S,
    EffectRandomF:S, HoldPeakF:S, LockupPulseF:S, NoisySoundLevel:S,
    ResponsiveLightningBlockL:S, SlowNoise:S, SwingAcceleration:S, SwingSpeed:S,
    Trigger:S, TwistAngle:S, Variation:S, VolumeLevel:S, WavLen:S,
    // JMT custom wrappers — UNKNOWN in standard ProffieOS, pass through silently
    BootAccelSpin:X, BootNormTime:X, ChargingAccentStyle:X,
    ChristmasPixelSwitchWrapper:X, CrystalChamberAccelWrapper:X,
    CrystalChamberHeartbeatWrapper:X, CrystalChamberWrapper:X,
    HexSpiralStyle:X, PixelSwitchWrapper:X,
    // Unimplemented ProffieOS functions
    BendTimePowInvX:U, BlastF:U, BlastFadeoutL:U, BlinkingF:U, BlinkingX:U,
    BrownNoiseF:U, CenterDistF:U, CircularSectionF:U, ColorChange:U,
    ColorSelect:U, ColorSequence:U, Cylon:U, EffectPulseF:U,
    IncrementWithReset:U, IsBetween:U, LayerFunctions:U, LocalizedClash:U,
    MultiTransitionEffect:U, MultiTransitionEffectL:U,
    Percentage:U, PulsingF:U, PulsingX:U, RandomBlink:U, RandomBlinkF:U,
    RandomPerLEDFlickerL:U, Remap:U,
    StaticFire:U, ThresholdPulseF:U, TimeSinceEffect:U, TrBlink:U, WavNum:U,
  };
})();

// Collect which UNIMPLEMENTED names were hit during a single parse so the
// caller can surface one consolidated error.
let _parseUnimplemented = null; // null = not tracking; Set when tracking

function _startParseTracking() { _parseUnimplemented = new Set(); }
function _stopParseTracking()  { const s = _parseUnimplemented; _parseUnimplemented = null; return s; }

// ── Public API ────────────────────────────────────────────────────────────────

window.BladeEval = {
  Blade,

  /**
   * Parse a style string.
   * @returns {{ style: object, unimplemented: Set<string> }}
   *   style    — runnable node (has run(blade) and getColor(led))
   *   unimplemented — set of UNIMPLEMENTED function names hit during parse
   */
  parse(text) {
    _startParseTracking();
    let style;
    try { style = parseStyle(text); }
    finally { /* tracking stopped in the return path */ }
    const unimplemented = _stopParseTracking();
    return { style, unimplemented };
  },

  /**
   * Build a SaberFrame by running the style for one frame.
   * @param {object} style  — from parse()
   * @param {Blade}  blade  — blade state
   * @returns {{ ledColors: Float32Array, ledCount: number }}
   */
  buildFrame(style, blade) {
    style.run(blade);
    const n = blade.ledCount;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const c = style.getColor(i);
      colors[i * 3]     = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    return { ledColors: colors, ledCount: n };
  },
};

document.dispatchEvent(new CustomEvent('blade-eval-ready'));
