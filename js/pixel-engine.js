const WINDOW_MS = 30_000;
const LANE_COUNT = 3;
const MAX_VISIBLE_PER_SIDE = 12;

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

function unitDimensions(unit) {
    const scale = unit.isWhale ? 2 : 1;
    return { scale, width: 19 * scale, height: 15 * scale };
}

function normalizeTick(tick, now) {
    const timestamp = Number(tick?.timestamp);
    const price = Number(tick?.price);
    if (!(price > 0) || !Number.isFinite(timestamp) || now - timestamp < 0 || now - timestamp > WINDOW_MS) return null;
    return { timestamp, price };
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
    const priceTicks = (source.priceTicks30s || [])
        .map((tick) => normalizeTick(tick, now))
        .filter(Boolean)
        .sort((a, b) => a.timestamp - b.timestamp);
    const price = Number(source.price) || priceTicks.at(-1)?.price || 0;
    if (price > 0 && (!priceTicks.length || now - priceTicks.at(-1).timestamp > 600)) {
        priceTicks.push({ timestamp: now, price });
    }
    return {
        now,
        windowMs: WINDOW_MS,
        trades,
        buySol,
        sellSol,
        price,
        priceTicks: priceTicks.slice(-90),
        online: source.connection === 'online' || source.connection === 'degraded',
    };
}

function selectVisibleUnits(snapshot, isBuy) {
    return snapshot.trades
        .filter((trade) => trade.isBuy === isBuy)
        .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
        .slice(-MAX_VISIBLE_PER_SIDE)
        .map((unit, index) => ({
            ...unit,
            lane: index % LANE_COUNT,
            phase: ((hashText(unit.id) >>> 4) % 628) / 100,
        }));
}

function placeSide(units, isBull, combatX, width, height, now) {
    const laneGroups = Array.from({ length: LANE_COUNT }, () => []);
    units.forEach((unit) => laneGroups[unit.lane].push(unit));
    const groundTop = Math.floor(height * 0.35);
    const usableGround = Math.max(66, height - groundTop - 10);
    const laneStep = usableGround / LANE_COUNT;
    const placed = [];

    laneGroups.forEach((laneUnits, lane) => {
        let previous = null;
        laneUnits.forEach((unit, rank) => {
            const dimensions = unitDimensions(unit);
            const target = previous
                ? previous.targetX + (isBull ? -1 : 1) * (previous.width * 0.5 + dimensions.width * 0.5 + 5)
                : combatX + (isBull ? -1 : 1) * (dimensions.width * 0.5 + 5);
            const spawnX = isBull ? -dimensions.width * 0.5 : width + dimensions.width * 0.5;
            const age = clamp(now - unit.timestamp, 0, WINDOW_MS);
            const entry = clamp(age / 5_200, 0, 1);
            let x = spawnX + (target - spawnX) * (entry * entry * (3 - 2 * entry));
            if (previous) {
                const orderedX = previous.x + (isBull ? -1 : 1) * (previous.width * 0.5 + dimensions.width * 0.5 + 4);
                x = isBull ? Math.min(x, orderedX) : Math.max(x, orderedX);
            }
            const y = Math.round(groundTop + laneStep * (lane + 0.76));
            const positioned = {
                ...unit,
                ...dimensions,
                isBull,
                rank,
                x,
                y,
                targetX: target,
                entry,
                engaged: rank === 0 && entry > 0.76,
            };
            positioned.box = {
                left: x - dimensions.width * 0.5,
                right: x + dimensions.width * 0.5,
                top: y - dimensions.height,
                bottom: y + 2,
            };
            placed.push(positioned);
            previous = positioned;
        });
    });
    return placed;
}

