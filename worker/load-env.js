/**
 * Load env for GenEx worker processes (worker.js, text-video-worker.js).
 * Order: worker/.env → genex/.env → genex/.env.local → process default.
 * Later files override earlier ones so real keys in .env.local win over blank lines in worker/.env.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

/**
 * @param {string} entryImportMetaUrl import.meta.url of the entry file (worker.js or text-video-worker.js)
 */
export function loadGenexWorkerEnv(entryImportMetaUrl) {
  const __dirname = path.dirname(fileURLToPath(entryImportMetaUrl));
  const genexRoot = path.join(__dirname, "..");

  dotenv.config({ path: path.join(__dirname, ".env") });

  const rootEnv = path.join(genexRoot, ".env");
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv, override: true });
  }

  const rootEnvLocal = path.join(genexRoot, ".env.local");
  if (fs.existsSync(rootEnvLocal)) {
    dotenv.config({ path: rootEnvLocal, override: true });
  }

  dotenv.config();
}
