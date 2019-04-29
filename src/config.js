export default function getConfig(_config = {}) {
	return {
		proxy: {
			ip: '127.0.0.1',
			port: 8000,
			clientHelloMTU: 100,
			..._config.proxy
		},
		dns: {
			type: 'https', // 'tls' or 'https'
			server: 'https://cloudflare-dns.com/dns-query',
			..._config.dns
		}
	};
}
