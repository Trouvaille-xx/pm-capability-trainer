import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    // 与 tsconfig 的 "@/*" -> "./src/*" 保持一致
    alias: { "@": path.join(root, "src") },
  },
});
