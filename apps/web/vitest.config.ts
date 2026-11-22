import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["lib/**/*.test.ts", "server/**/*.test.ts", "components/**/*.test.tsx"] },
});
