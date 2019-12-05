const config = {
	ip: '127.0.0.1',
	port: 5000,
	clientHelloMTU: 100,
	dns: {
		type: 'https', // 'tls' or 'https'
		server: 'https://cloudflare-dns.com/dns-query',
		cacheSize: 1000,
	}
};

export default config;
