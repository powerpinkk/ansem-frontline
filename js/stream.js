export function connectTradeStream(url, handlers) {
    let socket;
    let retryTimer;
    let heartbeatTimer;
    let retryDelay = 1_000;
    let stopped = false;
    const armHeartbeat = (nextSocket) => {
        window.clearTimeout(heartbeatTimer);
        heartbeatTimer = window.setTimeout(() => {
            handlers.onStatus?.('offline');
            nextSocket.close();
        }, 30_000);
    };

    const connect = () => {
        if (stopped) return;
        if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
        const nextSocket = new WebSocket(url);
        socket = nextSocket;
        armHeartbeat(nextSocket);
        handlers.onStatus?.('connecting');
        nextSocket.addEventListener('open', () => {
            if (stopped || socket !== nextSocket) return;
            retryDelay = 1_000;
            nextSocket.send(JSON.stringify({ type: 'configure', ...handlers.getConfiguration?.() }));
        });
        nextSocket.addEventListener('message', (event) => {
            if (stopped || socket !== nextSocket) return;
            try {
                const message = JSON.parse(event.data);
                if (message.version !== 3) { handlers.onStatus?.('offline'); return; }
                armHeartbeat(nextSocket);
                if (message.type === 'trade') handlers.onTrade?.(message.data);
                if (message.type === 'reconcile') handlers.onReconcile?.(message.data);
                if (message.type === 'snapshot') handlers.onSnapshot?.(message);
                if (message.type === 'integrity') handlers.onIntegrity?.(message.data);
                if (message.type === 'status') {
                    handlers.onProviderStatus?.(message.status);
                    handlers.onStatus?.(message.status === 'live' ? 'online' : 'offline');
                }
            } catch (error) {
                console.warn('[stream] Invalid message', error);
            }
        });
        nextSocket.addEventListener('close', () => {
            if (stopped || socket !== nextSocket) return;
            socket = null;
            window.clearTimeout(heartbeatTimer);
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
            window.clearTimeout(heartbeatTimer);
            if (socket?.readyState === WebSocket.OPEN) {
                armHeartbeat(socket);
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
            window.clearTimeout(heartbeatTimer);
            socket?.close();
        },
    };
}
