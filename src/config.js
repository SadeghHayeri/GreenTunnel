const config = {
	ip: '127.0.0.1',
	port: 8000,
	httpsOnly: false,
	clientHelloMTU: 100,
	dns: {
		type: 'https', // 'tls' or 'https' or 'unencrypted'
		server: 'https://cloudflare-dns.com/dns-query',
		ip: '127.0.0.1',
		port: 53,
		cacheSize: 1000,
	}
};

export default config;
