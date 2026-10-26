import * as React from 'react';

export function useHashRoute(): string {
  const [hash, setHash] = React.useState(() =>
    typeof window === 'undefined' ? '' : window.location.hash,
  );
  React.useEffect(() => {
    const handler = () => setHash(window.location.hash);
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  return hash;
}

export function routeFromHash(hash: string): string {
  const stripped = hash.replace(/^#/, '');
  return stripped.length > 0 ? stripped : '/';
}

export function useRoute(): string {
  return routeFromHash(useHashRoute());
}

// A screen holding unsaved work can veto navigation away from it. Every route
// change goes through navigate() (sidebar, command palette, deep links, the
// in-view back button), so one guard here covers all of them instead of each
// surface having to know about the draft. The guard receives the target route
// and returns false to stay; it is then responsible for asking the user and
// calling navigate(target, { force: true }) if they choose to leave.
//
// A hash change that bypasses navigate() is not guarded. Today there is none:
// nothing writes location.hash directly, and the app wires no history
// back/forward (no menu role, shortcut, app-command or swipe). Adding such a
// path must go through navigate() or extend this guard.
type NavigationGuard = (target: string) => boolean;
let navigationGuard: NavigationGuard | null = null;

/** Register the active guard. Returns a release function that only clears the
 *  guard it registered, so an unmounting screen cannot drop a newer one. */
export function setNavigationGuard(guard: NavigationGuard): () => void {
  navigationGuard = guard;
  return () => {
    if (navigationGuard === guard) navigationGuard = null;
  };
}

export function navigate(path: string, options: { force?: boolean } = {}) {
  if (typeof window === 'undefined') return;
  const next = path.startsWith('/') ? path : `/${path}`;
  if (window.location.hash === `#${next}`) return;
  if (!options.force && navigationGuard && !navigationGuard(next)) return;
  window.location.hash = next;
}

export function useNavigate() {
  return navigate;
}

// Tracks the most recent non-settings route so Settings's back button (and
// the sidebar Settings toggle) can return the user to where they came from
// instead of dumping them on Home. Module-level so it survives across
// component remounts.
let lastNonSettingsRoute: string = '/';

export function rememberNonSettingsRoute(route: string) {
  // `startsWith` rather than `===` so deep-links like /settings?tab=organisation
  // are still recognised as the settings route and don't get stored as
  // "last non-settings route" by mistake.
  if (!route.startsWith('/settings')) lastNonSettingsRoute = route;
}

export function getLastNonSettingsRoute(): string {
  return lastNonSettingsRoute;
}

/**
 * Toggle Settings: if already on /settings, return to the last non-settings
 * route the user was on. Otherwise stash the current route and navigate to
 * /settings.
 */
export function toggleSettings(currentRoute: string) {
  if (currentRoute.startsWith('/settings')) {
    navigate(lastNonSettingsRoute || '/');
  } else {
    rememberNonSettingsRoute(currentRoute);
    navigate('/settings');
  }
}

/** Pull a query-string param out of the current hash route. Used by Settings
 *  to deep-link to a specific tab via `/settings?tab=organisation`. Returns
 *  null when the param is absent or the route is malformed. */
export function getRouteParam(route: string, name: string): string | null {
  const qIdx = route.indexOf('?');
  if (qIdx < 0) return null;
  try {
    return new URLSearchParams(route.slice(qIdx + 1)).get(name);
  } catch (_) {
    return null;
  }
}
