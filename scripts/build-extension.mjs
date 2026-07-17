import { cp, mkdir, readFile, rm } from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const source = path.join(root, "extension")
const output = path.join(root, "dist", "voom-extension")

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(source, output, { recursive: true })

const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"))
if (manifest.manifest_version !== 3) throw new Error("Voom extension must use Manifest V3.")

console.log(`Built ${manifest.name} v${manifest.version} at ${path.relative(root, output)}`)
