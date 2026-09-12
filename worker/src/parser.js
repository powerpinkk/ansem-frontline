import { verifyTransaction } from './transaction-evidence.js';

// Browser pool metadata and prices are not inputs to economic verification.
export function parseTransaction(transaction, signature, _pool, tokenMint, _clientMarket, settlement = 'CONFIRMED') {
    return verifyTransaction(transaction, signature, tokenMint, settlement).event;
}
