import {isStartOfHTTPRequest, isConnectMethod} from '../http/utils';
import handleHTTP from './http';
import handleHTTPS from './https';

export default async function handleRequest(clientSocket, proxy) {
	clientSocket.resume();

	return new Promise((resolve, reject) => {
		clientSocket.once('data', async data => {
			try {
				clientSocket.pause();
				const strData = data.toString();

				if (isStartOfHTTPRequest(strData)) {
					if (isConnectMethod(strData)) {
						await handleHTTPS(clientSocket, data, proxy);
					} else if (proxy.config.httpsOnly) {
						throw new Error('Insecure request blocked: ', strData);
					} else {
						await handleHTTP(clientSocket, data, proxy);
					}
				} else {
					throw new Error('Unsupported request: ', strData);
				}

				resolve();
			} catch (error) {
				reject(error);
			}
		});
	});
}
