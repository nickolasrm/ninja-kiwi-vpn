#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"

if [[ $# != 2 ]]; then
  echo "Usage: ./build.sh INPUTS_DIR ARCHIVE_RESOURCES_DIR" >&2
  exit 2
fi
inputs=$(realpath "$1")
archive_resources=$(realpath "$2")
mkdir -p dist
build=$(mktemp -d)
trap 'rm -rf -- "$build"' EXIT

echo "b9116f983498eb3b914be59c29e4b85276d2202091f93a971b8dc33fbc334c4a  $inputs/app.zip" | sha256sum -c -
if [[ $(git -C "$inputs/FlashPrivateServer" rev-parse HEAD) != dea193d18d00fa6e3a96a007500ec62ba13f5e3a ]]; then
  echo "Expected FlashPrivateServer commit dea193d18d00fa6e3a96a007500ec62ba13f5e3a" >&2
  exit 1
fi
unzip -p "$inputs/app.zip" app.asar > "$build/app.asar"
python3 src/patch.py client "$build/app.asar" "$build/app" "$inputs/maps"
cp "$inputs/FlashPrivateServer/bmc/src/webapp/9a0a8254da299947492b4e1eb15291f1.json" "$build/app/swfs/"
cp -r "$inputs/FlashPrivateServer/src" "$build/server"
mkdir "$build/classes" "$build/multiplayer"
cp "$inputs/FlashPrivateServer/"{LICENSE,sas4_bot.bin,sas4_deadtab.bin,sas4_vs.bin} "$build/multiplayer"
mkdir "$build/server-root"
mv "$build/server" "$build/server-root/src"
python3 src/patch.py server "$build/server-root"
mapfile -d '' sources < <(find "$build/server-root/src/java" -name '*.java' -print0)
"$inputs/jdk/bin/javac" --release 17 -d "$build/classes" "${sources[@]}"
"$inputs/jdk/bin/jar" --create --file "$build/multiplayer/server.jar" \
  --main-class xyz.hydar.flash.FlashLauncher -C "$build/classes" .
"$inputs/jdk/bin/jlink" --add-modules java.base --strip-debug --no-header-files --no-man-pages \
  --compress=2 --output "$build/java-linux"

for platform in linux win; do
  package="$build/$platform"
  unzip -q "$inputs/electron-$platform.zip" -d "$package"
  resources="$package/resources"
  rm "$resources/default_app.asar"
  cp -r "$build/app" "$build/multiplayer" "$resources/"
  mkdir -p "$resources/pepper" "$resources/src/static"
  cp -r "$archive_resources/src/static/img" "$resources/src/static/"
  cp "$inputs/flashlinux/license.pdf" "$resources/pepper/"
done

linux="$build/linux"
cp -r "$build/java-linux" "$linux/resources/java"
cp "$inputs/flashlinux/libpepflashplayer.so" "$linux/resources/pepper/"
install -m 755 src/AppRun "$linux/AppRun"
cp src/ninja-kiwi-vpn.desktop "$linux/"
cp "$archive_resources/src/static/img/icon/icon_256@1x.png" "$linux/ninja-kiwi-vpn.png"
ARCH=x86_64 "$inputs/appimagetool/AppRun" --no-appstream --runtime-file "$inputs/runtime-x86_64" \
  --mksquashfs-opt -processors --mksquashfs-opt 4 "$linux" "$build/NinjaKiwiVPN-x86_64.AppImage"

win="$build/win"
unzip -q "$inputs/jre-win.zip" -d "$build/jre-win"
mv "$build/jre-win/"*-jre "$win/resources/java"
cp "$inputs/pepflashplayer.dll" "$win/resources/pepper/"
mv "$win/electron.exe" "$win/NinjaKiwiVPN.exe"
python3 - "$win" "$build/windows.zip" <<'PY'
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(sys.argv[1])
with ZipFile(sys.argv[2], "w", ZIP_DEFLATED, compresslevel=4) as archive:
    for file in sorted(root.rglob("*")):
        if file.is_file():
            archive.write(file, file.relative_to(root))
PY
version=$(sha256sum "$build/windows.zip")
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath \
  -ldflags="-s -w -H=windowsgui -X main.payloadVersion=${version%% *}" \
  -o "$build/windows.exe" src/windows.go
cat "$build/windows.exe" "$build/windows.zip" > "$build/NinjaKiwiVPN-x64.exe"
staging=$(mktemp -d dist/.build-XXXXXXXX)
trap 'rm -rf -- "$build" "$staging"' EXIT
install -m 755 "$build/NinjaKiwiVPN-x86_64.AppImage" "$staging/"
install -m 644 "$build/NinjaKiwiVPN-x64.exe" "$staging/"
(
  cd "$staging"
  sha256sum NinjaKiwiVPN-x86_64.AppImage NinjaKiwiVPN-x64.exe > SHA256SUMS
)
mv -f "$staging/"* dist/
