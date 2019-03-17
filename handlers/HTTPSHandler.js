const BaseHandler = require('./BaseHandler');
const { HTTPResponse } = require('../http-parser');
const { URL } = require('url');
const net = require('net');
const { chunks, dnsOverTLSAsync } = require('../utils');

class HTTPSHandler extends BaseHandler {

    static getConnectionEstablishedPacket() {
        const packet = new HTTPResponse();
        packet.statusCode = 200;
        packet.statusMessgae = 'Connection Established';
        return packet
    }

    static clientToServer(data) {
        return data;
    }

    static serverToClient(data) {
        return data;
    }

    static async handlerNewSocket(clientSocket, firstChunk = null) {
        const firstLine = firstChunk.toString().split('\r\n')[0];
        const url = new URL('https://' + firstLine.split(/\s+/)[1]);

        const host = url.hostname;
        const port = url.port || 443;

        const ip = await dnsOverTLSAsync(host);

        const serverSocket = net.createConnection({host: ip, port: port}, () => {
            console.log('connected to server!');

            clientSocket.write(HTTPSHandler.getConnectionEstablishedPacket().toString());
            clientSocket.resume();
        });

        clientSocket.once('data', (clientHello) => {
            chunks(clientHello, 100).forEach((chunk) => {
                serverSocket.write(chunk);
            });

            // setup for other packets
            clientSocket.on('data', (data) => {
                serverSocket.write(data)
            });
        });

        serverSocket.on('data', (data) => {
            clientSocket.write(HTTPSHandler.serverToClient(data))
        });

        serverSocket.on('end', () => {
            console.log('disconnected from server');
            clientSocket.end();
        });

        clientSocket.on('end', () => {
            console.log('disconnected from client');
            serverSocket.end();
        });
    }
}

module.exports = HTTPSHandler;