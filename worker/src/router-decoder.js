import idl from './idl/jupiter-v6.js';
import { decodeBase58 } from './protocol-verifiers.js';

export const JUPITER_PROGRAM = idl.address;
export const ROUTER_VERSION = 'jupiter-idl-446570768-v1';
// Bounded Borsh interpreter for the pinned program-owned IDL. Unknown enum
// variants, trailing bytes, truncated vectors and unsupported types fail closed.
export function decodeRouterInstruction(ix) {
    if (ix.programId !== JUPITER_PROGRAM) return null;
    const bytes = decodeBase58(ix.data);
    const layout = idl.instructions.find((l) => l.discriminator.every((b, i) => bytes?.[i] === b));
    if (!layout) throw new Error('UNSUPPORTED_ROUTER_VERSION');
    let offset = 8;
    function read(type, depth = 0) {
        if (depth > 12) throw new Error('ROUTER_DECODE_BUDGET');
        if (typeof type === 'string') {
            const size = { u8: 1, u16: 2, u32: 4, u64: 8, u128: 16, bool: 1 }[type];
            if (!size || offset + size > bytes.length) throw new Error('MALFORMED_ROUTER_DATA');
            let n = 0n;
            for (let i = 0; i < size; i++) n |= BigInt(bytes[offset++]) << BigInt(i * 8);
            if (type === 'bool' && n > 1n) throw new Error('MALFORMED_ROUTER_DATA');
            return size >= 8 ? n.toString() : Number(n);
        }
        if (type.vec) {
            const length = read('u32', depth + 1);
            if (length > 32) throw new Error('ROUTER_DECODE_BUDGET');
            return Array.from({ length }, () => read(type.vec, depth + 1));
        }
        if (type.option) {
            const present = read('bool', depth + 1);
            return present ? read(type.option, depth + 1) : null;
        }
        if (type.array) return Array.from({ length: type.array[1] }, () => read(type.array[0], depth + 1));
        const definition = idl.types.find((d) => d.name === type.defined?.name)?.type;
        if (!definition) throw new Error('UNSUPPORTED_ROUTER_TYPE');
        if (definition.kind === 'struct') return fields(definition.fields, depth + 1);
        const variant = definition.variants?.[read('u8', depth + 1)];
        if (!variant) throw new Error('UNSUPPORTED_ROUTER_VERSION');
        return { name: variant.name, ...fields(variant.fields || [], depth + 1) };
    }
    function fields(items, depth) {
        return Object.fromEntries(items.map((f) => [f.name, read(f.type, depth + 1)]));
    }
    const args = fields(layout.args, 0);
    if (offset !== bytes.length || !args.route_plan?.length || args.route_plan.length > 16) throw new Error('MALFORMED_ROUTER_DATA');
    if (!Array.isArray(ix.accounts) || ix.accounts.length < layout.accounts.length) throw new Error('ROUTER_ACCOUNTS_MISSING');
    const accounts = Object.fromEntries(layout.accounts.map((a, i) => {
        if (a.address && a.address !== ix.accounts[i]) throw new Error('ROUTER_ACCOUNT_MISMATCH');
        return [a.name, a.optional && ix.accounts[i] === JUPITER_PROGRAM ? null : ix.accounts[i]];
    }));
    if (accounts.program !== JUPITER_PROGRAM) throw new Error('ROUTER_ACCOUNT_MISMATCH');
    return { name: layout.name, accounts, args, version: ROUTER_VERSION,
        mode: layout.name.includes('exact_out') ? 'EXACT_OUT' : 'EXACT_IN', shared: layout.name.startsWith('shared_accounts') };
}
