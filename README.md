# Ninja Kiwi VPN

Open the [Linux AppImage](https://github.com/nickolasrm/ninja-kiwi-vpn/releases/latest/download/NinjaKiwiVPN-x86_64.AppImage) or
[Windows executable](https://github.com/nickolasrm/ninja-kiwi-vpn/releases/latest/download/NinjaKiwiVPN-x64.exe) on an x86-64 desktop.
The builds include Flash, Java and the game clients. The Windows executable unpacks
into your local app cache on its first run.

## SAS: Zombie Assault 3

1. Connect everyone to the same Hamachi or other VPN network.
2. The host selects **Host**, enters their own VPN IPv4 address and clicks
   **Host and play**. Leave that launcher open throughout the match.
3. Everyone else selects **Join**, enters the host’s VPN IPv4 address and clicks
   **Join and play**.
4. In SAS3, choose **Play as guest** when the online-profile screen appears.
   Then choose **Play → Start → Play co-op multi player**. Everyone selects the
   same mode and clicks **Start new match**. Once everyone is in the lobby,
   use **Start now with these players**.

SAS3 uses TCP 8044. If Join cannot reach the host, allow TCP 8044 on the host's
VPN interface in the firewall. On Linux, mark the AppImage executable if your
file manager asks. If FUSE is unavailable, run
`./NinjaKiwiVPN-x86_64.AppImage --appimage-extract-and-run`.

The picker also includes Counter Snipe, SAS4, Bloons TD 5 Co-op and Bloons TD
Battles. These additional games have had launch smoke tests. The lobby ports are TCP 7988, 8124, 5577 and 4480 respectively.
SAS4, BTD5 and Battles can also allocate match ports in the 8127–31999 range.
The launcher uses its own local Flash profile. SAS3 guest progress stays local.
The Linux build uses Electron's `--no-sandbox` switch for Pepper Flash compatibility.

## Build

Run `./build.sh INPUTS_DIR ARCHIVE_RESOURCES_DIR` on Linux with Python 3,
Go 1.23 or newer, Git and unzip. Use the Steam Archive’s `resources` directory
for the second argument. The input directory contains:

- `FlashPrivateServer/` at commit `dea193d18d00fa6e3a96a007500ec62ba13f5e3a` and the
  `app.zip` client from [FlashPrivateServer v5.2](https://github.com/GlennnM/FlashPrivateServer/releases/tag/v5.2).
  The server is AGPL-3.0. Its source is available from that repository, and this
  project applies its modifications in [src/patch.py](src/patch.py).
- `electron-linux.zip` and `electron-win.zip`, the Linux and Windows x64
  [Electron 8.0.1](https://github.com/electron/electron/releases/tag/v8.0.1) builds.
- `jdk/` with Temurin 17 for Linux x64 and `jre-win.zip` with the Windows x64
  JRE from [Temurin 17](https://github.com/adoptium/temurin17-binaries/releases/tag/jdk-17.0.21%2B9).
- `flashlinux/` containing `libpepflashplayer.so` and `license.pdf`, plus
  `pepflashplayer.dll` extracted from the Windows x64 Pepper installation,
  both from [Adobe Flash Player 32.0.0.371](https://archive.org/details/flashplayerarchive).
- `maps/` with the five [SAS3 map SWFs](https://github.com/sas4fs-maps/sas4fs-maps.github.io/tree/master/sas3maps).
- `appimagetool/`, the extracted x64 [appimagetool](https://github.com/AppImage/appimagetool/releases),
  and `runtime-x86_64` from the [AppImage Type 2 runtime](https://github.com/AppImage/type2-runtime/releases).

The two builds and their SHA-256 checksums are written to `dist/`.

With a SAS3 host running, check its socket policy and handshake with
`python3 tests/sas3_socket.py HOST_IPV4`.
