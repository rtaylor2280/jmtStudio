// Sound Fonts — import a font directly from a purchase/receipt link.
//
// Design (Ryan, 2026-07-09): the user pastes the ONE link a vendor gave them
// and the app peels it down to a font archive and downloads it, skipping the
// download-then-upload dance. See local/backlog.txt ("Import a sound font
// directly from a purchase/receipt link") for the full spec + vendor research.
//
// This module is the PEELER (Tier 1, headless Node fetch). It follows redirects
// and sniffs each hop until it reaches a font archive:
//   - archive (zip magic / .zip disposition)        -> download it
//   - Dropbox folder/file or dl=0 link              -> rewrite dl=1, refetch
//   - a text pointer file (.txt / .rtf)             -> pull the link out, recurse
//   - an HTML page                                  -> scrape a download anchor
//                                                      (BK's sdd-download-link,
//                                                       or <a download href>),
//                                                      or detect a login/error
//                                                      page -> stop, tell user
//   - anything else                                 -> stop, manual fallback
// Depth-capped so it can't loop. Everything it CAN'T resolve fails gracefully
// with a plain message (never a fake success). Browser-like headers on every
// request (BK 404s bare clients). Tier 2 (Electron browser-window capture for
// OneDrive / KSith / login-gated) is a separate, later mechanism.

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const MAX_DEPTH = 3;         // pointer/page hops before we give up
const MAX_REDIRECTS = 6;     // HTTP 30x hops per request
const TEXT_CAP = 512 * 1024; // bytes to read from a .txt/.rtf pointer
const HTML_CAP = 2 * 1024 * 1024; // bytes to read from an HTML page

// A real browser fingerprint. BK Saber Sounds (Cloudflare + Shopify) returns
// 404 to a bare client and 200 to this. Cheap to send; hardens every vendor.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Dropbox share links download the actual file/zip only with dl=1. Folder links
// (scl/fo) give a zip-of-folder; file links (scl/fi, /s/) give the file itself.
function normalizeDropbox(urlStr) {
  try {
    const u = new URL(urlStr);
    if (/(^|\.)dropbox\.com$/i.test(u.hostname)) {
      u.searchParams.set('dl', '1');
      return u.toString();
    }
  } catch { /* not a URL we can parse; leave as-is */ }
  return urlStr;
}

// GET that follows redirects manually so we can set a per-hop Referer and know
// the final URL. Resolves with the live response stream (headers already in).
function httpGet(urlStr, { referer, maxRedirects = MAX_REDIRECTS } = {}) {
  return new Promise((resolve, reject) => {
    const visit = (u, left, ref) => {
      let parsed;
      try { parsed = new URL(u); } catch { return reject(new Error('bad url')); }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return reject(new Error('unsupported protocol'));
      const lib = parsed.protocol === 'http:' ? http : https;
      const headers = { ...BROWSER_HEADERS };
      if (ref) headers['Referer'] = ref;
      const req = lib.get(parsed, { headers }, (res) => {
        const sc = res.statusCode || 0;
        if (sc >= 300 && sc < 400 && res.headers.location && left > 0) {
          res.resume(); // drain the redirect body
          let next;
          try { next = new URL(res.headers.location, parsed).toString(); }
          catch { return reject(new Error('bad redirect')); }
          return visit(next, left - 1, parsed.toString());
        }
        resolve({ statusCode: sc, headers: res.headers, res, finalUrl: parsed.toString() });
      });
      req.on('error', reject);
      req.setTimeout(45000, () => req.destroy(new Error('timed out')));
    };
    visit(urlStr, maxRedirects, referer);
  });
}

function readBody(res, cap) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    res.on('data', (c) => {
      total += c.length;
      if (total <= cap) chunks.push(c);
      else { res.destroy(); }
    });
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

