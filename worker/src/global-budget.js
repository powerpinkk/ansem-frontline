// A single persistent reservation ledger shared across every mint/DO. Limits
// bound upstream request counts, not Cloudflare ingress charges or dollar cost.
export const GLOBAL_LIMITS = Object.freeze({ minute: 30, day: 3000, ingressMinute: 120 });
export class GlobalBudget {
    constructor(ctx) { this.storage = ctx.storage; }
    async fetch(request) {
        const kind = new URL(request.url).pathname === '/ingress' ? 'ingress' : 'rpc';
        const now = Date.now(), minute = Math.floor(now / 60_000), day = Math.floor(now / 86_400_000);
        const allowed = await this.storage.transaction(async tx => {
            const saved = await tx.get('budget-v1') || {};
            const ledger = { minute, day, rpc: saved.minute === minute ? saved.rpc || 0 : 0,
                ingress: saved.minute === minute ? saved.ingress || 0 : 0, daily: saved.day === day ? saved.daily || 0 : 0 };
            if (kind === 'rpc' && (ledger.rpc >= GLOBAL_LIMITS.minute || ledger.daily >= GLOBAL_LIMITS.day)
                || kind === 'ingress' && ledger.ingress >= GLOBAL_LIMITS.ingressMinute) return false;
            if (kind === 'rpc') { ledger.rpc++; ledger.daily++; } else ledger.ingress++;
            await tx.put('budget-v1', ledger); return true;
        });
        return Response.json({ allowed }, { status: allowed ? 200 : 429,
            headers: { 'retry-after': '60', 'cache-control': 'no-store' } });
    }
}
export async function reserveGlobal(env, kind = 'rpc') {
    if (!env.GLOBAL_BUDGET) return false;
    try {
        const id = env.GLOBAL_BUDGET.idFromName('frontline-account-budget-v1');
        const r = await env.GLOBAL_BUDGET.get(id).fetch(new Request(`https://budget.internal/${kind}`, { method: 'POST' }));
        return r.status === 200;
    } catch { return false; }
}
export function liveMints(env) {
    // Portfolio operating scope: at most two explicitly configured markets.
    return String(env.LIVE_TOKEN_MINTS || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 2);
}
