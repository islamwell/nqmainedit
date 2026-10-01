const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.resolve(process.env.DATA_FILE || './data/db.json');
const BACKUPS = path.join(path.dirname(FILE), 'backups');
const EMPTY = { pages: [], courses: [], lectures: [], audio: [] };

function load() {
  try {
    if (!fs.existsSync(FILE)) {
      return JSON.parse(JSON.stringify(EMPTY));
    }
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { ...EMPTY, ...parsed };
  } catch (err) {
    console.error('Error loading db file, falling back to empty:', err.message);
    return JSON.parse(JSON.stringify(EMPTY));
  }
}

function save(data) {
  const dir = path.dirname(FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(BACKUPS, { recursive: true });

  if (fs.existsSync(FILE)) {
    // automatic backup, keep last 100
    fs.copyFileSync(FILE, path.join(BACKUPS, `db-${Date.now()}.json`));
    const backupFiles = fs.readdirSync(BACKUPS).sort();
    if (backupFiles.length > 100) {
      backupFiles.slice(0, -100).forEach(f => {
        try { fs.unlinkSync(path.join(BACKUPS, f)); } catch {}
      });
    }
  }

  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, FILE); // atomic write
}

const newId = () => crypto.randomBytes(6).toString('hex');

module.exports = { load, save, newId };
