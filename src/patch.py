"""Adapt the pinned FlashPrivateServer client and server for the VPN launcher."""
import json
import shutil
import struct
import sys
from pathlib import Path


def replace_once(file, old, new):
    text = file.read_bytes().decode()
    if text.count(old) != 1:
        raise ValueError(f"{file}: expected one instance of {old!r}")
    file.write_bytes(text.replace(old, new).encode())


def unpack_asar(archive, destination):
    with archive.open("rb") as source:
        _, header_size, _, json_size = struct.unpack("<4I", source.read(16))
        tree = json.loads(source.read(json_size))

        def unpack(node, directory):
            directory.mkdir(exist_ok=True)
            for name, entry in node["files"].items():
                if Path(name).name != name or name in (".", ".."):
                    raise ValueError(f"Invalid ASAR filename {name!r}")
                target = directory / name
                if "files" in entry:
                    unpack(entry, target)
                else:
                    source.seek(8 + header_size + int(entry["offset"]))
                    target.write_bytes(source.read(entry["size"]))

        unpack(tree, destination)


def patch_client(archive, destination, maps):
    unpack_asar(archive, destination)
    main = destination / "main.js"
    replace_once(main, 'let w=s.a.join(n.app.getPath("userData"),"flash","system",g)',
                 'let w=s.a.join(process.resourcesPath,"pepper",g)')
    replace_once(main, 'if(c.existsSync(w))b.addSource(w);', 'if(c.existsSync(w))b.addSource(w,"32.0.0.371");')
    replace_once(main, 'n.app.allowRendererProcessReuse=!0', 'n.app.allowRendererProcessReuse=!1')
    replace_once(main, 'n.app.commandLine.appendSwitch("in-process-gpu"),', '')
    start = 'm=new n.BrowserWindow({title:"Ninja Kiwi Archive"'
    end = '})),n.app.on("window-all-closed"'
    text = main.read_text()
    text = text[:text.index(start)] + '''
m = new n.BrowserWindow({
  title: "Ninja Kiwi VPN", width: 550, height: 435, minWidth: 515, minHeight: 410,
  backgroundColor: "#141613",
  webPreferences: { nodeIntegration: false, contextIsolation: true, preload: s.a.join(__dirname, "preload.js") }
});
n.Menu.setApplicationMenu(null);
require("./launcher.js")(m, openGameWindow);
await m.loadFile(s.a.join(__dirname, "launcher.html"));
''' + text[text.index(end, text.index(start)):]
    main.write_text(text)
    # Open the SWF with its original origin so Flash can read the server cookies.
    text = main.read_text()
    start = text.index('let t=new BrowserWindow({width:e.swfSize.width')
    end = text.index('require("url"),n.ipcMain.on("settings"', start)
    main.write_text(text[:start] + """
const gameWindow = new BrowserWindow({
  title: e.gameTitle, width: e.swfSize.width, height: e.swfSize.height,
  minWidth: 600, minHeight: 450, backgroundColor: "#000000",
  webPreferences: { plugins: true, nodeIntegration: false, contextIsolation: true, session: session.defaultSession }
});
gameWindow.removeMenu();
gameWindow.webContents.on("will-navigate", event => event.preventDefault());
gameWindow.webContents.on("new-window", event => event.preventDefault());
gameWindow.webContents.on("before-input-event", (event, input) => {
  if (input.type === "keyDown" && input.key === "F11") gameWindow.setFullScreen(!gameWindow.isFullScreen());
});
try {
  await gameWindow.loadURL(e.swfURL);
} catch (error) {
  gameWindow.destroy();
  throw error;
}
}
""" + text[end:])
    replace_once(main, 'rules=[{regex:', r'''rules=[
    ...["AirbaseMap","BlackIsleMap","FarmhouseMap","KarnivaleMap","VerdammtenstadtMap"].map(map => ({
      regex: new RegExp("^https://sas4fs-maps\\.github\\.io/sas3maps/" + map + "\\.swf"),
      replacement: map + ".swf"
    })),
    {regex:''')
    # The old SAS3 host is gone. Route both its HTTP and HTTPS map requests to the local copies.
    replace_once(main, 'if(e.game,0)return;if(', 'if(')
    replace_once(main, 'if(np){', r'''const oldMap = /^https:\/\/sas3maps\.ninjakiwi\.com\/sas3maps\/(\w+\.swf)(?:\?|$)/.exec(request.url);
if (oldMap && fs.existsSync(path.join(__dirname, "swfs", oldMap[1]))) {
  return callback({mimeType: "application/x-shockwave-flash", data: fs.readFileSync(path.join(__dirname, "swfs", oldMap[1]))});
}
if(np){''')
    replace_once(main,
                 '"http://ninjakiwi.com/*"]},((e,t)=>{t(e.url.startsWith("http://ninjakiwi.com/") ? {redirectURL:e.url.replace("http://","https://")}',
                 '"http://ninjakiwi.com/*","http://sas3maps.ninjakiwi.com/*"]},((e,t)=>{t(e.url.startsWith("http://ninjakiwi.com/") || e.url.startsWith("http://sas3maps.ninjakiwi.com/") ? {redirectURL:e.url.replace("http://","https://")}')
    for asset in maps.glob("*.swf"):
        shutil.copy2(asset, destination / "swfs")
    for name in ("start.js", "launcher.js", "preload.js", "launcher.html"):
        shutil.copy2(Path(__file__).parent / name, destination)
    manifest = destination / "package.json"
    package = json.loads(manifest.read_bytes())
    package.update(main="start.js", productName="Ninja Kiwi VPN")
    manifest.write_text(json.dumps(package, indent=2) + "\n")


