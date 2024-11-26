const { app, BrowserWindow, ipcMain } = require('electron');
const si = require('systeminformation');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const {attach, dettach, refresh} = require('electron-as-wallpaper');

const serverURL = "http://18.230.251.159:3000";
const appdataPath = path.join(process.env.APPDATA, 'DesktopFish');
const localFishPath = path.join(process.env.APPDATA, 'DesktopFish', 'LocalFish');

let mainWindow;
let fishWindow;
let clientInfo;
let bIsLaunching = false;
let lastSliderValue;

app.whenReady().then(()=> {
    if (!app.requestSingleInstanceLock()) {
        app.quit();
        return;
    }
})

app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

app.on('ready', () => {
    Init(); //TODO try catch this mf
});

app.setLoginItemSettings({
    openAtLogin: true, // Set to true to enable auto-launch
    openAsHidden: false, // Optional: set to true to run the app in the background without showing the main window
    path: app.getPath("exe"),
});

async function Init() {

    
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
        },
    });
    
    mainWindow.loadFile('pages/loading.html');
    mainWindow.removeMenu();

    mainWindow.on('close', (event) => {
        if (!fishWindow) {
            app.quit();
            return;
        } else {
            event.preventDefault();  // Impede que a janela seja fechada
            mainWindow.hide();
        }     // Esconde a janela
    });

    //mainWindow.webContents.openDevTools(); //TODO remove
    mainWindow.webContents.send('update-current-task', 'Initializing...'); await sleep(1000);
    
    if (!fs.existsSync(localFishPath)) {
        fs.mkdirSync(localFishPath, {recursive: true});
    }
    if (!fs.existsSync(path.join(localFishPath, 'version.txt'))) {
        fs.writeFileSync(path.join(localFishPath, 'version.txt'), '0');
    }
    fs.copyFileSync(path.join(__dirname, 'pages', 'fish.html'), path.join(localFishPath, 'index.html'));
    if (!fs.existsSync(path.join(localFishPath, 'configs.txt'))) {
        fs.writeFileSync(path.join(localFishPath, 'configs.txt'), "1");
    }

    try {
        if (await Login()) {
            await Update();
            mainWindow.webContents.send('update-current-task', `Iniciando FishApp...`); await sleep(3000);
            await Launch();
            
            const homeFilePath = path.join(__dirname, 'pages', 'home.html');
            mainWindow.loadFile(homeFilePath);
        } else {
            await Buy();
        }
    } catch (err) {
        try {
            mainWindow.webContents.send('update-current-task', `Failed to connect...`); await sleep(1500);
            mainWindow.webContents.send('update-current-task', `Initializing local version...`); await sleep(1500);
            mainWindow.webContents.send('update-current-task', `Iniciando FishApp...`); await sleep(3000);
            await Launch();
            
            const homeFilePath = path.join(__dirname, 'pages', 'home.html');
            mainWindow.loadFile(homeFilePath);
        } catch (err2) {
            ErrorPage(err);
        }
    }
}

async function GetClientInfo() {
    if (!clientInfo) {
        mainWindow.webContents.send('update-current-task', `Getting client info...`); await sleep(1000);

        clientInfo = (await si.uuid())?.hardware;
        if (!clientInfo) { // TODO, check for specifics inside systeminfo
            throw(new Error("Could not get system info!"));
        }
    }

    return clientInfo;
}

async function Login() {
    let info = await GetClientInfo();

    console.log(info);

    mainWindow.webContents.send('update-current-task', `Connecting to server...`); await sleep(1000);
    try {
        await axios.get(serverURL + '/login', {params: {'id': info}});
        return true;
    } catch(error) {
        if (!error.response) {
            throw("Server está offline...");
        }
        return false;
    }
}

async function Update() {
    let info = await GetClientInfo();

    try {
        mainWindow.webContents.send('update-current-task', `Comparing versions...`); await sleep(1000);
        const versionResponse = await axios.get(serverURL + '/version', {params: {'id': info}});
        let localVersion = await GetLocalVersion(); //TODO instead of getting the saved version number, make a hash with the existing file and compare to server's hash
        let serverVersion = versionResponse.data;

        console.log("Local version: ", localVersion);
        console.log("Server version: ", serverVersion);

        if (localVersion != serverVersion) { // TODO remove true, was only for testing
            mainWindow.webContents.send('update-current-task', `Updating fishApp...`); await sleep(1000);

            const response = await axios.get(serverURL + '/send-js', { params: {'id': info}, responseType: 'arraybuffer' });
            const filePath = path.join(localFishPath, 'defaultFishApp.js');
            
            // Salva o arquivo .zip no disco
            fs.writeFileSync(filePath, response.data);
            console.log('Arquivo .js baixado com sucesso!', filePath);

            // Salva a versao nova
            fs.writeFileSync(path.join(localFishPath, 'version.txt'), String(serverVersion));
        } else {
            mainWindow.webContents.send('update-current-task', `Already updated...`); await sleep(1000);
        }

    } catch (error) {
        console.error('Falha ao baixar o arquivo .js:', error);

        return false;
    }

    return true;
}

