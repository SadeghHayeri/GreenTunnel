const util = require('util');
var os = require('os');
const exec = util.promisify(require('child_process').exec);
const Registry = require('winreg');

class SystemProxyManager {
    static async _darwin_set_proxy(ip, port) {
        const wifiAdaptor = (await exec('networksetup -listallnetworkservices')).stdout.split('\n')[1];

        await exec(`networksetup -setwebproxy ${wifiAdaptor} ${ip} ${port}`);
        await exec(`networksetup -setsecurewebproxy ${wifiAdaptor} ${ip} ${port}`);
    }

    static async _darwin_unset_proxy() {
        const wifiAdaptor = (await exec('networksetup -listallnetworkservices')).stdout.split('\n')[1];

        await exec(`networksetup -setwebproxystate ${wifiAdaptor} off`);
        await exec(`networksetup -setsecurewebproxystate ${wifiAdaptor} off`);
    }

    static async _linux_set_proxy(ip, port) {}

    static async _linux_unset_proxy() {}

    static async _win_set_proxy(ip, port) {
        const regKey = new Registry({
            hive: Registry.HKEY_CURRENT_USER,
            key:  '\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
        });

        regKey.set('MigrateProxy', Registry.REG_DWORD, 1, (e) => {console.error(e)});
        regKey.set('ProxyEnable', Registry.REG_DWORD, 1, (e) => {console.error(e)});
        regKey.set('ProxyHttp1.1', Registry.REG_DWORD, 0, (e) => {console.error(e)});
        regKey.set('ProxyServer', Registry.REG_SZ, `${ip}:${port}`, (e) => {console.error(e)});
        regKey.set('ProxyOverride', Registry.REG_SZ, '*.local;<local>', (e) => {console.error(e)});
    }

    static async _win_unset_proxy() {
        const regKey = new Registry({
            hive: Registry.HKEY_CURRENT_USER,
            key:  '\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
        });

        regKey.set('ProxyEnable', Registry.REG_DWORD, 0, (e) => {console.error(e)});
    }

    static async set_proxy(ip, port) {
        switch (os.platform()) {
            case 'darwin':
                await SystemProxyManager._darwin_set_proxy(ip, port);
                break;
            case 'linux':
                await SystemProxyManager._linux_set_proxy(ip, port);
                break;
            case 'win32':
            case 'win64':
                await SystemProxyManager._win_set_proxy(ip, port);
                break;
            case 'unknown os':
            default:
                throw 'UNKNOWN OS TYPE ' + os.platform();
        }
    }

    static async unset_proxy() {
        switch (os.platform()) {
            case 'darwin':
                await SystemProxyManager._darwin_unset_proxy();
                break;
            case 'linux':
                await SystemProxyManager._linux_unset_proxy();
                break;
            case 'win32':
            case 'win64':
                await SystemProxyManager._win_unset_proxy();
                break;
            case 'unknown os':
            default:
                throw 'UNKNOWN OS TYPE ' + os.platform();
        }
    }
}

module.exports = SystemProxyManager;