import util from 'util';
import os from 'os';
import {exec as _exec} from 'child_process';
import Registry from 'winreg';
import getLogger from '../logger';

const exec = util.promisify(_exec);
const {debug} = getLogger('system-proxy');

// Const fs = require('fs-extra');
// Const writeFile = util.promisify(fs.writeFile);
// const readFile = util.promisify(fs.readFile);

// TODO: Support for lan connections too
async function darwinSetProxy(ip, port) {
	const wifiAdaptor = (await exec(`sh -c "networksetup -listnetworkserviceorder | grep \`route -n get 0.0.0.0 | grep 'interface' | cut -d ':' -f2\` -B 1 | head -n 1 | cut -d ' ' -f2"`)).stdout.trim();

	await exec(`networksetup -setwebproxy '${wifiAdaptor}' ${ip} ${port}`);
	await exec(`networksetup -setsecurewebproxy '${wifiAdaptor}' ${ip} ${port}`);
}

async function darwinUnsetProxy() {
	const wifiAdaptor = (await exec(`sh -c "networksetup -listnetworkserviceorder | grep \`route -n get 0.0.0.0 | grep 'interface' | cut -d ':' -f2\` -B 1 | head -n 1 | cut -d ' ' -f2"`)).stdout.trim();

	await exec(`networksetup -setwebproxystate '${wifiAdaptor}' off`);
	await exec(`networksetup -setsecurewebproxystate '${wifiAdaptor}' off`);
}

// Async function linuxFindPATH(env) {
// 	for (const line of env.split('\n')) {
// 		if (line.match('PATH')) {
// 			return line;
// 		}
// 	}

// 	return '';
// }

async function linuxSetProxy(ip, port) {
	// Gnome proxy
	await exec('gsettings set org.gnome.system.proxy mode manual');
	await exec(`gsettings set org.gnome.system.proxy.http host ${ip}`);
	await exec(`gsettings set org.gnome.system.proxy.http port ${port}`);

	// // etc/environment
	// const env = await readFile('/etc/environment', 'utf8');
	// const PATH = await SystemProxyManager._linux_find_PATH(env);
	//
	// let newEnv = `${PATH}\n`;
	// newEnv += `http_proxy=${ip}:${port}\n`;
	// newEnv += `https_proxy=${ip}:${port}\n`;
	// newEnv += `no_proxy="localhost,127.0.0.1,localaddress,.localdomain.com"\n`
	// newEnv += `HTTP_PROXY=${ip}:${port}\n`;
	// newEnv += `HTTPS_PROXY=${ip}:${port}\n`;
	// newEnv += `NO_PROXY="localhost,127.0.0.1,localaddress,.localdomain.com"\n`;
	//
	// await writeFile('/etc/environment', newEnv);
}

async function linuxUnsetProxy() {
	// Gnome proxy
	await exec('gsettings set org.gnome.system.proxy mode none');

	// // etc/environment
	// const env = await readFile('/etc/environment', 'utf8');
	// const PATH = await SystemProxyManager._linux_find_PATH(env);
	//
	// let newEnv = `${PATH}\n`;
	// await writeFile('/etc/environment', newEnv);
}

async function winSetProxy(ip, port) {
	const regKey = new Registry({
		hive: Registry.HKEY_CURRENT_USER,
		key: '\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
	});

	regKey.set('MigrateProxy', Registry.REG_DWORD, 1, e => {
		debug(e);
	});
	regKey.set('ProxyEnable', Registry.REG_DWORD, 1, e => {
		debug(e);
	});
	regKey.set('ProxyHttp1.1', Registry.REG_DWORD, 0, e => {
		debug(e);
	});
	regKey.set('ProxyServer', Registry.REG_SZ, `${ip}:${port}`, e => {
		debug(e);
	});
	regKey.set('ProxyOverride', Registry.REG_SZ, '*.local;<local>', e => {
		debug(e);
	});
}

async function winUnsetProxy() {
	const regKey = new Registry({
		hive: Registry.HKEY_CURRENT_USER,
		key: '\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
	});

	regKey.set('ProxyEnable', Registry.REG_DWORD, 0, e => {
		debug(e);
	});
}

export async function setProxy(ip, port) {
	switch (os.platform()) {
		case 'darwin':
			await darwinSetProxy(ip, port);
			break;
		case 'linux':
			await linuxSetProxy(ip, port);
			break;
		case 'win32':
		case 'win64':
			await winSetProxy(ip, port);
			break;
		case 'unknown os':
		default:
			throw new Error(`UNKNOWN OS TYPE ${os.platform()}`);
	}
}

export async function unsetProxy() {
	switch (os.platform()) {
		case 'darwin':
			await darwinUnsetProxy();
			break;
		case 'linux':
			await linuxUnsetProxy();
			break;
		case 'win32':
		case 'win64':
			await winUnsetProxy();
			break;
		case 'unknown os':
		default:
			throw new Error(`UNKNOWN OS TYPE ${os.platform()}`);
	}
}
