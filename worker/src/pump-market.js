import { accountBytes, integer, programAddress, seed } from './chain-binary.js';
import { decodeCurve, decodeMint, decodeTokenAccount, curveAddress, associatedAddress, migrationAddress,
    normalizeQuote, PUMP_PROGRAM, SOL_MINT } from './pump-state.js';
import { TOKEN_PROGRAM } from './protocol-verifiers.js';
import { QUOTE_USD_FEEDS, decodeQuoteUsd } from './quote-usd.js';
import { protocolMarketCap } from '../../js/canonical-valuation.js';

export async function probePumpCurve(mint, rpc) {
    const address = await curveAddress(mint);
    const result = await rpc('getMultipleAccounts',[[address,mint],{encoding:'base64',commitment:'confirmed'}]);
    if (!result?.value?.[0]) return null;
    const curve = decodeCurve(result.value[0]), base = decodeMint(result.value[1]);
    const quoteMint = normalizeQuote(curve.quote_mint);
    if (curve.complete) return { complete:true,address,quoteMint,migration:await migrationAddress(mint,quoteMint),slot:result.context.slot };
    const quoteProgram = quoteMint===SOL_MINT ? TOKEN_PROGRAM : null;
    // Non-SOL quote owner comes from the mint, never an assumed token program.
    let quote = null;
    if (!quoteProgram) {
        const q = await rpc('getMultipleAccounts',[[quoteMint],{encoding:'base64',commitment:'confirmed',minContextSlot:result.context.slot}]);
        quote=decodeMint(q.value[0]);
    }
    const baseVault = await associatedAddress(address,mint,base.tokenProgram);
    const quoteAta = await associatedAddress(address,quoteMint,quoteProgram??quote.tokenProgram);
    const globalAddress = await programAddress([seed('global')],PUMP_PROGRAM);
    const eventAuthority = await programAddress([seed('__event_authority')],PUMP_PROGRAM);
    const feed = QUOTE_USD_FEEDS[quoteMint];
    const addresses = [address,mint,baseVault,quoteMint,globalAddress,...(quoteMint===SOL_MINT?[]:[quoteAta]),...(feed?[feed.address]:[])];
    const snapshot = await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed',minContextSlot:result.context.slot}]);
    if (snapshot.context.slot<result.context.slot) throw new Error('CURVE_SLOT_REGRESSION');
    const current = decodeCurve(snapshot.value[0]), currentBase = decodeMint(snapshot.value[1]);
    if (normalizeQuote(current.quote_mint)!==quoteMint || currentBase.tokenProgram!==base.tokenProgram) throw new Error('CURVE_STATE_CHANGED');
    if (current.complete) return {complete:true,address,quoteMint,migration:await migrationAddress(mint,quoteMint),slot:snapshot.context.slot};
    const vault = decodeTokenAccount(snapshot.value[2],mint,address), currentQuote = decodeMint(snapshot.value[3]);
    if (vault.tokenProgram!==currentBase.tokenProgram || currentQuote.tokenProgram!==(quoteProgram??quote.tokenProgram)) throw new Error('CURVE_TOKEN_PROGRAM_CHANGED');
    const globalBytes = accountBytes(snapshot.value[4]);
    if (snapshot.value[4].owner!==PUMP_PROGRAM || globalBytes.length<113
        || ![167,232,232,177,200,108,114,127].every((v,i)=>globalBytes[i]===v)) throw new Error('CURVE_GLOBAL_IDENTITY');
    if (quoteMint!==SOL_MINT) {
        const vaultQuote=decodeTokenAccount(snapshot.value[5],quoteMint,address);
        if (vaultQuote.tokenProgram!==currentQuote.tokenProgram) throw new Error('CURVE_QUOTE_PROGRAM');
    }
    const observedAt=Date.now();
    const market={address,poolAddress:address,tokenMint:mint,quoteMint,mints:[mint,quoteMint],
        vaults:[baseVault,quoteMint===SOL_MINT?address:quoteAta],quoteAta,
        tokenPrograms:[base.tokenProgram,currentQuote.tokenProgram],quoteDecimals:currentQuote.decimals,
        tokenDecimals:currentBase.decimals,programId:PUMP_PROGRAM,protocol:'pump-curve',lifecycle:'CURVE_ACTIVE',
        identityEvidence:'PUMP_PDA_STATE_AND_VAULTS',compatibility:'POOL_STATE_AND_VAULTS_VERIFIED',
        verifiedAtSlot:snapshot.context.slot,sourceEpoch:1,globalAddress,eventAuthority,mayhem:current.is_mayhem_mode};
    let nativeValuation=null,valuationFailure=null,quoteUsd=null;
    try {
        const value=protocolMarketCap({supply:currentBase.supply,baseReserve:current.virtual_token_reserves,
            quoteReserve:current.virtual_quote_reserves,protocol:'pump-curve'});
        nativeValuation=nativeObservation(market,value,currentBase,snapshot.context.slot,observedAt,{
            curveSupply:current.token_total_supply,mintSupply:currentBase.supply,mayhem:current.is_mayhem_mode,
            supplyAgreement:current.token_total_supply===currentBase.supply,
            virtualTokenReserves:current.virtual_token_reserves,virtualQuoteReserves:current.virtual_quote_reserves,
        },currentQuote.safeExtensions);
        // The SDK's live-supply helper and Pump's displayed curve MC disagree
        // by 2x on retained Mayhem examples. Preserve the exact SDK diagnostic,
        // but do not silently choose a display/circulating convention for terrain.
        if (current.is_mayhem_mode) {
            nativeValuation.supplyVerified=false;
            nativeValuation.supplyDefinitionStatus='MAYHEM_CURVE_SUPPLY_CONVENTION_UNRESOLVED';
            valuationFailure=nativeValuation.supplyDefinitionStatus;
        } else if (!nativeValuation.supplyVerified) valuationFailure='MINT_OR_QUOTE_EXTENSIONS_UNSUPPORTED';
    } catch(e) {valuationFailure=e.message;}
    if (feed) { try {quoteUsd=decodeQuoteUsd(snapshot.value.at(-1),quoteMint,snapshot.context.slot,observedAt);}catch(e){valuationFailure=e.message;} }
    return {complete:false,canonicalMarket:market,nativeValuation,quoteUsd,valuationFailure,receivedAt:observedAt};
}
function nativeObservation(market,value,mint,slot,observedAt,state,quoteSafe) {
    return {...value,tokenMint:market.tokenMint,marketIdentity:market.address,sourceEpoch:market.sourceEpoch,
        quoteMint:market.quoteMint,quoteDecimals:market.quoteDecimals,kind:'PROTOCOL_MARKET_CAP',
        protocolDefinition:'PUMP_PROTOCOL_MARKET_CAP_V1',source:'ONCHAIN_PUMP_STATE',slot,observedAt,
        supplyVerified:mint.safeExtensions&&quoteSafe,
        provenance:{formula:market.protocol==='pump-curve'?'pump-sdk@2.0.0:bondingCurveMarketCap':'pump-swap-sdk@1.20.0:poolMarketCap',
            transport:'TRUSTED_RPC',observation:'ATOMIC_GET_MULTIPLE_ACCOUNTS',state,mintExtensions:mint.extensions} };
}
export async function pumpSwapValuation(market,rpc,minContextSlot) {
    const feed=QUOTE_USD_FEEDS[market.quoteMint];
    const addresses=[market.address,market.tokenMint,...market.vaults,market.quoteMint,...(feed?[feed.address]:[])];
    const snapshot=await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed',minContextSlot}]);
    if (snapshot.context.slot<minContextSlot) throw new Error('AMM_VALUATION_SLOT_REGRESSION');
    const pool=accountBytes(snapshot.value[0]),mint=decodeMint(snapshot.value[1]),quoteMint=decodeMint(snapshot.value[4]);
    if (snapshot.value[0].owner!==market.programId || pool.length<211
        || ![241,154,109,4,17,177,109,188].every((v,i)=>pool[i]===v)) throw new Error('AMM_VALUATION_IDENTITY');
    if (pool.length<271 && ![211,243,244,245,261,269,270].includes(pool.length)) throw new Error('AMM_VALUATION_LAYOUT_VERSION');
    // Pool/mint/vault identity must match the same atomic valuation observation.
    const {decodePoolIdentity}=await import('./pool-identity.js');
    const checked=decodePoolIdentity(market.address,snapshot.value[0],market.tokenMint,market.quoteMint);
    if (JSON.stringify(checked.vaults)!==JSON.stringify(market.vaults) || JSON.stringify(checked.mints)!==JSON.stringify(market.mints)) throw new Error('AMM_VALUATION_REBASE');
    const vaults=snapshot.value.slice(2,4).map((a,i)=>decodeTokenAccount(a,market.mints[i],market.address));
    const baseIndex=market.mints.indexOf(market.tokenMint),quoteIndex=1-baseIndex;
    if (baseIndex!==0 || vaults.some((v,i)=>v.tokenProgram!==market.tokenPrograms[i])
        || mint.tokenProgram!==market.tokenPrograms[0] || quoteMint.tokenProgram!==market.tokenPrograms[1]) throw new Error('AMM_VALUATION_TOKEN_PROGRAM');
    const mayhem=pool.length>243 && pool[243]===1;
    const virtualQuote=pool.length>=261?String(integer(pool,245,16,true)):'0';
    const value=protocolMarketCap({supply:mint.supply,baseReserve:vaults[baseIndex].amount,
        quoteReserve:vaults[quoteIndex].amount,virtualQuoteReserve:virtualQuote,mayhem,protocol:'pumpswap'});
    const observedAt=Date.now();
    const nativeValuation=nativeObservation({...market,quoteDecimals:quoteMint.decimals},value,mint,snapshot.context.slot,observedAt,
        {mintSupply:mint.supply,mayhem,baseReserve:vaults[0].amount,quoteReserve:vaults[1].amount,virtualQuoteReserves:virtualQuote},quoteMint.safeExtensions);
    let quoteUsd=null,valuationFailure=null;
    if (feed) {try {quoteUsd=decodeQuoteUsd(snapshot.value.at(-1),market.quoteMint,snapshot.context.slot,observedAt);}catch(e){valuationFailure=e.message;}}
    return {nativeValuation,quoteUsd,valuationFailure};
}
