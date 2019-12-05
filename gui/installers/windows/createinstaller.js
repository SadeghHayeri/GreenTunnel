const createWindowsInstaller = require('electron-winstaller').createWindowsInstaller;
const path = require('path');

getInstallerConfig()
    .then(createWindowsInstaller)
    .catch((error) => {
        console.debug(error.message || error);
        process.exit(1)
    });

function getInstallerConfig () {
    console.log('creating windows installer');
    const rootPath = path.join('./');
    const outPath = path.join(rootPath, 'release-builds');

    return Promise.resolve({
        appDirectory: path.join(outPath, 'green-tunnel-win32-ia32'),
        authors: 'Sadegh Hayeri',
        noMsi: true,
        outputDirectory: path.join(outPath, 'green-tunnel/windows-installer'),
        exe: 'green-tunnel.exe',
        setupExe: 'green-tunnel-installer.exe',
        setupIcon: path.join(rootPath, 'icons', 'win', 'icon.ico')
    })
}