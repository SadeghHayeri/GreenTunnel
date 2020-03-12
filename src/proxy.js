import net from 'net';
import {setProxy, unsetProxy} from './utils/system-proxy';
import handleRequest from './handlers/request';
import DNSOverTLS from './dns/tls';
import DNSOverHTTPS from './dns/https';
import config from './config';
import getLogger from './logger';
import {appUse} from './utils/analytics';

const logger = getLogger('proxy');

export default class Proxy {
	constructor(customConfig) {
		this.config = {...config, ...customConfig};
		this.server = undefined;
		this.isSystemProxySet = false;
		this.initDNS();
	}

	initDNS() {
		this.dns = this.config.dns.type === 'https' ?
			new DNSOverHTTPS(this.config.dns.server) :
			new DNSOverTLS(this.config.dns.server);
	}

	async start(options = {}) {
		appUse();
		options.setProxy = options.setProxy === undefined ? false : options.setProxy;

		this.server = net.createServer({pauseOnConnect: true}, clientSocket => {
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

		const {address, port} = this.server.address();
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
