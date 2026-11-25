#!/usr/bin/env node
// Build step: copy the contract files the functions read at runtime into lib/shared/.
// Only functions/ is uploaded on deploy, so the repo's shared/ folder is not there in production.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "lib", "shared");
mkdirSync(out, { recursive: true });
for (const f of ["prompts.json", "ladder.json"]) copyFileSync(join(here, "..", "..", "shared", f), join(out, f));
