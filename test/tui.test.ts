import { expect, test } from "bun:test"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { unlink } from "node:fs/promises"

test("compiled TUI passes headless loading, paging, Retry, Use-label and X checks", async () => {
  // Isolate host mocks and use the same client-side Solid runtime as OpenCode.
  const child = Bun.spawn([process.execPath, "--conditions=browser", "test", "./test/tui-render.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "pipe", stderr: "pipe",
  })
  const timer = setTimeout(() => child.kill(), 15000)
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    expect({ code, diagnostics: code === 0 ? "" : stdout + stderr }).toEqual({ code: 0, diagnostics: "" })
  } finally {
    clearTimeout(timer)
  }
}, 20000)

test("compiled public-slot layout passes fit, mouse, input-growth and resize checks", async () => {
  const output = new URL(`../dist/tui-layout-${process.pid}.js`, import.meta.url)
  const result = await Bun.build({
    entrypoints: [new URL("./tui-layout.tsx", import.meta.url).pathname],
    target: "bun", format: "esm", packages: "external", plugins: [createSolidTransformPlugin()],
  })
  if (!result.success) throw new Error("Layout fixture build failed")
  await Bun.write(output, result.outputs[0]!)
  const child = Bun.spawn([process.execPath, "--conditions=browser", "test", output.pathname], {
    cwd: new URL("..", import.meta.url).pathname, stdout: "pipe", stderr: "pipe",
  })
  const timer = setTimeout(() => child.kill(), 15000)
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    expect({ code, diagnostics: code === 0 ? "" : stdout + stderr }).toEqual({ code: 0, diagnostics: "" })
  } finally {
    clearTimeout(timer)
    await unlink(output.pathname)
  }
}, 20000)
