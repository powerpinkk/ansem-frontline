import { swapFixture } from './integrity.js';

export function arbitrageFixture(options = {}) {
    const buy = swapFixture(options), sell = swapFixture({ ...options, isBuy: false });
    const tx = buy.transaction;
    tx.transaction.message.instructions.push(sell.transaction.transaction.message.instructions[0]);
    tx.meta.innerInstructions.push({ index: 1, instructions: sell.transaction.meta.innerInstructions[0].instructions });
    tx.meta.logMessages.push(...sell.transaction.meta.logMessages);
    tx.meta.postTokenBalances = structuredClone(tx.meta.preTokenBalances);
    return buy;
}
