#!/usr/bin/env bash

trap "exit" INT TERM ERR
trap "kill 0" EXIT

echo '# Clean up'
rm -r ./icons
rm -r release-builds

echo '# Generate new icons file'
npm run generate-icons

echo '# Build for mac'
npm run package-mac &

echo '# Build for windows'
npm run package-win &

echo '# Build for linux'
npm run package-linux &

wait