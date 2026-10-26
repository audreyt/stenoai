const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Write via a temp file in the SAME directory, then rename. rename(2) is atomic
// within a filesystem, so a reader either sees the old file or the new one and
// never a truncated one. The temp name is randomised so two concurrent writers
// cannot collide, and it is dot-prefixed so a directory listing stays clean.
function writeFileAtomicSync(targetPath, data) {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const tmpPath = path.join(dir, `.${base}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  let mode = 0o600;
  try {
    mode = fs.statSync(targetPath).mode & 0o777;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  let fd;
  let ownsTemp = false;
  try {
    fd = fs.openSync(tmpPath, 'wx', mode);
    ownsTemp = true;
    if (process.platform !== 'win32') fs.fchmodSync(fd, mode);
    fs.writeFileSync(fd, data, 'utf8');
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmpPath, targetPath);
    ownsTemp = false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (_) {
        // Preserve the write error while still attempting cleanup.
      }
    }
    try {
      if (ownsTemp) fs.unlinkSync(tmpPath);
    } catch (_) {
      // Cleanup must not hide the original write error.
    }
  }
}

module.exports = { writeFileAtomicSync };