export function layoutPixelBattle(snapshot, width = 960, height = 170, now = snapshot?.now || Date.now()) {
    const buySol = Number(snapshot?.buySol) || 0;
    const sellSol = Number(snapshot?.sellSol) || 0;
    const totalSol = buySol + sellSol;
    const buyShare = totalSol > 0 ? buySol / totalSol : 0.5;
    const combatX = width * (0.32 + buyShare * 0.36);
    const bulls = placeSide(selectVisibleUnits(snapshot, true), true, combatX, width, height, now);
    const bears = placeSide(selectVisibleUnits(snapshot, false), false, combatX, width, height, now);

    // Front ranks receive a small attack lunge, but the layout reserves a
    // permanent gap so opposing sprites can never occupy the same pixels.
    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const bull = bulls.find((unit) => unit.lane === lane && unit.rank === 0);
        const bear = bears.find((unit) => unit.lane === lane && unit.rank === 0);
        if (!bull || !bear) continue;
        const gap = bear.box.left - bull.box.right;
        const correction = Math.max(0, (4 - gap) * 0.5);
        bull.x -= correction;
        bear.x += correction;
        bull.box.left -= correction;
        bull.box.right -= correction;
        bear.box.left += correction;
        bear.box.right += correction;
        bull.engaged = bull.engaged && bear.entry > 0.76;
        bear.engaged = bear.engaged && bull.entry > 0.76;
    }
    return { buyShare, combatX, bulls, bears, units: [...bulls, ...bears].sort((a, b) => a.y - b.y) };
}

export function findPixelOverlaps(layout) {
    const overlaps = [];
    const units = layout?.units || [];
    for (let index = 0; index < units.length; index++) {
        for (let otherIndex = index + 1; otherIndex < units.length; otherIndex++) {
            const first = units[index];
            const second = units[otherIndex];
            if (first.lane !== second.lane) continue;
            if (first.box.left < second.box.right && first.box.right > second.box.left
                && first.box.top < second.box.bottom && first.box.bottom > second.box.top) {
                overlaps.push([first.id, second.id]);
            }
        }
    }
    return overlaps;
}

