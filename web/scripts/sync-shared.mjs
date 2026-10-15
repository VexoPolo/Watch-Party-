// Copies the shared protocol + sync math from server/ into web/ so both sides use identical code.
// Run after editing anything in server/src/shared: `npm run sync-shared`.
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.resolve(here, "../../server/src/shared");
const to = path.resolve(here, "../src/shared");
mkdirSync(to, { recursive: true });
for (const f of ["protocol.ts", "syncMath.ts"]) {
  copyFileSync(path.join(from, f), path.join(to, f));
  console.log(`copied ${f}`);
}
