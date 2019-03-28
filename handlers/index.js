const { isStartOfHTTPPacket } = require('../utils');
const HTTPHandler = require('./HTTPHandler');
const HTTPSHandler = require('./HTTPSHandler');
const debug = require('debug')('green-tunnel-base-handler');


class RequestHandler {

    static isConnectMethod(rawInput) {
        const firstWord = rawInput.split(/\s+/)[0];
        return firstWord.toUpperCase() === 'CONNECT';
    }

    static handleNewSocket(socket) {
        socket.resume();
        socket.once('data', (data) => {
            socket.pause();
            const strData = data.toString();

            if(isStartOfHTTPPacket(strData)) {
                if(RequestHandler.isConnectMethod(strData))
                    HTTPSHandler.handlerNewSocket(socket, data);
                else
                    HTTPHandler.handlerNewSocket(socket, data);
            } else {
                debug('ERROR, UNSUPPORTED', strData)
            }
        })

    }
}

module.exports = RequestHandler;