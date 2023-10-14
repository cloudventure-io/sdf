import { spawn } from "child_process"
import { join } from "path"

export const tscCheck = async (rootDir: string) => {
  const child = spawn("yarn", ["-s", "run", "tsc", "--noEmit", "-p", join(rootDir, "tsconfig.json")], {
    cwd: rootDir,
  })
  const out: Array<string> = []
  child.stdout.on("data", data => out.push(data))
  child.stderr.on("data", data => out.push(data))

  const code = await new Promise(resolve => child.on("close", code => resolve(code)))

  if (code !== 0) {
    throw new Error(`tsc exited with status code ${code}: ` + out.join("\n"))
  }
}
