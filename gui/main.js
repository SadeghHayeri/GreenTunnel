const { app, BrowserWindow, Menu, Tray, shell, ipcMain } = require('electron');
const debug = /--debug/.test(process.argv[2]);

let win, tray;
let isOn = true;

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
    },
    {
        role: 'quit',
        label: 'Quit',
        type: 'normal',
    },
];

function turnOff() {
    isOn = false;

    menuItems[0].label = 'Enable';
    menuItems[0].click = () => turnOn();
    tray.setContextMenu(Menu.buildFromTemplate(menuItems));

    tray.setImage('./images/iconDisabledTemplate.png');
    win.webContents.send('changeStatus', isOn);
}

function turnOn() {
    isOn = true;

    menuItems[0].label = 'Disable';
    menuItems[0].click = () => turnOff();
    tray.setContextMenu(Menu.buildFromTemplate(menuItems));

    tray.setImage('./images/iconTemplate.png');
    win.webContents.send('changeStatus', isOn);
}

function createWindow () {
    win = new BrowserWindow({
        width: 300,
        height: 300,
        maximizable: debug,
        minimizable: debug,
        fullscreenable: debug,
        resizable: debug,
        icon: './icons/icon.icns',

        title: 'Green Tunnel',
        frame: false,
        transparent: true,
        webPreferences: {
            nodeIntegration: true,
        }
    });
    win.loadFile('./view/main-page/index.html');

    win.on('closed', () => {
        win = null
    });

    if(debug)
        win.webContents.openDevTools()
}

app.on('ready', createWindow);

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
    tray = new Tray('./images/iconTemplate.png');
    tray.setIgnoreDoubleClickEvents(true);
    tray.setToolTip('Green Tunnel');
    tray.setContextMenu(Menu.buildFromTemplate(menuItems));
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