import { accountBytes, integer } from './chain-binary.js';
import { SOL_MINT } from './pump-state.js';

// Official pro-compatible Pyth push PDAs, shard 0. Feed metadata, program
// revision and independently derived addresses are pinned in the audit.
export const QUOTE_USD_FEEDS = Object.freeze({
    [SOL_MINT]: { address:'7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE',
        feedId:'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d' },
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { address:'6HAuqASbHEh4w4REJEUUUCginTLfj1kwCh215ZLtMkrT',
        feedId:'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a' },
});
export const PYTH_RECEIVER = 'rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp';
export function decodeQuoteUsd(account, quoteMint, slot, receivedAt = Date.now()) {
    const feed = QUOTE_USD_FEEDS[quoteMint], bytes = accountBytes(account,256);
    if (!feed || account.owner !== PYTH_RECEIVER || bytes.length !== 134
        || ![34,241,35,99,157,126,244,205].every((v,i)=>bytes[i]===v) || bytes[40]!==1) throw new Error('QUOTE_ORACLE_IDENTITY_OR_VERIFICATION');
    const feedId = [...bytes.slice(41,73)].map(b=>b.toString(16).padStart(2,'0')).join('');
    const price = integer(bytes,73,8,true), conf = integer(bytes,81), exponent = Number(integer(bytes,89,4,true));
    const published = integer(bytes,93,8,true), postedSlot = integer(bytes,125);
    if (feedId!==feed.feedId || price<=0n || exponent < -18 || exponent>18 || published<0n
        || published>BigInt(Math.floor(receivedAt/1000)) || !Number.isSafeInteger(slot) || postedSlot>BigInt(slot)) throw new Error('QUOTE_ORACLE_VALUE_OR_TIME');
    return { quoteMint,price:String(price),exponent,observedAt:Number(published)*1000,receivedAt,slot,
        source:'PYTH_ONCHAIN_FULL',verification:'FULL',confidenceRaw:String(conf),
        // A numeric quality gate, independent of movement magnitude. Stablecoin
        // deviations from $1 remain real observations, never silently clamped.
        confidenceAccepted:conf*100n<=price,
        provenance:{source:'PYTH_PRICE_UPDATE_V2',account:feed.address,feedId,owner:PYTH_RECEIVER,postedSlot:String(postedSlot),transport:'TRUSTED_RPC'} };
}
