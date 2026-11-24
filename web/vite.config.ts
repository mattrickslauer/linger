import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // shared/ (prompts.json, test-vectors.json) lives one level up and is imported directly.
  server: { fs: { allow: [".."] } },
  test: { environment: "node" },
});
