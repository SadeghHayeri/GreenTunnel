module.exports = {
    HTTPS: {
        KEY_SIZE: 512,
        CERT_CACHING: true,
        PATHS: {
            ROOT_CA: 'GREEN_TUNNEL',
            SECRETS_DIR: 'secrets'
        },
        CERT_INFO: {
            CA: {
                attrs: [{
                    name: 'commonName',
                    value: 'Green Tunnel'
                }, {
                    name: 'countryName',
                    value: 'Internet'
                }, {
                    shortName: 'ST',
                    value: 'Internet'
                }, {
                    name: 'localityName',
                    value: 'Internet'
                }, {
                    name: 'organizationName',
                    value: 'Green Tunnel CA'
                }, {
                    shortName: 'OU',
                    value: 'CA'
                }],

                extensions: [{
                    name: 'basicConstraints',
                    cA: true
                }, {
                    name: 'keyUsage',
                    keyCertSign: true,
                    digitalSignature: true,
                    nonRepudiation: true,
                    keyEncipherment: true,
                    dataEncipherment: true
                }, {
                    name: 'extKeyUsage',
                    serverAuth: true,
                    clientAuth: true,
                    codeSigning: true,
                    emailProtection: true,
                    timeStamping: true
                }, {
                    name: 'nsCertType',
                    client: true,
                    server: true,
                    email: true,
                    objsign: true,
                    sslCA: true,
                    emailCA: true,
                    objCA: true
                }, {
                    name: 'subjectKeyIdentifier'
                }],
            },

            Hosts: {
                attrs: [{
                    name: 'countryName',
                    value: 'Internet'
                }, {
                    shortName: 'ST',
                    value: 'Internet'
                }, {
                    name: 'localityName',
                    value: 'Internet'
                }, {
                    name: 'organizationName',
                    value: 'Green Tunnel CA'
                }, {
                    shortName: 'OU',
                    value: 'Green Tunnel Server Certificate'
                }],

                extensions: [{
                    name: 'basicConstraints',
                    cA: false
                }, {
                    name: 'keyUsage',
                    keyCertSign: false,
                    digitalSignature: true,
                    nonRepudiation: false,
                    keyEncipherment: true,
                    dataEncipherment: true
                }, {
                    name: 'extKeyUsage',
                    serverAuth: true,
                    clientAuth: true,
                    codeSigning: false,
                    emailProtection: false,
                    timeStamping: false
                }, {
                    name: 'nsCertType',
                    client: true,
                    server: true,
                    email: false,
                    objsign: false,
                    sslCA: false,
                    emailCA: false,
                    objCA: false
                }, {
                    name: 'subjectKeyIdentifier'
                }],
            }
        }
    }

};