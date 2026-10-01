/**
 * serve.mjs — Pici statikus szerver a fejlesztéshez és a telefonos teszthez.
 *
 * Indítás:   node serve.mjs [port]
 * Alapértelmezett port: 8080. A hálózati kapcsolat minden címét kiírja,
 * hogy a telefonról is elérhető legyen ugyanazon a Wi-Fi-n.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2]) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';

  const file = path.join(ROOT, rel);
  // Könyvtáron kívülre mutató kérés elutasítása.
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Tiltott útvonal');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nincs ilyen fájl: ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      // Fejlesztés közben ne ragadjon be a régi verzió.
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/',
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const addrs = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) addrs.push(ni.address);
    }
  }

  console.log('\n  Konszenzus Időjárás — helyi szerver fut\n');
  console.log(`  Ezen a gépen:   http://localhost:${PORT}`);
  for (const a of addrs) console.log(`  Telefonról:     http://${a}:${PORT}`);
  console.log('\n  A telefonnak ugyanazon a Wi-Fi-n kell lennie.');
  console.log('  Megjegyzés: sima http-n a böngésző letiltja a helymeghatározást');
  console.log('  és a főképernyőre telepítést — ilyenkor használd a keresőt.');
  console.log('  Állandó telefonos használathoz tedd ki https-es tárhelyre');
  console.log('  (a részleteket a README.md írja le).\n');
  console.log('  Leállítás: Ctrl+C\n');
});
