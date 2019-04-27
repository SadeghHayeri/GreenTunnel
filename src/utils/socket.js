import net from 'net';
import getLogger from '../logger';

const {debug} = getLogger('socket');

export async function createConnection(opts, dns) {
	const ip = await dns.lookup(opts.host);

	const t = new Date();
	return new Promise(resolve => {
		const socket = net.createConnection({...opts, host: ip}, () => {
			debug(`Connected to ${opts.host} (${new Date() - t} ms)`);
			resolve(socket);
		});
	});
}
