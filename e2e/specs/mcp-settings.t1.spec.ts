import { test, expect } from '../fixtures/electron';

/**
 * T1 — renderer-only, mock IPC.
 * Proves the Local MCP server settings in the Integrations tab:
 * 1. The MCP section renders and the server toggle is OFF by default.
 * 2. Plain disclosure copy explains local-only (127.0.0.1), key required, and permissions (notes, transcripts, folders, questions).
 * 3. The API key is masked by default until explicitly revealed.
 * 4. Inline port validation rejects values outside 1024-65535 and non-integers without triggering backend mutation.
 * 5. Regenerate key opens a confirmation dialog warning about disconnecting active clients.
 * 6. Client configuration snippet renders with endpoint and Authorization header.
 * 7. Custom key paste input mode toggles and allows cancel.
 *
 * NOTE ON MOCK IPC STUB LIMITATIONS:
 * The mcp channels (`mcp-get-status`, `mcp-get-key`, `mcp-set-key`, `mcp-regenerate-key`,
 * `mcp-set-enabled`, `mcp-set-port`) are intentionally NOT stubbed in app/e2e-mock-ipc.js.
 * Under permissive `{ success: true }` mock resolution, the following backend behaviors
 * cannot be asserted in this T1 suite and require backend/T2 integration tests or explicit stubs:
 * - Round-trip persistence of enabled state and port changes across reloads.
 * - Exact key string verification returned from `mcp-get-key` (returns mock `{ success: true }`).
 * - Active localhost socket binding and port conflict refusal.
 * - Live HTTP Streamable protocol authorization header verification.
 */

test('Local MCP settings render OFF by default with disclosure copy and masked key', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=integrations';
  });

  const section = page.locator('[data-settings-tab="integrations"]');
  await expect(section).toBeVisible();

  // 1. Off by default
  const toggle = section.getByTestId('mcp-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();

  // 2. Plain disclosure copy (visible above the toggle)
  await expect(section.getByText('Local MCP server', { exact: true })).toBeVisible();
  await expect(
    section.getByText(/Listens on localhost \(127\.0\.0\.1\) only/),
  ).toBeVisible();
  await expect(
    section.getByText(/requires an API key on every request/),
  ).toBeVisible();
  await expect(
    section.getByText(/read your notes, transcripts, and folders/),
  ).toBeVisible();
  await expect(
    section.getByText(/ask questions across them/),
  ).toBeVisible();

  // 3. Key is masked by default
  const maskedKey = section.getByTestId('mcp-key-masked');
  await expect(maskedKey).toBeVisible();
  await expect(maskedKey).toHaveText('••••••••••••••••••••••••••••••••');
  await expect(section.getByTestId('mcp-key-revealed')).toHaveCount(0);

  // Reveal button is available
  await expect(section.getByTestId('mcp-reveal-key-btn')).toHaveText('Reveal');
});

test('MCP port validation rejects invalid ports inline', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=integrations';
  });

  const section = page.locator('[data-settings-tab="integrations"]');
  await expect(section).toBeVisible();

  const portInput = section.getByTestId('mcp-port-input');
  await expect(portInput).toBeVisible();
  await expect(portInput).toHaveValue('27127');

  // No error initially
  await expect(section.getByTestId('mcp-port-error')).toHaveCount(0);

  // Type invalid port < 1024
  await portInput.fill('80');
  const errorMsg = section.getByTestId('mcp-port-error');
  await expect(errorMsg).toBeVisible();
  await expect(errorMsg).toHaveText('Port must be an integer between 1024 and 65535.');

  // Type invalid port > 65535
  await portInput.fill('70000');
  await expect(errorMsg).toBeVisible();
  await expect(errorMsg).toHaveText('Port must be an integer between 1024 and 65535.');

  // Type non-numeric
  await portInput.fill('abc');
  await expect(errorMsg).toBeVisible();
  await expect(errorMsg).toHaveText('Port must be an integer between 1024 and 65535.');

  // Type valid port
  await portInput.fill('27128');
  await expect(section.getByTestId('mcp-port-error')).toHaveCount(0);
});

test('MCP client configuration snippet displays endpoint and Authorization header', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=integrations';
  });

  const section = page.locator('[data-settings-tab="integrations"]');
  await expect(section).toBeVisible();

  const configBlock = section.getByTestId('mcp-client-config');
  await expect(configBlock).toBeVisible();
  await expect(configBlock).toContainText('http://127.0.0.1:27127/mcp');
  await expect(configBlock).toContainText('"Authorization": "Bearer YOUR_API_KEY"');
  await expect(section.getByTestId('mcp-copy-config-btn')).toBeVisible();
});

test('Regenerate API key triggers confirmation dialog', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=integrations';
  });

  const section = page.locator('[data-settings-tab="integrations"]');
  await expect(section).toBeVisible();

  const regenBtn = section.getByTestId('mcp-regenerate-key-btn');
  await expect(regenBtn).toBeVisible();
  await regenBtn.click();

  // Confirmation dialog opens
  const dialog = page.locator('[data-confirm-dialog]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Regenerate MCP API key?');
  await expect(dialog).toContainText('disconnect any active MCP clients');

  // Cancel closes dialog
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('Paste custom key toggles input mode and allows cancel', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=integrations';
  });

  const section = page.locator('[data-settings-tab="integrations"]');
  await expect(section).toBeVisible();

  const customKeyBtn = section.getByTestId('mcp-custom-key-btn');
  await expect(customKeyBtn).toBeVisible();
  await customKeyBtn.click();

  const customKeyInput = section.getByTestId('mcp-custom-key-input');
  await expect(customKeyInput).toBeVisible();
  await expect(section.getByTestId('mcp-save-custom-key-btn')).toBeVisible();
  const cancelBtn = section.getByTestId('mcp-cancel-custom-key-btn');
  await expect(cancelBtn).toBeVisible();

  // Cancel reverts to masked display
  await cancelBtn.click();
  await expect(section.getByTestId('mcp-custom-key-input')).toHaveCount(0);
  await expect(section.getByTestId('mcp-key-masked')).toBeVisible();
});
