'use strict';

/**
 * Decides which in-app toast is on screen (#412).
 *
 * The toast window shows one notification at a time. Before this scheduler a
 * new toast closed the current one, so a silence auto-stop followed moments
 * later by note-ready lost the first, and a sleep-paused "Recording paused"
 * vanished after 15 s or under any later toast while the recording stayed
 * paused. Now:
 *  - a new toast waits behind the one on screen (FIFO, bounded);
 *  - a persistent toast never auto-closes; a non-persistent toast arriving
 *    while it is up interrupts it, and it comes back once no non-persistent
 *    toast is waiting;
 *  - a toast with a `tag` replaces a waiting or visible toast with the same
 *    tag instead of queueing behind it (e.g. a newer "Meeting detected").
 *
 * The scheduler owns no windows. `present(toast)` must open the toast's window
 * and `dismissWindow(toast)` must close it; when that window is gone the caller
 * reports it through `windowClosed(toast)`. `onDropped(toast)` is called for a
 * toast that leaves the queue without ever being shown.
 */
function createToastScheduler({ present, dismissWindow, onDropped = () => {}, maxQueued = 5 }) {
  let active = null;
  // The active toast's window has been asked to close.
  let activeClosing = false;
  // The active toast is closing only to make room and must come back.
  let activeComesBack = false;
  const queue = [];

  // Non-persistent toasts go first, so a returning persistent toast (which has
  // no auto-close) can never block the ones behind it.
  function presentNext() {
    let index = queue.findIndex((t) => !t.persistent);
    if (index === -1) index = 0;
    active = queue.splice(index, 1)[0] || null;
    activeClosing = false;
    activeComesBack = false;
    if (active) present(active);
  }

  function drop(toast) {
    const index = queue.indexOf(toast);
    if (index !== -1) queue.splice(index, 1);
    onDropped(toast);
  }

  // `keep` is the toast that just arrived; it must not be the one evicted.
  function trimQueue(keep = null) {
    while (queue.length > maxQueued) {
      const oldest = queue.find((t) => !t.persistent && t !== keep);
      if (!oldest) return;
      drop(oldest);
    }
  }

  function closeActive(comesBack) {
    if (activeClosing) {
      // Already closing: only a definite close may cancel a pending return.
      if (!comesBack) activeComesBack = false;
      return;
    }
    activeClosing = true;
    activeComesBack = comesBack;
    dismissWindow(active);
  }

  function show(toast) {
    if (toast === active || queue.includes(toast)) return;
    if (toast.tag) {
      for (const queued of queue.filter((t) => t.tag === toast.tag)) drop(queued);
    }
    if (!active) {
      active = toast;
      present(toast);
      return;
    }
    if (toast.tag && active.tag === toast.tag) {
      // Replace the visible toast; the newer one goes first.
      queue.unshift(toast);
      closeActive(false);
    } else if (active.persistent && !toast.persistent) {
      // Appended, not prepended: presentNext() already puts non-persistent
      // toasts first, and arrivals while the window is closing keep order.
      queue.push(toast);
      closeActive(true);
    } else {
      queue.push(toast);
    }
    trimQueue(toast);
  }

  /**
   * The toast's window closed. Returns true when the toast is done (the caller
   * then emits its 'close' event), false when it only made room and is queued
   * again.
   */
  function windowClosed(toast) {
    if (toast !== active) return true;
    const comesBack = activeComesBack;
    if (comesBack) queue.push(toast);
    presentNext();
    trimQueue();
    return !comesBack;
  }

  /**
   * Close a toast from code. A queued toast is removed without ever showing
   * ('removed'); the active one has its window closed for good ('closing').
   */
  function cancel(toast) {
    const index = queue.indexOf(toast);
    if (index !== -1) {
      queue.splice(index, 1);
      return 'removed';
    }
    if (toast === active) {
      closeActive(false);
      return 'closing';
    }
    return 'unknown';
  }

  return {
    show,
    windowClosed,
    cancel,
    get active() {
      return active;
    },
    get queued() {
      return [...queue];
    },
  };
}

/**
 * How a toast window sits above other windows (#412). Only a persistent toast
 * ("Recording paused": the user believes they are still capturing) may cover a
 * fullscreen app such as a presentation; every other toast stays off fullscreen
 * spaces, where the OS would have held back its own banner too. Electron cannot
 * read macOS Focus or Windows Do Not Disturb, so this is the closest respect we
 * can give it. Both settings only take effect on macOS.
 *
 * skipTransformProcessType: without it, Electron switches the macOS process
 * type on every setVisibleOnAllWorkspaces call, which shows or hides the Dock
 * icon behind the user's "Hide Dock icon" setting. Only covering fullscreen
 * needs that switch, so an ordinary toast skips it and leaves the Dock alone;
 * the persistent toast keeps the behaviour it has always had.
 *
 * @param {{ persistent?: boolean }} toast
 * @returns {{ visibleOnFullScreen: boolean, skipTransformProcessType: boolean,
 *   level: 'screen-saver' | 'floating' }}
 */
function toastLayering({ persistent } = {}) {
  return persistent
    ? { visibleOnFullScreen: true, skipTransformProcessType: false, level: 'screen-saver' }
    : { visibleOnFullScreen: false, skipTransformProcessType: true, level: 'floating' };
}

module.exports = { createToastScheduler, toastLayering };
