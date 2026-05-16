const path   = require('path');
const fs     = require('fs');
const fsp    = require('fs').promises;
const crypto = require('crypto');

const FOLDER_NAME = 'JMT Studio Backup';
const META_FILE   = '.jmt_backup.json';

function getBackupRoot(folderPath) {
  return path.join(folderPath, FOLDER_NAME);
}

function resolveConflict(backupRoot, action, newName, folderPath) {
  if (!fs.existsSync(backupRoot)) return;
  if (action === 'overwrite') {
    fs.rmSync(backupRoot, { recursive: true, force: true });
  } else if (action === 'rename') {
    const dest = path.join(folderPath, newName);
    if (fs.existsSync(dest)) throw new Error(`"${newName}" already exists in this folder.`);
    fs.renameSync(backupRoot, dest);
  }
}

async function _copyDirAsync(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath  = path.join(src,  entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await _copyDirAsync(srcPath, destPath);
    } else {
      await fsp.copyFile(srcPath, destPath);
    }
  }
}

async function doInitialBackup(backupRoot, { stylesPath, versionsPath, prefsPath }) {
  await fsp.mkdir(path.join(backupRoot, 'configs'), { recursive: true });

  if (fs.existsSync(stylesPath)) {
    await fsp.copyFile(stylesPath, path.join(backupRoot, 'my_styles.h'));
  }
  if (fs.existsSync(versionsPath)) {
    await _copyDirAsync(versionsPath, path.join(backupRoot, 'proffieOS_versions'));
  }
  if (fs.existsSync(prefsPath)) {
    await fsp.copyFile(prefsPath, path.join(backupRoot, 'prefs.json'));
  }
}

function backupConfigFile(backupRoot, filePath, content) {
  const configsDir = path.join(backupRoot, 'configs');
  const metaPath   = path.join(backupRoot, META_FILE);

  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}

  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  const key  = path.basename(filePath);

  if (meta[key] === hash) return;

  fs.mkdirSync(configsDir, { recursive: true });
  fs.writeFileSync(path.join(configsDir, key), content, 'utf8');
  meta[key] = hash;
  fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf8');
}

module.exports = { getBackupRoot, resolveConflict, doInitialBackup, backupConfigFile };
