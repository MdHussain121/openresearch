import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProviderCache } from './cache';

describe('ProviderCache', () => {
  let cache: ProviderCache;

  beforeEach(() => {
    cache = new ProviderCache(1000, 3); // 1s TTL, max 3 entries
  });

  it('stores and retrieves cached data', () => {
    cache.set('key1', { title: 'Test Paper' });
    expect(cache.has('key1')).toBe(true);
    expect(cache.get('key1')).toEqual({ title: 'Test Paper' });
  });

  it('tracks hits and misses accurately', () => {
    cache.set('key1', 'value1');
    cache.get('key1'); // hit
    cache.get('key2'); // miss

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(cache.getHitRate()).toBe(0.5);
  });

  it('deletes and reports a miss for expired entries on get', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    cache.set('ephemeral', 'data', 500);
    expect(cache.has('ephemeral')).toBe(true);

    // Advance past the TTL
    vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));
    expect(cache.get('ephemeral')).toBeNull(); // expired -> deleted + miss
    expect(cache.has('ephemeral')).toBe(false); // already removed

    vi.useRealTimers();
  });

  it('replaces an existing key without evicting another entry', () => {
    cache.set('a', 'first');
    cache.set('b', 'second');

    cache.set('a', 'updated'); // existing-key branch: delete-then-set

    expect(cache.get('a')).toBe('updated');
    expect(cache.get('b')).toBe('second');
    expect(cache.getStats().size).toBe(2);
  });

  it('handles zero-capacity caches and empty hit-rate totals', () => {
    const tiny = new ProviderCache(1000, 0);
    tiny.set('never', 'stored'); // eviction attempted but no oldest key exists
    expect(tiny.get('never')).toBe('stored'); // nothing could be evicted
    expect(new ProviderCache().getHitRate()).toBe(0);
  });

  it('evicts oldest entry when maxEntries is exceeded (LRU behavior)', () => {
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    cache.set('k3', 'v3');

    // Access k1 to make it most recently used
    cache.get('k1');

    // Insert k4 -> should evict k2 (oldest)
    cache.set('k4', 'v4');

    expect(cache.get('k1')).toBe('v1');
    expect(cache.get('k2')).toBeNull(); // evicted
    expect(cache.get('k3')).toBe('v3');
    expect(cache.get('k4')).toBe('v4');
  });

  it('expires entries after TTL elapsed', () => {
    vi.useFakeTimers();
    cache.set('tempKey', 'tempVal', 500); // 500ms TTL

    expect(cache.get('tempKey')).toBe('tempVal');

    vi.advanceTimersByTime(600);

    expect(cache.has('tempKey')).toBe(false);
    expect(cache.get('tempKey')).toBeNull();
    vi.useRealTimers();
  });

  it('clears all cached entries and resets statistics', () => {
    cache.set('k1', 'v1');
    cache.get('k1');
    cache.clear();

    expect(cache.getStats()).toEqual({
      hits: 0,
      misses: 0,
      size: 0,
    });
    expect(cache.has('k1')).toBe(false);
  });
});
