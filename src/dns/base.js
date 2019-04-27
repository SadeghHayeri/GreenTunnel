import LRU from 'lru-cache';
import {isIP} from 'validator';
import getLogger from '../logger';

const {debug} = getLogger('dns');

function _isIP(v) {
	return v && isIP(v);
}

export default class BaseDNS {
	constructor() {
		this.cache = new LRU();
	}

	async lookup(hostname) {
		let ip = this.cache.get(hostname);

		if (ip) {
			return ip;
		}

		ip = hostname;
		for (let depth = 0; !_isIP(ip) && depth < 5; depth++) {
			ip = await this._lookup(ip).catch(error => {
				debug(error);
				return ip;
			});
		}

		if (!_isIP(ip)) {
			throw new Error('[DNS] Cannot resolve hostname ' + hostname);
		}

		debug('DNS Lookup:', hostname, ip);
		this.cache.set(hostname, ip);
		return ip;
	}
}

