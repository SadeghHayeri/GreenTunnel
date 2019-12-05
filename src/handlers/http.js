import {URL} from 'url';
import {isStartOfHTTPRequest} from '../http/utils';
import {createConnection, closeSocket, tryWrite} from '../utils/socket';
import HTTPRequest from '../http/request';
import getLogger from '../logger';

const logger = getLogger('https-handler');

export default async function handleHTTP(clientSocket, firstChunk, proxy) {
	const firstLine = firstChunk.toString().split('\r\n')[0];
	const url = new URL(firstLine.split(/\s+/)[1]);

	const host = url.hostname;
	const port = url.port || 80;

	logger.debug(`[HTTP REQUEST] ${url.host}`);

	// -- ServerSocket --

	const serverSocket = await createConnection({host, port}, proxy.dns);

	const close = () => {
		closeSocket(clientSocket);
		closeSocket(serverSocket);
	};

	tryWrite(serverSocket, interceptRequest(firstChunk), close);

	serverSocket.on('data', data => {
		tryWrite(clientSocket, data, close);
	});

	serverSocket.on('error', error => {
		close(error);
	});

	serverSocket.on('end', () => {
		close();
	});

	// -- clientSocket --

	clientSocket.on('data', data => {
		tryWrite(serverSocket, interceptRequest(data), close);
	});

	clientSocket.on('end', () => {
		close();
	});

	clientSocket.resume();
}

function interceptRequest(data) {
	const strData = data.toString();

	if (isStartOfHTTPRequest(strData)) {
		const request = new HTTPRequest(strData);
		request.path = new URL(request.path).pathname;
		delete request.headers['Proxy-Connection'];
		return request.toString();
	}

	return data;
}
