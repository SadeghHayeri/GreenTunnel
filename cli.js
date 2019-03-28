#!/usr/bin/env node
const updateNotifier = require('update-notifier');
const proxy = require('./proxy');
const pkg = require('./package.json');
const chalk = require('chalk');
const clear = require('clear');
const debug = require('debug')('green-tunnel-cli');
const ora = require('ora');
const getPort = require('get-port');

const CONFIG = require('./config');

var argv = require('yargs')
    .usage('Usage: green-tunnel [options]')
    .usage('Usage: gt [options]')

    .default('ip',   CONFIG.PROXY.DEFAULT_IP)
    .describe('ip', 'ip address to bind proxy server')

    .default('port', 'random')
    .describe('port', 'port address to bind proxy server')

    .default('dnsType', CONFIG.DNS.TYPE)
    .choices('dnsType', ['DNS_OVER_HTTPS', 'DNS_OVER_TLS'])

    .default('dnsServer', CONFIG.DNS.DNS_OVER_HTTPS_URL)

    .example('$0')
    .example('$0 --ip 127.0.0.1 --port 8000')
    .example('$0 --dnsServer https://doh.securedns.eu/dns-query')
    .epilog('ISSUES:  https://github.com/SadeghHayeri/GreenTunnel/issues')

    .argv;

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

function showSpinner() {
    console.log('');
    const spinner = ora({
        indent: 27,
        text: '',
        color: 'green',
    }).start();
}

async function main() {
    clear();

    printBanner();
    printAlert();
    showSpinner();

    process.on('SIGINT', async () => {
        debug("Caught interrupt signal");
        await proxy.stopProxyServer();
        debug('Successfully Closed!');
        clear();
        process.exit();
    });

    const port = argv.port === 'random' ? await getPort({ port: CONFIG.PROXY.DEFAULT_PORT }) : argv.port;
    proxy.startProxyServer(argv.ip, port, argv.dnsType, argv.dnsServer);
}

main();