import net from 'net';
import { setProxy, unsetProxy } from './utils/system-proxy.js';
import handleRequest from './handlers/request.js';
import DNSOverTLS from './dns/tls.js';
import DNSOverHTTPS from './dns/https.js';
import DNSUnencrypted from './dns/unencrypted.js';
import config from './config.js';
import getLogger from './logger.js';

const logger = getLogger('proxy');

export default class Proxy {
	constructor(customConfig) {
		this.config = { ...config, ...customConfig };
		this.server = undefined;
		this.isSystemProxySet = false;
		this.initDNS();
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
