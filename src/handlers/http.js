import {URL} from 'url';
import {isStartOfHTTPRequest} from '../http/utils';
import {createConnection} from '../utils/socket';
import HTTPRequest from '../http/request';
import getLogger from '../logger';

const {debug} = getLogger('http-handler');

export default async function handleHTTP(clientSocket, firstChunk, proxy) {
	const firstLine = firstChunk.toString().split('\r\n')[0];
	const url = new URL(firstLine.split(/\s+/)[1]);

	const host = url.hostname;
	const port = url.port || 80;

	// -- ServerSocket --

	const serverSocket = await createConnection({host, port}, proxy.dns);

	serverSocket.write(interceptRequest(firstChunk));

	serverSocket.on('data', data => {
		clientSocket.write(data);
	});

	serverSocket.on('error', e => {
		clientSocket.end();
		debug('serverSocket error: ' + e);
	});

	serverSocket.on('end', () => {
		clientSocket.end();
	});

	// -- clientSocket --

	clientSocket.on('data', data => {
		serverSocket.write(interceptRequest(data));
	});

	clientSocket.on('end', () => {
		serverSocket.end();
	});

	clientSocket.resume();
}

function interceptRequest(data) {
	const srtData = data.toString();

	if (isStartOfHTTPRequest(srtData)) {
		const request = new HTTPRequest(srtData);
		request.path = new URL(request.path).pathname;
		delete request.headers['Proxy-Connection'];
		return request.toString();
	}

	return data;
}
