'use strict';

var path = require('path');
const fs = require('fs-extra');
const CONFIG = require('./config');
const forge = require('node-forge');
const { promisify } = require('util');

const pki = forge.pki;
const generateKeyPairAsync = promisify(pki.rsa.generateKeyPair);
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);

class CertTools {

    constructor() {
        this.CACHE = {};
    }

    async init() {
        await fs.ensureDir(CONFIG.HTTPS.PATHS.SECRETS_DIR);

        const rootCA = CONFIG.HTTPS.PATHS.ROOT_CA + '.pem';
        const isCAExist = await fs.pathExists(rootCA);

        if (isCAExist) {
            const { cert, keys } = await CA_TOOLS._loadPemFiles(CONFIG.HTTPS.PATHS.ROOT_CA, rootCA);
            this.cert = cert;
            this.keys = keys;
        } else {
            const { cert, keys } = await CA_TOOLS._generateCACertAndKeys();
            this.cert = cert;
            this.keys = keys;
            await CA_TOOLS._savePemFiles(CONFIG.HTTPS.PATHS.ROOT_CA, cert, keys, rootCA);
        }
    }

    async _generateCACertAndKeys() {
        const keys = await generateKeyPairAsync({bits: CONFIG.HTTPS.KEY_SIZE});

        const cert = pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = this._getRandomSN();
        cert.validity.notBefore = new Date();
        cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
        cert.setSubject(CONFIG.HTTPS.CERT_INFO.CA.attrs);
        cert.setIssuer(CONFIG.HTTPS.CERT_INFO.CA.attrs);
        cert.setExtensions(CONFIG.HTTPS.CERT_INFO.CA.extensions);
        cert.sign(keys.privateKey, forge.md.sha256.create());

        return { cert, keys }
    }

    async _savePemFiles(fileName, cert, keys, certPath=undefined, privatePath=undefined, publicPath=undefined) {
        await writeFileAsync(certPath || path.join(CONFIG.HTTPS.PATHS.SECRETS_DIR, fileName + '.pem'), pki.certificateToPem(cert));
        await writeFileAsync(privatePath || path.join(CONFIG.HTTPS.PATHS.SECRETS_DIR, fileName + '.private'), pki.privateKeyToPem(keys.privateKey));
        await writeFileAsync(publicPath || path.join(CONFIG.HTTPS.PATHS.SECRETS_DIR, fileName + '.public'), pki.publicKeyToPem(keys.publicKey));
    }

    async _loadPemFiles(fileName, certPath=undefined, privatePath=undefined, publicPath=undefined) {
        const CAPem = await readFileAsync(certPath || path.join(CONFIG.HTTPS.PATHS.SECRETS_DIR, fileName + '.pem'), 'utf-8');
        const privateKey =  await readFileAsync(privatePath || path.join(CONFIG.HTTPS.PATHS.SECRETS_DIR, fileName + '.private'), 'utf-8');
        const publicKey =  await readFileAsync(publicPath || path.join(CONFIG.HTTPS.PATHS.SECRETS_DIR, fileName + '.public'), 'utf-8');

        return {
            cert: pki.certificateFromPem(CAPem),
            keys: {
                privateKey: pki.privateKeyFromPem(privateKey),
                publicKey: pki.publicKeyFromPem(publicKey)
            }
        }
    }

    async _getRandomSN() {
        let sn = '';
        for (let i = 0; i < 4; i++)
            sn += ('00000000' + Math.floor(Math.random()*Math.pow(256, 4)).toString(16)).slice(-8);
        return sn;
    }

    async generateHostCertAndKeys(host) {
        const hostKeys = await generateKeyPairAsync(CONFIG.HTTPS.KEY_SIZE);

        const hostCert = pki.createCertificate();
        hostCert.publicKey = hostKeys.publicKey;
        hostCert.serialNumber = CA_TOOLS._getRandomSN();
        hostCert.validity.notBefore = new Date();
        hostCert.validity.notBefore.setDate(hostCert.validity.notBefore.getDate() - 1);
        hostCert.validity.notAfter = new Date();
        hostCert.validity.notAfter.setFullYear(hostCert.validity.notBefore.getFullYear() + 2);

        const hostAttrs = CONFIG.HTTPS.CERT_INFO.Hosts.attrs.slice(0);
        hostAttrs.unshift({name: 'commonName', value: mainHost});

        hostCert.setSubject(hostAttrs);
        hostCert.setIssuer(this.cert.issuer.attributes);
        hostCert.setExtensions(CONFIG.HTTPS.CERT_INFO.Hosts.extensions.concat([{
            name: 'subjectAltName',
            altNames: hosts.map(host => host.match(/^[\d.]+$/) ? {type: 7, ip: host} : {type: 2, value: host})
        }]));

        hostCert.sign(this.keys.privateKey);

        const fileName = mainHost.replace(/\*/g, '_');
        await CA_TOOLS._savePemFiles(fileName, hostCert, hostKeys);
        return { cert: hostCert, keys: hostKeys }
    }

    async getHostCertAndKeys(host) {
        if (CONFIG.HTTPS.CERT_CACHING && this.CACHE.hasOwnProperty(host))
            return this.CACHE.hasOwnProperty[host];

        const fileName = mainHost.replace(/\*/g, '_');
        const { cert, keys } = await this._loadPemFiles(fileName);
        this.CACHE[host] = { cert, keys };
        return { cert, keys };
    }
}

module.exports = CertTools;