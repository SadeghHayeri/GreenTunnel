import {parseRequest} from './utils';

export default class HTTPRequest {
	constructor(rawReq) {
		if (rawReq) {
			const packet = this._parseRequest(rawReq);
			this.method = packet.method;
			this.path = packet.path;
			this.httpVersion = packet.httpVersion;
			this.headers = packet.headers;
			this.payload = packet.payload;
		} else {
			this.method = 'GET';
			this.path = '/';
			this.httpVersion = 'HTTP/1.1';
			this.headers = {};
			this.payload = '';
		}
	}

	_parseRequest(rawReq) {
		const {firstLineParts, ...request} = parseRequest(rawReq);

		request.method = firstLineParts[0];
		request.path = firstLineParts[1];
		request.httpVersion = firstLineParts[2];

		return request;
	}

	toString() {
		let result = '';

		result += `${this.method} ${this.path} ${this.httpVersion}\r\n`;

		for (const header in this.headers) {
			result += `${header}: ${this.headers[header]}\r\n`;
		}

		result += '\r\n';
		result += this.payload;

		return result;
	}
}
