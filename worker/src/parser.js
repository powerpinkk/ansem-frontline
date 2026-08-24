const LAMPORTS_PER_SOL = 1_000_000_000;

export function parseTransaction(transaction, signature, pool, tokenMint, market) {
    const meta = transaction.meta;
    const keys = transaction.transaction.message.accountKeys;
    const feePayer = typeof keys[0] === 'string' ? keys[0] : keys[0]?.pubkey;
    const balances = new Map();
    for (const item of meta.preTokenBalances || []) addTokenBalance(balances, item, -1, tokenMint);
    for (const item of meta.postTokenBalances || []) addTokenBalance(balances, item, 1, tokenMint);
    const candidates = [...balances.entries()].filter(([, amount]) => Math.abs(amount) > 0.000001);
    if (!candidates.length) return null;
    const [wallet, tokenDelta] = candidates.find(([owner]) => owner === feePayer)
        || candidates.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
    const isBuy = tokenDelta > 0;
    const tokenAmount = Math.abs(tokenDelta);
    const usdValue = tokenAmount * market.tokenPriceUsd;
    let solValue = market.solPriceUsd > 0 ? usdValue / market.solPriceUsd : 0;
    if (pool && ['SOL', 'WSOL'].includes(pool.quoteSymbol?.toUpperCase())) {
        const payerIndex = keys.findIndex((key) => (typeof key === 'string' ? key : key.pubkey) === wallet);
        if (payerIndex >= 0) {
            const nativeDelta = (meta.postBalances[payerIndex] - meta.preBalances[payerIndex]) / LAMPORTS_PER_SOL;
            const exact = isBuy ? Math.abs(Math.min(0, nativeDelta + meta.fee / LAMPORTS_PER_SOL)) : Math.max(0, nativeDelta);
            if (exact > 0) solValue = exact;
        }
    }
    if (!(solValue > 0)) return null;
    return {
        id: signature, txHash: signature, isBuy, tokenAmount, usdValue, solValue,
        isWhale: solValue >= 20, timestamp: (transaction.blockTime || Math.floor(Date.now() / 1000)) * 1000,
        wallet, poolAddress: pool?.address || '', dexId: pool?.dexId || 'solana', quoteSymbol: pool?.quoteSymbol || '', provider: 'helius',
    };
}

function addTokenBalance(map, item, direction, tokenMint) {
    if (item.mint !== tokenMint || !item.owner) return;
    const amount = Number(item.uiTokenAmount?.uiAmountString || item.uiTokenAmount?.uiAmount || 0);
    map.set(item.owner, (map.get(item.owner) || 0) + amount * direction);
}
