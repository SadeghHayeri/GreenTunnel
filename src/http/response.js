import {parseRequest} from './utils';

export default class HTTPResponse {
	constructor(rawReq) {
		if (rawReq) {
			const packet = this._parseRequest(rawReq);
			this.httpVersion = packet.httpVersion;
			this.statusCode = packet.statusCode;
			this.statusMessgae = packet.statusMessgae;
			this.headers = packet.headers;
			this.payload = packet.payload;
		} else {
			this.httpVersion = 'HTTP/1.1';
			this.statusCode = 200;
			this.statusMessgae = 'OK';
			this.headers = {};
			this.payload = '';
		}
	}

	_parseResponse(rawRes) {
		const {firstLineParts, ...request} = parseRequest(rawRes);

		request.httpVersion = firstLineParts[0];
		request.statusCode = firstLineParts[1];
		request.statusMessgae = firstLineParts[2];

		return request;
	}

	toString() {
		let result = '';

		result += `${this.httpVersion} ${this.statusCode} ${this.statusMessgae}\r\n`;

		for (const header in this.headers) {
			result += `${header}: ${this.headers[header]}\r\n`;
		}

		result += '\r\n';
		result += this.payload;

		return result;
	}
}
