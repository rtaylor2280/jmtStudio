/**
 * The compile workspace follows the installed tree  [B-591]
 *
 * A release compiled in a copy of the selected version that was only re-made when the version
 * NAME changed, so a prop imported or an add-on updated in that version never reached the build.
 * Dev compiled in place and never showed it. Now both builds compile in the workspace and every
 * compile checks it against the tree's files as they are on disk. These cases pin that:
 *   · the compile root is the workspace, in a release AND in dev
 *   · a file added, changed or removed in the tree is in the next workspace
 *   · an unchanged tree is not copied again
 *   · staging writes only into the workspace, never into the user's tree
 *   · an old dev tree's staged my_config.h / my_styles.h do not ride into the workspace
 *
 * Run: node test/workspace-follows-tree.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

function load(isPackaged) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-ws-'));
  const origLoad = Module._load;
  Module._load = function (req, ...a) {
    if (req === 'electron') return { app: { getPath: () => userData, isPackaged } };
    return origLoad.call(this, req, ...a);
  };
  const file = path.join(__dirname, '..', 'proffieos.js');
  delete require.cache[require.resolve(file)];
  const proffie = require(file);
  Module._load = origLoad;
  return { proffie, userData };
}

for (const isPackaged of [true, false]) {
  const tag = isPackaged ? 'release' : 'dev';
  const { proffie, userData } = load(isPackaged);
  const V = 'ProffieOS 8.10 +JMT';
  const src = path.join(userData, 'proffieOS_versions', V, 'ProffieOS');
  const ws = path.join(userData, 'ProffieOS');
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true });
    fs.writeFileSync(path.join(src, rel), text);
  };
  put('ProffieOS.ino', '#define CONFIG_FILE "config/default_proffieboard_config.h"\n');
  put('props/saber.h', '// saber\n');
  put('config/default_proffieboard_config.h', '// stock\n');
  put('config/my_config.h', '// left by an old in-place dev compile\n');
  put('config/my_styles.h', '// left by an old in-place dev compile\n');

  ok(`${tag}: the compile root is the workspace`, proffie.getProffieOSRoot() === ws, proffie.getProffieOSRoot());

  const logs = [];
  const log = (l) => logs.push(l);
  ok(`${tag}: first compile makes the workspace`, proffie.initWorkspace(log).ok && fs.existsSync(path.join(ws, 'props', 'saber.h')));
  ok(`${tag}: an old in-place compile's staged files are not copied`,
    !fs.existsSync(path.join(ws, 'config', 'my_config.h')) && !fs.existsSync(path.join(ws, 'config', 'my_styles.h'))
    && fs.existsSync(path.join(ws, 'config', 'default_proffieboard_config.h')));

  logs.length = 0;
  proffie.initWorkspace(log);
  ok(`${tag}: an unchanged tree is not copied again`, !logs.some(l => /Setting up/.test(l)), logs.join(' | '));

  put('props/imported_prop.h', '// a prop imported after the copy\n');
  proffie.initWorkspace(log);
  ok(`${tag}: a prop imported since is in the next workspace`, fs.existsSync(path.join(ws, 'props', 'imported_prop.h')));

  put('props/saber.h', '// saber, updated by an add-on, now longer\n');
  proffie.initWorkspace(log);
  ok(`${tag}: a file changed since is the new version in the workspace`,
    fs.readFileSync(path.join(ws, 'props', 'saber.h'), 'utf8').includes('updated by an add-on'));

  fs.rmSync(path.join(src, 'props', 'imported_prop.h'));
  proffie.initWorkspace(log);
  ok(`${tag}: a file removed since is gone from the workspace`, !fs.existsSync(path.join(ws, 'props', 'imported_prop.h')));

  const before = fs.readFileSync(path.join(src, 'ProffieOS.ino'), 'utf8');
  ok(`${tag}: staging the config succeeds`, proffie.ensureConfigFileRef(() => {}).ok && proffie.stageConfig('// my config\n').ok);
  ok(`${tag}: staging writes into the workspace`, fs.readFileSync(path.join(ws, 'config', 'my_config.h'), 'utf8') === '// my config\n');
  ok(`${tag}: the user's tree is not touched by staging`,
    fs.readFileSync(path.join(src, 'ProffieOS.ino'), 'utf8') === before
    && fs.readFileSync(path.join(src, 'config', 'my_config.h'), 'utf8').includes('old in-place'));

  // The compile cache key and the name index notice an edit nothing announced (Explorer). [B-591]
  const h1 = proffie.hashVersion(V);
  const ix1 = proffie.getVersionNameIndex(V);
  put('props/saber.h', '#ifdef EDITED_IN_EXPLORER\n#endif\n');
  ok(`${tag}: the OS hash changes with an unannounced edit`, proffie.hashVersion(V) !== h1);
  const ix2 = proffie.getVersionNameIndex(V, ix1.stamp);
  ok(`${tag}: the name index rebuilds after an unannounced edit`,
    ix2.ok && !ix2.unchanged && !!ix2.names.EDITED_IN_EXPLORER);
  ok(`${tag}: an untouched tree keeps its hash and index`,
    proffie.hashVersion(V) === proffie.hashVersion(V)
    && proffie.getVersionNameIndex(V, ix2.stamp).unchanged === true);

  fs.rmSync(userData, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
