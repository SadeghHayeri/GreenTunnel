import net from 'net';
import { setProxy, unsetProxy } from './utils/system-proxy';
import handleRequest from './handlers/request';
import DNSOverTLS from './dns/tls';
import DNSOverHTTPS from './dns/https';
import DNSUnencrypted from './dns/unencrypted';
import config from './config';
import getLogger from './logger';
import { appInit } from './utils/analytics';

const logger = getLogger('proxy');

export default class Proxy {
	constructor(customConfig) {
		this.config = { ...config, ...customConfig };
		this.server = undefined;
		this.isSystemProxySet = false;
		this.initDNS();
		appInit(customConfig.source);
	}

	initDNS() {
		if (this.config.dns.type === 'https') {
			this.dns = new DNSOverHTTPS(this.config.dns.server);
		} else if (this.config.dns.type === 'tls') {
			this.dns = new DNSOverTLS(this.config.dns.server);
		} else {
			this.dns = new DNSUnencrypted(this.config.dns.ip, this.config.dns.port);
		}
	}

	async start(options = {}) {
		options.setProxy = options.setProxy === undefined ? false : options.setProxy;

		this.server = net.createServer({ pauseOnConnect: true }, clientSocket => {
			handleRequest(clientSocket, this).catch(err => {
				logger.debug(String(err));
			});
		});

		this.server.on('error', err => {
			logger.error(err.toString());
		});

		this.server.on('close', () => {
			logger.debug('server closed');
		});

		await new Promise(resolve => {
			this.server.listen(this.config.port, this.config.ip, () => resolve());
		});

		const { address, port } = this.server.address();
		logger.debug(`server listen on ${address} port ${port}`);

		if (options.setProxy) {
			await setProxy(address, port);
			this.isSystemProxySet = true;
			logger.debug('system proxy set');
		}
	}

	async stop() {
		if (this.server) {
			this.server.close();
		}

		if (this.isSystemProxySet) {
			await unsetProxy();
			this.isSystemProxySet = false;
			logger.debug('system proxy unset');
		}
	}
}
