# Caching System

The CCXT MCP Server includes a built-in caching system that stores API responses locally to improve performance and reduce API calls to exchanges.

## Overview

The caching system:
- Stores cached data in the user's cache directory (`~/.cache/ccxt-mcp` on Linux/macOS)
- Implements TTL (Time-To-Live) for automatic expiration
- Uses SHA-256 hashing for cache key generation
- Provides automatic cleanup of expired entries
- Supports configurable cache behavior per tool

## Cache Storage

Cache files are stored as JSON files in the cache directory:
- Location: `~/.cache/ccxt-mcp/` (or custom path)
- Format: Each cache entry is a separate JSON file with data, timestamp, and TTL
- Metadata: `.metadata.json` tracks cache statistics

## Default TTL Values

Different tools have different default TTL values based on data volatility:

- **Market Data** (fetchMarkets): **7 days** (markets are relatively static)
- **Ticker Data** (fetchTicker, fetchTickers): 5 minutes  
- **OHLCV Data** (fetchOHLCV): 1 minute (more volatile)
- **Order Book**: Not cached by default (too volatile)
- **Trades**: Not cached by default (real-time data)

### Market Data Long-Term Caching

The `fetchMarkets` tool uses an extended 7-day cache TTL because:
- Market listings change infrequently on exchanges
- This data is resource-intensive for AI systems to process
- Reduces unnecessary API calls and improves performance
- Use `forceRefresh: true` parameter if you need fresh market data

## Usage

### Using Cache with Tools

Most market data tools support caching with optional parameters:

```json
{
  "exchangeId": "binance",
  "symbol": "BTC/USDT",
  "useCache": true,
  "cacheTTL": 300000
}
```

Parameters:
- `useCache` (boolean, default: true): Enable/disable cache for this request
- `cacheTTL` (number, optional): Override default TTL in milliseconds

### Cache Management Tools

Three tools are available for cache management:

#### 1. getCacheStats

Get cache statistics including total entries, cache directory, and default TTL.

```json
{}
```

Response:
```json
{
  "totalEntries": 15,
  "cacheDir": "/Users/username/.cache/ccxt-mcp",
  "defaultTTL": 300000
}
```

#### 2. clearCache

Clear all cached data.

```json
{}
```

Response: Confirmation message

#### 3. cleanupCache

Remove only expired cache entries (non-destructive).

```json
{}
```

Response: Number of expired entries deleted

## Examples

### Example 1: Fetch Markets with Long-term Cache

```json
{
  "tool": "fetchMarkets",
  "arguments": {
    "exchangeId": "binance",
    "useCache": true
  }
}
```

First call: Fetches from API and stores in cache for 7 days
Subsequent calls (within 7 days): Returns cached data instantly

### Example 2: Force Refresh Markets Cache

```json
{
  "tool": "fetchMarkets",
  "arguments": {
    "exchangeId": "binance",
    "forceRefresh": true
  }
}
```

Forces a fresh fetch from the exchange and updates the cache.

### Example 3: Fetch Ticker with Cache

```json
{
  "tool": "fetchTicker",
  "arguments": {
    "exchangeId": "binance",
    "symbol": "BTC/USDT",
    "useCache": true
  }
}
```

First call: Fetches from API and stores in cache
Subsequent calls (within 5 minutes): Returns cached data instantly

### Example 4: Fetch Ticker Bypassing Cache

```json
{
  "tool": "fetchTicker",
  "arguments": {
    "exchangeId": "binance",
    "symbol": "BTC/USDT",
    "useCache": false
  }
}
```

Always fetches fresh data from the exchange API.

### Example 5: Custom TTL for OHLCV Data

```json
{
  "tool": "fetchOHLCV",
  "arguments": {
    "exchangeId": "binance",
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "useCache": true,
    "cacheTTL": 30000
  }
}
```

Caches OHLCV data for 30 seconds (30,000 milliseconds).

### Example 6: Check Cache Statistics

```json
{
  "tool": "getCacheStats",
  "arguments": {}
}
```

### Example 7: Clear All Cache

```json
{
  "tool": "clearCache",
  "arguments": {}
}
```

## Cache Key Generation

Cache keys are generated using:
1. Namespace (e.g., "tool")
2. Identifier (e.g., "fetchTicker")
3. Parameters (e.g., `{exchangeId: "binance", symbol: "BTC/USDT"}`)

These are combined and hashed with SHA-256 to create a unique, consistent key.

## Automatic Cleanup

The cache manager automatically runs cleanup every hour to remove expired entries. You can also manually trigger cleanup using the `cleanupCache` tool.

## Performance Benefits

Caching provides several benefits:

1. **Reduced API Calls**: Fewer requests to exchange APIs
2. **Faster Response Times**: Instant responses for cached data
3. **Rate Limit Management**: Helps avoid hitting exchange rate limits
4. **Cost Reduction**: Lower API costs for paid exchange APIs

## Best Practices

1. **Use default cache for market data**: Markets don't change frequently
2. **Disable cache for real-time data**: Order books and recent trades
3. **Adjust TTL based on your needs**: Longer TTL for historical data
4. **Monitor cache size**: Use `getCacheStats` to track cache growth
5. **Clear cache periodically**: Use `clearCache` if cache gets too large

## Implementation Details

The caching system is implemented in `src/cache.ts` and provides:

- `CacheManager` class: Main cache management
- `get(key)`: Retrieve cached data
- `set(key, data, ttl)`: Store data in cache
- `getOrSet(key, operation, ttl)`: Cache wrapper for async operations
- `delete(key)`: Remove specific cache entry
- `clear()`: Remove all cache entries
- `cleanup()`: Remove expired entries only
- `getStats()`: Get cache statistics

## Environment Variables

Currently, the cache system uses default paths. Future versions may support:

- `CCXT_CACHE_DIR`: Custom cache directory
- `CCXT_CACHE_TTL`: Default TTL override
- `CCXT_CACHE_ENABLED`: Global cache enable/disable

## Troubleshooting

### Cache not working

1. Check cache directory exists and is writable
2. Verify `useCache: true` is set in tool arguments
3. Check cache hasn't expired (use `getCacheStats`)

### Cache taking too much space

1. Run `cleanupCache` to remove expired entries
2. Run `clearCache` to clear all cache
3. Consider reducing TTL values

### Stale data being returned

1. Reduce TTL for that specific tool
2. Use `useCache: false` for critical real-time data
3. Clear cache with `clearCache` tool

## Logging

Cache operations are logged to stderr with prefixes:
- `[INFO]`: Initialization and cleanup messages
- `[DEBUG]`: Cache hits, misses, and operations
- `[WARN]`: Invalid cache files
- `[ERROR]`: Cache operation failures

Enable verbose logging to see detailed cache behavior.
