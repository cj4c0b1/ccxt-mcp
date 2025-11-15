/**
 * Cache management system for CCXT MCP Server
 * Implements TTL-based caching with local file storage
 */

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

interface CacheMetadata {
  totalEntries: number;
  lastCleanup: number;
}

export class CacheManager {
  private cacheDir: string;
  private metadataPath: string;
  private defaultTTL: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize cache manager
   * @param cacheDir Optional custom cache directory path
   * @param defaultTTL Default TTL in milliseconds (default: 5 minutes)
   */
  constructor(cacheDir?: string, defaultTTL: number = 5 * 60 * 1000) {
    // Determine cache directory path
    if (cacheDir) {
      this.cacheDir = cacheDir;
    } else {
      // Use OS-specific cache directory
      const homeCacheDir = path.join(os.homedir(), ".cache", "ccxt-mcp");
      this.cacheDir = homeCacheDir;
    }

    this.metadataPath = path.join(this.cacheDir, ".metadata.json");
    this.defaultTTL = defaultTTL;

    // Ensure cache directory exists
    this.ensureCacheDir();

    // Start periodic cleanup
    this.startCleanupInterval();

    console.error(`[INFO] Cache initialized at: ${this.cacheDir}`);
    console.error(`[INFO] Default TTL: ${defaultTTL}ms (${defaultTTL / 1000}s)`);
  }

