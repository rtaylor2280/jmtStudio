// Open a zip whose file descriptor WE own. [B-479, 2026-10-11]
//
// node-stream-zip opens the file itself when given `{ file }`, and when a read FAILS its
// close() reports success and leaks the descriptor anyway. There is no error raised and nothing
// to log, so a correct-looking `finally { await zip.close(); }` is not enough - every site in
// this app had one and they all leaked.
//
// Measured on the shipped inspect path: a good zip comes back with an fd delta of 0, a truncated
// one leaves +1 behind. On a card that is the difference between ejecting and Windows saying the
// drive is "In use", because the failed read is still holding the volume. Reported from a real
// restore off a board-mounted saber: the read failed, the card would not eject, and the holder
// was us.
//
// WHAT THIS DOES: opens the descriptor here, hands node-stream-zip `{ fd }`, and WRAPS close()
// so every existing cleanup path releases ours as well. Call sites keep whatever try/finally
// they already had; nothing has to remember a second step.
'use strict';

const fs = require('fs');

// Reasons this is a function rather than each caller doing it: the wrap has to survive every
// return path, and the fd must be closed even when the constructor throws - two things that
// were wrong at one site or another when they were written out by hand.
function openZipOwned(zipPath, options = {}) {
  const StreamZip = require('node-stream-zip');
  const fd = fs.openSync(zipPath, 'r');
  let zip;
  try {
    zip = new StreamZip.async(Object.assign({}, options, { fd }));
  } catch (err) {
    try { fs.closeSync(fd); } catch {}
    throw err;
  }
  const origClose = zip.close.bind(zip);
  let closed = false;
  zip.close = async () => {
    if (closed) return;
    closed = true;
    try { return await origClose(); }
    // EBADF here just means node-stream-zip got there first, which is the healthy case.
    finally { try { fs.closeSync(fd); } catch {} }
  };
  return zip;
}

module.exports = { openZipOwned };
