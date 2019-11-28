#!/usr/bin/env node
const updateNotifier = require('update-notifier');
const chalk = require('chalk');
const clear = require('clear');
const ora = require('ora');
const yargs = require('yargs');
const consola = require('consola');
const pkg = require('../package.json');
const {Proxy, getConfig, getLogger} = require('../src/index.cjs');

const defaultConfig = getConfig();
const {debug} = getLogger('cli');

const {argv} = yargs
	.usage('Usage: green-tunnel [options]')
	.usage('Usage: gt [options]')
	.alias('help', 'h')
	.alias('version', 'V')

	.option('ip', {
		type: 'string',
		describe: 'ip address to bind proxy server',
		default: '127.0.0.1'
	})

	.option('port', {
		type: 'number',
		describe: 'port address to bind proxy server',
		default: 5000
	})

	.option('dns-type', {
		type: 'string',
		choices: ['https', 'tls'],
		default: defaultConfig.dns.type
	})

	.option('dns-server', {
		type: 'string',
		default: defaultConfig.dns.server,
	})

	.option('verbose', {
		alias: 'v',
		type: 'boolean',
		describe: 'make the operation more talkative',
		default: false
	})

	.option('silent', {
		alias: 's',
		type: 'boolean',
		describe: 'run in silent mode',
		default: false
	})

	.example('$0')
	.example('$0 --ip 127.0.0.1 --port 8000')
	.example('$0 --dnsServer https://doh.securedns.eu/dns-query')
	.epilog('ISSUES:  https://github.com/SadeghHayeri/GreenTunnel/issues\n' +
		'DONATE:  https://github.com/SadeghHayeri/GreenTunnel#donation');

const MAIN_COLOR = '84C66F';

function printBanner() {
	console.log();
	console.log('                          ' + chalk.bgHex(MAIN_COLOR)('    '));
	console.log('                       ' + chalk.bgHex(MAIN_COLOR)('          '));
	console.log('                      ' + chalk.bgHex(MAIN_COLOR)('            '));
	console.log('                      ' + chalk.bgHex(MAIN_COLOR)('     ') + '  ' + chalk.bgHex(MAIN_COLOR)('     '));
	console.log('                      ' + chalk.bgHex(MAIN_COLOR)('   ') + '      ' + chalk.bgHex(MAIN_COLOR)('   '));
	console.log('                      ' + chalk.bgHex(MAIN_COLOR)(' ') + '          ' + chalk.bgHex(MAIN_COLOR)(' '));
	console.log();
	console.log('                      ' + chalk.hex(MAIN_COLOR).bold('Green') + ' ' + chalk.bold.white('Tunnel'));
}

function printAlert(proxy) {
	console.log('\n');
	console.log('    ' + chalk.bgHex(MAIN_COLOR).black(' Note: GreenTunnel does not hide your IP address '));
	console.log('      ' + chalk.hex(MAIN_COLOR)(' https://github.com/SadeghHayeri/GreenTunnel '));
	console.log('\n      ' + chalk.white(` GreenTunnel is running at ${proxy.server.address().address}:${proxy.server.address().port}. `));
}

function showSpinner() {
	console.log('');
	ora({
		indent: 27,
		text: '',
		color: 'green'
	}).start();
}

async function main() {
	const proxy = new Proxy({
		proxy: {
			ip: argv.ip,
			port: parseInt(argv.port, 10) || 0
		},
		dns: {
			type: argv.dnsType,
			server: argv.dnsServer
		}
	});

	const exitTrap = async () => {
		debug('Caught interrupt signal');
		await proxy.stop();
		debug('Successfully Closed!');

		if (!argv.silent) {
			clear();
		}

		process.exit(0);
	};

	const errorTrap = error => {
		consola.error(error);
	};

	process.on('SIGINT', exitTrap);
	process.on('unhandledRejection', errorTrap);
	process.on('uncaughtException', errorTrap);

	await proxy.start({setProxy: true, verboseMode: argv.verbose});

	if (!argv.silent) {
		clear();
		printBanner();
		updateNotifier({pkg}).notify();
		printAlert(proxy);
		showSpinner();
	}
}

main().catch(console.error);
