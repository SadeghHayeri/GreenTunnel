import net from 'net';
import getLogger from '../logger';

const {debug} = getLogger('socket');

export async function createConnection(opts, dns) {
	const ip = await dns.lookup(opts.host);

	const t = new Date();
	return new Promise(resolve => {
		const socket = net.createConnection({...opts, host: ip}, () => {
			debug(`Connected to ${opts.host} (${ip}) (${new Date() - t} ms)`);
			resolve(socket);
		});
	});
}

export function tryWrite(socket, data, onError) {
	try {
		socket.write(data);
	} catch (error) {
		if (onError) {
			onError(error);
		}
	}
}

export function closeSocket(socket) {
	socket.removeAllListeners('data');
	socket.removeAllListeners('error');
	socket.end();
}