// Pull a follow-on URL out of a pointer file's text. Prefer a Dropbox link
// (the payload) over any stray vendor/reference URLs (fett263, hubbe, etc.).
function extractUrl(text) {
  const all = (String(text).match(/https?:\/\/[^\s"'<>)\]}\\]+/g) || [])
    .map(s => s.replace(/[.,;]+$/, ''));
  if (!all.length) return null;
  return all.find(u => /dropbox\.com/i.test(u)) || all[0];
}

// Find a real download link on an HTML page. Covers BK Saber Sounds
// (class="sdd-download-link"), generic <a download href>, and a bare .zip href.
function scrapeDownload(html, baseUrl) {
  const abs = (href) => { try { return new URL(href, baseUrl).toString(); } catch { return null; } };
  let m = html.match(/<a[^>]*class="[^"]*sdd-download-link[^"]*"[^>]*href="([^"]+)"/i)
       || html.match(/<a[^>]*href="([^"]+)"[^>]*class="[^"]*sdd-download-link[^"]*"/i)
       || html.match(/<a[^>]*\bdownload\b[^>]*href="([^"]+)"/i)
       || html.match(/<a[^>]*href="([^"]+)"[^>]*\bdownload\b/i)
       || html.match(/href="([^"]+\.zip[^"]*)"/i);
  return m ? abs(m[1]) : null;
}

function looksGated(html, finalUrl) {
  return /must be logged in|please log ?in|sign in to (download|your account)|you must be signed in/i.test(html)
      || /[?&]wc_error=/i.test(finalUrl)
      || /\/(login|account|signin|sign-in)(\/|\?|$)/i.test(finalUrl);
}

function filenameFromDisposition(disp) {
  if (!disp) return '';
  const m = disp.match(/filename\*=(?:UTF-8'')?([^;]+)/i) || disp.match(/filename="?([^";]+)"?/i);
  return m ? decodeURIComponent(m[1].replace(/^"|"$/g, '')) : '';
}

function basenameFromUrl(urlStr) {
  try { const u = new URL(urlStr); const b = decodeURIComponent(u.pathname.split('/').pop() || ''); return b; }
  catch { return ''; }
}

function sanitizeName(name) {
  return String(name || '').split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f]/g, '_').trim();
}

function isArchive(ctype, dispName, finalUrl) {
  if (/application\/(zip|x-zip-compressed|x-zip|octet-stream|x-rar-compressed|x-7z-compressed)|binary\/octet-stream/i.test(ctype)) {
    // octet-stream is ambiguous; require a zip-ish name to accept it.
    if (/octet-stream/i.test(ctype)) return /\.(zip|rar|7z)(\?|$)/i.test(dispName || basenameFromUrl(finalUrl));
    return true;
  }
  return /\.(zip|rar|7z)(\?|$)/i.test(dispName || '') || /\.(zip|rar|7z)(\?|$)/i.test(basenameFromUrl(finalUrl));
}

function isTextPointer(ctype, dispName, finalUrl) {
  return /text\/plain|text\/rtf|application\/rtf|application\/msword/i.test(ctype)
      || /\.(txt|rtf)(\?|$)/i.test(dispName || '')
      || /\.(txt|rtf)(\?|$)/i.test(basenameFromUrl(finalUrl));
}

// Stream a live response to a file, reporting (received, total) as it goes.
function streamToFile(res, destPath, total, onProgress) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    let received = 0;
    res.on('data', (c) => { received += c.length; if (onProgress) { try { onProgress(received, total); } catch {} } });
    res.on('error', reject);
    out.on('error', reject);
    out.on('finish', () => resolve(received));
    res.pipe(out);
  });
}

// Failure reasons where opening the link in a real in-app browser (Tier 2) can
// still get the file — gated pages (log in), JS-app pages (click their button),
// expired/blocked hops, etc. Reasons NOT here (bad-url, no-link-in-text) are
// dead ends a browser won't fix.
const BROWSER_RECOVERABLE = new Set(['too-deep', 'fetch-failed', 'gated', 'no-download-on-page', 'unknown', 'download-failed']);

// Public entry: peel, then tag failures with browserRecoverable so the UI knows
// whether to offer the in-app browser fallback.
async function resolve(inputUrl, opts = {}, depth = 0, referer) {
  const r = await peel(inputUrl, opts, depth, referer);
  if (r && !r.ok) {
    r.browserRecoverable = BROWSER_RECOVERABLE.has(r.reason) || /^http-(4\d\d|5\d\d)$/.test(r.reason || '');
  }
  return r;
}

