import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { readUserConfig } from '../fixtures/user-config';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { ElectronApplication } from '@playwright/test';

/**
 * T2 - OpenAI-compatible cloud ASR config. Drives the real backend's
 * `openaiAsr` IPC and asserts both the get/set round-trip and the persisted
 * config.json keys. Model-free + deterministic: every call here is a local
 * config write or a local safeStorage encryption. No network, no real ASR
 * endpoint is ever contacted (that's the whole point - this is the security +
 * wiring contract, not a transcription smoke).
 *
 * Security keystone: the API KEY must NEVER land in config.json. It is stored
 * encrypted (safeStorage) under the temp dir, exactly like the cloud
 * summariser key. Only the non-secret url/model persist to config.
 */

type AsrConfig = {
  success: boolean;
  api_url?: string;
  api_key_set?: boolean;
  model?: string;
  error?: string;
};
type SetKeyResult = { success: boolean; api_key_set?: boolean; error?: string };

type StenoWindow = Window & {
  stenoai: {
    openaiAsr: {
      getConfig: () => Promise<AsrConfig>;
      setConfig: (cfg: { api_url?: string; model?: string }) => Promise<AsrConfig>;
      setKey: (key: string) => Promise<SetKeyResult>;
    };
  };
};

const getConfig = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as StenoWindow).stenoai.openaiAsr.getConfig());

async function expectEncryptedKey(app: ElectronApplication, userDataDir: string, expectedKey: string) {
  const encrypted = readFileSync(path.join(userDataDir, '.openai-asr-api-key')).toString('base64');
  const envelope = await app.evaluate(({ safeStorage }, bytes) =>
    JSON.parse(safeStorage.decryptString(Buffer.from(bytes, 'base64'))), encrypted);
  expect(envelope).toEqual({ version: 1, origin: 'https://api.openai.com', key: expectedKey });
}

test('non-secret openai-asr config (url/model) round-trips and persists to config.json', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const { page } = await launchApp();

  // Fresh config → the registry defaults.
  const initial = await getConfig(page);
  expect(initial.success).toBe(true);
  expect(initial.api_url).toBe('https://api.openai.com/v1');
  expect(initial.model).toBe('whisper-1');
  expect(initial.api_key_set).toBe(false);

  // Set both non-secret fields.
  const setResult = await page.evaluate(() =>
    (window as StenoWindow).stenoai.openaiAsr.setConfig({
      api_url: 'https://api.groq.example/openai/v1',
      model: 'whisper-large-v3',
    }),
  );
  expect(setResult.success).toBe(true);

  // They persist to the right config.json keys...
  await expect
    .poll(() => {
      const cfg = readUserConfig(userDataDir);
      return { url: cfg.openai_asr_api_url, model: cfg.openai_asr_model };
    })
    .toEqual({
      url: 'https://api.groq.example/openai/v1',
      model: 'whisper-large-v3',
    });

  // ...and round-trip back through the getter.
  await expect
    .poll(async () => {
      const c = await getConfig(page);
      return { url: c.api_url, model: c.model };
    })
    .toEqual({
      url: 'https://api.groq.example/openai/v1',
      model: 'whisper-large-v3',
    });

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test('openai-asr API key is stored encrypted (safeStorage), not in config.json', async ({
  launchApp,
  userDataDir,
}) => {
  const { app, page } = await launchApp();

  // The key is persisted via safeStorage; on a headless runner with no usable
  // keyring it is unavailable - skip LOUDLY rather than emit a misleading red
  // (mirrors ai-provider.t2's cloud-key guard).
  const encryptionAvailable = await app.evaluate(({ safeStorage }) =>
    safeStorage.isEncryptionAvailable(),
  );
  if (!encryptionAvailable) {
    // eslint-disable-next-line no-console
    console.warn('[t2] SKIPPED openai-asr-key: safeStorage unavailable on this runner.');
    test.info().annotations.push({
      type: 'skip-reason',
      description: 'safeStorage unavailable; openai-asr key cannot persist on this runner',
    });
  }
  test.skip(!encryptionAvailable, 'safeStorage unavailable on this runner');

  const SECRET = 'sk-oai-e2e-secret-987';
  const setResult = await page.evaluate(
    (k) => (window as StenoWindow).stenoai.openaiAsr.setKey(k),
    SECRET,
  );
  expect(setResult.success).toBe(true);

  // Encrypted blob lands in the temp dir...
  await expect
    .poll(() => existsSync(path.join(userDataDir, '.openai-asr-api-key')), { timeout: 10_000 })
    .toBe(true);
  // ...the config reports it set...
  await expect.poll(async () => (await getConfig(page)).api_key_set).toBe(true);
  // ...and the plaintext key never appears in config.json.
  expect(JSON.stringify(readUserConfig(userDataDir))).not.toContain(SECRET);

  // Introduce a legacy value after startup migration has completed, then
  // rotate directly: success must not depend on a later settings refresh.
  writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({
    ...readUserConfig(userDataDir),
    openai_asr_api_key: 'legacy-synthetic-key',
  }));
  const rotation = await page.evaluate(() =>
    (window as StenoWindow).stenoai.openaiAsr.setKey('replacement-synthetic-key'),
  );
  expect(rotation.success).toBe(true);
  expect(readUserConfig(userDataDir)).not.toHaveProperty('openai_asr_api_key');
  await expectEncryptedKey(app, userDataDir, 'replacement-synthetic-key');
  expect((await getConfig(page)).api_key_set).toBe(true);

  // A bearer token is scoped to the canonical endpoint origin. Changing the
  // provider must leave the encrypted blob inert until the user saves a key
  // for that new origin, never reusing Authorization across providers.
  const endpointResult = await page.evaluate(() =>
    (window as StenoWindow).stenoai.openaiAsr.setConfig({
      api_url: 'https://replacement.example/v1',
    }),
  );
  expect(endpointResult.success).toBe(true);
  await expect.poll(async () => (await getConfig(page)).api_key_set).toBe(false);

  // Clearing removes the encrypted file and flips api_key_set back to false.
  const clearResult = await page.evaluate(() =>
    (window as StenoWindow).stenoai.openaiAsr.setKey(''),
  );
  expect(clearResult.success).toBe(true);
  await expect
    .poll(() => existsSync(path.join(userDataDir, '.openai-asr-api-key')))
    .toBe(false);
  await expect.poll(async () => (await getConfig(page)).api_key_set).toBe(false);
});

test('legacy-only openai-asr API key rotates to a usable encrypted replacement', async ({ launchApp, userDataDir }) => {
  const { app, page } = await launchApp();
  test.skip(!await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()), 'safeStorage unavailable on this runner');
  await getConfig(page);
  expect(existsSync(path.join(userDataDir, '.openai-asr-api-key'))).toBe(false);
  writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({
    ...readUserConfig(userDataDir),
    openai_asr_api_key: 'legacy-only-synthetic-key',
  }));
  const result = await page.evaluate(() =>
    (window as StenoWindow).stenoai.openaiAsr.setKey('legacy-only-replacement-key'),
  );
  expect(result.success).toBe(true);
  expect(readUserConfig(userDataDir)).not.toHaveProperty('openai_asr_api_key');
  await expectEncryptedKey(app, userDataDir, 'legacy-only-replacement-key');
  expect((await getConfig(page)).api_key_set).toBe(true);
});
