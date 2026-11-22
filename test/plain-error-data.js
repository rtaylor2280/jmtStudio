// The plain compile error messages, for the tests that check what they say. The app ships them
// locked (errorDataLock.js); the plain working copy lives in the private jmt-studio-data repo beside
// this one, or wherever JMT_ERROR_DATA points. Without it those tests are skipped, and say so.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { lock } = require('../errorDataLock');

const FILE = process.env.JMT_ERROR_DATA || path.join(__dirname, '..', '..', 'jmt-studio-data', 'error-messages.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; }
}

// Opens the messages into the matrix, or ends this test file as a skip.
function useOrSkip(name) {
  const data = load();
  if (!data) {
    console.log(`SKIP  ${name}: no plain error data at ${FILE}`);
    process.exit(0);
  }
  require('../compileErrorMatrix').setSignatures(data.signatures);
  return data;
}

// A small valid set, locked under a key of its own, for tests of the rail and the lock themselves.
function sample(version = 4, updated = '2026-11-18') {
  return {
    schema: 1, version, updated,
    signatures: [{ id: 'sample', severity: 'error', match: 'sample error', title: 'Sample title',
                   meaning: 'Sample meaning.', fix: 'Sample fix.' }],
  };
}

function lockedSample(version, updated, key = crypto.randomBytes(32)) {
  const data = sample(version, updated);
  return { data, key, locked: lock(data, key) };
}

module.exports = { FILE, load, useOrSkip, sample, lockedSample };
