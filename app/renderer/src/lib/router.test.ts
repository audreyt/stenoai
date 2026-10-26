import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigate, setNavigationGuard } from './router';

describe('navigation guard', () => {
  afterEach(() => {
    window.location.hash = '#/';
  });

  it('navigates when no guard is registered', () => {
    navigate('/chat');
    expect(window.location.hash).toBe('#/chat');
  });

  it('lets a guard refuse a navigation and see where it was headed', () => {
    const guard = vi.fn(() => false);
    const release = setNavigationGuard(guard);
    navigate('/chat');
    expect(guard).toHaveBeenCalledWith('/chat');
    expect(window.location.hash).toBe('#/');
    release();
  });

  it('lets a forced navigation past the guard', () => {
    const guard = vi.fn(() => false);
    const release = setNavigationGuard(guard);
    navigate('/chat', { force: true });
    expect(guard).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/chat');
    release();
  });

  it('does not consult the guard for the route already shown', () => {
    navigate('/chat');
    const guard = vi.fn(() => false);
    const release = setNavigationGuard(guard);
    navigate('chat');
    expect(guard).not.toHaveBeenCalled();
    release();
  });

  it('stops guarding once released, and a stale release keeps a newer guard', () => {
    const first = vi.fn(() => false);
    const releaseFirst = setNavigationGuard(first);
    const second = vi.fn(() => false);
    const releaseSecond = setNavigationGuard(second);
    releaseFirst();
    navigate('/chat');
    expect(second).toHaveBeenCalledWith('/chat');
    expect(window.location.hash).toBe('#/');
    releaseSecond();
    navigate('/chat');
    expect(window.location.hash).toBe('#/chat');
  });
});
