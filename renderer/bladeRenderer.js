"use strict";

// ─── Renderer constants (tuned) ───────────────────────────────────────────────
const W = 900, H = 200;
const MARGIN          = 40;
const MAX_BLADE_W     = W - MARGIN * 2;
const PX_PER_LED      = MAX_BLADE_W / 144;
const RIGHT_MARGIN    = 20;
const HILT_PX_FULL    = 35 * PX_PER_LED;
const FULL_CENTER_X   = (W - RIGHT_MARGIN) - (144 * PX_PER_LED + HILT_PX_FULL) / 2;

const TIP_CAP_RADIUS  = 0.20;
const HILT_CAP_RADIUS = 0.05;
const CORE_WHITEN_FADE= 0.05;
const HILT_CRESCENT   = 0.2;
const HILT_GAP        = 6;
const HILT_PX         = HILT_PX_FULL;
const HILT_WIDTH      = 0.16;
const GAIN_R          = 1.21;
const GAIN_G          = 1;
const GAIN_B          = 0.96;
const GAMMA           = 0.85;
const BLEND_RADIUS    = 8;
const FALLOFF         = 0.8;
const CORE_WIDTH      = 0.14;
const EDGE_SOFT       = 2.1;
const BLOOM_RADIUS    = 73;
const BLOOM_INTENSITY = 0.35;
const BLOOM_SENS      = 2;
const SATURATION      = 2.35;
const CORE_WHITEN     = 0.75;
const HILT_CURVE      = 0.9;
const TIP_FALLOFF     = 0.1;

// ─── Internal state ───────────────────────────────────────────────────────────
let _canvas, _ctx, _bloomCanvas, _bctx;
let _colR, _colG, _colB, _colLum, _imgData, _pix;
let _gBstart = 0, _gBend = 0;

let _pixels     = [];
let _ledCount   = 144;
let _brightness = 1.0;
let _animFrames = null;
let _animFps    = 30;
let _animIdx    = 0;
let _animTimer  = null;

// ─── Runtime tuning overrides ─────────────────────────────────────────────────
// Keys match the const names above, plus HILT_LED_LEN for the 35 in HILT_PX_FULL.
// Any key not set here falls back to the const value above.
let _tuning = {};
function _t(key, def) { const v = _tuning[key]; return v !== undefined ? v : def; }

// ─── Init ─────────────────────────────────────────────────────────────────────
function _init(canvasEl) {
  _canvas = canvasEl;
  _canvas.width  = W;
  _canvas.height = H;
  _ctx = _canvas.getContext('2d');

  _colR   = new Float32Array(W);
  _colG   = new Float32Array(W);
  _colB   = new Float32Array(W);
  _colLum = new Float32Array(W);
  _imgData = _ctx.createImageData(W, H);
  _pix     = _imgData.data;

  _bloomCanvas = document.createElement('canvas');
  _bloomCanvas.width = W; _bloomCanvas.height = H;
  _bctx = _bloomCanvas.getContext('2d');

  _render();
}

// ─── Public API ───────────────────────────────────────────────────────────────
function setPixels(pixels) {
  stopAnimation();
  _pixels = pixels;
  _render();
}

function setBrightness(brightness) {
  _brightness = Math.max(0, Math.min(1, brightness));
  _render();
}

function setLedCount(n) {
  _ledCount = Math.max(1, Math.min(144, Math.round(n)));
  _render();
}

function setAnimation(frames, fps = 30) {
  stopAnimation();
  if (!frames || frames.length === 0) return;
  _animFrames = frames;
  _animFps    = fps;
  _animIdx    = 0;
  _stepAnimation();
}

function stopAnimation() {
  if (_animTimer !== null) { clearTimeout(_animTimer); _animTimer = null; }
  _animFrames = null;
}

// Update renderer constants at runtime without reloading the script.
// Call with an object whose keys are const names (e.g. BLEND_RADIUS, GAIN_R)
// plus the special key HILT_LED_LEN for the hilt pixel multiplier.
// Triggers an immediate re-render.
function setTuning(overrides) {
  _tuning = overrides || {};
  _render();
}

// ─── Animation stepper ────────────────────────────────────────────────────────
function _stepAnimation() {
  if (!_animFrames) return;
  _pixels = _animFrames[_animIdx];
  _render();
  _animIdx = (_animIdx + 1) % _animFrames.length;
  _animTimer = setTimeout(_stepAnimation, 1000 / _animFps);
}

// ─── Core render pipeline ─────────────────────────────────────────────────────
function _render() {
  if (!_ctx) return;
  _sampleField();
  _drawBlade();
  _drawHilt();
  _drawBloom();
}

