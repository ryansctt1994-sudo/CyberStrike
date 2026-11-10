import path from "path"
import { lstat, mkdir, open } from "fs/promises"
import { constants } from "fs"
import { Log } from "../util/log"
import { Global } from "../global"

export namespace Discovery {
  const log = Log.create({ service: "skill-discovery" })

  type IndexSkill = {
    name: string
    description: string
  } & ({ files: string[] } | { type: "skill-md" | "archive"; url: string; digest?: string })

  type Index = {
    skills: IndexSkill[]
  }

  export function dir() {
    return path.join(Global.Path.cache, "skills")
  }

  // Index contents are untrusted. Reject traversal, separators and ambiguous URI encodings.
  function segment(value: unknown): value is string {
    return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)
  }

  function relativeFile(value: unknown): value is string {
    return typeof value === "string" && value.split("/").every(segment)
  }

  // Same-origin fetch only; localhost HTTP is permitted for offline fixture tests.
  function origin(value: URL): boolean {
    return value.username === "" && value.password === "" &&
      (value.protocol === "https:" ||
        (value.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(value.hostname)))
  }

  async function directory(value: string): Promise<boolean> {
    await mkdir(value, { recursive: true })
    const stat = await lstat(value)
    return stat.isDirectory() && !stat.isSymbolicLink()
  }

  async function get(url: string, dest: string): Promise<boolean> {
    const cached = await lstat(dest).catch(() => undefined)
    if (cached) return cached.isFile() && !cached.isSymbolicLink()
    try {
      const response = await fetch(url, { redirect: "error" })
      if (!response.ok || !response.body) return false
      // Bound disk and memory consumption even if Content-Length is absent or false.
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let bytes = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 4 * 1024 * 1024) {
          await reader.cancel()
          log.warn("skill download size limit exceeded", { url })
          return false
        }
        chunks.push(value)
      }
      const file = await open(dest, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try {
        await file.writeFile(Buffer.concat(chunks))
      } finally {
        await file.close()
      }
      return true
    } catch (err) {
      log.error("failed to download", { url, err })
      return false
    }
  }

  export async function pull(url: string): Promise<string[]> {
    const result: string[] = []
    const base = url.endsWith("/") ? url : `${url}/`
    const location = new URL(base)
    if (!origin(location)) {
      log.warn("untrusted skill index URL", { url })
      return result
    }
    const index = new URL("index.json", location).href
    const cache = dir()
    if (!(await directory(cache))) return result

    log.info("fetching index", { url: index })
    const data = await fetch(index, { redirect: "error" })
      .then(async (response) => {
        if (!response.ok) {
          log.error("failed to fetch index", { url: index, status: response.status })
          return undefined
        }
        return response
          .json()
          .then((json) => json as Index)
          .catch((err) => {
            log.error("failed to parse index", { url: index, err })
            return undefined
          })
      })
      .catch((err) => {
        log.error("failed to fetch index", { url: index, err })
        return undefined
      })

    if (!data?.skills || !Array.isArray(data.skills)) {
      log.warn("invalid index format", { url: index })
      return result
    }

    const list = data.skills.filter((skill) => {
      if (!segment(skill?.name)) {
        log.warn("invalid skill entry", { url: index, skill })
        return false
      }
      const hasFiles = "files" in skill && Array.isArray(skill.files) && skill.files.length > 0 && skill.files.every(relativeFile)
      const hasUrl = "url" in skill && typeof skill.url === "string"
      if ("files" in skill && !hasFiles) return false
      if (!hasFiles && !hasUrl) {
        log.warn("invalid skill entry", { url: index, skill })
        return false
      }
      return true
    })

    await Promise.all(
      list.map(async (skill) => {
        // Archive extraction remains disabled until a bounded, independently-audited extractor exists.
        if ("type" in skill && skill.type === "archive") {
          log.warn("remote skill archives are disabled", { name: skill.name })
          return
        }

        const root = path.join(cache, skill.name)
        if (!(await directory(root))) return
        const files = "files" in skill && Array.isArray(skill.files) ? skill.files : ["SKILL.md"]
        const links = files.map((file) => {
          const baseURL = new URL(`${skill.name}/`, location)
          const link = "files" in skill ? new URL(file, baseURL) : new URL(skill.url, location)
          // Both legacy and skill-md URLs must remain within the approved index origin.
          if (!origin(link) || link.origin !== location.origin) return undefined
          if (link.username || link.password || link.hash) return undefined
          if ("files" in skill && !link.href.startsWith(baseURL.href)) return undefined
          if (!("files" in skill) && !link.href.startsWith(location.href)) return undefined
          return { file, link: link.href, dest: path.join(root, file) }
        })
        if (links.some((link) => !link)) return

        const ok = await Promise.all(
          links.filter((link) => link !== undefined).map(async ({ link, dest }) => {
            if (!(await directory(path.dirname(dest)))) return false
            return get(link, dest)
          }),
        )
        if (ok.some((success) => !success)) return
        const md = path.join(root, "SKILL.md")
        const stat = await lstat(md).catch(() => undefined)
        if (stat?.isFile() && !stat.isSymbolicLink()) result.push(root)
      }),
    )

    return result
  }
}
