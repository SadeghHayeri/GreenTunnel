import dnsSocket from 'dns-socket';
import BaseDNS from './base';

const socket = dnsSocket()

export default class DNSUnencrypted extends BaseDNS {
  constructor(dnsIp, dnsPort) {
    super();
    this.dnsIp = dnsIp;
    this.dnsPort = dnsPort;
  }

  _lookup(hostname) {
    return new Promise((resolve, reject) => {
      socket.query({
        questions: [{
          type: 'A',
          name: hostname
        }]
      }, this.dnsPort, this.dnsIp, (err, res, query) => {
        resolve(res.answers[0].data);
      });
    });
  }
}