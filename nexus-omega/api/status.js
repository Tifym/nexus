import { marketFeed } from './_utils/market.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
    try {
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        
        if (req.method === 'OPTIONS') {
            return res.status(200).end();
        }

        // Fetch price with fallback
        let consensus;
        try {
            consensus = await marketFeed.getConsensusPrice('BTC');
        } catch (priceError) {
            console.error('Price fetch failed:', priceError);
            // Return fallback data
            consensus = {
                consensusPrice: 65000,
                spread: 0,
                exchangesUsed: 0,
                exchangesTotal: 0,
                allPrices: [],
                timestamp: Date.now(),
                error: priceError.message,
                isFallback: true
            };
        }
        
        // Fetch trading state with fallback
        let state;
        try {
            const { data, error } = await supabase
                .from('trading_state')
                .select('*')
                .eq('id', 'main')
                .single();
            
            if (error) throw error;
            state = data;
        } catch (dbError) {
            console.error('Database error:', dbError);
            // Return default state
            state = {
                balance: 2050.75,
                initial_balance: 2050.75,
                total_trades: 0,
                winning_trades: 0,
                losing_trades: 0,
                total_profit: 0,
                total_loss: 0,
                max_drawdown: 0,
                last_trade_time: null
            };
        }
        
        // Fetch position with fallback
        let position = null;
        try {
            const { data, error } = await supabase
                .from('positions')
                .select('*')
                .eq('status', 'OPEN')
                .maybeSingle();
            
            if (!error) position = data;
        } catch (posError) {
            console.error('Position fetch error:', posError);
        }

        // Calculate cooldown
        const cooldownActive = state.last_trade_time && 
            (Date.now() - state.last_trade_time) < (5 * 60 * 1000);
        const cooldownRemaining = cooldownActive 
            ? Math.ceil((5 * 60 * 1000 - (Date.now() - state.last_trade_time)) / 1000 / 60)
            : 0;

        // Calculate win rate
        const winRate = state.total_trades > 0 
            ? ((state.winning_trades / state.total_trades) * 100).toFixed(1)
            : 0;

        // Calculate profit/loss
        const profitLoss = (state.balance - state.initial_balance).toFixed(2);

        res.status(200).json({
            price: {
                consensus: consensus.consensusPrice,
                spread: consensus.spread,
                exchanges: consensus.allPrices || [],
                timestamp: consensus.timestamp,
                isReal: !consensus.isFallback && !consensus.error,
                error: consensus.error || null
            },
            stats: {
                balance: state.balance,
                initialBalance: state.initial_balance,
                totalTrades: state.total_trades,
                winRate: winRate,
                profitLoss: profitLoss,
                maxDrawdown: state.max_drawdown || 0,
                hasOpenPosition: !!position,
                cooldownActive,
                cooldownRemaining
            },
            position: position ? {
                side: position.side,
                entryPrice: position.entry_price,
                currentPrice: consensus.consensusPrice,
                unrealizedPnl: position.unrealized_pnl || 0,
                stopLoss: position.stop_loss,
                takeProfit: position.take_profit,
                entryTime: position.entry_time,
                dataSources: position.data_sources || []
            } : null,
            lastTrade: null // We'll fetch this separately if needed
        });
        
    } catch (error) {
        console.error('Status endpoint error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message,
            price: {
                consensus: 65000,
                isFallback: true
            },
            stats: {
                balance: 2050.75,
                totalTrades: 0,
                winRate: 0,
                hasOpenPosition: false,
                cooldownActive: false
            }
        });
    }
}
