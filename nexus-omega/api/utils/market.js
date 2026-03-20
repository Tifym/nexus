// api/_utils/market.js
// Multi-exchange real-time data aggregation with fallbacks

const EXCHANGES = {
  BINANCE: {
    name: 'Binance',
    restUrl: 'https://api.binance.com/api/v3',
    weight: 1.0,
    timeout: 5000
  },
  COINBASE: {
    name: 'Coinbase',
    restUrl: 'https://api.exchange.coinbase.com',
    weight: 0.95,
    timeout: 5000
  },
  BYBIT: {
    name: 'Bybit',
    restUrl: 'https://api.bybit.com/v5/market',
    weight: 0.9,
    timeout: 5000
  },
  OKX: {
    name: 'OKX',
    restUrl: 'https://www.okx.com/api/v5/market',
    weight: 0.9,
    timeout: 5000
  },
  KRAKEN: {
    name: 'Kraken',
    restUrl: 'https://api.kraken.com/0/public',
    weight: 0.85,
    timeout: 5000
  }
};

class MultiExchangeFeed {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 10000; // 10 seconds
    this.lastFetch = 0;
  }

  async fetchWithTimeout(url, timeout, options = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          ...options.headers
        }
      });
      clearTimeout(id);
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      clearTimeout(id);
      throw error;
    }
  }

  // Binance API - Most reliable
  async fetchBinance(symbol = 'BTCUSDT') {
    try {
      const data = await this.fetchWithTimeout(
        `${EXCHANGES.BINANCE.restUrl}/ticker/24hr?symbol=${symbol}`,
        EXCHANGES.BINANCE.timeout
      );
      
      return {
        exchange: 'Binance',
        symbol: symbol.replace('USDT', '-USD'),
        price: parseFloat(data.lastPrice),
        bid: parseFloat(data.bidPrice),
        ask: parseFloat(data.askPrice),
        volume_24h: parseFloat(data.volume),
        price_change_24h: parseFloat(data.priceChangePercent),
        timestamp: data.closeTime,
        latency_ms: Date.now() - this.lastFetch,
        weight: EXCHANGES.BINANCE.weight,
        status: 'active'
      };
    } catch (e) {
      console.error('Binance fetch failed:', e.message);
      return null;
    }
  }

  // Coinbase API
  async fetchCoinbase(symbol = 'BTC-USD') {
    try {
      const [ticker, stats] = await Promise.all([
        this.fetchWithTimeout(
          `${EXCHANGES.COINBASE.restUrl}/products/${symbol}/ticker`,
          EXCHANGES.COINBASE.timeout
        ),
        this.fetchWithTimeout(
          `${EXCHANGES.COINBASE.restUrl}/products/${symbol}/stats`,
          EXCHANGES.COINBASE.timeout
        ).catch(() => ({ volume: '0', last: '0', open: '0' }))
      ]);
      
      return {
        exchange: 'Coinbase',
        symbol: symbol,
        price: parseFloat(ticker.price),
        bid: parseFloat(ticker.bid),
        ask: parseFloat(ticker.ask),
        volume_24h: parseFloat(stats.volume || 0),
        price_change_24h: stats.last && stats.open ? ((parseFloat(stats.last) - parseFloat(stats.open)) / parseFloat(stats.open)) * 100 : 0,
        timestamp: new Date(ticker.time).getTime(),
        latency_ms: Date.now() - this.lastFetch,
        weight: EXCHANGES.COINBASE.weight,
        status: 'active'
      };
    } catch (e) {
      console.error('Coinbase fetch failed:', e.message);
      return null;
    }
  }

  // Bybit API
  async fetchBybit(symbol = 'BTCUSDT') {
    try {
      const data = await this.fetchWithTimeout(
        `${EXCHANGES.BYBIT.restUrl}/tickers?category=spot&symbol=${symbol}`,
        EXCHANGES.BYBIT.timeout
      );
      
      if (data.retCode !== 0) throw new Error(data.retMsg || 'Bybit API error');
      
      const ticker = data.result?.list?.[0];
      if (!ticker) throw new Error('No ticker data');
      
      return {
        exchange: 'Bybit',
        symbol: symbol.replace('USDT', '-USD'),
        price: parseFloat(ticker.lastPrice),
        bid: parseFloat(ticker.bid1Price),
        ask: parseFloat(ticker.ask1Price),
        volume_24h: parseFloat(ticker.volume24h),
        price_change_24h: parseFloat(ticker.price24hPcnt) * 100,
        timestamp: parseInt(ticker.ts),
        latency_ms: Date.now() - this.lastFetch,
        weight: EXCHANGES.BYBIT.weight,
        status: 'active'
      };
    } catch (e) {
      console.error('Bybit fetch failed:', e.message);
      return null;
    }
  }

  // OKX API
  async fetchOKX(symbol = 'BTC-USDT') {
    try {
      const data = await this.fetchWithTimeout(
        `${EXCHANGES.OKX.restUrl}/ticker?instId=${symbol}`,
        EXCHANGES.OKX.timeout
      );
      
      if (data.code !== '0') throw new Error(data.msg || 'OKX API error');
      
      const ticker = data.data?.[0];
      if (!ticker) throw new Error('No ticker data');
      
      return {
        exchange: 'OKX',
        symbol: symbol.replace('-USDT', '-USD'),
        price: parseFloat(ticker.last),
        bid: parseFloat(ticker.bidPx),
        ask: parseFloat(ticker.askPx),
        volume_24h: parseFloat(ticker.vol24h),
        price_change_24h: parseFloat(ticker.change24h),
        timestamp: parseInt(ticker.ts),
        latency_ms: Date.now() - this.lastFetch,
        weight: EXCHANGES.OKX.weight,
        status: 'active'
      };
    } catch (e) {
      console.error('OKX fetch failed:', e.message);
      return null;
    }
  }

  // Kraken API
  async fetchKraken(pair = 'XXBTZUSD') {
    try {
      const data = await this.fetchWithTimeout(
        `${EXCHANGES.KRAKEN.restUrl}/Ticker?pair=${pair}`,
        EXCHANGES.KRAKEN.timeout
      );
      
      // Kraken returns pairs with weird names
      const tickerKey = Object.keys(data.result || {}).find(k => k.includes('XBT') || k.includes('BTC'));
      if (!tickerKey) throw new Error('Pair not found in response');
      
      const ticker = data.result[tickerKey];
      const lastPrice = parseFloat(ticker.c?.[0] || 0);
      const openPrice = parseFloat(ticker.o || 0);
      
      return {
        exchange: 'Kraken',
        symbol: 'BTC-USD',
        price: lastPrice,
        bid: parseFloat(ticker.b?.[0] || 0),
        ask: parseFloat(ticker.a?.[0] || 0),
        volume_24h: parseFloat(ticker.v?.[1] || 0),
        price_change_24h: openPrice > 0 ? ((lastPrice - openPrice) / openPrice) * 100 : 0,
        timestamp: Date.now(),
        latency_ms: Date.now() - this.lastFetch,
        weight: EXCHANGES.KRAKEN.weight,
        status: 'active'
      };
    } catch (e) {
      console.error('Kraken fetch failed:', e.message);
      return null;
    }
  }

  // Fetch all exchanges with individual error handling
  async fetchAllPrices(symbol = 'BTC') {
    this.lastFetch = Date.now();
    
    // Try Binance first (most reliable)
    const binanceData = await this.fetchBinance('BTCUSDT');
    
    // Try others in parallel
    const otherPromises = [
      this.fetchCoinbase('BTC-USD'),
      this.fetchBybit('BTCUSDT'),
      this.fetchOKX('BTC-USDT'),
      this.fetchKraken('XXBTZUSD')
    ];
    
    const otherResults = await Promise.allSettled(otherPromises);
    const validOthers = otherResults
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);
    
    // Always include Binance if available, otherwise we fail
    const validData = [];
    if (binanceData) {
      validData.push(binanceData);
    }
    validData.push(...validOthers);
    
    // If we have at least Binance, we're good
    if (validData.length === 0) {
      throw new Error('All exchange data sources failed - even Binance');
    }
    
    console.log(`Fetched prices from ${validData.length} exchanges: ${validData.map(d => d.exchange).join(', ')}`);
    
    return validData;
  }

  // Calculate consensus price using weighted median
  calculateConsensus(exchangeData) {
    if (exchangeData.length === 0) return null;
    
    // Sort by price
    const sorted = [...exchangeData].sort((a, b) => a.price - b.price);
    
    // Calculate weighted median
    const totalWeight = sorted.reduce((sum, d) => sum + d.weight, 0);
    let cumulativeWeight = 0;
    let medianPrice = sorted[0].price;
    
    for (const data of sorted) {
      cumulativeWeight += data.weight;
      if (cumulativeWeight >= totalWeight / 2) {
        medianPrice = data.price;
        break;
      }
    }
    
    // Filter out outliers (prices more than 2% from median)
    const validPrices = sorted.filter(d => 
      Math.abs(d.price - medianPrice) / medianPrice < 0.02
    );
    
    // If all prices are outliers, use median
    const pricesToUse = validPrices.length > 0 ? validPrices : [sorted[Math.floor(sorted.length / 2)]];
    
    // Weighted average of valid prices
    const consensusPrice = pricesToUse.reduce((sum, d) => sum + d.price * d.weight, 0) / 
                          pricesToUse.reduce((sum, d) => sum + d.weight, 0);
    
    const spread = pricesToUse.length > 1 
      ? (Math.max(...pricesToUse.map(d => d.price)) - Math.min(...pricesToUse.map(d => d.price))) / consensusPrice * 100
      : 0;
    
    return {
      consensusPrice,
      medianPrice,
      spread,
      exchangesUsed: pricesToUse.length,
      exchangesTotal: exchangeData.length,
      allPrices: exchangeData.map(d => ({
        exchange: d.exchange,
        price: d.price,
        change_24h: d.price_change_24h,
        latency: d.latency_ms,
        status: d.status
      })),
      timestamp: Date.now()
    };
  }

  // Main method: Get consensus price with fallback
  async getConsensusPrice(symbol = 'BTC') {
    // Check cache first
    const cached = this.cache.get(symbol);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
      console.log('Returning cached price:', cached.consensusPrice);
      return cached;
    }
    
    try {
      const allData = await this.fetchAllPrices(symbol);
      const consensus = this.calculateConsensus(allData);
      
      // Cache result
      this.cache.set(symbol, consensus);
      
      return consensus;
    } catch (error) {
      console.error('Consensus price calculation failed:', error);
      
      // Return cached data even if stale
      if (cached) {
        console.warn('Returning stale cached data');
        return { ...cached, stale: true, error: error.message };
      }
      
      // Last resort: return mock data with error flag
      return {
        consensusPrice: 65000,
        medianPrice: 65000,
        spread: 0,
        exchangesUsed: 0,
        exchangesTotal: 0,
        allPrices: [],
        timestamp: Date.now(),
        error: error.message,
        isMock: true
      };
    }
  }
}

export const marketFeed = new MultiExchangeFeed();
export { EXCHANGES };
