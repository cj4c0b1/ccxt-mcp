#!/usr/bin/env node

/**
 * Test script for the caching system
 * This script demonstrates cache functionality
 */

import { CacheManager } from './dist/cache.js';
import path from 'path';
import os from 'os';

// Create a test cache directory
const testCacheDir = path.join(os.tmpdir(), 'ccxt-mcp-cache-test');

console.log('=== CCXT MCP Cache System Test ===\n');

// Initialize cache manager with 10-second TTL for testing
const cache = new CacheManager(testCacheDir, 10000);

console.log('1. Cache initialized');
console.log('   Cache directory:', testCacheDir);
console.log('   Default TTL: 10 seconds\n');

// Test 1: Set and get cache
console.log('2. Testing cache set/get...');
const testKey = cache.generateCacheKey('test', 'operation1', { param: 'value' });
const testData = { message: 'Hello from cache!', timestamp: Date.now() };

cache.set(testKey, testData);
console.log('   Data stored in cache');

const retrieved = cache.get(testKey);
console.log('   Data retrieved:', retrieved ? 'SUCCESS' : 'FAILED');
console.log('   Match:', JSON.stringify(retrieved) === JSON.stringify(testData) ? 'YES' : 'NO');
console.log('');

// Test 2: Cache statistics
console.log('3. Testing cache statistics...');
const stats = cache.getStats();
console.log('   Total entries:', stats.totalEntries);
console.log('   Cache directory:', stats.cacheDir);
console.log('   Default TTL:', stats.defaultTTL, 'ms');
console.log('');

// Test 3: getOrSet wrapper
console.log('4. Testing getOrSet wrapper...');
let callCount = 0;

async function expensiveOperation() {
  callCount++;
  console.log('   [Operation executed, call count:', callCount + ']');
  return { result: 'expensive computation', value: Math.random() };
}

const key2 = cache.generateCacheKey('test', 'expensive', { id: 123 });

console.log('   First call (cache miss):');
const result1 = await cache.getOrSet(key2, expensiveOperation, 5000);
console.log('   Result:', result1.result);

console.log('   Second call (cache hit):');
const result2 = await cache.getOrSet(key2, expensiveOperation, 5000);
console.log('   Result:', result2.result);
console.log('   Same data:', JSON.stringify(result1) === JSON.stringify(result2) ? 'YES' : 'NO');
console.log('   Operation call count:', callCount, '(should be 1)');
console.log('');

// Test 4: Cache expiration
console.log('5. Testing cache expiration...');
const shortKey = cache.generateCacheKey('test', 'short-ttl', {});
cache.set(shortKey, { data: 'expires soon' }, 2000); // 2-second TTL

console.log('   Data cached with 2-second TTL');
console.log('   Immediate retrieval:', cache.get(shortKey) ? 'SUCCESS' : 'FAILED');

console.log('   Waiting 3 seconds...');
await new Promise(resolve => setTimeout(resolve, 3000));

console.log('   Retrieval after expiration:', cache.get(shortKey) ? 'FAILED (should be null)' : 'SUCCESS (expired as expected)');
console.log('');

// Test 5: Cleanup
console.log('6. Testing cache cleanup...');
const statsBefore = cache.getStats();
console.log('   Entries before cleanup:', statsBefore.totalEntries);

cache.cleanup();

const statsAfter = cache.getStats();
console.log('   Entries after cleanup:', statsAfter.totalEntries);
console.log('');

// Test 6: Clear cache
console.log('7. Testing cache clear...');
cache.clear();
const statsCleared = cache.getStats();
console.log('   Entries after clear:', statsCleared.totalEntries);
console.log('');

// Shutdown
cache.shutdown();
console.log('8. Cache manager shutdown complete');
console.log('');
console.log('=== All Tests Complete ===');
