import BaseDNS from './base.js';

export default class DNSOverHTTPS extends BaseDNS {
	constructor(dnsServer) {
		super();
		this.dnsServer = dnsServer;
	}

	async _lookup(hostname) {
		const url = new URL(this.dnsServer);
		url.searchParams.set('name', hostname);
		url.searchParams.set('type', 'A');

		const response = await fetch(url.toString(), {
			headers: {Accept: 'application/dns-json'},
		});

		if (!response.ok) {
			throw new Error(`DoH request failed: ${response.status}`);
		}

		const result = await response.json();

		if (!result.Answer || result.Answer.length === 0) {
			throw new Error(`No DNS answers for ${hostname}`);
		}

		return result.Answer[0].data;
	}
}
