#!/usr/bin/env node
const updateNotifier = require('update-notifier');
const proxy = require('./proxy');
const pkg = require('./package.json');

updateNotifier({pkg}).notify();

process.on('SIGINT', async () => {
    console.log("Caught interrupt signal");
    await proxy.stopProxyServer();
    console.log('Successfully Closed!');
    process.exit();
});

proxy.startProxyServer();