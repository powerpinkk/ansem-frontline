export function connectTradeStream(url, handlers) {
    let socket;
    let retryTimer;
    let retryDelay = 1_000;
    let stopped = false;

    const connect = () => {
        if (stopped) return;
        if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
        const nextSocket = new WebSocket(url);
        socket = nextSocket;
        handlers.onStatus?.('connecting');
        nextSocket.addEventListener('open', () => {
            retryDelay = 1_000;
            nextSocket.send(JSON.stringify({ type: 'configure', ...handlers.getConfiguration?.() }));
        });
        nextSocket.addEventListener('message', (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'trade') handlers.onTrade?.(message.data);
                if (message.type === 'status') {
                    handlers.onProviderStatus?.(message.status);
                    handlers.onStatus?.(message.status === 'live' ? 'online' : 'offline');
                }
            } catch (error) {
                console.warn('[stream] Invalid message', error);
            }
        });
        nextSocket.addEventListener('close', () => {
            if (socket === nextSocket) socket = null;
            reconnect();
        });
        nextSocket.addEventListener('error', () => nextSocket.close());
    };

    const reconnect = () => {
        if (stopped) return;
        handlers.onStatus?.('offline');
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(30_000, retryDelay * 2);
    };

    connect();
    return {
        reconnect() {
            if (stopped) return;
            retryDelay = 1_000;
            window.clearTimeout(retryTimer);
            if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'configure', ...handlers.getConfiguration?.() }));
                return;
            }
            socket?.close();
            socket = null;
            connect();
        },
        stop() {
            stopped = true;
            window.clearTimeout(retryTimer);
            socket?.close();
        },
    };
}
