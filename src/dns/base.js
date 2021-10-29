import LRU from 'lru-cache';
import { isIP } from 'validator';
import getLogger from '../logger';
import config from '../config';

const logger = getLogger('dns');

function _isIP(v) {
	return v && isIP(v);
}

export default class BaseDNS {
	constructor() {
		this.cache = new LRU(config.dns.cacheSize);
	}

	async lookup(hostname) {
		try {
			let ip = this.cache.get(hostname);
			if (ip) {
				return ip;
			}

			const t = new Date();

			ip = hostname;
			for (let depth = 0; !_isIP(ip) && depth < 5; depth++) {
				ip = await this._lookup(ip).catch(error => {
					logger.debug(error);
					return ip;
				});
			}

			if (!_isIP(ip)) {
				throw new Error(`BAD IP FORMAT (${ip})`);
			}

			logger.debug(`[DNS] ${hostname} -> ${ip} (${new Date() - t} ms)`);
			this.cache.set(hostname, ip);
			return ip;
		} catch (error) {
			logger.debug(`[DNS] cannot resolve hostname ${hostname} (${error})`);
		}
	}
}

