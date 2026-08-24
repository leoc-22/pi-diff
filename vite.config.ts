import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  root: "client",
  plugins: [react()],
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
});
