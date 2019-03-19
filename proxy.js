'use strict';

const net = require('net');
const CONFIG = require('./config');
const RequestHandler = require('./handlers');

const server = net.createServer({ pauseOnConnect: true }, (socket) => {
    console.log('client connected');

    socket.on('end', () => {
        console.log('client disconnected')
    });

    RequestHandler.handleNewSocket(socket);
});

server.on('error', (err) => {
    console.log(err.toString());
});

server.listen(CONFIG.PROXY.PORT, () => {
    console.log('server bound');
});