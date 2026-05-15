import { defineConfig } from "vite";
import { resolve } from "node:path";

const browser = process.env.BROWSER === "firefox" ? "firefox" : "chrome";

export default defineConfig({
  publicDir: "public",
  build: {
    outDir: `dist/${browser}`,
    emptyOutDir: true,
    target: "es2022",
    sourcemap: browser !== "chrome",
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.ts"),
        content: resolve(__dirname, "src/content.ts"),
        pageVoiceBridge: resolve(__dirname, "src/page-voice-bridge.ts"),
        popup: resolve(__dirname, "popup.html"),
        offscreen: resolve(__dirname, "offscreen.html"),
        inferenceWorker: resolve(__dirname, "src/ai/inference-worker.ts")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  },
  optimizeDeps: {
    exclude: ["@mlc-ai/web-llm", "@huggingface/transformers"]
  },
  define: {
    __FILLAI_BROWSER__: JSON.stringify(browser)
  }
});
