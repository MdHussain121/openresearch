/**
 * Provider Response Cache with TTL & Quota Protection
 */

import { CacheEntry, ProviderCacheStats } from './types';

export class ProviderCache {
  private store: Map<string, CacheEntry<any>> = new Map();
  private hits = 0;
  private misses = 0;
  private defaultTtlMs: number;
  private maxEntries: number;

  constructor(defaultTtlMs: number = 24 * 60 * 60 * 1000, maxEntries: number = 500) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxEntries = maxEntries;
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return null;
    }

    // Refresh access order (LRU in ES6 Map)
    this.store.delete(key);
    this.store.set(key, entry);

    this.hits++;
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs?: number): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }

    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.store.set(key, {
      data,
      cachedAt: Date.now(),
      expiresAt,
    });
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): ProviderCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.store.size,
    };
  }

  getHitRate(): number {
    const total = this.hits + this.misses;
    return total > 0 ? this.hits / total : 0;
  }
}

export const providerCache = new ProviderCache();
