export const PIXEL_SOURCE_WIDTH = 640;
export const PIXEL_SOURCE_HEIGHT = 160;

const WINDOW_MS = 30_000;
const LANE_COUNT = 2;
const MAX_VISIBLE_PER_SIDE = 6;

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

function formatMarketCap(value, compact = false) {
    const numeric = Number(value) || 0;
    if (!(numeric > 0)) return 'MC --';
    if (numeric >= 1_000_000_000) return `MC $${(numeric / 1_000_000_000).toFixed(compact ? 1 : 2)}B`;
    if (numeric >= 1_000_000) return `MC $${(numeric / 1_000_000).toFixed(compact ? 1 : 2)}M`;
    if (numeric >= 1_000) return `MC $${(numeric / 1_000).toFixed(compact ? 0 : 1)}K`;
    return `MC $${numeric.toFixed(0)}`;
}

function formatPrice(value, compact = false) {
    const numeric = Number(value) || 0;
    if (!(numeric > 0)) return '$--';
    return `$${numeric.toFixed(compact ? 4 : 6)}`;
}

function formatSol(value) {
    const numeric = Number(value) || 0;
    if (numeric >= 100) return numeric.toFixed(0);
    if (numeric >= 10) return numeric.toFixed(1);
    return numeric.toFixed(2);
}

function unitDimensions(unit, height = PIXEL_SOURCE_HEIGHT) {
    const compactScale = height < 120 ? 0.8 : 1;
    const scale = (unit.isWhale ? 2.35 : 1.55) * compactScale;
    return {
        scale,
        width: Math.round(19 * scale),
        height: Math.round(15 * scale),
    };
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
        mcap: Math.max(0, Number(source.mcap) || 0),
        priceTicks: priceTicks.slice(-90),
        online: source.connection === 'online' || source.connection === 'degraded',
    };
}

function selectVisibleUnits(snapshot, isBuy) {
    const side = snapshot.trades
        .filter((trade) => trade.isBuy === isBuy)
        .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    const whales = side.filter((trade) => trade.isWhale).slice(-MAX_VISIBLE_PER_SIDE);
    const selectedIds = new Set(whales.map((trade) => trade.id));
    const regularSlots = MAX_VISIBLE_PER_SIDE - whales.length;
    const regulars = side.filter((trade) => !selectedIds.has(trade.id)).slice(-regularSlots);
    return [...whales, ...regulars]
        .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
        .map((unit, index) => ({
            ...unit,
            lane: index % LANE_COUNT,
            phase: ((hashText(unit.id) >>> 4) % 628) / 100,
        }));
}

function placeSide(units, isBull, combatX, width, height, now) {
    const laneGroups = Array.from({ length: LANE_COUNT }, () => []);
    units.forEach((unit) => laneGroups[unit.lane].push(unit));
    const hudHeight = height < 120 ? 25 : 33;
    const footerHeight = height < 120 ? 16 : 20;
    const groundTop = Math.floor(height * 0.34);
    const groundBottom = height - footerHeight - 2;
    const usableGround = Math.max(44, groundBottom - groundTop);
    const laneStep = usableGround / LANE_COUNT;
    const placed = [];

    laneGroups.forEach((laneUnits, lane) => {
        let previous = null;
        laneUnits.forEach((unit, rank) => {
            const dimensions = unitDimensions(unit, height);
            const spacing = height < 120 ? 3 : 5;
            const target = previous
                ? previous.targetX + (isBull ? -1 : 1) * (previous.width * 0.5 + dimensions.width * 0.5 + spacing)
                : combatX + (isBull ? -1 : 1) * (dimensions.width * 0.5 + 6);
            const spawnX = isBull ? -dimensions.width * 0.5 : width + dimensions.width * 0.5;
            const age = clamp(now - unit.timestamp, 0, WINDOW_MS);
            const entry = clamp(age / 4_300, 0, 1);
            const easedEntry = entry * entry * (3 - 2 * entry);
            let x = spawnX + (target - spawnX) * easedEntry;
            if (previous) {
                const orderedX = previous.x + (isBull ? -1 : 1)
                    * (previous.width * 0.5 + dimensions.width * 0.5 + spacing);
                x = isBull ? Math.min(x, orderedX) : Math.max(x, orderedX);
            }
            const y = Math.round(Math.max(
                hudHeight + dimensions.height + 2,
                groundTop + laneStep * (lane + 0.73),
            ));
            const positioned = {
                ...unit,
                ...dimensions,
                isBull,
                rank,
                x,
                y: Math.min(y, groundBottom - 1),
                targetX: target,
                entry,
                engaged: rank === 0 && entry > 0.72,
            };
            positioned.box = {
                left: x - dimensions.width * 0.5,
                right: x + dimensions.width * 0.5,
                top: positioned.y - dimensions.height,
                bottom: positioned.y + 2,
            };
            placed.push(positioned);
            previous = positioned;
        });
    });
    return placed;
}

