import util from 'util';
import os from 'os';
import path from 'path';
import {exec as _exec, spawn} from 'child_process';
import Registry from 'winreg';
import getLogger from '../logger';

const logger = getLogger('system-proxy');
const exec = util.promisify(_exec);

class SystemProxy {
	static async setProxy(ip, port) {
		throw new Error('You have to implement the method setProxy!');
	}
	static async unsetProxy() {
		throw new Error('You have to implement the method unsetProxy!');
	}
}

// TODO: Add path http_proxy and https_proxy
// TODO: Support for non-gnome
class LinuxSystemProxy extends SystemProxy {
	static async setProxy(ip, port) {
		await exec('gsettings set org.gnome.system.proxy mode manual');
		await exec(`gsettings set org.gnome.system.proxy.http host ${ip}`);
		await exec(`gsettings set org.gnome.system.proxy.http port ${port}`);
		await exec(`gsettings set org.gnome.system.proxy.https host ${ip}`);
		await exec(`gsettings set org.gnome.system.proxy.https port ${port}`);
	}

	static async unsetProxy() {
		await exec('gsettings set org.gnome.system.proxy mode none');
	}
}

// TODO: Support for lan connections too
// TODO: move scripts to ../scripts/darwin
class DarwinSystemProxy extends SystemProxy {
	static async setProxy(ip, port) {
		const wifiAdaptor = (await exec(`sh -c "networksetup -listnetworkserviceorder | grep \`route -n get 0.0.0.0 | grep 'interface' | cut -d ':' -f2\` -B 1 | head -n 1 | cut -d ' ' -f2"`)).stdout.trim();

		await exec(`networksetup -setwebproxy '${wifiAdaptor}' ${ip} ${port}`);
		await exec(`networksetup -setsecurewebproxy '${wifiAdaptor}' ${ip} ${port}`);
	}

	static async unsetProxy() {
		const wifiAdaptor = (await exec(`sh -c "networksetup -listnetworkserviceorder | grep \`route -n get 0.0.0.0 | grep 'interface' | cut -d ':' -f2\` -B 1 | head -n 1 | cut -d ' ' -f2"`)).stdout.trim();

		await exec(`networksetup -setwebproxystate '${wifiAdaptor}' off`);
		await exec(`networksetup -setsecurewebproxystate '${wifiAdaptor}' off`);
	}
}


class WindowsSystemProxy extends SystemProxy{
	static async setProxy(ip, port) {
		const regKey = new Registry({
			hive: Registry.HKCU,
			key: '\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
		});

		await Promise.all([
			WindowsSystemProxy._asyncRegSet(regKey, 'MigrateProxy', Registry.REG_DWORD, 1),
			WindowsSystemProxy._asyncRegSet(regKey, 'ProxyEnable', Registry.REG_DWORD, 1),
			WindowsSystemProxy._asyncRegSet(regKey, 'ProxyHttp1.1', Registry.REG_DWORD, 0),
			WindowsSystemProxy._asyncRegSet(regKey, 'ProxyServer', Registry.REG_SZ, `${ip}:${port}`),
			WindowsSystemProxy._asyncRegSet(regKey, 'ProxyOverride', Registry.REG_SZ, '*.local;<local>'),
		]);
		await WindowsSystemProxy._resetWininetProxySettings();
	}

	static async unsetProxy() {
		const regKey = new Registry({
			hive: Registry.HKCU,
			key: '\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
		});

		await Promise.all([
			WindowsSystemProxy._asyncRegSet(regKey, 'ProxyEnable', Registry.REG_DWORD, 0),
			WindowsSystemProxy._asyncRegSet(regKey, 'ProxyServer', Registry.REG_SZ, ``),
		]);
		await WindowsSystemProxy._resetWininetProxySettings();
	}

	static _asyncRegSet(regKey, name, type, value) {
		return new Promise((resolve, reject) => {
			regKey.set(name, type, value, e => {
				if (e) {
					reject(e);
				} else {
					resolve();
				}
			})
		});
	}

	static _resetWininetProxySettings() {
		return new Promise((resolve, reject) => {
			const scriptPath = path.join(__dirname, '..', 'scripts', 'windows', 'wininet-reset-settings.ps1');
			const child = spawn("powershell.exe", [scriptPath]);
			child.stdout.setEncoding('utf8');
			child.stdout.on("data", (data) => {
				if (data.includes('True')) {
					resolve();
				} else {
					reject(data);
				}
			});

			child.stderr.on("data", (err) => {
				reject(err);
			});

			child.stdin.end();
		});
	}
}

function getSystemProxy() {
	switch (os.platform()) {
		case 'darwin':
			return DarwinSystemProxy;
		case 'linux':
			return LinuxSystemProxy;
		case 'win32':
		case 'win64':
			return WindowsSystemProxy;
		case 'unknown os':
		default:
			throw new Error(`UNKNOWN OS TYPE ${os.platform()}`);
	}
}

export async function setProxy(ip, port) {
	try {
		const systemProxy = getSystemProxy();
		await systemProxy.setProxy(ip, port);
	} catch (error) {
		logger.debug(`[SYSTEM PROXY] error on SetProxy (${error})`)
	}
}

export async function unsetProxy() {
	try {
		const systemProxy = getSystemProxy();
		await systemProxy.unsetProxy();
	} catch (error) {
		logger.debug(`[SYSTEM PROXY] error on UnsetProxy (${error})`)
	}
}
