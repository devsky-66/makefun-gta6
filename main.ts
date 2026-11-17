// Cinder Bay Nights — submission entry point (Node 22, standard library
// only). The game itself is plain static files under game/: a canvas
// open-world crime game that plays offline in a desktop browser. This file
// hands it in by copying game/ and screenshots/ next to this file into the
// output directory (MAKEFUN_OUTPUT_DIR, default /output) and writing the
// dossier.json the judge reads, using the vendored make.fun library with
// the scorer's caps.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
}

// The scorer's own caps: text is capped at 163840 bytes; at most 4
// screenshots and none over 256 KiB; game/ holds at most 993 files and
// 48 MiB in total, and no path under game/ is longer than 1000 bytes.
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);
