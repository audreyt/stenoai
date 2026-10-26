import { QueryClient } from '@tanstack/react-query';

// networkMode 'always': every query and mutation here is an IPC call into the
// main process, which works the same with or without a network. React Query's
// default ('online') pauses all of them while the OS reports offline, freezing
// the UI on stale data and holding back saves until Wi-Fi returns (#459). Main
// still reports real network failures (org adapter, cloud providers) as errors.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
      networkMode: 'always',
    },
    mutations: {
      networkMode: 'always',
    },
  },
});
