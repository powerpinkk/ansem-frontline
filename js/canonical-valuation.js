export const CANONICAL_VALUATION_POLICY = Object.freeze({ nativeTtlMs: 20_000, quoteTtlMs: 90_000 });
const unsigned = value => typeof value === 'string' && /^\d{1,80}$/.test(value) ? BigInt(value) : null;
export function protocolMarketCap({ supply, baseReserve, quoteReserve, virtualQuoteReserve = '0', mayhem = false, protocol }) {
    const s = unsigned(supply), b = unsigned(baseReserve), q = unsigned(quoteReserve);
    if (s === null || s <= 0n || b === null || b <= 0n || q === null
        || !/^-?\d{1,39}$/.test(virtualQuoteReserve) || !['pump-curve','pumpswap'].includes(protocol)) throw new Error('NATIVE_VALUATION_INPUT');
    const effective = q + BigInt(virtualQuoteReserve);
    if (effective <= 0n) throw new Error('NATIVE_QUOTE_NONPOSITIVE');
    const basis = protocol === 'pumpswap' && mayhem ? 1000000000000000n : s;
    return { rawQuoteValue: String(effective * basis / b), supplyRaw: String(basis),
        supplyBasis: protocol === 'pumpswap' && mayhem ? 'PUMP_AMM_MAYHEM_PROTOCOL_SUPPLY' : 'LIVE_MINT_SUPPLY',
        effectiveQuoteReserve: String(effective) };
}
export function decimalRatio(numerator, denominator, precision = 18) {
    if (numerator < 0n || denominator <= 0n || precision < 0 || precision > 36) throw new Error('DECIMAL_RATIO');
    const scale = 10n ** BigInt(precision), raw = numerator * scale / denominator;
    const whole = raw / scale, fraction = String(raw % scale).padStart(precision,'0').replace(/0+$/,'');
    return String(whole) + (fraction ? '.'+fraction : '');
}
const fresh = (time,now,ttl) => Number.isSafeInteger(time) && time <= now && now-time <= ttl;
export function canonicalValuation(native, quote, market, previous = null, now = Date.now()) {
    const policy = CANONICAL_VALUATION_POLICY;
    const gates = {
        identity: !!market && native?.tokenMint === market.tokenMint && native?.marketIdentity === market.address
            && native?.sourceEpoch === market.sourceEpoch && market.compatibility === 'POOL_STATE_AND_VAULTS_VERIFIED',
        formula: native?.protocolDefinition === 'PUMP_PROTOCOL_MARKET_CAP_V1' && native?.kind === 'PROTOCOL_MARKET_CAP',
        supply: native?.supplyVerified === true,
        nativeFresh: fresh(native?.observedAt,now,policy.nativeTtlMs),
        quoteIdentity: !!quote && native?.quoteMint === quote.quoteMint && quote.source === 'PYTH_ONCHAIN_FULL'
            && quote.verification === 'FULL' && quote.confidenceAccepted === true,
        quoteFresh: fresh(quote?.observedAt,now,policy.quoteTtlMs),
        slot: Number.isSafeInteger(native?.slot) && native.slot >= 0,
        lifecycle: ['CURVE_ACTIVE','AMM'].includes(market?.lifecycle),
    };
    let valueUsd = null, quoteUsdPrice = null;
    try {
        const raw = unsigned(native.rawQuoteValue), price = unsigned(quote.price), exponent = quote.exponent;
        if (!raw || !price || !Number.isInteger(exponent) || Math.abs(exponent)>18
            || !Number.isInteger(native.quoteDecimals) || native.quoteDecimals < 0 || native.quoteDecimals > 18) throw new Error('NUMERIC');
        const denominator = 10n**BigInt(native.quoteDecimals + Math.max(0,-exponent));
        valueUsd = decimalRatio(raw * price * 10n**BigInt(Math.max(0,exponent)),denominator);
        quoteUsdPrice = decimalRatio(price * 10n**BigInt(Math.max(0,exponent)),10n**BigInt(Math.max(0,-exponent)));
        gates.numeric = Number.isFinite(Number(valueUsd)) && Number(valueUsd)>0;
    } catch { gates.numeric = false; }
    const rebase = !previous || previous.marketIdentity !== native?.marketIdentity || previous.sourceEpoch !== native?.sourceEpoch
        || previous.protocolDefinition !== native?.protocolDefinition;
    const basisChanged = previous && (previous.supplyBasis !== native?.supplyBasis || previous.supplyRaw !== native?.supplyRaw);
    const nativeChanged = previous && previous.nativeQuoteValue !== native?.rawQuoteValue;
    const fxChanged = previous && previous.quoteUsdPrice !== quoteUsdPrice;
    return { tokenMint:native?.tokenMint ?? market?.tokenMint, marketIdentity:native?.marketIdentity ?? market?.address,
        sourceEpoch:market?.sourceEpoch, kind:'PROTOCOL_MARKET_CAP',protocolDefinition:native?.protocolDefinition,
        supplyBasis:native?.supplyBasis,supplyRaw:native?.supplyRaw,valueUsd,nativeQuoteValue:native?.rawQuoteValue,
        quoteMint:native?.quoteMint,quoteUsdPrice,nativeObservedAt:native?.observedAt,quoteObservedAt:quote?.observedAt,
        slot:native?.slot, provenance:{native:native?.provenance,quote:quote?.provenance}, gates,
        nativeFreshness:gates.nativeFresh?'FRESH':'STALE',quoteFreshness:gates.quoteFresh?'FRESH':'STALE',
        freshness:Object.values(gates).every(Boolean)?'FRESH':'DEGRADED',authorityEligible:Object.values(gates).every(Boolean),
        movementCause:rebase?'SOURCE_REBASE':basisChanged?'SUPPLY_BASIS_CHANGE':nativeChanged&&fxChanged?'TOKEN_PRICE_AND_QUOTE_FX'
            :nativeChanged?'TOKEN_PRICE_UPDATE':fxChanged?'QUOTE_USD_FX_UPDATE':'STATE_RECONCILIATION' };
}
export function createCanonicalValuationBoundary(tokenMint) {
    let current = null;
    return {
        accept(value, market, now = Date.now()) {
            if (!value || value.tokenMint !== tokenMint || value.marketIdentity !== market?.address || value.sourceEpoch !== market?.sourceEpoch
                || !Number.isSafeInteger(value.sourceEpoch) || value.sourceEpoch<1 || !Number.isSafeInteger(value.slot) || value.slot<0
                || !Number.isSafeInteger(value.nativeObservedAt) || value.nativeObservedAt>now
                || value.quoteObservedAt!=null && (!Number.isSafeInteger(value.quoteObservedAt) || value.quoteObservedAt>now)) return null;
            if (value.authorityEligible && (value.kind!=='PROTOCOL_MARKET_CAP' || value.protocolDefinition!=='PUMP_PROTOCOL_MARKET_CAP_V1'
                || typeof value.valueUsd!=='string' || !/^\d+(\.\d+)?$/.test(value.valueUsd)
                || !Number.isFinite(Number(value.valueUsd)) || Number(value.valueUsd)<=0
                || !['identity','formula','supply','nativeFresh','quoteIdentity','quoteFresh','slot','lifecycle','numeric'].every(g=>value.gates?.[g]===true))) return null;
            if (current && (value.sourceEpoch<current.sourceEpoch || value.sourceEpoch===current.sourceEpoch
                && (value.slot<current.slot || value.nativeObservedAt<current.nativeObservedAt
                    || value.quoteObservedAt!=null && current.quoteObservedAt!=null && value.quoteObservedAt<current.quoteObservedAt))) return null;
            current=value; return this.snapshot(now);
        },
        snapshot(now = Date.now()) {
            if (!current) return null;
            const nativeFresh = fresh(current.nativeObservedAt,now,CANONICAL_VALUATION_POLICY.nativeTtlMs);
            const quoteFresh = fresh(current.quoteObservedAt,now,CANONICAL_VALUATION_POLICY.quoteTtlMs);
            return { ...current, nativeFreshness:nativeFresh?'FRESH':'STALE',quoteFreshness:quoteFresh?'FRESH':'STALE',
                authorityEligible:current.authorityEligible === true && nativeFresh && quoteFresh,
                freshness:current.authorityEligible && nativeFresh && quoteFresh?'FRESH':'DEGRADED' };
        },
        clear() { current=null; },
    };
}
