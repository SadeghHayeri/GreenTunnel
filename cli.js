#!/usr/bin/env node
const updateNotifier = require('update-notifier');
const proxy = require('./proxy');
const pkg = require('./package.json');
const chalk = require('chalk');
const clear = require('clear');
const debug = require('debug')('green-tunnel-cli');
const ora = require('ora');

updateNotifier({pkg}).notify();

const MAIN_COLOR = '84C66F';

function printBanner() {
    console.log('\n\n' +
        '                          [0m[48;5;113m    [0m      \n' +
        '                       [0m[48;5;113m          [0m   \n' +
        '                      [0m[48;5;113m            [0m  \n' +
        '                      [0m[48;5;113m     [0m  [0m[48;5;113m     [0m  \n' +
        '                      [0m[48;5;113m   [0m      [0m[48;5;113m   [0m  \n' +
        '                      [0m[48;5;113m [0m          [0m[48;5;113m [0m  \n' +
         '[0m');
    console.log('                      ' + chalk.hex(MAIN_COLOR).bold('Green') + ' ' + chalk.bold.white('Tunnel'));
}

function printAlert() {
    console.log('\n');
    console.log('    ' + chalk.bgHex(MAIN_COLOR).black(' Note: GreenTunnel does not hide your IP address '));
    console.log('      ' + chalk.hex(MAIN_COLOR)(' https://github.com/SadeghHayeri/GreenTunnel '));
}

function showSpiner() {
    console.log('');
    const spinner = ora({
        indent: 27,
        text: '',
        color: 'green',
    }).start();
}

function main() {
    clear();

    printBanner();
    printAlert();
    showSpiner();

    process.on('SIGINT', async () => {
        debug("Caught interrupt signal");
        await proxy.stopProxyServer();
        debug('Successfully Closed!');
        clear();
        process.exit();
    });

    proxy.startProxyServer();
}

main();