const WINDOW_MS = 30_000;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function hashText(value) {
    let hash = 2166136261;
    for (const character of String(value)) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function crispRect(ctx, x, y, width, height, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}

export function createPixelSnapshot(source, now = Date.now()) {
    const trades = (source.liveTrades || [])
        .filter((trade) => now - Number(trade.timestamp) >= 0 && now - Number(trade.timestamp) <= WINDOW_MS)
        .map((trade) => ({
            id: String(trade.txHash || trade.id || `${trade.timestamp}-${trade.isBuy}`),
            isBuy: Boolean(trade.isBuy),
            isWhale: Boolean(trade.isWhale),
            solValue: Math.max(0, Number(trade.solValue) || 0),
            timestamp: Number(trade.timestamp) || now,
        }));
    let buySol = 0;
    let sellSol = 0;
    for (const trade of trades) {
        if (trade.isBuy) buySol += trade.solValue;
        else sellSol += trade.solValue;
    }
    return {
        now,
        windowMs: WINDOW_MS,
        trades,
        buySol,
        sellSol,
        price: Number(source.price) || 0,
        online: source.connection === 'online' || source.connection === 'degraded',
    };
}

export class PixelFrontline {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.snapshot = createPixelSnapshot({ liveTrades: [] });
        this.units = new Map();
        this.running = false;
        this.frame = 0;
        this.view = canvas.ownerDocument.defaultView || window;
        this.resizeObserver = new this.view.ResizeObserver(() => this.resize());
        this.resizeObserver.observe(canvas);
        this.resize();
    }

    resize() {
        const width = Math.max(320, Math.floor(this.canvas.clientWidth || 960));
        const height = Math.max(96, Math.floor(this.canvas.clientHeight || 160));
        const ratio = Math.min(this.view.devicePixelRatio || 1, 2);
        this.canvas.width = Math.floor(width * ratio);
        this.canvas.height = Math.floor(height * ratio);
        this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        this.width = width;
        this.height = height;
        this.ctx.imageSmoothingEnabled = false;
    }

    setSnapshot(snapshot) {
        if (!snapshot || !Array.isArray(snapshot.trades)) return;
        this.snapshot = snapshot;
        const active = new Set();
        for (const trade of snapshot.trades) {
            active.add(trade.id);
            if (!this.units.has(trade.id)) {
                const hash = hashText(trade.id);
                this.units.set(trade.id, {
                    ...trade,
                    lane: hash % 5,
                    phase: ((hash >>> 4) % 628) / 100,
                });
            } else {
                Object.assign(this.units.get(trade.id), trade);
            }
        }
        for (const id of this.units.keys()) {
            if (!active.has(id)) this.units.delete(id);
        }
    }

    start() {
        if (this.running) return;
        this.running = true;
        const render = (time) => {
            if (!this.running) return;
            this.draw(time);
            this.frame = requestAnimationFrame(render);
        };
        this.frame = requestAnimationFrame(render);
    }

    destroy() {
        this.running = false;
        cancelAnimationFrame(this.frame);
        this.resizeObserver.disconnect();
    }

    draw(time) {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        const now = Date.now();
        crispRect(ctx, 0, 0, w, h, '#020403');
        crispRect(ctx, 0, Math.floor(h * 0.36), w, h * 0.64, '#5b4028');
        crispRect(ctx, 0, Math.floor(h * 0.36), w, 4, '#27492b');
        this.drawTrees(w, h);
        this.drawGroundDetail(w, h);

        const totalSol = this.snapshot.buySol + this.snapshot.sellSol;
        const buyShare = totalSol > 0 ? this.snapshot.buySol / totalSol : 0.5;
        const markerX = Math.round(w * (0.22 + buyShare * 0.56));
        for (let y = Math.floor(h * 0.39); y < h - 7; y += 9) crispRect(ctx, markerX, y, 2, 4, buyShare >= 0.5 ? '#00a85f' : '#8d1836');

        const bulls = [...this.units.values()].filter((unit) => unit.isBuy).slice(-26);
        const bears = [...this.units.values()].filter((unit) => !unit.isBuy).slice(-26);
        const furthestAge = Math.max(1, ...[...bulls, ...bears].map((unit) => now - unit.timestamp));
        const combatX = w * 0.5 + (buyShare - 0.5) * w * 0.3;
        const drawUnits = (units, isBull) => {
            units.forEach((unit, index) => {
                const age = clamp(now - unit.timestamp, 0, WINDOW_MS);
                const entry = clamp(age / Math.min(8_000, furthestAge), 0, 1);
                const depth = Math.floor(index / 5);
                const side = isBull ? 1 : -1;
                const spawnX = isBull ? 14 : w - 14;
                const contactOffset = side * -(10 + depth * 10);
                const x = spawnX + (combatX + contactOffset - spawnX) * entry
                    + Math.sin(time * 0.006 + unit.phase) * (entry > 0.92 ? 3 : 0);
                const laneStep = Math.max(12, Math.floor((h * 0.53) / 5));
                const y = Math.floor(h * 0.42) + unit.lane * laneStep + (depth % 2) * 3;
                this.drawUnit(unit, x, Math.min(h - 12, y), isBull, time);
            });
        };
        drawUnits(bulls, true);
        drawUnits(bears, false);

        this.drawPressureBar(w, h, buyShare, bulls.length, bears.length);
    }

    drawTrees(w, h) {
        const positions = [0.08, 0.17, 0.82, 0.91];
        for (const position of positions) {
            const x = Math.floor(w * position);
            crispRect(this.ctx, x, h * 0.25, 4, 17, '#3b2416');
            crispRect(this.ctx, x - 7, h * 0.2, 18, 8, '#174125');
            crispRect(this.ctx, x - 4, h * 0.15, 12, 8, '#1f5c31');
        }
    }

    drawGroundDetail(w, h) {
        for (let index = 0; index < 22; index++) {
            const x = (index * 97 + 43) % Math.max(1, Math.floor(w));
            const y = Math.floor(h * 0.46) + ((index * 29) % Math.max(1, Math.floor(h * 0.46)));
            if (index % 3 === 0) {
                crispRect(this.ctx, x, y, 5, 3, '#3d3024');
                crispRect(this.ctx, x + 2, y - 2, 4, 3, '#776047');
            } else {
                crispRect(this.ctx, x, y, 2, 6, '#2a5d31');
                crispRect(this.ctx, x + 3, y + 2, 2, 4, '#3f7944');
            }
        }
    }

    drawUnit(unit, x, y, isBull, time) {
        const ctx = this.ctx;
        const scale = unit.isWhale ? 3 : 2;
        const direction = isBull ? 1 : -1;
        const stride = Math.sin(time * 0.016 + unit.phase) > 0 ? 1 : -1;
        const bodyX = x - (isBull ? 0 : 14 * scale);
        if (isBull) {
            crispRect(ctx, bodyX, y - 8 * scale, 13 * scale, 7 * scale, '#080b0a');
            crispRect(ctx, bodyX + 9 * scale, y - 10 * scale, 7 * scale, 6 * scale, '#0b0f0d');
            crispRect(ctx, bodyX + 13 * scale, y - 11 * scale, 2 * scale, 2 * scale, '#00ff88');
            crispRect(ctx, bodyX + 2 * scale, y - 9 * scale, 6 * scale, scale, '#087f75');
            crispRect(ctx, bodyX + 9 * scale, y - 13 * scale, 2 * scale, 4 * scale, '#d8fff0');
            crispRect(ctx, bodyX + 14 * scale, y - 13 * scale, 2 * scale, 4 * scale, '#d8fff0');
        } else {
            crispRect(ctx, bodyX, y - 8 * scale, 13 * scale, 7 * scale, '#b97946');
            crispRect(ctx, bodyX - 3 * scale, y - 10 * scale, 7 * scale, 6 * scale, '#c98b55');
            crispRect(ctx, bodyX - 2 * scale, y - 11 * scale, 2 * scale, 2 * scale, '#ff164f');
            crispRect(ctx, bodyX - 5 * scale, y - 10 * scale, 4 * scale, scale, '#ff164f');
        }
        crispRect(ctx, bodyX + 2 * scale, y - scale, 3 * scale, (3 + stride) * scale, '#171a17');
        crispRect(ctx, bodyX + 9 * scale, y - scale, 3 * scale, (3 - stride) * scale, '#171a17');
        if (unit.isWhale) {
            const aura = isBull ? '#00a85f' : '#9b1739';
            crispRect(ctx, bodyX - 2, y + 5, 18 * scale, 2, aura);
        }
        if (direction < 0) ctx.direction = 'ltr';
    }

    drawPressureBar(w, h, buyShare, bullCount, bearCount) {
        const ctx = this.ctx;
        const barWidth = Math.min(280, w * 0.34);
        const x = (w - barWidth) * 0.5;
        const y = 8;
        crispRect(ctx, x, y, barWidth, 6, '#21131a');
        crispRect(ctx, x, y, barWidth * buyShare, 6, '#00ff88');
        crispRect(ctx, x + barWidth * buyShare, y, barWidth * (1 - buyShare), 6, '#ff164f');
        ctx.font = 'bold 9px monospace';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#8afbc4';
        ctx.fillText(`${bullCount} BULL${bullCount === 1 ? '' : 'S'}`, x - 62, y - 1);
        ctx.fillStyle = '#ff7696';
        ctx.fillText(`${bearCount} BEAR${bearCount === 1 ? '' : 'S'}`, x + barWidth + 8, y - 1);
        ctx.fillStyle = '#718078';
        ctx.textAlign = 'center';
        ctx.fillText(this.snapshot.online ? 'VERIFIED 30S FRONTLINE' : 'RECONNECTING', w * 0.5, y + 10);
        ctx.textAlign = 'left';
    }
}
