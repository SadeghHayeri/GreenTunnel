'use strict';

const { HTTP } = require('./http-parser');
const dnstls = require('dns-over-tls');
const doh = require('dns-over-http');
const CONFIG = require('./config');
const { promisify } = require('util');
const validator = require('validator');

const dohQueryAsync = promisify(doh.query);


function isStartOfHTTPPacket(rawInput) {

    // valid methods (for http request)
    const firstWord = rawInput.split(/\s+/)[0];
    if(HTTP.validMethods.includes(firstWord.toUpperCase()))
        return true;

    // like HTTP/1.1 (For http response)
    const httpWord = firstWord.split('/')[0];
    if(httpWord.toLowerCase() === 'http')
        return true;

    return false;
}

function chunks(buffer, chunkSize) {
    var result = [];
    var len = buffer.length;
    var i = 0;

    while (i < len)
        result.push(buffer.slice(i, i += chunkSize));

    return result;
}

const DNS_CACHE = {};

async function dnsOverTLSAsync(hostname) {

    if(DNS_CACHE.hasOwnProperty(hostname))
        return DNS_CACHE[hostname];

    const query = await dnstls.query(hostname);
    for(let id in query.answers) {
        const answer = query.answers[id];
        if (answer.type === 'A' && answer.class === 'IN') {
            DNS_CACHE[hostname] = answer.data;
            return answer.data;
        }
    }
}


async function dnsOverHTTPSAsync(hostname) {

    if(DNS_CACHE.hasOwnProperty(hostname)) {
        if(validator.isIP(DNS_CACHE[hostname]))
            return DNS_CACHE[hostname];
        else
            return await dnsOverHTTPSAsync(DNS_CACHE[hostname]);
    }

    try {
        const result = await dohQueryAsync({url: CONFIG.DNS.DNS_OVER_HTTPS_URL}, [{type: 'A', name: hostname}]);
        for (let ans of result.answers)
            DNS_CACHE[ans.name] = ans.data;

        const answer = result.answers[0].data;

        if(validator.isIP(answer))
            return answer;
        else
            return await dnsOverHTTPSAsync(answer);
    }
    catch (e) {
        throw 'DNS RECORD NOT FOUND ' + hostname;
    }
}

function dnsLookup(dnsType, dnsServer) {
    return (hostname, options, callback) => {
        if(CONFIG.DNS.TYPE === 'DNS_OVER_HTTPS') {
            dnsOverHTTPSAsync(hostname)
                .then((data) => {
                    callback(null, data, 4)
                })
        } else {
            dnsOverTLSAsync(hostname)
                .then((data) => {
                    callback(null, data, 4)
                });
        }
    }
}

module.exports = { isStartOfHTTPPacket, chunks, dnsLookup};