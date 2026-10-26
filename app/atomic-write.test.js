const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { writeFileAtomicSync } = require('./atomic-write');

function tmpFile(t, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'note.md');
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

test('writeFileAtomicSync replaces the file contents', (t) => {
  const file = tmpFile(t, 'old');
  writeFileAtomicSync(file, 'new');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'new');
});

test('writeFileAtomicSync creates a file that does not exist yet', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'fresh.md');
  writeFileAtomicSync(file, 'hello');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'hello');
});

test('a failed write leaves the original intact and removes the temp file', (t) => {
  const file = tmpFile(t, 'original');
  const dir = path.dirname(file);
  const before = fs.readdirSync(dir);

  // Force the failure AFTER the temp file has genuinely been written to disk,
  // by making the rename step itself throw. This is the real window the
  // atomic-write guarantee protects: the temp file exists, the rename fails,
  // and the catch block's cleanup must remove it without touching the
  // original. Using node:test's built-in mock keeps this dependency-free and
  // restores fs.renameSync automatically once the test ends.
  t.mock.method(fs, 'renameSync', () => {
    throw new Error('boom');
  });

  assert.throws(() => {
    writeFileAtomicSync(file, 'new');
  });

  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'original');
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), before.sort());
});


test('replacing a private note preserves its permissions', { skip: process.platform === 'win32' }, (t) => {
  const file = tmpFile(t, 'private note');
  fs.chmodSync(file, 0o600);
  writeFileAtomicSync(file, 'updated private note');
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
});

test('new notes are private by default', { skip: process.platform === 'win32' }, (t) => {
  const file = tmpFile(t, 'placeholder');
  fs.unlinkSync(file);
  writeFileAtomicSync(file, 'private note');
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
});

test('a colliding temporary file is neither overwritten nor removed', (t) => {
  const file = tmpFile(t, 'original');
  t.mock.method(crypto, 'randomBytes', () => Buffer.from('abcdefabcdef', 'hex'));
  const otherFile = path.join(path.dirname(file), '.note.md.abcdefabcdef.tmp');
  fs.writeFileSync(otherFile, 'belongs to another writer');
  assert.throws(() => writeFileAtomicSync(file, 'replacement'), { code: 'EEXIST' });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'original');
  assert.strictEqual(fs.readFileSync(otherFile, 'utf8'), 'belongs to another writer');
});
