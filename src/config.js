export default function getConfig(_config = {}) {
	return {
		proxy: {
			ip: '127.0.0.1',
			port: 8000,
			clientHelloMTU: 100,
			..._config.proxy
		},
		dns: {
			type: 'https', // 'DNS_OVER_TLS' or 'DNS_OVER_HTTPS'
			server: 'https://cloudflare-dns.com/dns-query',
			..._config.dns
		}
	};
}
