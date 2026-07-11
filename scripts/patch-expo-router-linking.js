const fs = require('node:fs')
const path = require('node:path')

const linkingPath = path.join(__dirname, '..', 'node_modules', 'expo-router', 'build', 'fork', 'useLinking.native.js')

if (!fs.existsSync(linkingPath)) {
  process.exit(0)
}

const source = fs.readFileSync(linkingPath, 'utf8')
const directCall = 'onUnhandledLinking((0, extractPathFromURL_1.extractExpoPathFromURL)(prefixes, url));'
const deferredCall =
  'setTimeout(() => onUnhandledLinking((0, extractPathFromURL_1.extractExpoPathFromURL)(prefixes, url)), 0);'

if (!source.includes(directCall)) {
  process.exit(0)
}

fs.writeFileSync(linkingPath, source.replaceAll(directCall, deferredCall))
