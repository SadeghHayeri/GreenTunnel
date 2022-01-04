#!/usr/bin/env node

const updateNotifier = require('update-notifier');
const chalk = require('chalk');
const clear = require('clear');
const ora = require('ora');
const debug = require('debug');
const yargs = require('yargs');
const pkg = require('../package.json');
const { Proxy, config, getLogger } = require('../src/index.cjs');

const logger = getLogger('cli');

const { argv } = yargs
	.usage('Usage: green-tunnel [options]')
	.usage('Usage: gt [options]')
	.alias('help', 'h')
	.alias('version', 'V')

	.option('ip', {
		type: 'string',
		describe: 'ip address to bind proxy server',
		default: '127.0.0.1',
	})

	.option('port', {
		type: 'number',
		describe: 'port address to bind proxy server',
		default: config.port,
	})

	.option('https-only', {
		type: 'boolean',
		describe: 'Block insecure HTTP requests',
		default: config.httpsOnly,
	})

	.option('dns-type', {
		type: 'string',
		choices: ['https', 'tls', 'unencrypted'],
		default: config.dns.type,
	})

	.option('dns-server', {
		type: 'string',
		default: config.dns.server,
	})

	.option('dns-ip', {
		type: 'string',
		default: config.dns.ip,
	})

	.option('dns-port', {
		type: 'number',
		default: config.dns.port,
	})

	.option('silent', {
		alias: 's',
		type: 'boolean',
		describe: 'run in silent mode',
		default: false,
	})

	.option('verbose', {
		alias: 'v',
		type: 'string',
		describe: 'debug mode',
		default: '',
	})

	.option('system-proxy', {
		type: 'boolean',
		describe: 'automatic set system-proxy',
		default: true,
	})

	.example('$0')
	.example('$0 --ip 127.0.0.1 --port 8000')
	.example('$0 --dns-server https://doh.securedns.eu/dns-query')
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
	if (argv['verbose']) {
		debug.enable(argv['verbose']);
	}

	const proxy = new Proxy({
		ip: argv['ip'],
		port: parseInt(argv['port'], 10),
		httpsOnly: argv['https-only'],
		dns: {
			type: argv['dns-type'],
			server: argv['dns-server'],
			ip: argv['dns-ip'],
			port: argv['dns-port']
		},
		source: 'CLI',
	});

	const exitTrap = async () => {
		logger.debug('Caught interrupt signal');
		await proxy.stop();
		logger.debug('Successfully Closed!');

		if (!argv['silent']) {
			clear();
		}

		process.exit(0);
	};

	const errorTrap = error => {
		logger.error(error);
	};

	process.on('SIGINT', exitTrap);
	process.on('unhandledRejection', errorTrap);
	process.on('uncaughtException', errorTrap);

	await proxy.start({ setProxy: argv['system-proxy'] });

	if (!argv['silent'] && !argv['verbose']) {
		clear();
		printBanner();
		updateNotifier({ pkg }).notify();
		printAlert(proxy);
		showSpinner();
	}
}

main().catch(logger.error);