async function GetLocalVersion() {
    return fs.readFileSync(path.join(localFishPath, 'version.txt'), 'utf8');
}

async function Launch() {
    await SetFishVariables();

    fishWindow = new BrowserWindow({
        width: 800,
        height: 600,
        fullscreen: true,
        frame: false,
        transparent: true,
        webPreferences: {
            nodeIntegration: false,
            preload: null,
            contextIsolation: false,
            sandbox: false,
        }
    });

    if (!fs.existsSync(path.join(localFishPath, 'defaultFishApp.js')))
        throw("No local fish!");

    fishWindow.loadFile(path.join(localFishPath, 'index.html'));
    fishWindow.setIgnoreMouseEvents(true, { forward: true });

    fishWindow.on('close', (event) => {
        if (!mainWindow) {
            app.quit();
            return;
        }
    });

    attach(fishWindow, {
        transparent: true,
    });
}

async function SetFishVariables() {
    let fishQtd = fs.readFileSync(path.join(localFishPath, 'configs.txt'), 'utf8');

    let fileContent = fs.readFileSync(path.join(localFishPath, 'defaultFishApp.js'), 'utf8');
    fileContent = fileContent.replace("$$$qtd", fishQtd);
    fs.writeFileSync(path.join(localFishPath, 'fishApp.js'), fileContent, 'utf8');
}

let onCheckbox = true;
ipcMain.on('checkbox-toggled', async (event, { label, isChecked }) => { // Uncheck start on startup
    console.log(`Checkbox "${label}" foi ${isChecked ? 'marcado' : 'desmarcado'}.`);
    // Lógica adicional aqui

    if (label == 'Ligado') {
        onCheckbox = isChecked;
        if (isChecked) {
            if (!bIsLaunching) {
                bIsLaunching = true;
                await Launch();
                bIsLaunching = false;
            }
        } else {
            if (!bIsLaunching && fishWindow) {
                fishWindow.close();
                fishWindow = null;
            }
        }
    } else if (label == 'Iniciar no startup') {
        app.setLoginItemSettings({
            openAtLogin: isChecked, // Set to true to enable auto-launch
            openAsHidden: false, // Optional: set to true to run the app in the background without showing the main window
            path: app.getPath("exe"),
        });
    }
});

ipcMain.on('slider-changed', async (event, { value }) => {
console.log(`Slider alterado para o valor: ${value}`);
    if (!bIsLaunching) {
    lastSliderValue = value;
        if (fishWindow) {
            fishWindow.close();
            fishWindow = null;
        }

        fs.writeFileSync(path.join(localFishPath, 'configs.txt'), String(value));
        await sleep(1000);

        if (lastSliderValue == value && onCheckbox) {
            Launch();
        }
    }
});

async function Buy() {
    mainWindow.webContents.send('update-current-task', `Generating QRCode...`); await sleep(1000);
    
    let info = await GetClientInfo();
    const response = await axios.get(serverURL + '/qrcode', {params: {'id': info}});

    mainWindow.loadFile(path.join(__dirname, 'pages', 'qrcode.html'));
    mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('update-qrcode', response.data.qrCodeImageUrl);
    });

    checkQrCodeStatus(info);
}

async function checkQrCodeStatus(userId) {
    const interval = 7000; // Intervalo de 10 segundos

    const intervalId = setInterval(async () => {
        try {
            const statusResponse = await axios.get(serverURL + '/last-qrcode-status', {
                params: { id: userId }
            });

            if (statusResponse.status === 200) {
                console.log('QR Code payment validated. Stopping checks.');
                clearInterval(intervalId); // Para o intervalo
                mainWindow.loadFile(path.join(__dirname, 'pages', 'loading.html'));
                mainWindow.webContents.once('did-finish-load', async () => {
                    await sleep(1000);
                    await Update();
                    Launch();
                });
            }
        } catch (error) {
            if (error.response && error.response.status === 403) {
                console.log('QR Code payment not yet validated. Retrying...');
            } else {
                console.error('Error checking QR Code status:', error);
                clearInterval(intervalId); // Para o intervalo se houver erro inesperado
            }
        }
    }, interval);
}

