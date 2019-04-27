import {URL} from 'url';
import {bufferToChunks} from '../utils/buffer';
import {createConnection, closeSocket, tryWrite} from '../utils/socket';
import HTTPResponse from '../http/response';

export default async function handleHTTPS(clientSocket, firstChunk, proxy) {
	const firstLine = firstChunk.toString().split('\r\n')[0];
	const url = new URL(`https://${firstLine.split(/\s+/)[1]}`);

	const host = url.hostname;
	const port = url.port || 443;

	// -- ServerSocket --

	const serverSocket = await createConnection({host, port}, proxy.dns);

	const close = () => {
		closeSocket(clientSocket);
		closeSocket(serverSocket);
	};

	serverSocket.on('data', data => {
		tryWrite(clientSocket, data, close);
	});

	serverSocket.on('end', () => {
		close();
	});

	serverSocket.on('error', error => {
		close(error);
	});

	// -- clientSocket --

	clientSocket.once('data', clientHello => {
		const chunks = bufferToChunks(clientHello, proxy.config.proxy.clientHelloMTU);
		for (const chunk of chunks) {
			tryWrite(serverSocket, chunk, close);
		}

		clientSocket.on('data', data => {
			tryWrite(serverSocket, data, close);
		});
	});

	clientSocket.on('end', () => {
		close();
	});

	clientSocket.on('error', error => {
		close(error);
	});

	tryWrite(clientSocket, getConnectionEstablishedPacket(), close);

	clientSocket.resume();
}

function getConnectionEstablishedPacket() {
	const packet = new HTTPResponse();
	packet.statusCode = 200;
	packet.statusMessgae = 'Connection Established';
	return packet.toString();
}

