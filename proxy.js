'use strict';

const net = require('net');
const CONFIG = require('./config');
const RequestHandler = require('./handlers');
const SystemProxyManager = require('./system-proxy-manager');

class Proxy {
    static async startProxyServer() {
        Proxy.server = net.createServer({ pauseOnConnect: true }, (socket) => {
            console.log('client connected');

            socket.on('end', () => {
                console.log('client disconnected')
            });

            RequestHandler.handleNewSocket(socket);
        });

        Proxy.server.on('error', (err) => {
            console.log(err.toString());
        });

        Proxy.server.on('close', () => {
            console.log('server closed');
        });

        Proxy.server.listen(CONFIG.PROXY.PORT, CONFIG.PROXY.IP, () => {
            console.log('server bound');
        });

        await SystemProxyManager.set_proxy(CONFIG.PROXY.IP, CONFIG.PROXY.PORT);
    }

    static async stopProxyServer() {
        Proxy.server.close();
        await SystemProxyManager.unset_proxy();
    }
}
Proxy.server = null;

module.exports = Proxy;