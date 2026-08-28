import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: [
        "/Users/ianduclos/_SecondBrain/02_Areas/_Coding/Cachito",
        "/Users/ianduclos/Desktop",
      ],
    },
  },
});
