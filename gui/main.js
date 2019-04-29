const { app, BrowserWindow, Menu, Tray, shell, ipcMain, nativeImage } = require('electron');
const windowStateKeeper = require('electron-window-state');
const debug = /--debug/.test(process.argv[2]);
const { Proxy } = require('green-tunnel');
const path = require('path');

// if (require('electron-squirrel-startup')) return;
const setupEvents = require('./installers/windows/setupEvents');

if (setupEvents.handleSquirrelEvent()) {
    return;
}

let win, tray, proxy;
let isOn = false;

const menuItems = [
    {
        label: 'Turn Off',
        type: 'normal',
        click: () => turnOff(),
    },
    {
        label: 'Run At Login',
        type: 'checkbox',
    },
    {
        type: 'separator',
    },
    {
        label: 'Source Code',
        type: 'normal',
        click: () => shell.openExternal('https://github.com/SadeghHayeri/GreenTunnel'),
    },
    {
        label: 'Donate',
        type: 'normal',
        click: () => shell.openExternal('https://github.com/SadeghHayeri/GreenTunnel#donation'),
    },
    {
        role: 'quit',
        label: 'Quit',
        type: 'normal',
    },
];

async function turnOff() {
    isOn = false;

    if (proxy) {
        await proxy.stop();
        proxy = null
    }

    win.webContents.send('changeStatus', isOn);

    menuItems[0].label = 'Enable';
    menuItems[0].click = () => turnOn();
    tray.setContextMenu(Menu.buildFromTemplate(menuItems));

    const iconPath = path.join(__dirname, 'images/iconDisabledTemplate.png');
    const trayIcon = nativeImage.createFromPath(iconPath);
    tray.setImage(trayIcon);
}

async function turnOn() {
    isOn = true;

    if (proxy) {
        await turnOff()
    }

    proxy = new Proxy();
    await proxy.start();

    win.webContents.send('changeStatus', isOn);

    menuItems[0].label = 'Disable';
    menuItems[0].click = () => turnOff();
    tray.setContextMenu(Menu.buildFromTemplate(menuItems));

    const iconPath = path.join(__dirname, 'images/iconTemplate.png');
    const trayIcon = nativeImage.createFromPath(iconPath);
    tray.setImage(trayIcon);
}

function createWindow() {
    const iconPath = path.join(__dirname, 'icons/icon.icns');
    const appIcon = nativeImage.createFromPath(iconPath);

    const stateManager = windowStateKeeper();

    win = new BrowserWindow({
        width: 300,
        height: 300,
        x: stateManager.x,
        y: stateManager.y,
        maximizable: debug,
        minimizable: debug,
        fullscreenable: debug,
        resizable: debug,
        icon: appIcon,
        show: false,

        title: 'Green Tunnel',
        frame: false,
        transparent: true,
        webPreferences: {
            nodeIntegration: true,
        }
    });

    // save states
    stateManager.manage(win);

    win.loadFile('./view/main-page/index.html');

    win.on('ready-to-show', function() {
        win.show();
        win.focus();
        turnOn();
    });

    win.on('closed', () => {
        win = null
    });

    if(debug)
        win.webContents.openDevTools()
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
});

app.on('activate', () => {
    if (win === null) {
        createWindow()
    }
});

app.on('ready', () => {
    createWindow();
    const iconPath = path.join(__dirname, 'images/iconTemplate.png');
    const trayIcon = nativeImage.createFromPath(iconPath);
    tray = new Tray(trayIcon);
    tray.setIgnoreDoubleClickEvents(true);
    tray.setToolTip('Green Tunnel');
    tray.setContextMenu(Menu.buildFromTemplate(menuItems));
});

app.on('before-quit', async (e) => {
    if(isOn) {
        e.preventDefault();
        await turnOff();
        app.quit();
    }
});

ipcMain.on('close-button', (event, arg) => {
    app.hide();
});

ipcMain.on('on-off-button', (event, arg) => {
    if(isOn)
        turnOff();
    else
        turnOn();
});