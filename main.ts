// Token Radar: turn the sealed DefiLlama snapshot into a ranked board.
//
// This file is the entrypoint. It takes the snapshot (a file, or a directory
// holding snapshot.json), asks lib/model.ts to score every protocol that
// records no token yet, and lays out the grader's /output: the board itself,
// the script the dashboard reads, the static dashboard, the screenshots and
// the dossier the judge opens first. Nothing here fetches the network and
// nothing here decides a rank; the model does that, this file only moves
// files around. Node 22, standard library only.
//
// Run it outside the grader like this:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import {
  copyFileSync as copyOne,
  existsSync as pathExists,
  mkdirSync as makeDir,
  readdirSync as listDir,
  readFileSync as readText,
  statSync as statOne,
  writeFileSync as writeText,
} from "node:fs";
import { join as joinPath } from "node:path";
import { fileURLToPath as urlToPath } from "node:url";
import {
  boardIssue as boardProblem,
  buildRadar as scoreSnapshot,
  dataScript as boardScript,
  parseSnapshot as readSnapshot,
} from "./lib/model.ts";
import { buildDossier as makeDossier } from "./vendor/makefun-board.ts";

const rootDir = urlToPath(new URL(".", import.meta.url));

// Caps the dossier builder enforces: the text cap shapes the bytes,
// the rest refuse outright.
const DOSSIER_TEXT_LIMIT = 65_536;
const SHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

// Read --name <value> (or --name=<value>) from the process arguments.
function flagValue(name: string, fallback: string): string {
  const argv = process.argv;
  const slot = argv.indexOf(`--${name}`);
  if (slot >= 0 && slot + 1 < argv.length) return argv[slot + 1]!;
  const glued = argv.find((a) => a.startsWith(`--${name}=`));
  return glued === undefined ? fallback : glued.slice(name.length + 3);
}

function fail(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

// Mirror every regular file of one directory into another, skipping
// dotfiles, and report the names that landed.
function mirrorDir(from: string, to: string): string[] {
  if (!pathExists(from)) return [];
  makeDir(to, { recursive: true });
  const landed: string[] = [];
  for (const name of listDir(from)) {
    if (name.startsWith(".")) continue;
    const source = joinPath(from, name);
    if (!statOne(source).isFile()) continue;
    copyOne(source, joinPath(to, name));
    landed.push(name);
  }
  return landed;
}

const inputGiven = flagValue("input", "/input");
const snapshotPath = inputGiven.endsWith(".json")
  ? inputGiven
  : joinPath(inputGiven, "snapshot.json");
if (!pathExists(snapshotPath)) {
  fail(
    `no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`,
    2,
  );
}
const outDir = flagValue("output", process.env.MAKEFUN_OUTPUT_DIR ?? "/output");

const sealed = readSnapshot(readText(snapshotPath, "utf8"));
const { board: ranked, radar: model } = scoreSnapshot(sealed);
const problem = boardProblem(ranked, sealed);
if (problem !== null) {
  fail(`the model wrote a board the gate refuses: ${problem}`, 1);
}

makeDir(outDir, { recursive: true });
writeText(joinPath(outDir, "board.json"), `${JSON.stringify({ rows: ranked })}\n`);
writeText(joinPath(outDir, "data.js"), boardScript(model));

mirrorDir(joinPath(rootDir, "dashboard"), joinPath(outDir, "dashboard"));
const images = mirrorDir(joinPath(rootDir, "screenshots"), joinPath(outDir, "screenshots"));
if (images.length < 3) {
  fail(
    `screenshots/ holds ${images.length} image${images.length === 1 ? "" : "s"}: hand in 3, the board, a detail view and a filtered view`,
    1,
  );
}
for (const name of images) {
  if (!SHOT_NAME.test(name)) {
    fail(
      `screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`,
      1,
    );
  }
}

// The dossier goes last: the scorer rebuilds it from this /output and compares bytes.
writeText(
  joinPath(outDir, "dossier.json"),
  makeDossier(outDir, {
    text_max_bytes: DOSSIER_TEXT_LIMIT,
    screenshots: SHOT_LIMITS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token radar: ${sealed.protocols.length} protocols in, ${sealed.watchlist.length} on the watchlist, ${ranked.length} rows scored (${model.early_size} early, ${model.live_size} live set aside)\n` +
    `token radar: wrote ${joinPath(outDir, "board.json")}, ${joinPath(outDir, "data.js")}, ${joinPath(outDir, "dashboard")} (3 files), ${joinPath(outDir, "screenshots")} (${images.length} images) and ${joinPath(outDir, "dossier.json")}\n`,
);
