const { app, BrowserWindow, Menu, Tray, shell, ipcMain } = require('electron');
const debug = /--debug/.test(process.argv[2]);

let win, tray;

console.log('hi!');

ipcMain.on('close-button', (event, arg) => {
    app.hide();
});

let x = true;
ipcMain.on('on-off-button', (event, arg) => {
    event.sender.send('changeStatus', x);
    x = !x;
});

// win.webContents.send('ping', 'whoooooooh!');

function createWindow () {
    win = new BrowserWindow({
        width: 300,
        height: 300,
        maximizable: debug,
        minimizable: debug,
        fullscreenable: debug,
        resizable: debug,

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
    const menuItems = [
        {
            label: 'Turn Off',
            type: 'normal',
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
    tray.setContextMenu(Menu.buildFromTemplate(menuItems));


    // menuItems[0].label = 'Disable';
    // tray.setContextMenu(Menu.buildFromTemplate(menuItems));
});