function _sampleField() {
  const n       = _ledCount;
  const hiltPx  = _t('HILT_LED_LEN', 35) * PX_PER_LED;
  const bladePx = n * PX_PER_LED;
  const totalW  = hiltPx + bladePx;
  _gBstart = FULL_CENTER_X - totalW / 2 + hiltPx;
  _gBend   = _gBstart + bladePx;

  if (n === 0 || _pixels.length === 0) {
    _colR.fill(0); _colG.fill(0); _colB.fill(0); _colLum.fill(0); return;
  }

  const R  = _t('BLEND_RADIUS', BLEND_RADIUS);
  const fo = _t('FALLOFF',      FALLOFF);

  for (let px = 0; px < W; px++) {
    if (px < _gBstart || px > _gBend) {
      _colR[px]=_colG[px]=_colB[px]=_colLum[px]=0; continue;
    }
    const ledPos = ((px - _gBstart) / bladePx) * (n - 1);
    let wr=0, wg=0, wb=0, wt=0;
    const iMin = Math.max(0, Math.floor(ledPos - R));
    const iMax = Math.min(n - 1, Math.ceil(ledPos + R));
    for (let i = iMin; i <= iMax; i++) {
      const w = 1.0 / Math.pow(Math.abs(ledPos - i) + 0.5, fo);
      const px_data = _pixels[i];
      const pr = px_data ? px_data[0] / 255 : 0;
      const pg = px_data ? px_data[1] / 255 : 0;
      const pb = px_data ? px_data[2] / 255 : 0;
      wr+=pr*w; wg+=pg*w; wb+=pb*w; wt+=w;
    }
    _colR[px]=wr/wt; _colG[px]=wg/wt; _colB[px]=wb/wt;
    _colLum[px]=Math.max(_colR[px], _colG[px], _colB[px]);
  }
}

function _drawBlade() {
  _pix.fill(0);
  const cy=H/2, halfH=H/2;
  const bri=_brightness;
  const bStart=_gBstart, bEnd=_gBend, bladeW=bEnd-bStart;

  if (bladeW<=0) { _ctx.fillStyle='#000'; _ctx.fillRect(0,0,W,H); return; }

  const tCapR   = _t('TIP_CAP_RADIUS',  TIP_CAP_RADIUS);
  const hCapR   = _t('HILT_CAP_RADIUS', HILT_CAP_RADIUS);
  const cwFade  = _t('CORE_WHITEN_FADE',CORE_WHITEN_FADE);
  const tipFo   = _t('TIP_FALLOFF',     TIP_FALLOFF);
  const sat     = _t('SATURATION',      SATURATION);
  const cw      = _t('CORE_WHITEN',     CORE_WHITEN);
  const cwid    = _t('CORE_WIDTH',      CORE_WIDTH);
  const esoft   = _t('EDGE_SOFT',       EDGE_SOFT);
  const hcurve  = _t('HILT_CURVE',      HILT_CURVE);
  const gainR   = _t('GAIN_R',          GAIN_R);
  const gainG   = _t('GAIN_G',          GAIN_G);
  const gainB   = _t('GAIN_B',          GAIN_B);
  const gamma   = _t('GAMMA',           GAMMA);
  const gammaI  = gamma !== 1.0 ? 1 / gamma : 0;

  const capLen      = halfH * tCapR * 2.0;
  const capEdge     = bEnd - capLen;
  const hiltCapLen  = halfH * hCapR * 2.0;
  const hiltCapEdge = bStart + hiltCapLen;
  const whitenFadeStart = 1.0 - cwFade;

  for (let px=0; px<W; px++) {
    if (px<bStart||px>bEnd) continue;

    let r=_colR[px]*bri, g=_colG[px]*bri, b=_colB[px]*bri;

    // Per-channel gain + gamma for display calibration
    r = Math.min(1, r * gainR);
    g = Math.min(1, g * gainG);
    b = Math.min(1, b * gainB);
    if (gammaI) {
      if (r > 0) r = Math.pow(r, gammaI);
      if (g > 0) g = Math.pow(g, gammaI);
      if (b > 0) b = Math.pow(b, gammaI);
    }

    if (tipFo>0) {
      const tPos=(px-bStart)/bladeW;
      const tipZone=Math.max(0,(tPos-0.7)/0.3);
      const taper=1-tipZone*(1-Math.exp(-tipFo*3));
      r*=taper; g*=taper; b*=taper;
    }

    const sat_n=Math.max(r,g,b)*0.5;
    r=sat_n+(r-sat_n)*sat;
    g=sat_n+(g-sat_n)*sat;
    b=sat_n+(b-sat_n)*sat;

    let hiltRowScale=1.0, hiltFade=1.0;
    if (hiltCapLen>0 && px<=hiltCapEdge) {
      const t2=(hiltCapEdge-px)/hiltCapLen;
      hiltRowScale=Math.sqrt(Math.max(0,1-t2*t2));
      hiltFade=hiltRowScale;
      if (hiltRowScale<0.001) continue;
    }
    let tipRowScale=1.0, tipFade=1.0;
    if (capLen>0 && px>=capEdge) {
      const t2=(px-capEdge)/capLen;
      tipRowScale=Math.sqrt(Math.max(0,1-t2*t2));
      tipFade=tipRowScale;
      if (tipRowScale<0.001) continue;
    }

    const rowScale    =Math.min(hiltRowScale, tipRowScale);
    const combinedFade=Math.min(hiltFade, tipFade);
    const usableHalf  =halfH*rowScale;
    const bladePos    =(px-bStart)/bladeW;

    let whitenMult=1.0;
    if (bladePos>whitenFadeStart) {
      const fadeT=(bladePos-whitenFadeStart)/(1.0-whitenFadeStart+0.001);
      whitenMult=Math.max(0,1.0-fadeT*fadeT*3.0);
    }

    for (let py=0; py<H; py++) {
      const absDy=Math.abs(py-cy);
      const dy=absDy/(usableHalf+0.001);
      if (dy>3.0) continue;

      let edgeDim=1.0;
      if (hcurve>0) {
        const hz=Math.max(0,1.0-bladePos/0.25);
        const edgeness=Math.min(1,absDy/(usableHalf+0.001));
        edgeDim=1.0-hcurve*0.5*hz*Math.pow(edgeness,1.5);
      }

      const coreAlpha =Math.max(0,1-dy/cwid);
      const outerAlpha=Math.exp(-Math.pow(dy/cwid,esoft));
      const alpha     =Math.max(coreAlpha,outerAlpha)*combinedFade*edgeDim;
      const wh=coreAlpha*cw*whitenMult*tipFade;
      const fr=Math.min(1,(r+(1-r)*wh)*alpha);
      const fg=Math.min(1,(g+(1-g)*wh)*alpha);
      const fb=Math.min(1,(b+(1-b)*wh)*alpha);
      const idx=(py*W+px)*4;
      _pix[idx]=fr*255; _pix[idx+1]=fg*255; _pix[idx+2]=fb*255; _pix[idx+3]=255;
    }
  }

  _ctx.fillStyle='#000';
  _ctx.fillRect(0,0,W,H);
  _ctx.putImageData(_imgData,0,0);
}

