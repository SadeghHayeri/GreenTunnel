#!/usr/bin/env node
const updateNotifier = require('update-notifier');
const proxy = require('./proxy');
const pkg = require('./package.json');
const debug = require('debug')('cli');

updateNotifier({pkg}).notify();

process.on('SIGINT', async () => {
    debug("Caught interrupt signal");
    await proxy.stopProxyServer();
    debug('Successfully Closed!');
    process.exit();
});

proxy.startProxyServer();