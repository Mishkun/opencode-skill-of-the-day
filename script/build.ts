import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const started = Date.now()
const result = await Bun.build({
  entrypoints: ["src/tui.tsx"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  packages: "external",
  plugins: [createSolidTransformPlugin()],
})
if (!result.success) {
  for (const message of result.logs) console.error(message)
  throw new Error("Build failed")
}
await Bun.write("dist/tui.d.ts", 'declare const plugin: import("@opencode/plugin/tui/plugin").Definition;\nexport default plugin;\n')
console.log(`Built OpenTUI Solid plugin in ${Date.now() - started}ms`)
