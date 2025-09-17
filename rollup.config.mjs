import typescript from "@rollup/plugin-typescript";
import url from "@rollup/plugin-url";

export default {
  input: "main.ts",
  output: { dir: ".", sourcemap: false, format: "cjs", exports: "default" },
  external: ["obsidian"],
  plugins: [
    typescript(),
    url({
      include: ["**/*.mp3"],
      // Inline everything as a data: URL so new Audio(url) just works
      limit: Infinity
    }),
  ],
};