async function ErrorPage(err) {
    mainWindow.loadFile(path.join(__dirname, 'pages', 'error.html'));
    mainWindow.webContents.once('did-finish-load', () => {
        if (err.message)
            mainWindow.webContents.send('update-error', err.message);
        else
            mainWindow.webContents.send('update-error', err);
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/*
const axios = require('axios');
const si = require('systeminformation');
const https = require('https');
const http = require('http');
const fs = require('fs');
const express = require('express');
const {attach, dettach, refresh} = require('electron-as-wallpaper');
const ngrok = require('ngrok');
const { userInfo } = require('os');
const serverURL = "http://18.230.251.159:3000"
const localtunnel = require('localtunnel');
const exp = require('constants');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const appdataPath = process.env.APPDATA + '\\DesktopFish'
const expressApp = express();
const localTunnelPort = 80;

let context = {};

//app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-web-security');  // Disables web security (use cautiously)
app.commandLine.appendSwitch('no-sandbox');
//app.commandLine.appendSwitch('single-process');

/*
function GetLauncherWindow(context)
{
    if (context.launcherWindow == undefined || !context.launcherWindow)
    {
        context.launcherWindow = new BrowserWindow({
            width: 800,
            height: 600,
            webPreferences: {
                nodeIntegration: false,
                preload: null,
                contextIsolation: false,
                sandbox: false,
            }
        });

        context.launcherWindow.on('close', () => {
            //if (context.appWindow != undefined && context.appWindow)
            //    context.appWindow.close();
            // TODO BACK
        });
    }

    return context.launcherWindow;
}

function GetAppWindow(context)
{
    if (context.appWindow == undefined || !context.appWindow)
    {
        context.appWindow = new BrowserWindow({
            width: 800,
            height: 600,
            fullscreen: true,
            frame: false,
            transparent: true,
            webPreferences: {
                nodeIntegration: false,
                preload: null,
                contextIsolation: false,
                sandbox: false,
            }
        });

        context.appWindow.setIgnoreMouseEvents(true, { forward: true });

        attach(context.appWindow, {
            transparent: true,
        });
    }

    return context.appWindow;
}

async function GetClientInfo(context)
{
    console.log("Getting client info...")

    let ip = axios.get('https://api.ipify.org?format=json', {timeout: 2000});
    let systeminfo = si.uuid();

    [ip, systeminfo] = await Promise.all([ip, systeminfo]);

    context.clientInfo = {"ipv4": ip.data.ip, "systemInfo": systeminfo};
    console.log("Client info: ", context.clientInfo);

    return context.clientInfo;
}

async function UpdateUser(context, clientInfo)
{
    context.userInfo = (await axios.post(serverURL + '/users', clientInfo, {timeout:2000})).data;
    return context.userInfo;
}

async function downloadFile(url, path, bIsSSL) {
    
    const file = fs.createWriteStream(path);

    let func = bIsSSL ? https.get : http.get;

    return new Promise((resolve, reject) => {
        func(url, (response) => {
            // Verifica se o status é diferente de 200
            if (response.statusCode !== 200) {
                file.close(); // Fecha o arquivo antes de deletar
                fs.unlink(path, () => {
                    reject(new Error(`Failed to download file: Status code ${response.statusCode}`));
                });
                return;
            }

            response.pipe(file);

            file.on('finish', () => {
                file.close(); // Fecha o arquivo após finalizar a escrita
                console.log(`Downloaded: ${path}`);
                resolve(true);
            });
        }).on('error', (err) => {
            fs.unlink(path, () => {
                reject(new Error(`Error downloading the file: ${err.message}`));
            });
        });
    });
}


app.whenReady().then(() => Init(context));

async function Init(context)
{
    try
    {
        // Stops app window if it was initiated previously
        if (context.appWindow != undefined && context.appWindow)
        {
            context.appWindow.close();
            delete context.appWindow;
        }

        GetLauncherWindow(context).loadFile(path.join(__dirname, 'pages', 'LLoading.html'));
        try {
            await TryLogin(context);
        } catch (err) {
            console.error(err, "Trying to load local APP");
            await LoadApp(context);
            context.launcherWindow.close();
        }
    }
    catch (err)
    {
        console.error(err);

        if (context.launcherWindow != undefined && context.launcherWindow)
            context.launcherWindow.loadFile(path.join(__dirname, 'pages', 'LError.html'));
        if (context.appWindow != undefined && context.appWindow)
            context.appWindow.close();
    }
}

async function TryLogin(context)
{
    //await LoadApp(context); //TODO remove
    //return;

    let clientinfo = GetClientInfo(context);
    let url = OpenListenServer(context);

    [clientinfo, url] = await Promise.all([clientinfo, url]);
    clientinfo.webhook = url;

    let userInfo = await UpdateUser(context, clientinfo);

    if (userInfo.qrCodeImage != undefined && userInfo.qrCodeImage)
    {
        await LoadQRCode(context, userInfo.qrCodeImage);

        // Wainting for payment, this will now be managed by the webhook
    }
    else
    {
        await UpdateApp(context);
        await LoadApp(context);
    }
}

async function OpenListenServer(context)
{
    console.log("Creating listen server...");
    context.tunnelSubdomain = await uuidv4();
    //context.tunnelSubdomain = "e959e1db-be33-4050-8581-147c01e7af5c";

    console.log("Openning tunnel...");
    context.tunnelURL = new Promise((resolve, reject) => {
        context.tunnel = localtunnel(localTunnelPort, { subdomain: context.tunnelSubdomain }, (err, tunnel) => {
            if (err) {
                console.error('Error starting localtunnel:', err);
                reject("Could not use localtunnel!");
                return;
            }
            console.log(`Localtunnel running at: ${tunnel.url}`);
            context.tunnelURL = tunnel.url;
    
            tunnel.on('close', () => {
                console.log('Localtunnel closed');
            });
    
            context.server = expressApp.listen(localTunnelPort, () => {
                console.log("Listenning on port:", localTunnelPort);
                expressApp.post('/webhook', (req, res) => {
                    
                    res.status(200).send();
                    CloseServer(context).then(() => UpdateApp(context).then(() => LoadApp(context)));
                });
            });

            resolve(tunnel.url + '/webhook');
        });
    });

    return (await context.tunnelURL);
}

async function CloseServer(context)
{
    if (context.tunnel != undefined)
    {
        (await context.tunnel).close();
    }
    if (context.server != undefined)
    {
        (await context.server).close();
    }
}

async function LoadQRCode(context, url) {
    console.log("Loading QRCode...");

    if (!fs.existsSync(appdataPath))
        fs.mkdirSync(appdataPath);

    await downloadFile(url, appdataPath + '\\qrcode.png', true);

    let lwin = GetLauncherWindow(context);
    let awin = GetAppWindow(context);

    lwin.loadFile(path.join(__dirname, 'pages', 'LQRCode.html'));
    awin.loadFile(path.join(__dirname, 'pages', 'DTest.html'));
}

async function UpdateApp(context)
{
    console.log("Update code...");

    if (!fs.existsSync(appdataPath))
        fs.mkdirSync(appdataPath);

    await downloadFile(serverURL + '/code.js?id=' + context.userInfo.id, appdataPath + '\\fishApp.js', false);
}

async function LoadApp(context)
{
    console.log("Running app...");
    // TODO Remove this copy and make the download on UPDATEAPP be a zip folder with html and javascripts
    let filePath = path.join(__dirname, 'pages', 'DFishApp.html');

    if (!fs.existsSync(appdataPath))
        fs.mkdirSync(appdataPath);

    fs.copyFileSync(filePath, appdataPath + '\\DFishApp.html');

    let lwin = GetLauncherWindow(context);
    let awin = GetAppWindow(context);

    lwin.loadFile(path.join(__dirname, 'pages', 'LConfigs.html'));
    awin.loadFile(appdataPath + '\\DFishApp.html');
}
/*
async function main() {

    try
    {
        await Init();
        userInfo = (await TryLogin());
        

        console.log(await userInfo);

        if (userInfo?.qrCode == undefined)
        {   
            console.log("User is authenticated");

            await UpdateApp(userInfo);
            await RunApp();
        }
        else
        {
            console.log("Not authenticated, proceding to qrCode...");

            
        }
    }
    catch (err)
    {
        //LoadErrorPage();
        if (launcherWindow != undefined && launcherWindow)
        {
            launcherWindow.loadFile('pages\\LError.html');
        }
        console.error(err);
    }
};


app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        launcherWindow = createLauncherWindow();
    }
});

*/