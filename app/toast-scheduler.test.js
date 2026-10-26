'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createToastScheduler } = require('./toast-scheduler');

// A fake window layer: present() records what is on screen, dismissWindow()
// queues a close that flushCloses() delivers, like the real asynchronous
// 'closed' event.
function harness(options = {}) {
  const shown = [];
  const dropped = [];
  const pendingCloses = [];
  const scheduler = createToastScheduler({
    present: (t) => shown.push(t.name),
    dismissWindow: (t) => pendingCloses.push(t),
    onDropped: (t) => dropped.push(t.name),
    ...options,
  });
  const flushCloses = () => {
    const results = [];
    while (pendingCloses.length) {
      const t = pendingCloses.shift();
      results.push([t.name, scheduler.windowClosed(t)]);
    }
    return results;
  };
  // The user or the 15 s timer closes the toast on screen.
  const closeActive = () => {
    const t = scheduler.active;
    return [t.name, scheduler.windowClosed(t)];
  };
  return { scheduler, shown, dropped, flushCloses, closeActive };
}

const toast = (name, extra = {}) => ({ name, persistent: false, ...extra });
const persistent = (name) => toast(name, { persistent: true });

test('a toast arriving while another is up waits instead of replacing it', () => {
  const { scheduler, shown, closeActive } = harness();
  scheduler.show(toast('auto-stop'));
  scheduler.show(toast('note-ready'));
  assert.deepStrictEqual(shown, ['auto-stop']);
  assert.deepStrictEqual(closeActive(), ['auto-stop', true]);
  assert.deepStrictEqual(shown, ['auto-stop', 'note-ready']);
  closeActive();
  assert.strictEqual(scheduler.active, null);
});

test('a persistent toast is interrupted, then shown again, without counting as closed', () => {
  const { scheduler, shown, flushCloses, closeActive } = harness();
  const paused = persistent('recording-paused');
  scheduler.show(paused);
  scheduler.show(toast('note-ready'));
  assert.deepStrictEqual(flushCloses(), [['recording-paused', false]]);
  assert.deepStrictEqual(shown, ['recording-paused', 'note-ready']);
  closeActive();
  assert.deepStrictEqual(shown, ['recording-paused', 'note-ready', 'recording-paused']);
  assert.strictEqual(scheduler.active, paused);
});

test('a returning persistent toast does not block toasts that arrived while it was away', () => {
  const { scheduler, shown, flushCloses, closeActive } = harness();
  scheduler.show(persistent('recording-paused'));
  scheduler.show(toast('a'));
  flushCloses();
  scheduler.show(toast('b')); // arrives while "a" is on screen
  closeActive(); // a
  closeActive(); // b
  assert.deepStrictEqual(shown, ['recording-paused', 'a', 'b', 'recording-paused']);
});

test('toasts arriving while the persistent one is closing keep their order', () => {
  const { scheduler, shown, flushCloses, closeActive } = harness();
  scheduler.show(persistent('recording-paused'));
  scheduler.show(toast('a'));
  scheduler.show(toast('b'));
  flushCloses();
  closeActive();
  closeActive();
  assert.deepStrictEqual(shown, ['recording-paused', 'a', 'b', 'recording-paused']);
});

test('cancelling a persistent toast while it makes room closes it once and for good', () => {
  const { scheduler, shown, flushCloses, closeActive } = harness();
  const paused = persistent('recording-paused');
  scheduler.show(paused);
  scheduler.show(toast('a'));
  assert.strictEqual(scheduler.cancel(paused), 'closing');
  scheduler.show(toast('b')); // must not revive the cancelled toast
  assert.deepStrictEqual(flushCloses(), [['recording-paused', true]]);
  closeActive(); // a
  closeActive(); // b
  assert.deepStrictEqual(shown, ['recording-paused', 'a', 'b']);
  assert.strictEqual(scheduler.active, null);
});

