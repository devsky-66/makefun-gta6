// A tiny static server for game/ (Node 22, standard library only), so the
// entry can be played locally with no build step: `node serve.ts` serves
// game/ on http://localhost:8080 (or --port <n>, or PORT). It sends the MIME
// types a browser game needs, refuses any path that escapes game/, and
// otherwise does nothing clever: a development convenience, not a web
// server for the internet.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const gameRoot = resolve(fileURLToPath(new URL('./game', import.meta.url)));
const cliArgs = process.argv.slice(2);
const flagAt = cliArgs.indexOf('--port');
const flagPort = flagAt === -1 ? NaN : Number(cliArgs[flagAt + 1]);
const envPort = Number(process.env.PORT);
const wantedPort = Number.isInteger(flagPort) && flagPort > 0 && flagPort < 65536
  ? flagPort
  : (Number.isInteger(envPort) && envPort > 0 && envPort < 65536 ? envPort : 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

createServer((req, res) => {
  const parsed = new URL(req.url ?? '/', 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const target = resolve(join(gameRoot, normalize(pathname)));
  if (target !== gameRoot && !target.startsWith(gameRoot + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  let bytes;
  try {
    const info = statSync(target);
    if (!info.isFile()) throw new Error('not a file');
    bytes = info.size;
  } catch {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
    'content-length': bytes,
    'cache-control': 'no-store',
  });
  createReadStream(target).pipe(res);
}).listen(wantedPort, '127.0.0.1', () => {
  console.log(`game/ is on http://localhost:${wantedPort}`);
});
