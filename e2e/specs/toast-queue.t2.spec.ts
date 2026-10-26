import { test, expect } from '../fixtures/electron';
import type { ElectronApplication, Page } from '@playwright/test';

/**
 * T2: in-app toasts queue instead of replacing each other (#412).
 *
 * A silence auto-stop followed moments later by note-ready used to close the
 * first toast before the user saw it. Drives the REAL main-process toast window
 * (T2: the mock IPC layer would replace the toast handlers): the second toast
 * must wait until the first is closed, then appear.
 */

type ShowResult = { success: boolean; shown?: boolean };
type StenoWindow = Window & {
  stenoai: {
    settings: {
      setNotifications: (v: boolean) => Promise<unknown>;
      showSilenceAutoStopNotification: (payload: unknown) => Promise<ShowResult>;
      showNoteReadyNotification: (payload: unknown) => Promise<ShowResult>;
    };
  };
};

const toastWindows = (app: ElectronApplication): Page[] =>
  app.windows().filter((w) => !w.isClosed() && w.url().includes('#/notification'));

const toastText = async (app: ElectronApplication): Promise<string> => {
  const texts = await Promise.all(
    toastWindows(app).map((w) => w.locator('body').innerText().catch(() => '')),
  );
  return texts.join('\n');
};

test('a second toast waits for the first instead of replacing it (#412)', async ({ launchApp }) => {
  const { app, page } = await launchApp();
  await page.evaluate(() => (window as StenoWindow).stenoai.settings.setNotifications(true));

  await page.evaluate(() =>
    (window as StenoWindow).stenoai.settings.showSilenceAutoStopNotification({
      minutes: 5,
      sessionName: 'Queue test',
    }),
  );
  await expect.poll(() => toastText(app)).toContain('Recording stopped');

  const second = await page.evaluate(() =>
    (window as StenoWindow).stenoai.settings.showNoteReadyNotification({
      title: 'Queued note',
      summaryFile: 'queued-note.json',
    }),
  );
  expect(second.shown).toBe(true);

  // The first toast stays; the second is not on screen yet.
  await page.waitForTimeout(1000);
  expect(await toastText(app)).toContain('Recording stopped');
  expect(await toastText(app)).not.toContain('Queued note');
  expect(toastWindows(app)).toHaveLength(1);

  // Closing the first brings up the second.
  await toastWindows(app)[0].getByTitle('Close').click({ force: true });
  await expect.poll(() => toastText(app)).toContain('Queued note');
  expect(await toastText(app)).not.toContain('Recording stopped');
});