// Peel `inputUrl` down to a font archive. With opts.dryRun, stop at the archive
// and return its URL (no download) — used by tests. Otherwise download it to
// opts.destDir and return the file path. Failure is always { ok:false, reason,
// message } with a plain, user-facing message.
async function peel(inputUrl, opts = {}, depth = 0, referer) {
  if (depth > MAX_DEPTH) return { ok: false, reason: 'too-deep', message: 'This link points through too many pages to follow automatically.' };
  const url = normalizeDropbox(String(inputUrl || '').trim());
  if (!/^https?:\/\//i.test(url)) return { ok: false, reason: 'bad-url', message: 'That does not look like a web link. Paste the download link from your receipt.' };

  let r;
  try { r = await httpGet(url, { referer }); }
  catch (e) { return { ok: false, reason: 'fetch-failed', message: `Could not reach that link (${e.message}).` }; }
  const { statusCode, headers, res, finalUrl } = r;

  if (statusCode !== 200) {
    res.resume();
    return { ok: false, reason: 'http-' + statusCode, message: `That link returned an error (HTTP ${statusCode}), and may have expired.` };
  }

  const ctype = (headers['content-type'] || '').toLowerCase();
  const disp = headers['content-disposition'] || '';
  const dispName = filenameFromDisposition(disp);
  const total = parseInt(headers['content-length'] || '0', 10) || 0;

  if (isArchive(ctype, dispName, finalUrl)) {
    const fileName = sanitizeName(dispName) || sanitizeName(basenameFromUrl(finalUrl)) || 'sound-font.zip';
    if (opts.dryRun) { res.destroy(); return { ok: true, archiveUrl: finalUrl, fileName, size: total, ctype }; }
    const destDir = opts.destDir || fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-linkimport-'));
    const destPath = path.join(destDir, fileName);
    try {
      const received = await streamToFile(res, destPath, total, opts.onProgress);
      return { ok: true, filePath: destPath, fileName, size: received };
    } catch (e) {
      try { fs.rmSync(destPath, { force: true }); } catch {}
      return { ok: false, reason: 'download-failed', message: `The download failed partway (${e.message}).` };
    }
  }

  if (isTextPointer(ctype, dispName, finalUrl)) {
    const body = await readBody(res, TEXT_CAP);
    const next = extractUrl(body);
    if (!next) return { ok: false, reason: 'no-link-in-text', message: 'That file has no download link inside it. Download the font from the vendor, then use Pick .zip file.' };
    return peel(next, opts, depth + 1, finalUrl);
  }

  if (/text\/html/i.test(ctype)) {
    const body = await readBody(res, HTML_CAP);
    if (looksGated(body, finalUrl)) {
      return { ok: false, reason: 'gated', message: "This link needs you to be logged in on the vendor's site." };
    }
    const dl = scrapeDownload(body, finalUrl);
    if (dl && dl !== finalUrl) return peel(dl, opts, depth + 1, finalUrl);
    return { ok: false, reason: 'no-download-on-page', message: 'This page needs a login or a button click to download.' };
  }

  res.resume();
  return { ok: false, reason: 'unknown', message: "That link did not lead to a font archive." };
}

// Post-process a file the in-app browser captured (Tier 2). A gated download
// often hands back a .txt/.rtf POINTER (e.g. JayDalorian's WooCommerce download
// is the instruction .txt with a Dropbox link inside), not the archive itself.
// So: if it's already an archive, keep it; otherwise read a follow-on link out
// of it and peel that down to the real archive.
async function resolveLocalFile(filePath, opts = {}) {
  const name = path.basename(filePath);
  let magicZip = false;
  try {
    const fd = fs.openSync(filePath, 'r');
    const b = Buffer.alloc(4);
    fs.readSync(fd, b, 0, 4, 0);
    fs.closeSync(fd);
    magicZip = b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07);
  } catch { /* unreadable; fall through */ }
  if (magicZip || /\.(zip|rar|7z)$/i.test(name)) return { ok: true, filePath, fileName: name };
  // Not an archive — try to read a download link out of it and peel that.
  let text = '';
  try { text = fs.readFileSync(filePath, 'utf8'); } catch {}
  const next = extractUrl(text);
  if (next) return resolve(next, opts);
  return { ok: false, reason: 'not-a-font', message: 'That download was not a font archive, and had no link inside it. Download the font from the vendor, then use Pick .zip file.', browserRecoverable: false };
}

module.exports = { resolve, resolveLocalFile, normalizeDropbox, extractUrl, scrapeDownload };
