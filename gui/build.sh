#!/usr/bin/env bash

trap "exit" INT TERM ERR
trap "kill 0" EXIT

echo '# Generate new icons file'
npm run generate-icons

echo '# Build for mac'
npm run package-mac &

echo '# Build for windows'
npm run package-win &

echo '# Build for linux'
npm run package-linux &

wait

npm run linux-installer &
npm run windows-installer &

wait

echo '# Clean up'
rm -r release-builds/green-tunnel-linux-x64
rm -r release-builds/green-tunnel-win32-ia32
rm -r icons