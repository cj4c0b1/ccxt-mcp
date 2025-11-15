export const config = {
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
} as const;
