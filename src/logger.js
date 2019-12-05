import debug from 'debug';

export default function getLogger(name) {
	return {
		debug: debug(`green-tunnel:${name}`),
		success: debug(`green-tunnel:${name}:success`),
		error: debug(`green-tunnel:${name}:error`),
	}
}

debug.enable('green-tunnel:proxy:error');