function _drawHilt() {
  const cy        = H/2;
  const halfH     = H/2;
  const hiltPx    = _t('HILT_LED_LEN',   35)             * PX_PER_LED;
  const hCapR     = _t('HILT_CAP_RADIUS', HILT_CAP_RADIUS);
  const gapPx     = _t('HILT_GAP',        HILT_GAP);
  // hiltRight: extends into blade cap ramp zone so crescent meets blade at full height;
  // gapPx > 0 pulls it back left creating visible space between hilt and blade
  const hiltCapLen = halfH * hCapR * 2.0;
  const hiltRight = _gBstart + hiltCapLen - gapPx;
  const hiltLeft  = hiltRight - hiltPx - hiltCapLen;
  const hw        = _t('HILT_WIDTH',    HILT_WIDTH)    * (H/2);
  const crescent  = _t('HILT_CRESCENT', HILT_CRESCENT);
  const drawLeft  = Math.max(0, hiltLeft);
  if (drawLeft >= hiltRight) return;

  // Crescent depth in pixels — how far the concave right edge bows into the hilt
  const cd = hw * crescent;

  // Build hilt outline: straight on left/top/bottom, concave bezier on right
  _ctx.save();
  _ctx.beginPath();
  _ctx.moveTo(drawLeft,   cy - hw);
  _ctx.lineTo(hiltRight,  cy - hw);
  _ctx.bezierCurveTo(
    hiltRight - cd, cy - hw * 0.25,   // ctrl 1 — pulls curve inward near top
    hiltRight - cd, cy + hw * 0.25,   // ctrl 2 — pulls curve inward near bottom
    hiltRight,      cy + hw           // end: bottom-right corner
  );
  _ctx.lineTo(drawLeft, cy + hw);
  _ctx.closePath();
  _ctx.clip();

  const grad = _ctx.createLinearGradient(0, cy-hw, 0, cy+hw);
  grad.addColorStop(0.00,'#1a1a1a');
  grad.addColorStop(0.15,'#555');
  grad.addColorStop(0.30,'#999');
  grad.addColorStop(0.45,'#ccc');
  grad.addColorStop(0.50,'#e8e8e8');
  grad.addColorStop(0.55,'#bbb');
  grad.addColorStop(0.70,'#888');
  grad.addColorStop(0.85,'#444');
  grad.addColorStop(1.00,'#111');
  _ctx.fillStyle = grad;
  _ctx.fillRect(drawLeft, cy-hw, hiltRight-drawLeft, hw*2);

  _ctx.strokeStyle='#000'; _ctx.lineWidth=1;
  _ctx.beginPath();
  _ctx.moveTo(drawLeft,cy-hw); _ctx.lineTo(hiltRight,cy-hw);
  _ctx.moveTo(drawLeft,cy+hw); _ctx.lineTo(hiltRight,cy+hw);
  _ctx.stroke();
  _ctx.globalAlpha=0.18;
  const grooveSpacing=PX_PER_LED*2;
  for (let gx=drawLeft; gx<hiltRight; gx+=grooveSpacing) {
    _ctx.beginPath(); _ctx.moveTo(gx,cy-hw); _ctx.lineTo(gx,cy+hw); _ctx.stroke();
  }
  _ctx.globalAlpha=1.0;
  _ctx.restore();
}