  /**
   * Ensure cache directory exists
   */
  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      console.error(`[INFO] Created cache directory: ${this.cacheDir}`);
    }
  }

  /**
   * Generate a cache key from request parameters
   * @param namespace Namespace for the cache (e.g., 'tool', 'resource')
   * @param identifier Identifier for the specific operation (e.g., tool name, resource URI)
   * @param params Additional parameters to include in the key
   */
  public generateCacheKey(
    namespace: string,
    identifier: string,
    params?: Record<string, any>
  ): string {
    const dataToHash = JSON.stringify({
      namespace,
      identifier,
      params: params || {},
    });

    // Create a hash of the parameters for a consistent key
    const hash = crypto.createHash("sha256").update(dataToHash).digest("hex");
    return `${namespace}_${identifier}_${hash}`;
  }

  /**
   * Get cache file path for a given key
   */
  private getCacheFilePath(key: string): string {
    return path.join(this.cacheDir, `${key}.json`);
  }

  /**
   * Get data from cache
   * @param key Cache key
   * @returns Cached data or null if not found or expired
   */
  public get<T = any>(key: string): T | null {
    try {
      const filePath = this.getCacheFilePath(key);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.error(`[DEBUG] Cache miss: ${key}`);
        return null;
      }

      // Read cache entry
      const fileContent = fs.readFileSync(filePath, "utf-8");
      const entry: CacheEntry<T> = JSON.parse(fileContent);

      // Check if expired
      const now = Date.now();
      const age = now - entry.timestamp;

      if (age > entry.ttl) {
        console.error(`[DEBUG] Cache expired: ${key} (age: ${age}ms, ttl: ${entry.ttl}ms)`);
        // Delete expired entry
        this.delete(key);
        return null;
      }

      console.error(`[DEBUG] Cache hit: ${key} (age: ${age}ms, ttl: ${entry.ttl}ms)`);
      return entry.data;
    } catch (error) {
      console.error(`[ERROR] Failed to read cache for key ${key}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Set data in cache
   * @param key Cache key
   * @param data Data to cache
   * @param ttl Optional TTL in milliseconds (uses default if not provided)
   */
  public set<T = any>(key: string, data: T, ttl?: number): void {
    try {
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        ttl: ttl || this.defaultTTL,
      };

      const filePath = this.getCacheFilePath(key);
      fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), "utf-8");

      console.error(`[DEBUG] Cache set: ${key} (ttl: ${entry.ttl}ms)`);

      // Update metadata
      this.updateMetadata();
    } catch (error) {
      console.error(`[ERROR] Failed to write cache for key ${key}: ${(error as Error).message}`);
    }
  }

  /**
   * Delete a cache entry
   * @param key Cache key
   */
  public delete(key: string): void {
    try {
      const filePath = this.getCacheFilePath(key);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.error(`[DEBUG] Cache deleted: ${key}`);
      }
    } catch (error) {
      console.error(`[ERROR] Failed to delete cache for key ${key}: ${(error as Error).message}`);
    }
  }

  /**
   * Clear all cache entries
   */
  public clear(): void {
    try {
      const files = fs.readdirSync(this.cacheDir);
      let deletedCount = 0;

      for (const file of files) {
        if (file.endsWith(".json") && file !== ".metadata.json") {
          const filePath = path.join(this.cacheDir, file);
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      }

      console.error(`[INFO] Cache cleared: ${deletedCount} entries deleted`);
      this.updateMetadata();
    } catch (error) {
      console.error(`[ERROR] Failed to clear cache: ${(error as Error).message}`);
    }
  }

  /**
   * Clean up expired cache entries
   */
  public cleanup(): void {
    try {
      const files = fs.readdirSync(this.cacheDir);
      let deletedCount = 0;
      const now = Date.now();

      for (const file of files) {
        if (file.endsWith(".json") && file !== ".metadata.json") {
          const filePath = path.join(this.cacheDir, file);

          try {
            const fileContent = fs.readFileSync(filePath, "utf-8");
            const entry: CacheEntry = JSON.parse(fileContent);

            // Check if expired
            const age = now - entry.timestamp;
            if (age > entry.ttl) {
              fs.unlinkSync(filePath);
              deletedCount++;
            }
          } catch (error) {
            // Invalid cache file, delete it
            console.error(`[WARN] Invalid cache file: ${file}, deleting...`);
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        }
      }

      if (deletedCount > 0) {
        console.error(`[INFO] Cache cleanup: ${deletedCount} expired entries deleted`);
        this.updateMetadata();
      }
    } catch (error) {
      console.error(`[ERROR] Failed to cleanup cache: ${(error as Error).message}`);
    }
  }

  /**
   * Update cache metadata
   */
  private updateMetadata(): void {
    try {
      const files = fs.readdirSync(this.cacheDir);
      const cacheFiles = files.filter(
        (file) => file.endsWith(".json") && file !== ".metadata.json"
      );

      const metadata: CacheMetadata = {
        totalEntries: cacheFiles.length,
        lastCleanup: Date.now(),
      };

      fs.writeFileSync(
        this.metadataPath,
        JSON.stringify(metadata, null, 2),
        "utf-8"
      );
    } catch (error) {
      console.error(`[ERROR] Failed to update metadata: ${(error as Error).message}`);
    }
  }

  /**
   * Get cache statistics
   */
  public getStats(): { totalEntries: number; cacheDir: string; defaultTTL: number } {
    try {
      const files = fs.readdirSync(this.cacheDir);
      const cacheFiles = files.filter(
        (file) => file.endsWith(".json") && file !== ".metadata.json"
      );

      return {
        totalEntries: cacheFiles.length,
        cacheDir: this.cacheDir,
        defaultTTL: this.defaultTTL,
      };
    } catch (error) {
      console.error(`[ERROR] Failed to get cache stats: ${(error as Error).message}`);
      return {
        totalEntries: 0,
        cacheDir: this.cacheDir,
        defaultTTL: this.defaultTTL,
      };
    }
  }

  /**
   * Start periodic cleanup interval
   */
  private startCleanupInterval(): void {
    // Run cleanup every hour
    this.cleanupInterval = setInterval(() => {
      console.error("[INFO] Running scheduled cache cleanup...");
      this.cleanup();
    }, 60 * 60 * 1000);
  }

  /**
   * Stop cleanup interval and perform final cleanup
   */
  public shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    console.error("[INFO] Cache manager shutdown complete");
  }

  /**
   * Wrapper function to cache the result of an async operation
   * @param key Cache key
   * @param operation Async operation to execute on cache miss
   * @param ttl Optional TTL in milliseconds
   * @returns Cached or fresh data
   */
  public async getOrSet<T = any>(
    key: string,
    operation: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    // Try to get from cache
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Cache miss - execute operation
    console.error(`[DEBUG] Executing operation for cache key: ${key}`);
    const result = await operation();

    // Store in cache
    this.set(key, result, ttl);

    return result;
  }
}

// Export a singleton instance
let cacheInstance: CacheManager | null = null;

/**
 * Get or create the cache manager singleton
 */
export function getCacheManager(cacheDir?: string, defaultTTL?: number): CacheManager {
  if (!cacheInstance) {
    cacheInstance = new CacheManager(cacheDir, defaultTTL);
  }
  return cacheInstance;
}

/**
 * Reset the cache manager singleton (useful for testing)
 */
export function resetCacheManager(): void {
  if (cacheInstance) {
    cacheInstance.shutdown();
    cacheInstance = null;
  }
}
