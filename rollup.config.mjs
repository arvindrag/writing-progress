import typescript from "@rollup/plugin-typescript";
export default {
  input: "main.ts",
  output: { dir: ".", sourcemap: false, format: "cjs", exports: "default" },
  external: ["obsidian"],
  plugins: [typescript()],
};
