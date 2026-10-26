import { test, expect } from '../fixtures/electron';
import type { ElectronApplication, Page } from '@playwright/test';

type ConfigRace = {
  writes: number;
  reads: number;
  pending: Array<() => void>;
};
type RaceGlobal = typeof globalThis & { __cloudAsrConfigRace: ConfigRace };

async function installConfigRace(app: ElectronApplication) {
  await app.evaluate(() => {
    (globalThis as RaceGlobal).__cloudAsrConfigRace = { writes: 0, reads: 0, pending: [] };
  });
}

const raceWrites = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as RaceGlobal).__cloudAsrConfigRace.writes);

const releaseConfigSave = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as RaceGlobal).__cloudAsrConfigRace.pending.shift()?.());

async function flushPaint(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function openAiSettings(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=ai';
  });
  await expect(page.getByTestId('transcription-model-select')).toBeVisible();
}

async function chooseCloudApi(page: import('@playwright/test').Page) {
  await page.getByTestId('transcription-model-select').click();
  await page.getByRole('option', { name: /cloud api/i }).click();
}

test('cloud ASR requires confirmation and honours cancellation', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true });
  await openAiSettings(page);

  await chooseCloudApi(page);
  const dialog = page.locator('[data-confirm-dialog]');
  await expect(dialog).toContainText('Send audio to a cloud service?');
  await expect(dialog).toContainText('audio leaves your computer');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByTestId('openai-asr-config')).toHaveCount(0);

  await chooseCloudApi(page);
  await dialog.getByRole('button', { name: 'Use cloud ASR' }).click();
  await expect(page.getByTestId('openai-asr-config')).toBeVisible();
});

test('cloud ASR save failures stay visible and restore the committed endpoint', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_OAI_ASR_SAVE_FAIL: '1' },
  });
  await openAiSettings(page);
  await chooseCloudApi(page);
  await page.locator('[data-confirm-dialog]').getByRole('button', { name: 'Use cloud ASR' }).click();

  const config = page.getByTestId('openai-asr-config');
  const endpoint = config.getByLabel('API base URL');
  await endpoint.fill('https://rejected.example/v1');
  await endpoint.blur();

  await expect(config.getByRole('alert')).toContainText('previous value is still active');
  await expect(endpoint).toHaveValue('https://api.openai.com/v1');
});

test('clearing a saved key wins over the replacement queued by input blur', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_OAI_ASR_KEY_SET: '1',
      STENOAI_E2E_OAI_ASR_KEY_RACE: '1',
    },
  });
  await openAiSettings(page);
  await chooseCloudApi(page);
  await page.locator('[data-confirm-dialog]').getByRole('button', { name: 'Use cloud ASR' }).click();

  const config = page.getByTestId('openai-asr-config');
  await config.getByLabel('API key').fill('replacement-key');
  await config.getByRole('button', { name: 'Clear' }).click();

  await expect(config).toContainText('Stored encrypted on your device');
  await expect(config.getByRole('button', { name: 'Clear' })).toHaveCount(0);
});

test('a completed model save preserves an unsaved endpoint edit', async ({ launchApp }) => {
  const { app, page } = await launchApp({ mockIpc: true });
  await installConfigRace(app);
  await openAiSettings(page);
  await chooseCloudApi(page);
  await page.locator('[data-confirm-dialog]').getByRole('button', { name: 'Use cloud ASR' }).click();
  const config = page.getByTestId('openai-asr-config');
  await expect(config.getByLabel('API base URL')).toHaveValue('https://api.openai.com/v1');
  await config.getByLabel('Model', { exact: true }).fill('replacement-model');
  await config.getByLabel('API base URL').fill('https://unsaved.example/v1');
  await expect.poll(() => raceWrites(app)).toBe(1);
  const reads = await app.evaluate(() => (globalThis as RaceGlobal).__cloudAsrConfigRace.reads);
  await releaseConfigSave(app);
  await expect.poll(() => app.evaluate(() => (globalThis as RaceGlobal).__cloudAsrConfigRace.reads)).toBeGreaterThan(reads);
  // This hint depends on config.data, not on the mutation response. Wait for
  // the refetch to reach React before allowing its effects to finish painting.
  await expect(config).toContainText('A key is saved.');
  await flushPaint(page);
  await expect(config.getByLabel('API base URL')).toHaveValue('https://unsaved.example/v1');
});

for (const field of [
  { label: 'API base URL', key: 'api_url', initial: 'https://api.openai.com/v1', replacement: 'https://pending.example/v1' },
  { label: 'Model', key: 'model', initial: 'whisper-1', replacement: 'pending-model' },
] as const) {
  test(`returning ${field.key} to its saved value wins over an older pending save`, async ({ launchApp }) => {
    const { app, page } = await launchApp({ mockIpc: true });
    await installConfigRace(app);
    await openAiSettings(page);
    await chooseCloudApi(page);
    await page.locator('[data-confirm-dialog]').getByRole('button', { name: 'Use cloud ASR' }).click();
    const config = page.getByTestId('openai-asr-config');
    const input = config.getByLabel(field.label, { exact: true });
    await expect(input).toHaveValue(field.initial);
    await input.fill(field.replacement);
    await input.blur();
    await expect.poll(() => raceWrites(app)).toBe(1);
    await input.fill(field.initial);
    await input.blur();
    await flushPaint(page);
    expect(await raceWrites(app)).toBe(1); // the next write must be serialized
    await releaseConfigSave(app);
    await expect.poll(() => raceWrites(app)).toBe(2);
    await releaseConfigSave(app);
    await expect.poll(() => page.evaluate(async (key) =>
      (await window.stenoai.openaiAsr.getConfig())[key], field.key,
    )).toBe(field.initial);
    await expect(config).toContainText('A key is saved.');
    await flushPaint(page);
    await expect(input).toHaveValue(field.initial);
  });
}

test('a completed key save preserves a newly typed replacement', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_OAI_ASR_KEY_RACE: '1' },
  });
  await openAiSettings(page);
  await chooseCloudApi(page);
  await page.locator('[data-confirm-dialog]').getByRole('button', { name: 'Use cloud ASR' }).click();
  const config = page.getByTestId('openai-asr-config');
  const input = config.getByLabel('API key');
  await input.fill('first-synthetic-key');
  await input.blur();
  await input.fill('second-synthetic-key');
  await expect(config).toContainText('A key is saved.');
  await expect(input).toHaveValue('second-synthetic-key');
  await input.blur();
  await expect(input).toHaveValue('');
});