export class PixelFrontline {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.snapshot = createPixelSnapshot({ liveTrades: [], priceTicks30s: [] });
        this.running = false;
        this.frame = 0;
        this.lastLayout = layoutPixelBattle(this.snapshot);
        this.view = canvas.ownerDocument.defaultView || window;
        this.resizeObserver = typeof this.view.ResizeObserver === 'function'
            ? new this.view.ResizeObserver(() => this.resize())
            : null;
        this.resizeObserver?.observe(canvas);
        this.resize();
    }

    resize() {
        const width = Math.max(320, Math.floor(this.canvas.clientWidth || Number(this.canvas.getAttribute('width')) || 960));
        const height = Math.max(96, Math.floor(this.canvas.clientHeight || Number(this.canvas.getAttribute('height')) || 170));
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
    }

    start() {
        if (this.running) return;
        this.running = true;
        const render = (time) => {
            if (!this.running) return;
            this.draw(time);
            this.frame = this.view.requestAnimationFrame(render);
        };
        this.frame = this.view.requestAnimationFrame(render);
    }

    destroy() {
        this.running = false;
        this.view.cancelAnimationFrame(this.frame);
        this.resizeObserver?.disconnect();
    }

    getDiagnostics() {
        return {
            width: this.width,
            height: this.height,
            bullCount: this.lastLayout.bulls.length,
            bearCount: this.lastLayout.bears.length,
            overlaps: findPixelOverlaps(this.lastLayout),
            pricePoints: this.snapshot.priceTicks?.length || 0,
        };
    }

    draw(time) {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        const now = Date.now();
        crispRect(ctx, 0, 0, w, h, '#020504');
        crispRect(ctx, 0, Math.floor(h * 0.35), w, h * 0.65, '#503823');
        ctx.globalAlpha = 0.48;
        crispRect(ctx, 0, Math.floor(h * 0.35), w, Math.floor(h * 0.65), '#715135');
        ctx.globalAlpha = 1;
        crispRect(ctx, 0, Math.floor(h * 0.35), w, 4, '#285435');
        this.drawTrees(w, h);
        this.drawGroundDetail(w, h);
        this.drawPriceTrace(w, h, now);

        this.lastLayout = layoutPixelBattle(this.snapshot, w, h, now);
        const markerX = Math.round(w * (0.22 + this.lastLayout.buyShare * 0.56));
        ctx.globalAlpha = 0.68;
        for (let y = Math.floor(h * 0.39); y < h - 5; y += 9) {
            crispRect(ctx, markerX, y, 2, 4, this.lastLayout.buyShare >= 0.5 ? '#00d97a' : '#a30f38');
        }
        ctx.globalAlpha = 1;

        for (const unit of this.lastLayout.units) this.drawUnit(unit, time);
        this.drawPressureBar(w, this.lastLayout.buyShare, this.lastLayout.bulls.length, this.lastLayout.bears.length);
    }

    drawPriceTrace(w, h, now) {
        const ctx = this.ctx;
        const ticks = (this.snapshot.priceTicks || []).filter((tick) => now - tick.timestamp <= WINDOW_MS);
        ctx.globalAlpha = 0.18;
        ctx.strokeStyle = '#386a51';
        ctx.lineWidth = 1;
        for (let seconds = 5; seconds < 30; seconds += 5) {
            const x = w * (1 - seconds / 30);
            ctx.beginPath();
            ctx.moveTo(x, 22);
            ctx.lineTo(x, h - 3);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        if (ticks.length < 2) return;
        const prices = ticks.map((tick) => tick.price);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const range = Math.max(max - min, Math.max(max * 0.00025, 1e-9));
        const rising = prices.at(-1) >= prices[0];
        ctx.beginPath();
        ticks.forEach((tick, index) => {
            const x = clamp(((tick.timestamp - (now - WINDOW_MS)) / WINDOW_MS) * w, 0, w);
            const y = 27 + (1 - (tick.price - min) / range) * (h - 52);
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.globalAlpha = 0.34;
        ctx.strokeStyle = rising ? '#00ff88' : '#ff164f';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.globalAlpha = 0.12;
        ctx.lineWidth = 8;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.font = 'bold 8px monospace';
        ctx.fillStyle = rising ? '#65dca4' : '#df5b7d';
        ctx.textAlign = 'right';
        ctx.fillText(`30S PRICE  $${this.snapshot.price.toFixed(6)}`, w - 8, 8);
        ctx.textAlign = 'left';
    }

    drawTrees(w, h) {
        for (const position of [0.05, 0.14, 0.86, 0.95]) {
            const x = Math.floor(w * position);
            crispRect(this.ctx, x, h * 0.25, 4, 17, '#382116');
            crispRect(this.ctx, x - 7, h * 0.2, 18, 8, '#153d23');
            crispRect(this.ctx, x - 4, h * 0.15, 12, 8, '#216139');
        }
    }

    drawGroundDetail(w, h) {
        for (let index = 0; index < 24; index++) {
            const x = (index * 97 + 43) % Math.max(1, Math.floor(w));
            const y = Math.floor(h * 0.43) + ((index * 29) % Math.max(1, Math.floor(h * 0.5)));
            if (index % 3 === 0) {
                crispRect(this.ctx, x, y, 5, 3, '#372a20');
                crispRect(this.ctx, x + 2, y - 2, 4, 3, '#80674a');
            } else {
                crispRect(this.ctx, x, y, 2, 6, '#286037');
                crispRect(this.ctx, x + 3, y + 2, 2, 4, '#43864c');
            }
        }
    }

    drawUnit(unit, time) {
        const ctx = this.ctx;
        const { scale, isBull, x, y } = unit;
        const stride = Math.sin(time * 0.014 + unit.phase) > 0 ? 1 : -1;
        const attack = unit.engaged ? Math.max(0, Math.sin(time * 0.009 + unit.phase)) : 0;
        const lunge = attack * 1.5 * (isBull ? 1 : -1);
        const left = Math.round(x + lunge - unit.width * 0.5);

        if (unit.isWhale) {
            ctx.globalAlpha = 0.25 + attack * 0.12;
            crispRect(ctx, left - 3, y - unit.height - 3, unit.width + 6, unit.height + 8, isBull ? '#00ff88' : '#ff164f');
            ctx.globalAlpha = 1;
        }
        if (isBull) this.drawBull(left, y, scale, stride, attack);
        else this.drawBear(left, y, scale, stride, attack);
    }

    drawBull(left, y, scale, stride, attack) {
        const ctx = this.ctx;
        crispRect(ctx, left + scale, y - 10 * scale, 12 * scale, 7 * scale, '#070a09');
        crispRect(ctx, left + 4 * scale, y - 12 * scale, 6 * scale, 3 * scale, '#101713');
        crispRect(ctx, left + 11 * scale, y - 12 * scale, 7 * scale, 6 * scale, '#080d0b');
        crispRect(ctx, left + 16 * scale, y - 10 * scale, 3 * scale, 3 * scale, '#151c18');
        crispRect(ctx, left + 12 * scale, y - 15 * scale, 2 * scale, 4 * scale, '#d8fff0');
        crispRect(ctx, left + 16 * scale, y - 15 * scale, 2 * scale, 4 * scale, '#d8fff0');
        crispRect(ctx, left + 15 * scale, y - 12 * scale, 2 * scale, 2 * scale, attack > 0.55 ? '#b8ffe0' : '#00ff88');
        crispRect(ctx, left - scale, y - 11 * scale, 3 * scale, scale, '#07100b');
        crispRect(ctx, left + 3 * scale, y - 3 * scale, 3 * scale, (3 + stride) * scale, '#050706');
        crispRect(ctx, left + 10 * scale, y - 3 * scale, 3 * scale, (3 - stride) * scale, '#050706');
        crispRect(ctx, left + 2 * scale, y + stride * scale, 4 * scale, scale, '#17211c');
        crispRect(ctx, left + 10 * scale, y - stride * scale, 4 * scale, scale, '#17211c');
    }

    drawBear(left, y, scale, stride, attack) {
        const ctx = this.ctx;
        crispRect(ctx, left + 5 * scale, y - 10 * scale, 12 * scale, 7 * scale, '#a96f46');
        crispRect(ctx, left + 8 * scale, y - 13 * scale, 6 * scale, 4 * scale, '#bd8050');
        crispRect(ctx, left + scale, y - 12 * scale, 7 * scale, 6 * scale, '#c68a56');
        crispRect(ctx, left, y - 9 * scale, 4 * scale, 3 * scale, '#5b3521');
        crispRect(ctx, left + 2 * scale, y - 14 * scale, 2 * scale, 2 * scale, '#6c4028');
        crispRect(ctx, left + 6 * scale, y - 14 * scale, 2 * scale, 2 * scale, '#6c4028');
        crispRect(ctx, left + 2 * scale, y - 12 * scale, 2 * scale, 2 * scale, attack > 0.55 ? '#ffc1ce' : '#ff164f');
        crispRect(ctx, left - (2 + Math.round(attack * 2)) * scale, y - 12 * scale, 4 * scale, scale, '#ff164f');
        crispRect(ctx, left + 7 * scale, y - 3 * scale, 3 * scale, (3 + stride) * scale, '#56351f');
        crispRect(ctx, left + 14 * scale, y - 3 * scale, 3 * scale, (3 - stride) * scale, '#56351f');
        crispRect(ctx, left + 6 * scale, y + stride * scale, 4 * scale, scale, '#24160f');
        crispRect(ctx, left + 14 * scale, y - stride * scale, 4 * scale, scale, '#24160f');
    }

    drawPressureBar(w, buyShare, bullCount, bearCount) {
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
        ctx.fillStyle = '#8c9b92';
        ctx.textAlign = 'center';
        ctx.fillText(this.snapshot.online ? 'VERIFIED SWAPS · ROLLING 30S' : 'RECONNECTING', w * 0.5, y + 10);
        ctx.textAlign = 'left';
    }
}