def patch_server(root):
    flash = root / "src/java/xyz/hydar/flash"
    launcher = flash / "FlashLauncher.java"
    # Each game port serves Flash's socket policy, so the launcher can host without root on Linux.
    text = launcher.read_text()
    start = text.index('\t\tSystem.out.println("Please ensure port 843')
    end = text.index("\t\tif(args.length", start)
    launcher.write_text(text[:start] + text[end:])
    replace_once(launcher, 'System.out.println("Type \\"stop\\" to close all servers.");',
                 'System.out.println("VPN server ready");')
    replace_once(launcher, 'if(cmd.equals("stop")) {',
                 'if (cmd == null) break;\n\t\t\t\tif(cmd.equals("stop")) {')

    text_policy = '''
        if (m.equals("<policy-file-request/>")) {
            send(PolicyFileServer.POLICY);
            flush();
            return;
        }'''
    for name in ("S3Server.java", "CSServer.java"):
        file = flash / name
        text = file.read_text()
        start = text.index("{", text.index("public void onMessage(String m)")) + 1
        file.write_text(text[:start] + text_policy + text[start:])

    replace_once(flash / "PolicyFileServer.java", 'permitted-cross-domain-policies="master-only"',
                 'permitted-cross-domain-policies="all"')
    for name, marker in (("BattlesServer.java", "public void onMessage(String line) throws IOException {"),
                         ("CoopServer.java", "public void onMessage(String line){")):
        file = flash / name
        replace_once(file, marker, marker + text_policy.replace("m.equals", "line.equals"))
    # SAS4's Flash client requests policy on its matchmaking port before sending binary data.
    replace_once(flash / "S4Server.java", "int end=src.position();", '''
                if (src.position() > 0 && src.get(0) == '<') {
                    if (src.position() < 23) return;
                    send(PolicyFileServer.POLICY);
                    flush();
                    src.clear();
                    return;
                }
                int end=src.position();''')
    replace_once(launcher, 'System.out.println("VPN server ready");', '''
        try {
            startChecked(PolicyFileServer::new, true, 843, true);
        } catch (IOException unavailable) {
            // Flash can fall back to the game port.
        }
        System.out.println("VPN server ready");''')


if __name__ == "__main__":
    if sys.argv[1] == "client":
        patch_client(*map(Path, sys.argv[2:]))
    else:
        patch_server(Path(sys.argv[2]))
