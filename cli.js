#!/usr/bin/env node
const proxy = require('./proxy');

process.on('SIGINT', async () => {
    console.log("Caught interrupt signal");
    await proxy.stopProxyServer();
    console.log('Successfully Closed!');
    process.exit();
});

proxy.startProxyServer();