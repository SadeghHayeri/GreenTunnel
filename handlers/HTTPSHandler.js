const BaseHandler = require('./BaseHandler');
const { HTTPResponse } = require('../http-parser');
const { URL } = require('url');
const net = require('net');
const debug = require('debug')('http-handler');

const { chunks, dnsOverTLSAsync, dnsOverHTTPSAsync } = require('../utils');
const CONFIG = require('../config');

class HTTPSHandler extends BaseHandler {

    static getConnectionEstablishedPacket() {
        const packet = new HTTPResponse();
        packet.statusCode = 200;
        packet.statusMessgae = 'Connection Established';
        return packet
    }

    static sendDataByCatch(socket, data, pairSocket=null) {
        try {
            socket.write(data)
        } catch (e) {
            debug('ERROR', e);
            if(pairSocket)
                pairSocket.end();
        }
    }

    static dnsLookup(hostname, options, callback) {
        if(CONFIG.DNS.TYPE === 'DNS_OVER_HTTPS') {
            dnsOverHTTPSAsync(hostname)
                .then((data) => {
                    callback(null, data, 4)
                })
        } else {
            dnsOverTLSAsync(hostname)
                .then((data) => {
                    callback(null, data, 4)
                });
        }
    }

    static async handlerNewSocket(clientSocket, firstChunk = null) {
        const firstLine = firstChunk.toString().split('\r\n')[0];
        const url = new URL('https://' + firstLine.split(/\s+/)[1]);

        const host = url.hostname;
        const port = url.port || 443;

        const serverSocket = net.createConnection({host, port, lookup: HTTPSHandler.dnsLookup}, () => {
            debug('connected to server!');

            clientSocket.once('data', (clientHello) => {
                chunks(clientHello, CONFIG.PROXY.CLIENT_HELLO_MTU).forEach((chunk) => {
                    HTTPSHandler.sendDataByCatch(serverSocket, chunk, clientSocket);
                });

                // setup for other packets
                clientSocket.on('data', (data) => {
                    HTTPSHandler.sendDataByCatch(serverSocket, data, clientSocket);
                });
            });

            clientSocket.on('end', () => {
                debug('disconnected from client');
                serverSocket.end();
            });

            clientSocket.on('error', (e) => {
                debug('ERROR', e)
            });

            HTTPSHandler.sendDataByCatch(clientSocket, HTTPSHandler.getConnectionEstablishedPacket().toString(), serverSocket);
            clientSocket.resume();
        });

        serverSocket.on('data', (data) => {
            HTTPSHandler.sendDataByCatch(clientSocket, data, serverSocket);
        });

        serverSocket.on('end', () => {
            debug('disconnected from server');
            clientSocket.end();
        });

        serverSocket.on('error', (e) => {
            debug('ERROR', e);
        });
    }
}

module.exports = HTTPSHandler;