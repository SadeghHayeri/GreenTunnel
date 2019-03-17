class HTTP {
    static parseHeaders(headerLines) {
        const headers = {};
        headerLines.forEach((line) => {
            const lineParts = line.split(/ *: */);
            headers[lineParts[0]] = lineParts[1];
        });
        return headers
    }

    static baseParser(rawInput) {
        const mainParts = rawInput.split('\r\n\r\n');
        const headersPart = mainParts[0];
        const payload = mainParts[1];

        const headerLines = headersPart.split('\r\n');
        const firsLine = headerLines.shift();

        const firstLineParts = firsLine.split(/\s+/);
        const headers = HTTP.parseHeaders(headerLines);

        return {
            firstLineParts,
            headers,
            payload
        }
    }
}

class HTTPRequest extends HTTP {

    constructor(rawPacket=null) {
        super();

        if(rawPacket) {
            const packet = HTTPRequest.parseRequest(rawPacket);
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

    toString() {
        let result = "";
        result += `${this.method} ${this.path} ${this.httpVersion}\r\n`;
        for (const header in this.headers)
            result += `${header}: ${this.headers[header]}\r\n`;
        result += '\r\n';
        result += this.payload;
        return result;
    }

    static parseRequest(rawReq) {
        const mainParts = HTTP.baseParser(rawReq);

        mainParts.method = mainParts.firstLineParts[0];
        mainParts.path = mainParts.firstLineParts[1];
        mainParts.httpVersion = mainParts.firstLineParts[2];

        delete mainParts.firstLineParts;
        return mainParts;
    }
}

class HTTPResponse extends HTTP {

    constructor(rawPacket=null) {
        super();

        if(rawPacket) {
            const packet = HTTPRequest.parseRequest(rawPacket);
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

    toString() {
        let result = "";
        result += `${this.httpVersion} ${this.statusCode} ${this.statusMessgae}\r\n`;
        for (const header in this.headers)
            result += `${header}: ${this.headers[header]}\r\n`;
        result += '\r\n';
        result += this.payload;
        return result;
    }

    static parseResponse(rawRes) {
        const mainParts = HTTP.baseParser(rawRes);

        mainParts.httpVersion = mainParts.firstLineParts[0];
        mainParts.statusCode = mainParts.firstLineParts[1];
        mainParts.statusMessgae = mainParts.firstLineParts[2];

        delete mainParts.firstLineParts;
        return mainParts;
    }
}


HTTP.validMethods = [
    'DELETE',
    'GET',
    'HEAD',
    'POST',
    'PUT',
    'CONNECT',
    'OPTIONS',
    'TRACE',
    'COPY',
    'LOCK',
    'MKCOL',
    'MOVE',
    'PROPFIND',
    'PROPPATCH',
    'SEARCH',
    'UNLOCK',
    'BIND',
    'REBIND',
    'UNBIND',
    'ACL',
    'REPORT',
    'MKACTIVITY',
    'CHECKOUT',
    'MERGE',
    'M-SEARCH',
    'NOTIFY',
    'SUBSCRIBE',
    'UNSUBSCRIBE',
    'PATCH',
    'PURGE',
    'MKCALENDAR',
    'LINK',
    'UNLINK'
];

module.exports = { HTTP, HTTPRequest, HTTPResponse };