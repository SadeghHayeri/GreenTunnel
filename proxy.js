'use strict';

const net = require('net');
const CONFIG = require('./config');
const RequestHandler = require('./handlers');
const SystemProxyManager = require('./system-proxy-manager');
const debug = require('debug')('green-tunnel-proxy');

class Proxy {
    static async startProxyServer(ip, port, dnsType, dnsServer) {
        Proxy.server = net.createServer({ pauseOnConnect: true }, (socket) => {
            debug('client connected');

            socket.on('end', () => {
                debug('client disconnected')
            });

            RequestHandler.handleNewSocket(socket, dnsType, dnsServer);
        });

        Proxy.server.on('error', (err) => {
            debug(err.toString());
        });

        Proxy.server.on('close', () => {
            debug('server closed');
        });

        Proxy.server.listen(port, ip, () => {
            debug('server bound');
        });

        await SystemProxyManager.set_proxy(ip, port);
    }

    static async stopProxyServer() {
        Proxy.server.close();
        await SystemProxyManager.unset_proxy();
    }
}
Proxy.server = null;

module.exports = Proxy;