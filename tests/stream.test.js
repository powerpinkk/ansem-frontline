import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectTradeStream } from '../js/stream.js';

class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    static instances = [];

    constructor(url) {
        this.url = url;
        this.readyState = FakeWebSocket.CONNECTING;
        this.listeners = new Map();
        this.sent = [];
        FakeWebSocket.instances.push(this);
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    emit(type, payload = {}) {
        for (const listener of this.listeners.get(type) || []) listener(payload);
    }

    open() {
        this.readyState = FakeWebSocket.OPEN;
        this.emit('open');
    }

    send(message) {
        this.sent.push(message);
    }

    close() {
        if (this.readyState === FakeWebSocket.CLOSED) return;
        this.readyState = FakeWebSocket.CLOSED;
        this.emit('close');
    }
}

describe('trade stream lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        FakeWebSocket.instances = [];
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('window', { setTimeout, clearTimeout });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('configures the socket and forwards normalized messages', () => {
        const onTrade = vi.fn();
        const onStatus = vi.fn();
        const controller = connectTradeStream('wss://example.test/stream', {
            onTrade,
            onStatus,
            getConfiguration: () => ({ pools: [{ address: 'pool' }] }),
        });
        const socket = FakeWebSocket.instances[0];
        socket.open();
        socket.emit('message', { data: JSON.stringify({ type: 'trade', data: { txHash: 'tx' } }) });
        socket.emit('message', { data: JSON.stringify({ type: 'status', status: 'live' }) });

        expect(JSON.parse(socket.sent[0])).toEqual({ type: 'configure', pools: [{ address: 'pool' }] });
        expect(onTrade).toHaveBeenCalledWith({ txHash: 'tx' });
        expect(onStatus).toHaveBeenLastCalledWith('online');
        controller.stop();
    });

    it('reconfigures an open stream and reconnects a closed one immediately on demand', () => {
        const controller = connectTradeStream('wss://example.test/stream', {
            getConfiguration: () => ({ market: { tokenPriceUsd: 1 } }),
        });
        const first = FakeWebSocket.instances[0];
        first.open();
        controller.reconnect();
        expect(first.sent).toHaveLength(2);

        first.close();
        controller.reconnect();
        expect(FakeWebSocket.instances).toHaveLength(2);
        controller.stop();
    });
});
