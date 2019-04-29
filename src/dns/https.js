import {promisify} from 'util';
import doh from 'dns-over-http';
import BaseDNS from './base';

const dohQueryAsync = promisify(doh.query);

export default class DNSOverHTTPS extends BaseDNS {
	constructor(dnsServer) {
		super();
		this.dnsServer = dnsServer;
	}

	async _lookup(hostname) {
		const result = await dohQueryAsync({url: this.dnsServer}, [{type: 'A', name: hostname}]);
		return result.answers[0].data;
	}
}
