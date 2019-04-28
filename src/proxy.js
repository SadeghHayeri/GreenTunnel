import net from 'net';
import {setProxy, unsetProxy} from './utils/system-proxy';
import handleRequest from './handlers/request';
import DNSOverTLS from './dns/tls';
import DNSOverHTTPS from './dns/https';
import getConfig from './config';
import getLogger from './logger';

const {debug, error, success} = getLogger('proxy');

export default class Proxy {
	constructor(_config) {
		this.config = getConfig(_config);

		this.server = undefined;
		this.proxySet = false;

		this.initDNS();
	}

	initDNS() {
		this.dns = this.config.dns.type === 'https' ?
			new DNSOverHTTPS(this.config.dns.server) :
			new DNSOverTLS(this.config.dns.server);
	}

	async start() {
		this.server = net.createServer({pauseOnConnect: true}, clientSocket => {
			handleRequest(clientSocket, this).catch(err => {
				error(String(err));
			});
		});

		this.server.on('error', err => {
			debug(err.toString());
		});

		this.server.on('close', () => {
			debug('server closed');
		});

		this.server.listen(this.config.proxy.port, this.config.proxy.ip, async () => {
			const {address, port} = this.server.address();
			success('Proxy listening on', address + ':' + port);
			await setProxy(address, port);
			this.proxySet = true;
		});
	}

	async stop() {
		if (this.server) {
			this.server.close();
		}

		if (this.proxySet) {
			await unsetProxy();
		}
	}
}
