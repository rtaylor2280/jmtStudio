'use strict';
// Install count [B-687]: the first time a version of JMT Studio runs on a computer, it downloads one
// small file from the "counters" release on GitHub. GitHub counts downloads of release files, so the
// file's download count is how many computers have run that version. Nothing is sent: it is a plain
// download, and the reply is not used.
//
// Runs in the background and is never awaited. Any failure is ignored and tried again at the next
// launch. Once a version's file has downloaded, a marker in userData stops it being fetched again.

const fs = require('fs');
const path = require('path');

const COUNTER_URL = (version) =>
  `https://github.com/rtaylor2280/jmtStudio/releases/download/counters/first-run-${version}.json`;
const MARKER = 'install-count.json';

function readMarker(userData) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(userData, MARKER), 'utf8'));
    return m && Array.isArray(m.counted) ? m : { counted: [] };
  } catch { return { counted: [] }; }
}

function writeMarker(userData, marker) {
  const f = path.join(userData, MARKER);
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(marker, null, 2));
  fs.renameSync(tmp, f);
}

// get(url) -> Promise that resolves on a 200 and rejects otherwise. Resolves true when this launch
// counted the version, false when it was already counted or the download did not succeed.
async function countFirstRun({ userData, version, get }) {
  if (!userData || !/^\d+\.\d+\.\d+/.test(String(version || ''))) return false;
  const marker = readMarker(userData);
  if (marker.counted.includes(version)) return false;
  try { await get(COUNTER_URL(version)); } catch { return false; }
  marker.counted.push(version);
  try { writeMarker(userData, marker); } catch {}
  return true;
}

module.exports = { countFirstRun, COUNTER_URL, MARKER };