test('cancelling a queued toast removes it before it is ever shown', () => {
  const { scheduler, shown, closeActive } = harness();
  scheduler.show(toast('first'));
  const stale = toast('stale');
  scheduler.show(stale);
  assert.strictEqual(scheduler.cancel(stale), 'removed');
  closeActive();
  assert.deepStrictEqual(shown, ['first']);
});

test('a tagged toast replaces a waiting toast with the same tag', () => {
  const { scheduler, shown, dropped, closeActive } = harness();
  scheduler.show(toast('note-ready'));
  scheduler.show(toast('detected-zoom', { tag: 'meeting-detected' }));
  scheduler.show(toast('detected-teams', { tag: 'meeting-detected' }));
  assert.deepStrictEqual(dropped, ['detected-zoom']);
  closeActive();
  assert.deepStrictEqual(shown, ['note-ready', 'detected-teams']);
});

test('a tagged toast replaces the visible toast with the same tag', () => {
  const { scheduler, shown, flushCloses } = harness();
  scheduler.show(toast('detected-zoom', { tag: 'meeting-detected' }));
  scheduler.show(toast('detected-teams', { tag: 'meeting-detected' }));
  assert.deepStrictEqual(flushCloses(), [['detected-zoom', true]]);
  assert.deepStrictEqual(shown, ['detected-zoom', 'detected-teams']);
});

test('the queue is bounded and drops the oldest non-persistent toast', () => {
  const { scheduler, dropped } = harness({ maxQueued: 2 });
  scheduler.show(toast('on-screen'));
  scheduler.show(toast('one'));
  scheduler.show(toast('two'));
  scheduler.show(toast('three'));
  assert.deepStrictEqual(dropped, ['one']);
  assert.deepStrictEqual(scheduler.queued.map((t) => t.name), ['two', 'three']);
});

test('a tagged replacement survives a full queue', () => {
  const { scheduler, dropped, flushCloses } = harness({ maxQueued: 2 });
  scheduler.show(toast('detected-zoom', { tag: 'meeting-detected' }));
  scheduler.show(toast('one'));
  scheduler.show(toast('two'));
  scheduler.show(toast('detected-teams', { tag: 'meeting-detected' }));
  assert.deepStrictEqual(dropped, ['one']);
  flushCloses();
  assert.strictEqual(scheduler.active.name, 'detected-teams');
});

test('the bound also holds while a persistent toast is making room', () => {
  const { scheduler, dropped, flushCloses } = harness({ maxQueued: 2 });
  scheduler.show(persistent('recording-paused'));
  for (const name of ['a', 'b', 'c', 'd']) scheduler.show(toast(name));
  assert.ok(scheduler.queued.length <= 2);
  flushCloses();
  assert.ok(scheduler.queued.length <= 2);
  assert.ok(dropped.length >= 2);
  assert.ok(!dropped.includes('recording-paused'));
});

test('showing the same toast twice is a no-op', () => {
  const { scheduler, shown } = harness();
  const t = toast('once');
  scheduler.show(t);
  scheduler.show(t);
  assert.deepStrictEqual(shown, ['once']);
  assert.deepStrictEqual(scheduler.queued, []);
});

test('only a persistent toast may cover a fullscreen app (#412)', () => {
  const { toastLayering } = require('./toast-scheduler');
  assert.deepStrictEqual(toastLayering({ persistent: true }), {
    visibleOnFullScreen: true,
    skipTransformProcessType: false,
    level: 'screen-saver',
  });
  // An ordinary toast must not touch the process type, or it would show a
  // Dock icon the user chose to hide.
  assert.deepStrictEqual(toastLayering({ persistent: false }), {
    visibleOnFullScreen: false,
    skipTransformProcessType: true,
    level: 'floating',
  });
  // A Notification without the option is not persistent.
  assert.deepStrictEqual(toastLayering({}), toastLayering({ persistent: false }));
});