export function layoutPixelBattle(snapshot, width = PIXEL_SOURCE_WIDTH, height = PIXEL_SOURCE_HEIGHT, now = snapshot?.now || Date.now()) {
    const buySol = Number(snapshot?.buySol) || 0;
    const sellSol = Number(snapshot?.sellSol) || 0;
    const totalSol = buySol + sellSol;
    const buyShare = totalSol > 0 ? buySol / totalSol : 0.5;
    const combatX = width * (0.34 + buyShare * 0.32);
    const bullTrades = snapshot?.trades?.filter((trade) => trade.isBuy) || [];
    const bearTrades = snapshot?.trades?.filter((trade) => !trade.isBuy) || [];
    const bulls = placeSide(selectVisibleUnits(snapshot, true), true, combatX, width, height, now);
    const bears = placeSide(selectVisibleUnits(snapshot, false), false, combatX, width, height, now);

    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const bull = bulls.find((unit) => unit.lane === lane && unit.rank === 0);
        const bear = bears.find((unit) => unit.lane === lane && unit.rank === 0);
        if (!bull || !bear) continue;
        const gap = bear.box.left - bull.box.right;
        const correction = Math.max(0, (6 - gap) * 0.5);
        bull.x -= correction;
        bear.x += correction;
        bull.box.left -= correction;
        bull.box.right -= correction;
        bear.box.left += correction;
        bear.box.right += correction;
        bull.engaged = bull.engaged && bear.entry > 0.72;
        bear.engaged = bear.engaged && bull.entry > 0.72;
    }
    return {
        buyShare,
        combatX,
        bulls,
        bears,
        bullTotal: bullTrades.length,
        bearTotal: bearTrades.length,
        units: [...bulls, ...bears].sort((a, b) => a.y - b.y || a.rank - b.rank),
    };
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
        const width = Math.max(320, Math.floor(this.canvas.clientWidth || Number(this.canvas.getAttribute('width')) || PIXEL_SOURCE_WIDTH));
        const height = Math.max(96, Math.floor(this.canvas.clientHeight || Number(this.canvas.getAttribute('height')) || PIXEL_SOURCE_HEIGHT));
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
        const widths = this.lastLayout.units.map((unit) => unit.width);
        return {
            width: this.width,
            height: this.height,
            bullCount: this.lastLayout.bulls.length,
            bearCount: this.lastLayout.bears.length,
            bullTotal: this.lastLayout.bullTotal,
            bearTotal: this.lastLayout.bearTotal,
            hiddenUnits: Math.max(0, this.lastLayout.bullTotal - this.lastLayout.bulls.length)
                + Math.max(0, this.lastLayout.bearTotal - this.lastLayout.bears.length),
            minimumSpriteWidth: widths.length ? Math.min(...widths) : 0,
            overlaps: findPixelOverlaps(this.lastLayout),
            pricePoints: this.snapshot.priceTicks?.length || 0,
            mcap: Number(this.snapshot.mcap) || 0,
        };
    }

    draw(time) {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        const now = Date.now();
        const footerHeight = h < 120 ? 16 : 20;
        const footerY = h - footerHeight;
        const groundTop = Math.floor(h * 0.34);
        crispRect(ctx, 0, 0, w, h, '#020504');
        crispRect(ctx, 0, groundTop, w, footerY - groundTop, '#6c4b2e');
        crispRect(ctx, 0, groundTop, w, 4, '#2f7745');
        ctx.globalAlpha = 0.28;
        crispRect(ctx, 0, groundTop + 4, w, footerY - groundTop - 4, '#9b7144');
        ctx.globalAlpha = 1;

        this.drawPriceTrace(w, h, now, footerY);
        this.drawScenery(w, h, footerY);
        this.lastLayout = layoutPixelBattle(this.snapshot, w, h, now);
        this.drawMarketWatermark(w, h, footerY);

        const markerX = Math.round(this.lastLayout.combatX);
        ctx.globalAlpha = 0.42;
        for (let y = groundTop + 4; y < footerY - 3; y += 10) {
            crispRect(ctx, markerX, y, 2, 5, this.lastLayout.buyShare >= 0.5 ? '#00ff88' : '#ff164f');
        }
        ctx.globalAlpha = 1;

        for (const unit of this.lastLayout.units) this.drawUnit(unit, time);
        if (!this.lastLayout.units.length) this.drawWaitingState(w, h, footerY);
        this.drawMarketHud(w, h);
        this.drawPressureFooter(w, h, this.lastLayout);
    }

    drawPriceTrace(w, h, now, footerY) {
        const ctx = this.ctx;
        const top = h < 120 ? 26 : 34;
        const bottom = footerY - 3;
        const ticks = (this.snapshot.priceTicks || []).filter((tick) => now - tick.timestamp <= WINDOW_MS);
        ctx.globalAlpha = 0.12;
        ctx.strokeStyle = '#7ba58d';
        ctx.lineWidth = 1;
        for (let seconds = 5; seconds < 30; seconds += 5) {
            const x = w * (1 - seconds / 30);
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, bottom);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        if (ticks.length < 2) return;
        const prices = ticks.map((tick) => tick.price);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const range = Math.max(max - min, Math.max(max * 0.00025, 1e-9));
        const rising = prices.at(-1) >= prices[0];
        const points = ticks.map((tick) => ({
            x: clamp(((tick.timestamp - (now - WINDOW_MS)) / WINDOW_MS) * w, 0, w),
            y: top + 6 + (1 - (tick.price - min) / range) * Math.max(12, bottom - top - 14),
        }));
        ctx.beginPath();
        ctx.moveTo(points[0].x, bottom);
        points.forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.lineTo(points.at(-1).x, bottom);
        ctx.closePath();
        ctx.globalAlpha = 0.13;
        ctx.fillStyle = rising ? '#00ff88' : '#ff164f';
        ctx.fill();
        ctx.globalAlpha = 0.28;
        ctx.beginPath();
        points.forEach((point, index) => {
            if (index === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.strokeStyle = rising ? '#00ff88' : '#ff164f';
        ctx.lineWidth = h < 120 ? 3 : 5;
        ctx.stroke();
        ctx.globalAlpha = 0.92;
        ctx.lineWidth = h < 120 ? 1 : 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    drawScenery(w, h, footerY) {
        const groundTop = Math.floor(h * 0.34);
        for (const position of [0.035, 0.94]) {
            const x = Math.floor(w * position);
            crispRect(this.ctx, x, groundTop - 8, 5, 21, '#3d2315');
            crispRect(this.ctx, x - 9, groundTop - 15, 23, 9, '#174429');
            crispRect(this.ctx, x - 6, groundTop - 23, 17, 10, '#257143');
        }
        for (let index = 0; index < 10; index++) {
            const x = (index * 83 + 47) % Math.max(1, Math.floor(w));
            const y = groundTop + 10 + ((index * 31) % Math.max(1, Math.floor(footerY - groundTop - 16)));
            if (index % 3 === 0) crispRect(this.ctx, x, y, 6, 3, '#3b2b20');
            else crispRect(this.ctx, x, y, 2, 6, '#347342');
        }
    }

    drawMarketWatermark(w, h, footerY) {
        const ctx = this.ctx;
        ctx.save();
        ctx.globalAlpha = 0.13;
        ctx.fillStyle = '#d8ffe9';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${Math.max(14, Math.min(28, Math.floor(w / 24)))}px monospace`;
        ctx.fillText(formatMarketCap(this.snapshot.mcap, true), w * 0.5, (Math.floor(h * 0.34) + footerY) * 0.5);
        ctx.restore();
    }

    drawUnit(unit, time) {
        const ctx = this.ctx;
        const { scale, isBull, x, y } = unit;
        const stride = Math.sin(time * 0.015 + unit.phase) > 0 ? 1 : -1;
        const attack = unit.engaged ? Math.max(0, Math.sin(time * 0.01 + unit.phase)) : 0;
        const lunge = attack * 2.2 * (isBull ? 1 : -1);
        const left = Math.round(x + lunge - unit.width * 0.5);

        ctx.globalAlpha = 0.32;
        crispRect(ctx, left + scale, y + scale, unit.width - scale * 2, Math.max(2, scale * 1.5), '#020302');
        ctx.globalAlpha = 1;
        if (unit.isWhale) {
            ctx.globalAlpha = 0.22 + attack * 0.12;
            crispRect(ctx, left - 4, y - unit.height - 4, unit.width + 8, unit.height + 10, isBull ? '#00ff88' : '#ff164f');
            ctx.globalAlpha = 1;
        }
        if (isBull) this.drawBull(left, y, scale, stride, attack);
        else this.drawBear(left, y, scale, stride, attack);
    }

    drawBull(left, y, scale, stride, attack) {
        const ctx = this.ctx;
        crispRect(ctx, left + scale, y - 10 * scale, 12 * scale, 7 * scale, '#050807');
        crispRect(ctx, left + 4 * scale, y - 12 * scale, 6 * scale, 3 * scale, '#111c17');
        crispRect(ctx, left + 11 * scale, y - 12 * scale, 7 * scale, 6 * scale, '#07100c');
        crispRect(ctx, left + 16 * scale, y - 10 * scale, 3 * scale, 3 * scale, '#1a251f');
        crispRect(ctx, left + 12 * scale, y - 15 * scale, 2 * scale, 4 * scale, '#e1fff2');
        crispRect(ctx, left + 16 * scale, y - 15 * scale, 2 * scale, 4 * scale, '#e1fff2');
        ctx.globalAlpha = 0.35;
        crispRect(ctx, left + 13.5 * scale, y - 13.5 * scale, 5 * scale, 5 * scale, '#00ff88');
        ctx.globalAlpha = 1;
        crispRect(ctx, left + 15 * scale, y - 12 * scale, 2.3 * scale, 2.3 * scale, attack > 0.55 ? '#d7ffeb' : '#00ff88');
        if (attack > 0.68) {
            ctx.globalAlpha = 0.72;
            crispRect(ctx, left + 17 * scale, y - 11.5 * scale, 5 * scale, Math.max(1, scale * 0.7), '#00ff88');
            ctx.globalAlpha = 1;
        }
        crispRect(ctx, left - scale, y - 11 * scale, 3 * scale, scale, '#07100b');
        crispRect(ctx, left + 3 * scale, y - 3 * scale, 3 * scale, (3 + stride) * scale, '#030504');
        crispRect(ctx, left + 10 * scale, y - 3 * scale, 3 * scale, (3 - stride) * scale, '#030504');
        crispRect(ctx, left + 2 * scale, y + stride * scale, 4 * scale, scale, '#1b2a23');
        crispRect(ctx, left + 10 * scale, y - stride * scale, 4 * scale, scale, '#1b2a23');
    }

    drawBear(left, y, scale, stride, attack) {
        const ctx = this.ctx;
        crispRect(ctx, left + 5 * scale, y - 10 * scale, 12 * scale, 7 * scale, '#a96f46');
        crispRect(ctx, left + 8 * scale, y - 13 * scale, 6 * scale, 4 * scale, '#c18150');
        crispRect(ctx, left + scale, y - 12 * scale, 7 * scale, 6 * scale, '#c88b55');
        crispRect(ctx, left, y - 9 * scale, 4 * scale, 3 * scale, '#56311e');
        crispRect(ctx, left + 2 * scale, y - 14 * scale, 2 * scale, 2 * scale, '#684027');
        crispRect(ctx, left + 6 * scale, y - 14 * scale, 2 * scale, 2 * scale, '#684027');
        ctx.globalAlpha = 0.35;
        crispRect(ctx, left, y - 13.5 * scale, 5 * scale, 5 * scale, '#ff164f');
        ctx.globalAlpha = 1;
        crispRect(ctx, left + 2 * scale, y - 12 * scale, 2.3 * scale, 2.3 * scale, attack > 0.55 ? '#ffd5df' : '#ff164f');
        crispRect(ctx, left - (2 + Math.round(attack * 3)) * scale, y - 12 * scale, (4 + Math.round(attack * 2)) * scale, Math.max(1, scale), '#ff164f');
        crispRect(ctx, left + 7 * scale, y - 3 * scale, 3 * scale, (3 + stride) * scale, '#56351f');
        crispRect(ctx, left + 14 * scale, y - 3 * scale, 3 * scale, (3 - stride) * scale, '#56351f');
        crispRect(ctx, left + 6 * scale, y + stride * scale, 4 * scale, scale, '#24160f');
        crispRect(ctx, left + 14 * scale, y - stride * scale, 4 * scale, scale, '#24160f');
    }

    drawMarketHud(w, h) {
        const ctx = this.ctx;
        const compact = w < 480 || h < 120;
        const hudHeight = compact ? 25 : 33;
        crispRect(ctx, 0, 0, w, hudHeight, '#030706');
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${compact ? 10 : 12}px monospace`;
        ctx.fillStyle = this.snapshot.online ? '#00ff88' : '#ff5a76';
        ctx.textAlign = 'left';
        ctx.fillText(this.snapshot.online ? (compact ? '● 30S' : '● LIVE · 30S') : '● RETRY', 8, hudHeight * 0.5);
        ctx.fillStyle = '#e8fff3';
        ctx.textAlign = 'center';
        ctx.font = `900 ${compact ? 13 : 18}px monospace`;
        ctx.fillText(formatMarketCap(this.snapshot.mcap, compact), w * 0.5, hudHeight * 0.5);
        ctx.fillStyle = '#b8c8bf';
        ctx.textAlign = 'right';
        ctx.font = `900 ${compact ? 9 : 11}px monospace`;
        ctx.fillText(formatPrice(this.snapshot.price, compact), w - 8, hudHeight * 0.5);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

    drawWaitingState(w, h, footerY) {
        const ctx = this.ctx;
        ctx.fillStyle = '#b8c8bf';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${h < 120 ? 9 : 11}px monospace`;
        ctx.fillText('WAITING FOR VERIFIED SWAPS', w * 0.5, (Math.floor(h * 0.34) + footerY) * 0.5 + 16);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

    drawPressureFooter(w, h, layout) {
        const ctx = this.ctx;
        const compact = w < 480 || h < 120;
        const footerHeight = compact ? 16 : 20;
        const y = h - footerHeight;
        const buyPercent = Math.round(layout.buyShare * 100);
        const sellPercent = 100 - buyPercent;
        crispRect(ctx, 0, y, w, footerHeight, '#080a09');
        crispRect(ctx, 0, y, w * layout.buyShare, 4, '#00ff88');
        crispRect(ctx, w * layout.buyShare, y, w * (1 - layout.buyShare), 4, '#ff164f');
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${compact ? 8 : 10}px monospace`;
        ctx.fillStyle = '#70ffc0';
        ctx.textAlign = 'left';
        const buyLabel = compact
            ? `BUY ${buyPercent}% · ${layout.bullTotal}`
            : `BUY ${buyPercent}% · ${formatSol(this.snapshot.buySol)} SOL · ${layout.bullTotal} SWAPS`;
        ctx.fillText(buyLabel, 7, y + footerHeight * 0.62);
        ctx.fillStyle = '#ff7394';
        ctx.textAlign = 'right';
        const sellLabel = compact
            ? `SELL ${sellPercent}% · ${layout.bearTotal}`
            : `SELL ${sellPercent}% · ${formatSol(this.snapshot.sellSol)} SOL · ${layout.bearTotal} SWAPS`;
        ctx.fillText(sellLabel, w - 7, y + footerHeight * 0.62);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
}
