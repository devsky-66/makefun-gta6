// Entry point for the Cinder Bay Nights entry (Node 22, standard library
// only). The game itself is plain static files in game/ — a canvas
// open-world crime game that loads offline in a desktop browser — and this
// file hands it in: it copies game/ and screenshots/ next to this file into
// the output directory (MAKEFUN_OUTPUT_DIR, or /output by default) and
// writes the dossier.json the judge reads, using the vendored make.fun
// library with the scorer's caps.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's own caps: text is capped at 163840 bytes; at most 4
// screenshots and none over 256 KiB; game/ holds at most 993 files and
// 48 MiB in all, and no path under game/ is longer than 1000 bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
