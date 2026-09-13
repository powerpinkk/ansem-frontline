// Shared raw RPC context for independent pool-effect and user-attribution pipelines.
import { QUOTE_ASSETS } from '../../js/market-selection.js';
import { validateSolanaMint } from '../../js/token-context.js';
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from './protocol-verifiers.js';

export const rawInteger = (value) => typeof value === 'string' && /^\d{1,20}$/.test(value)
    && BigInt(value) <= 18446744073709551615n ? BigInt(value) : null;

export function balanceEvidence(meta, keys, instructions) {
    const result = new Map();
    for (const [side, entries] of [['pre', meta.preTokenBalances], ['post', meta.postTokenBalances]]) {
        if (!Array.isArray(entries)) return null;
        for (const b of entries) {
            const amount = rawInteger(b.uiTokenAmount?.amount);
            const decimals = b.uiTokenAmount?.decimals;
            const address = keys[b.accountIndex];
            if (amount === null || !Number.isInteger(b.accountIndex) || b.accountIndex < 0 || !address || !Number.isInteger(decimals) || decimals < 0 || decimals > 18
                || !validateSolanaMint(b.owner).ok || !validateSolanaMint(b.mint).ok
                || (b.programId && ![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(b.programId))) return null;
            const previous = result.get(address);
            if (previous && (previous.mint !== b.mint || previous.decimals !== decimals || previous.owner !== b.owner)) return null;
            const record = previous || { mint: b.mint, decimals, owner: b.owner, pre: 0n, post: 0n };
            if (record[`${side}Seen`]) return null;
            record[`${side}Seen`] = true;
            record[side] = amount;
            result.set(address, record);
        }
    }
    // Wrapped SOL accounts created and closed in one transaction do not appear
    // in pre/post token balances. Recover their identity from executed SPL init.
    for (const ix of instructions) {
        if (!ix.executedSuccessfully || ![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(ix.programId)
            || !['initializeAccount', 'initializeAccount2', 'initializeAccount3'].includes(ix.parsed?.type)) continue;
        const info = ix.parsed.info;
        if (result.has(info.account)) continue;
        const decimals = QUOTE_ASSETS[info.mint]?.decimals ?? [...result.values()].find((b) => b.mint === info.mint)?.decimals;
        if (!Number.isInteger(decimals) || !validateSolanaMint(info.owner).ok || !keys.includes(info.account)) continue;
        result.set(info.account, { mint: info.mint, owner: info.owner, decimals, pre: 0n, post: 0n, temporary: true });
    }
    return result;
}

export function successfulInvocations(logs) {
    const result = new Map();
    const stack = [];
    for (const line of Array.isArray(logs) ? logs : []) {
        const enter = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(line);
        if (enter) {
            const height = Number(enter[2]);
            if (height !== stack.length + 1) return new Map();
            const frame = { programId: enter[1], success: false, ancestors: [...stack] };
            const key = `${enter[1]}:${height}`;
            if (!result.has(key)) result.set(key, []);
            result.get(key).push(frame); stack.push(frame);
        }
        const leave = /^Program ([1-9A-HJ-NP-Za-km-z]+) (success|failed:.*)$/.exec(line);
        if (leave) {
            const frame = stack.pop();
            if (!frame || frame.programId !== leave[1]) return new Map();
            frame.success = leave[2] === 'success';
        }
    }
    return result;
}
