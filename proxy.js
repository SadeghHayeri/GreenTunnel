'use strict';

const net = require('net');
const CONFIG = require('./config');
const RequestHandler = require('./handlers');
const SystemProxyManager = require('./system-proxy-manager');
const debug = require('debug')('proxy-service');

class Proxy {
    static async startProxyServer() {
        Proxy.server = net.createServer({ pauseOnConnect: true }, (socket) => {
            debug('client connected');

            socket.on('end', () => {
                debug('client disconnected')
            });

            RequestHandler.handleNewSocket(socket);
        });

        Proxy.server.on('error', (err) => {
            debug(err.toString());
        });

        Proxy.server.on('close', () => {
            debug('server closed');
        });

        Proxy.server.listen(CONFIG.PROXY.PORT, CONFIG.PROXY.IP, () => {
            debug('server bound');
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