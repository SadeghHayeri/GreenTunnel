FROM mhart/alpine-node:12
# Use this instead to build image for Raspberry Pi
# FROM balenalib/raspberry-pi-alpine-node

ENV PORT 8000
ENV HTTPS-ONLY false
ENV VERBOSE 'green-tunnel:*'
ENV SILENT false
ENV DNS_TYPE 'https'
ENV DNS_SERVER 'https://cloudflare-dns.com/dns-query'

WORKDIR /green-tunnel

COPY package*.json ./
RUN npm ci

COPY src ./src
COPY bin ./bin

EXPOSE 8000/tcp

CMD node ./bin/gt.js \
	--verbose $VERBOSE \
	--ip 0.0.0.0 \
	--port $PORT \
	--silent $SILENT \
	--system-proxy false \
	--dns-type $DNS_TYPE \
	--dns-server $DNS_SERVER