function _drawBloom() {
  const bloomI = _t('BLOOM_INTENSITY', BLOOM_INTENSITY);
  if (bloomI<0.01) return;
  const bloomR = _t('BLOOM_RADIUS', BLOOM_RADIUS);
  const bloomS = _t('BLOOM_SENS',   BLOOM_SENS);
  const cy=H/2, bri=_brightness;
  const tipIdx=Math.max(0,Math.min(W-1,Math.floor(_gBend)-1));
  const tipR=_colR[tipIdx]*bri, tipG=_colG[tipIdx]*bri, tipBv=_colB[tipIdx]*bri;
  const tipLum=Math.max(tipR,tipG,tipBv);
  const overhang=bloomR*1.5;

  // Bloom cap fade: shrink bloom radius near emitter to follow the blade cap arc
  const hCapR      = _t('HILT_CAP_RADIUS', HILT_CAP_RADIUS);
  const gapPx      = _t('HILT_GAP', HILT_GAP);
  const hiltCapLen = (H/2) * hCapR * 2.0;
  const hiltCapEdge = _gBstart + hiltCapLen - gapPx;

  _bctx.clearRect(0,0,W,H);
  for (let px=0; px<W; px++) {
    let rv,gv,bv,lum;
    if (px<=_gBend) {
      lum=_colLum[px]*bri;
      if (lum<0.005) continue;
      rv=_colR[px]*bri; gv=_colG[px]*bri; bv=_colB[px]*bri;
    } else {
      const dist=px-_gBend;
      if (dist>overhang) continue;
      const fade=Math.exp(-dist/(overhang*0.4));
      lum=tipLum*fade;
      if (lum<0.005) continue;
      rv=tipR*fade; gv=tipG*fade; bv=tipBv*fade;
    }
    // Scale bloom down near emitter so glow follows blade cap arc instead of hard-edging
    let capFade = 1.0;
    if (px >= _gBstart && px < hiltCapEdge && hiltCapLen > 0) {
      const t2 = (hiltCapEdge - px) / hiltCapLen;
      capFade = Math.sqrt(Math.max(0, 1 - t2 * t2));
    }
    const brad=bloomR*Math.pow(Math.max(0.0001,lum),1.0/bloomS)*capFade;
    if (!isFinite(brad)||brad<1) continue;
    const alpha=Math.min(1,lum*bloomI*0.4*capFade);
    const grad=_bctx.createLinearGradient(px,cy-brad,px,cy+brad);
    const c=`rgba(${(rv*255)|0},${(gv*255)|0},${(bv*255)|0},`;
    grad.addColorStop(0,c+'0)');
    grad.addColorStop(0.5,c+alpha+')');
    grad.addColorStop(1,c+'0)');
    _bctx.fillStyle=grad;
    _bctx.fillRect(px,cy-brad,1,brad*2);
  }
  _ctx.globalCompositeOperation='screen';
  _ctx.drawImage(_bloomCanvas,0,0);
  _ctx.globalCompositeOperation='source-over';
}

// ─── Expose ───────────────────────────────────────────────────────────────────
window.WS2812 = { init: _init, setPixels, setBrightness, setLedCount, setAnimation, stopAnimation, setTuning };
document.dispatchEvent(new CustomEvent('blade-renderer-ready'));
