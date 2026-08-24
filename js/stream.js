export function connectTradeStream(url, handlers) {
    let socket;
    let retryTimer;
    let retryDelay = 1_000;
    let stopped = false;

    const connect = () => {
        if (stopped) return;
        socket = new WebSocket(url);
        handlers.onStatus?.('connecting');
        socket.addEventListener('open', () => {
            retryDelay = 1_000;
            handlers.onStatus?.('online');
        });
        socket.addEventListener('message', (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'trade') handlers.onTrade?.(message.data);
                if (message.type === 'status') handlers.onProviderStatus?.(message.status);
            } catch (error) {
                console.warn('[stream] Invalid message', error);
            }
        });
        socket.addEventListener('close', reconnect);
        socket.addEventListener('error', () => socket.close());
    };

    const reconnect = () => {
        if (stopped) return;
        handlers.onStatus?.('offline');
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(30_000, retryDelay * 2);
    };

    connect();
    return () => {
        stopped = true;
        window.clearTimeout(retryTimer);
        socket?.close();
    };
}
