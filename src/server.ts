/**
 * CCXT MCP 서버 클래스 구현
 * 이 파일은 MCP 서버와 CCXT 라이브러리 통합을 구현합니다.
 */

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js"; // Restore original path
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"; // Restore original path
import { URL } from "url";
import { z } from "zod";
import ccxt, { Exchange } from "ccxt"; // Import Exchange type
import fs from "fs";
import path from "path";
import os from "os";

import { registerExchangeResources } from "./resources/exchanges.js"; // Restore .js
import { registerMarketResources } from "./resources/markets.js"; // Restore .js
import { registerPriceResources } from "./resources/prices.js"; // Restore .js
import { registerOrderBookResources } from "./resources/orderbooks.js"; // Restore .js
import { registerMarketTools } from "./tools/market-tools.js"; // Restore .js
import { registerOrderTools } from "./tools/order-tools.js"; // Restore .js
import { registerAccountTools } from "./tools/account-tools.js"; // Restore .js
import { registerAnalysisTools } from "./tools/analysis-tools.js"; // 거래 분석 도구
import { CacheManager } from "./cache.js"; // Cache management

// 설정 파일의 계정 구조 정의
interface AccountConfig {
  name: string;
  exchangeId: string;
  apiKey: string;
  secret: string;
  password?: string; // Some exchanges require password (e.g. FTX)
  uid?: string; // Some exchanges require UID (e.g. Deribit)
  privateKey?: string; // For exchanges using private key auth
  walletAddress?: string; // For DEX exchanges
  subaccount?: string; // For exchanges with subaccount support
  defaultType?: "spot" | "margin" | "future" | "swap" | "option"; // Extended market types
  enableRateLimit?: boolean; // Rate limiter control
  timeout?: number; // Custom timeout
  verbose?: boolean; // Debug mode
  proxy?: string; // Proxy settings
  options?: {
    [key: string]: any; // Exchange-specific options
  };
}

/**
 * CCXT MCP 서버 클래스
 * MCP 프로토콜을 통해 CCXT 기능을 노출합니다.
 */
export class CcxtMcpServer {
  private server: McpServer;
  // Key: account name from config, Value: Authenticated CCXT Exchange instance
  private exchangeInstances: Record<string, Exchange> = {};
  // Key: `${exchangeId}-${marketType}`, Value: Public (unauthenticated) CCXT Exchange instance
  private publicExchangeInstances: Record<string, Exchange> = {};
  // 설정 파일 경로
  private configPath: string;
  // Cache manager
  private cacheManager: CacheManager;

  /**
   * @param configPath 사용자 지정 설정 파일 경로 (선택 사항)
   */
  constructor(configPath?: string) {
    // MCP 서버 초기화
    this.server = new McpServer({
      name: "CCXT MCP",
      version: "4.0.0",
    });

    // Determine config file path: prefer provided path, otherwise use project 'config/ccxt-accounts.json'
    if (configPath && typeof configPath === "string") {
      this.configPath = configPath;
    } else {
      // Use a config path relative to the current working directory when no explicit path is provided
      this.configPath = path.resolve(process.cwd(), "config", "ccxt-accounts.json");
    }

    console.error(`[INFO] Using config file: ${this.configPath}`);

    // Initialize cache manager with default 5-minute TTL
    this.cacheManager = new CacheManager(undefined, 5 * 60 * 1000);

    // IMPORTANT: do NOT load accounts or register resources/tools in the constructor because
    // loading requires async operations. Loading and registration will be performed in start().
  }

