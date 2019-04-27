import {URL} from 'url';
import {bufferToChunks} from '../utils/buffer';
import {createConnection} from '../utils/socket';
import HTTPResponse from '../http/response';
import getLogger from '../logger';

const {debug} = getLogger('https-handler');

export default async function handleHTTPS(clientSocket, firstChunk, proxy) {
	const firstLine = firstChunk.toString().split('\r\n')[0];
	const url = new URL(`https://${firstLine.split(/\s+/)[1]}`);

	const host = url.hostname;
	const port = url.port || 443;

	// -- ServerSocket --

	const serverSocket = await createConnection({host, port}, proxy.dns);

	serverSocket.on('data', data => {
		sendDataByCatch(clientSocket, data, serverSocket);
	});

	serverSocket.on('end', () => {
		clientSocket.end();
	});

	serverSocket.on('error', e => {
		debug('serverSocket error: ' + e);
	});

	// -- clientSocket --

	clientSocket.once('data', clientHello => {
		const chunks = bufferToChunks(clientHello, proxy.config.proxy.clientHelloMTU);
		for (const chunk of chunks) {
			sendDataByCatch(serverSocket, chunk, clientSocket);
		}

		clientSocket.on('data', data => {
			sendDataByCatch(serverSocket, data, clientSocket);
		});
	});

	clientSocket.on('end', () => {
		serverSocket.end();
	});

	clientSocket.on('error', e => {
		debug('clientSocket error: ' + e);
	});

	sendDataByCatch(clientSocket, getConnectionEstablishedPacket().toString(), serverSocket);
	clientSocket.resume();
}

function getConnectionEstablishedPacket() {
	const packet = new HTTPResponse();
	packet.statusCode = 200;
	packet.statusMessgae = 'Connection Established';
	return packet;
}

function sendDataByCatch(socket, data, pairSocket = null) {
	try {
		socket.write(data);
	} catch (e) {
		debug('send error:' + e);
		if (pairSocket) {
			pairSocket.end();
		}
	}
}
