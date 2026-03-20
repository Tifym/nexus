export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    try {
        res.status(200).json({
            price: {
                consensus: 65000,
                spread: 0.1,
                exchanges: [
                    { exchange: 'Binance', price: 65000, change_24h: 2.5, latency: 50 }
                ],
                timestamp: Date.now(),
                isReal: false
            },
            stats: {
                balance: 2050.75,
                initialBalance: 2050.75,
                totalTrades: 0,
                winRate: 0,
                profitLoss: 0,
                maxDrawdown: 0,
                hasOpenPosition: false,
                cooldownActive: false,
                cooldownRemaining: 0
            },
            position: null,
            lastTrade: null
        });
    } catch (error) {
        res.status(200).json({ error: error.message });
    }
}
