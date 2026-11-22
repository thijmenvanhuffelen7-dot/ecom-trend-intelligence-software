#!/bin/sh
# Bouwt een uploadbaar zip-bestand voor de Chrome Web Store (geen build-stap nodig: plain ES modules).
set -eu
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./manifest.json').version")
mkdir -p dist
rm -f "dist/trendscope-extension-$VERSION.zip"
zip -qr "dist/trendscope-extension-$VERSION.zip" manifest.json src icons -x "*.test.js"
echo "dist/trendscope-extension-$VERSION.zip"
