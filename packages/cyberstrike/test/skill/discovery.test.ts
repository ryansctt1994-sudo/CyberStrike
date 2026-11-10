import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Discovery } from "../../src/skill/discovery"
import { rm } from "node:fs/promises"
import path from "node:path"

const name = "ci-discovery-" + process.pid + "-" + Date.now()
const md = "---\nname: " + name + "\ndescription: Local fixture\n---\n# Local fixture\n"
const counts = new Map<string, number>()
let server: ReturnType<typeof Bun.serve>
let url = ""

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const route = new URL(request.url).pathname
      counts.set(route, (counts.get(route) ?? 0) + 1)
      if (route === "/skills/index.json") {
        return Response.json({ skills: [{ name, description: "Local test fixture", files: ["SKILL.md", "references/guide.md"] }] })
      }
      if (route === "/skills/" + name + "/SKILL.md") return new Response(md)
      if (route === "/skills/" + name + "/references/guide.md") return new Response("# Reference guide\n")
      if (route === "/html/index.json") return new Response("<html>not JSON</html>", { headers: { "content-type": "text/html" } })
      return new Response("not found", { status: 404 })
    },
  })
  url = "http://127.0.0.1:" + server.port + "/skills/"
})

afterAll(async () => {
  server.stop()
  await rm(path.join(Discovery.dir(), name), { recursive: true, force: true })
})

describe("Discovery.pull (credential-free local HTTP fixture)", () => {
  test("downloads skills from local index", async () => {
    const dirs = await Discovery.pull(url)
    expect(dirs).toHaveLength(1)
    for (const dir of dirs) {
      expect(dir).toStartWith(Discovery.dir())
      expect(await Bun.file(path.join(dir, "SKILL.md")).exists()).toBe(true)
      expect(await Bun.file(path.join(dir, "SKILL.md")).text()).toBe(md)
    }
  })

  test("url without trailing slash works", async () => {
    const dirs = await Discovery.pull(url.replace(/\/$/, ""))
    expect(dirs).toHaveLength(1)
    expect(await Bun.file(path.join(dirs[0], "SKILL.md")).exists()).toBe(true)
  })

  test("returns empty array for invalid url", async () => {
    expect(await Discovery.pull(url.replace("/skills/", "/invalid/"))).toEqual([])
  })

  test("returns empty array for non-json response", async () => {
    expect(await Discovery.pull(url.replace("/skills/", "/html/"))).toEqual([])
  })

  test("downloads reference files alongside SKILL.md", async () => {
    const dirs = await Discovery.pull(url)
    expect(dirs).toHaveLength(1)
    const refs = path.join(dirs[0], "references")
    const refFiles = await Array.fromAsync(new Bun.Glob("**/*.md").scan({ cwd: refs, onlyFiles: true }))
    expect(refFiles).toContain("guide.md")
    expect(await Bun.file(path.join(refs, "guide.md")).text()).toBe("# Reference guide\n")
  })

  test("caches downloaded files on second pull", async () => {
    const first = await Discovery.pull(url)
    expect(first).toHaveLength(1)
    const file = "/skills/" + name + "/SKILL.md"
    const before = counts.get(file) ?? 0
    const second = await Discovery.pull(url)
    expect(second.sort()).toEqual(first.sort())
    expect(counts.get(file) ?? 0).toBe(before)
  })
})
