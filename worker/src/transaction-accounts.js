import { validateSolanaMint } from '../../js/token-context.js';
import { decodeBase58, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from './protocol-verifiers.js';

export const MAX_SUPPORTED_TRANSACTION_VERSION = 1;

function validateVersion(message, meta, version) {
    // Older retained responses can omit the version. Explicit unknown versions
    // or a v1 config under a legacy/v0 label must never inherit swap authority.
    if (version !== undefined && version !== 'legacy' && version !== 0 && version !== MAX_SUPPORTED_TRANSACTION_VERSION) {
        throw new Error('UNSUPPORTED_TRANSACTION_VERSION');
    }
    if (version !== 1) {
        if (message.transactionConfig !== undefined) throw new Error('TRANSACTION_VERSION_MISMATCH');
        return;
    }
    const config = message.transactionConfig;
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('TRANSACTION_CONFIG_MISSING');
    // V1 has no address lookup tables. The RPC has decoded its wire format;
    // transactionConfig is opaque here and cannot contribute economic amounts.
    const lookups = message.addressTableLookups, loaded = meta.loadedAddresses;
    if (lookups != null && (!Array.isArray(lookups) || lookups.length)
        || loaded != null && (!Array.isArray(loaded.writable) || loaded.writable.length
            || !Array.isArray(loaded.readonly) || loaded.readonly.length)
        || message.accountKeys.some((key) => key?.source === 'lookupTable')) {
        throw new Error('V1_LOOKUP_TABLES_UNSUPPORTED');
    }
}

// jsonParsed already expands ALT keys. Compiled JSON uses static + writable +
// readonly loaded keys in that order; signer flags apply only to static keys.
export function resolveTransactionAccounts(message, meta, version) {
    const source = message?.accountKeys;
    if (!Array.isArray(source) || !source.length) throw new Error('ACCOUNT_KEYS_MISSING');
    validateVersion(message, meta, version);
    if (!Array.isArray(message.instructions) || message.instructions.length > 512
        || (meta.innerInstructions || []).reduce((n, g) => n + g.instructions.length, message.instructions.length) > 512) throw new Error('INSTRUCTION_BUDGET');
    const parsed = source.every((k) => typeof k === 'object' && k !== null);
    const compiled = source.every((k) => typeof k === 'string');
    if (!parsed && !compiled) throw new Error('ACCOUNT_KEYS_INVALID');
    const required = message.header?.numRequiredSignatures;
    if (compiled && (!Number.isInteger(required) || required < 1 || required > source.length)) throw new Error('SIGNERS_MISSING');
    if (compiled && message.addressTableLookups?.length && !meta.loadedAddresses) throw new Error('LOADED_ADDRESSES_MISSING');
    const keys = parsed ? source.map((k) => k.pubkey) : [...source, ...(meta.loadedAddresses?.writable || []), ...(meta.loadedAddresses?.readonly || [])];
    if (keys.length > 256 || new Set(keys).size !== keys.length || keys.some((k) => !validateSolanaMint(k).ok)) throw new Error('ACCOUNT_KEYS_INVALID');
    const signers = parsed ? source.filter((k) => k.signer === true && k.source !== 'lookupTable').map((k) => k.pubkey) : source.slice(0, required);
    if (!signers.length) throw new Error('SIGNERS_MISSING');
    const at = (i) => {
        if (!Number.isInteger(i) || i < 0 || i >= keys.length) throw new Error('ACCOUNT_INDEX_INVALID');
        return keys[i];
    };
    function normalize(ix) {
        const programId = ix.programId ?? at(ix.programIdIndex);
        const accounts = ix.accounts?.map((a) => typeof a === 'number' ? at(a) : a);
        if (!keys.includes(programId) || accounts?.some((a) => !keys.includes(a))) throw new Error('INSTRUCTION_ACCOUNT_INVALID');
        const result = { ...ix, programId, accounts };
        if (!ix.parsed && [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(programId)) {
            const b = decodeBase58(ix.data);
            const checked = b?.[0] === 12;
            if ((b?.[0] === 3 && b.length === 9) || (checked && b.length === 10)) {
                if (accounts.length < (checked ? 4 : 3)) throw new Error('TRANSFER_ACCOUNTS_MISSING');
                let amount = 0n;
                for (let i = 0; i < 8; i++) amount |= BigInt(b[i + 1]) << BigInt(i * 8);
                result.parsed = { type: checked ? 'transferChecked' : 'transfer', info: checked
                    ? { source: accounts[0], mint: accounts[1], destination: accounts[2], authority: accounts[3], tokenAmount: { amount: String(amount), decimals: b[9] } }
                    : { source: accounts[0], destination: accounts[1], authority: accounts[2], amount: String(amount) } };
            }
        }
        return result;
    }
    const inner = new Map();
    for (const group of meta.innerInstructions || []) {
        if (!Number.isInteger(group.index) || group.index < 0 || group.index >= message.instructions.length || inner.has(group.index)) throw new Error('INNER_SCOPE_INVALID');
        inner.set(group.index, group.instructions);
    }
    const groups = message.instructions.map((ix, outerIndex) => [
        { ...normalize(ix), height: 1, outerIndex, innerIndex: null },
        ...(inner.get(outerIndex) || []).map((child, innerIndex) => ({ ...normalize(child), height: child.stackHeight, outerIndex, innerIndex })),
    ]);
    if (groups.flat().length > 512) throw new Error('INSTRUCTION_BUDGET');
    return { keys, signers, groups };
}