  /**
   * 설정 파일에서 계정 정보를 로드하고 CCXT 인스턴스를 생성합니다.
   */
  private async loadAccountsFromConfig() {
    try {
      console.error(`[DEBUG] Loading config from: ${this.configPath}`);
      
      // 파일 존재 확인
      if (!fs.existsSync(this.configPath)) {
        console.error(`[ERROR] Config file not found: ${this.configPath}`);
        return;
      }
      
      // Default configuration for Binance
      const defaultConfig = {
        binance: {
          urls: {
            api: {
              public: 'https://api.binance.com',
              private: 'https://api.binance.com',
              ws: 'wss://stream.binance.com:9443/ws'
            }
          },
          options: {
            defaultType: 'spot',
            adjustForTimeDifference: true,
            recvWindow: 10000,
            createMarketBuyOrderRequiresPrice: true,
            fetchMarkets: ['spot'],
            fetchTicker: ['spot'],
            fetchTickers: ['spot']
          }
        }
      };
      
      const configContent = fs.readFileSync(this.configPath, "utf-8");
      console.error(`[DEBUG] Config file size: ${configContent.length} bytes`);
      
      let config;
      try {
        config = JSON.parse(configContent);
        console.error(`[DEBUG] Successfully parsed JSON config`);
        
        // Apply default configuration for Binance
        if (config.accounts && Array.isArray(config.accounts)) {
          config.accounts = config.accounts.map(account => {
            if (account.exchangeId === 'binance') {
              return {
                ...account,
                options: {
                  ...defaultConfig.binance.options,
                  ...(account.options || {})
                }
              };
            }
            return account;
          });
        }
      } catch (jsonError) {
        console.error(`[ERROR] Invalid JSON in config file: ${jsonError.message}`);
        throw new Error(
          `Invalid JSON format in config file: ${jsonError.message}`,
        );
      }

      let accounts: AccountConfig[] = [];
      
      // 먼저 직접 외부 설정 파일에서 계정 정보를 확인
      if (Array.isArray(config.accounts)) {
        console.error(`[DEBUG] Found ${config.accounts.length} accounts directly in config file`);
        accounts = config.accounts;
      } 
      // 외부 설정 파일에 계정 정보가 없으면 Claude Desktop 설정 구조 확인
      else {
        console.error(`[DEBUG] No direct 'accounts' array found, checking mcpServers structure`);
        // 새로운 구조에서는 mcpServers.ccxt-mcp.accounts에 계정 정보가 있습니다
        const mcpConfig = config?.mcpServers?.["ccxt-mcp"];
        if (!mcpConfig || !Array.isArray(mcpConfig.accounts)) {
          console.error(
            `[ERROR] Neither 'accounts' array nor 'mcpServers.ccxt-mcp.accounts' found in config`
          );
          console.error(`[DEBUG] Config structure: ${JSON.stringify(Object.keys(config))}`);
          return;
        }
        console.error(`[DEBUG] Found ${mcpConfig.accounts.length} accounts in mcpServers.ccxt-mcp.accounts`);
        accounts = mcpConfig.accounts;
      }

      // 계정이 없는 경우 로그 출력
      if (accounts.length === 0) {
        console.error(`[ERROR] No accounts found in configuration file: ${this.configPath}`);
        return;
      }
      
      console.error(`[INFO] Found ${accounts.length} account(s) in configuration`);
      console.error(`[DEBUG] Account names: ${accounts.map(a => a.name).join(', ')}`);

      const loadedAccountNames = new Set<string>();
      for (const account of accounts) {
        // 필수 필드 검증
        if (
          !account.name ||
          !account.exchangeId ||
          !account.apiKey ||
          !account.secret
        ) {
          console.warn(
            `Skipping account due to missing fields: ${JSON.stringify(account)}`,
          );
          continue;
        }

        // 중복 계정 이름 검사
        if (loadedAccountNames.has(account.name)) {
          console.error(`Duplicate account name '${account.name}'. Skipping.`);
          continue;
        }
        loadedAccountNames.add(account.name);

        // 지원되는 거래소인지 확인
        if (!ccxt.exchanges.includes(account.exchangeId)) {
          console.error(
            `Unsupported exchange ID '${account.exchangeId}' for account '${account.name}'. Supported exchanges: ${ccxt.exchanges.join(", ")}`,
          );
          continue;
        }

        try {
          const mergedOptions: Record<string, any> = {
            defaultType: account.defaultType || "spot",
            ...(account.options || {}),
          };

          const exchangeOptions: Record<string, any> = {
            apiKey: account.apiKey,
            secret: account.secret,
            options: mergedOptions,
          };

          const accountPassword =
            account.password ??
            (typeof mergedOptions.password === "string"
              ? mergedOptions.password
              : undefined);
          if (accountPassword) {
            exchangeOptions.password = accountPassword;
            delete mergedOptions.password; // Prevent leaking password inside options
            console.error(`[DEBUG] Password set for account '${account.name}': ${accountPassword ? 'Yes' : 'No'}`);
          } else {
            console.error(`[DEBUG] No password found for account '${account.name}'`);
          }

          if (account.uid) exchangeOptions.uid = account.uid;
          if (account.privateKey) exchangeOptions.privateKey = account.privateKey;
          if (account.walletAddress)
            exchangeOptions.walletAddress = account.walletAddress;
          if (account.subaccount) exchangeOptions.subaccount = account.subaccount;
          if (typeof account.enableRateLimit === "boolean")
            exchangeOptions.enableRateLimit = account.enableRateLimit;
          if (typeof account.timeout === "number")
            exchangeOptions.timeout = account.timeout;
          if (typeof account.verbose === "boolean")
            exchangeOptions.verbose = account.verbose;
          if (account.proxy) exchangeOptions.proxy = account.proxy;

          // @ts-ignore - CCXT dynamic instantiation
          const exchangeInstance = new ccxt[account.exchangeId](
            exchangeOptions,
          );
          
          console.error(`[DEBUG] Created exchange instance for '${account.name}' with password: ${exchangeInstance.password ? 'Yes' : 'No'}`);

          // 특정 마켓 타입이 지원되는지 검증
          if (account.defaultType) {
            await exchangeInstance.loadMarkets();
            const supportedTypes = {
              spot: exchangeInstance.has.spot,
              margin: exchangeInstance.has.margin,
              future: exchangeInstance.has.future,
              swap: exchangeInstance.has.swap,
              option: exchangeInstance.has.option,
            };

            if (!supportedTypes[account.defaultType]) {
              console.error(
                `${account.exchangeId} does not support ${account.defaultType} trading. ` +
                  `Supported types: ${Object.entries(supportedTypes)
                    .filter(([_, supported]) => supported)
                    .map(([type]) => type)
                    .join(", ")}`,
              );
              continue;
            }
          }

          // Store the instance using the account name as the key
          this.exchangeInstances[account.name] = exchangeInstance;
        } catch (error) {
          console.error(
            `Failed to create CCXT instance for account '${account.name}' (${account.exchangeId}):`,
            error instanceof Error ? error.message : error,
          );
          // Continue to next account
          continue;
        }
      }
    } catch (error) {
      console.error(
        `Failed to load or parse configuration file ${this.configPath}:`,
        error,
      );
    }
  } // loadAccountsFromConfig 메소드 닫는 괄호

