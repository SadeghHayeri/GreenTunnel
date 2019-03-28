module.exports = {
    PROXY: {
        IP: '127.0.0.1',
        PORT: 8000,
        CLIENT_HELLO_MTU: 100,

    },
    DNS: {
        TYPE: 'DNS_OVER_HTTPS', // 'DNS_OVER_TLS' or 'DNS_OVER_HTTPS'
        DNS_OVER_HTTPS_URL: 'https://cloudflare-dns.com/dns-query',
    }
};