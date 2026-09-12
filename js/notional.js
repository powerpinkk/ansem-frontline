// USD is an estimate attached to evidence, never an input to swap verification.
export function estimateNotional(event, quote = null, now = Date.now()) {
    if (event?.evidenceLevel !== 'CHAIN_VERIFIED' || !Number.isFinite(event.quoteAmount) || event.quoteAmount <= 0) return null;
    if (['USDC', 'USDT'].includes(event.quoteSymbol)) return { valueUsd: event.quoteAmount,
        source: 'STABLECOIN_PARITY_ASSUMPTION', observedAt: null, receivedAt: now, basis: 'POOL_QUOTE_GROSS' };
    if (event.quoteSymbol !== 'SOL' || quote?.source !== 'dexscreener-sol-usd'
        || !Number.isFinite(quote.priceUsd) || quote.priceUsd <= 0
        || !Number.isFinite(quote.receivedAt) || now < quote.receivedAt || now - quote.receivedAt > 60_000) return null;
    return { valueUsd: event.quoteAmount * quote.priceUsd, source: quote.source,
        observedAt: null, receivedAt: quote.receivedAt, basis: 'POOL_QUOTE_AT_INDICATIVE_SPOT' };
}

export function formatQuote(event) {
    const amount = event?.quoteAmount;
    return Number.isFinite(amount) ? `${amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${event.quoteSymbol}` : 'Quote —';
}
export function formatUsdEstimate(event) {
    const value = event?.estimatedUsdNotional?.valueUsd;
    return Number.isFinite(value) && value > 0 ? `≈ $${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'USD —';
}