  /**
   * 선물 주문을 위한 거래소별 파라미터 반환
   */
  private getFutureParams(exchangeId: string) {
    return (
      {
        binance: { type: "future", marginMode: "cross" },
        bybit: { category: "linear" },
        okx: { instType: "SWAP" },
        kucoin: { type: "future" },
      }[exchangeId.toLowerCase()] || {}
    );
  }

  /**
   * 선물 주문 실행 (자동 재시도 포함)
   */
  async executeFutureOrder(
    accountName: string,
    orderParams: {
      symbol: string;
      type: string;
      side: string;
      amount: number;
      price?: number;
      params?: any;
    },
  ) {
    const exchange = this.getExchangeInstance(accountName);
    const futureParams = this.getFutureParams(exchange.id);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await exchange.createOrder(
          orderParams.symbol,
          orderParams.type,
          orderParams.side,
          orderParams.amount,
          orderParams.price,
          {
            ...(orderParams.params || {}),
            ...futureParams,
          },
        );
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (attempt + 1)),
        );
      }
    }
  }

  /**
   * 설정 파일에서 미리 로드된 특정 계정 이름에 해당하는 인증된 거래소 인스턴스를 가져옵니다.
   * @param accountName 설정 파일에 정의된 계정의 'name'
   * @returns 요청된 계정에 대한 CCXT 거래소 인스턴스
   * @throws 계정을 찾을 수 없는 경우 오류 발생
   */
  getExchangeInstance(accountName: string): Exchange {
    const instance = this.exchangeInstances[accountName];
    if (!instance) {
      console.error(
        `No pre-loaded exchange instance found for account name: ${accountName}`,
      );
      // Consider listing available account names: Object.keys(this.exchangeInstances).join(', ')
      throw new Error(
        `Account configuration not found or failed to load for: ${accountName}`,
      );
    }
    return instance;
  }

  /**
   * 공개 데이터 접근을 위한 인증되지 않은 거래소 인스턴스를 가져오거나 생성합니다.
   * @param exchangeId 거래소 ID (e.g., 'binance')
   * @param marketType 시장 유형 ('spot' or 'futures'), 기본값 'spot'
   * @returns 요청된 거래소/시장 유형에 대한 공개 CCXT 인스턴스
   * @throws 지원되지 않는 거래소 ID인 경우 오류 발생
   */
  /**
   * 로드된 모든 계정 이름 목록을 반환합니다.
   */
  getAccountNames(): string[] {
    const accountNames = Object.keys(this.exchangeInstances);
    console.error(`[DEBUG] getAccountNames() called, returning ${accountNames.length} accounts: ${accountNames.join(', ')}`);
    return accountNames;
  }

  /**
   * 캐시 매니저 인스턴스를 반환합니다.
   */
  getCacheManager(): CacheManager {
    return this.cacheManager;
  }

  getPublicExchangeInstance(
    exchangeId: string,
    marketType: "spot" | "futures" = "spot",
  ): Exchange {
    const instanceKey = `${exchangeId}-${marketType}`;

    if (!this.publicExchangeInstances[instanceKey]) {
      if (!ccxt.exchanges.includes(exchangeId)) {
        console.error(
          `Exchange ID '${exchangeId}' not found in ccxt.exchanges for public instance.`,
        );
        throw new Error(`Unsupported exchange for public data: ${exchangeId}`);
      }

      const exchangeOptions = {
        options: {
          defaultType: marketType,
        },
      };

      try {
        // @ts-ignore - CCXT dynamic instantiation without credentials
        this.publicExchangeInstances[instanceKey] = new ccxt[exchangeId](
          exchangeOptions,
        );
      } catch (error) {
        console.error(
          `Failed to create public CCXT instance for ${exchangeId} (${marketType}):`,
          error,
        );
        throw error; // Re-throw the error after logging
      }
    }

    return this.publicExchangeInstances[instanceKey];
  }

  /**
   * MCP 리소스를 등록합니다.
   */
  private registerResources() {
    registerExchangeResources(this.server, this);
    registerMarketResources(this.server, this);
    registerPriceResources(this.server, this);
    registerOrderBookResources(this.server, this);
  }

  /**
   * MCP 도구를 등록합니다.
   */
  private registerTools() {
    registerMarketTools(this.server, this);
    registerOrderTools(this.server, this);
    registerAccountTools(this.server, this);
    registerAnalysisTools(this.server, this);
    this.registerCacheTools();
  }

  /**
   * 캐시 관리 도구를 등록합니다.
   */
  private registerCacheTools() {
    // Cache statistics tool
    this.server.tool(
      "getCacheStats",
      "Get cache statistics including total entries, cache directory, and default TTL",
      {},
      async () => {
        try {
          const stats = this.cacheManager.getStats();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(stats, null, 2)
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error getting cache stats: ${(error as Error).message}`
              }
            ],
            isError: true
          };
        }
      }
    );

    // Clear cache tool
    this.server.tool(
      "clearCache",
      "Clear all cached data",
      {},
      async () => {
        try {
          this.cacheManager.clear();
          return {
            content: [
              {
                type: "text",
                text: "Cache cleared successfully"
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error clearing cache: ${(error as Error).message}`
              }
            ],
            isError: true
          };
        }
      }
    );

    // Cleanup expired cache entries tool
    this.server.tool(
      "cleanupCache",
      "Remove expired cache entries",
      {},
      async () => {
        try {
          this.cacheManager.cleanup();
          return {
            content: [
              {
                type: "text",
                text: "Cache cleanup completed"
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error cleaning up cache: ${(error as Error).message}`
              }
            ],
            isError: true
          };
        }
      }
    );
  }

  /**
   * 서버를 시작합니다.
   */
  async start() {
    // Load accounts and initialize exchange instances before registering resources/tools
    await this.loadAccountsFromConfig();

    // Register resources and tools after accounts are loaded to ensure tools like
    // `listAccounts` reflect the loaded accounts immediately.
    this.registerResources();
    this.registerTools();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("CCXT MCP Server started");
  }
}
