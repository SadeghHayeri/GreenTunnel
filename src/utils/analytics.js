import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import packageJson from '../../package.json' with { type: 'json' };

const MEASUREMENT_ID = 'G-D1R7M2YZ8Q';

// Get this from: GA4 Admin → Data Streams → select stream → Measurement Protocol API secrets → Create
const API_SECRET = 'Y_lvWjBxSG2-k5UYBJQQ7Q';

const CONFIG_DIR = join(homedir(), '.config', 'greentunnel');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

function getClientId() {
	try {
		mkdirSync(CONFIG_DIR, {recursive: true});
		let config = {};
		if (existsSync(CONFIG_FILE)) {
			config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
		}

		if (!config.clientId) {
			config.clientId = randomUUID();
			writeFileSync(CONFIG_FILE, JSON.stringify(config));
		}

		return config.clientId;
	} catch {
		return randomUUID();
	}
}

async function sendEvent(name, params = {}) {
	if (!API_SECRET) return;

	try {
		await fetch(
			`https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`,
			{
				method: 'POST',
				body: JSON.stringify({
					client_id: getClientId(),
					events: [{name, params}],
				}),
			},
		);
	} catch {
		// Analytics failures must never crash the app
	}
}

export function appInit(source = 'OTHER') {
	sendEvent('app_init', {
		source,
		version: packageJson.version,
		platform: process.platform,
	});
}
