import { afterEach, describe, expect, it } from 'vitest';
import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { queryClient } from './queryClient';

// Every query and mutation here is an IPC call into the main process, so the
// OS losing its network must not pause them (#459): a paused queue poll left
// the processing screen reading a stale "idle, empty" state.
describe('queryClient while the OS reports offline', () => {
  afterEach(() => {
    onlineManager.setOnline(true);
    queryClient.clear();
  });

  it('still runs queries', async () => {
    onlineManager.setOnline(false);
    const result = await Promise.race([
      queryClient.fetchQuery({ queryKey: ['offline-probe'], queryFn: async () => 'fetched' }),
      new Promise((resolve) => setTimeout(() => resolve('paused'), 200)),
    ]);
    expect(result).toBe('fetched');
  });

  it('still runs mutations', async () => {
    onlineManager.setOnline(false);
    const observer = new MutationObserver(queryClient, { mutationFn: async () => 'saved' });
    const result = await Promise.race([
      observer.mutate(),
      new Promise((resolve) => setTimeout(() => resolve('paused'), 200)),
    ]);
    expect(result).toBe('saved');
  });
});
