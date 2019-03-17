const BaseHandler = require('./BaseHandler');
const { HTTP, HTTPRequest, HTTPResponse } = require('../http-parser');
const { URL } = require('url');
const net = require('net');
const { isStartOfHTTPPacket } = require('../utils');

class HTTPHandler extends BaseHandler {

    static clientToServer(data) {
        const srtData = data.toString();

        if(isStartOfHTTPPacket(srtData)) {
            const packet = new HTTPRequest(srtData);
            packet.path = new URL(packet.path).pathname;

            if(packet.headers.hasOwnProperty('Proxy-Connection'))
                delete packet.headers['Proxy-Connection'];

            return packet.toString()
        } else
            return data;
    }

    static serverToClient(data) {
        return data;
    }

    static handlerNewSocket(clientSocket, firstChunk = null) {
        const firstLine = firstChunk.toString().split('\r\n')[0];
        const url = new URL(firstLine.split(/\s+/)[1]);

        const host = url.hostname;
        const port = url.port || 80;

        const serverSocket = net.createConnection({host: host, port: port}, () => {
            console.log('connected to server!');

            serverSocket.write(HTTPHandler.clientToServer(firstChunk));
            clientSocket.resume();
        });

        serverSocket.on('data', (data) => { clientSocket.write(HTTPHandler.serverToClient(data)) });
        clientSocket.on('data', (data) => { serverSocket.write(HTTPHandler.clientToServer(data)) });

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

module.exports = HTTPHandler;