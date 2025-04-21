import { Fn, TerraformLocal, TerraformOutput, TerraformStack } from "cdktf"
import { spawn } from "child_process"
import path from "path"

import * as setup from "../tests/setup"
import { App } from "./App"
import { Module } from "./Module"

const tfExec = async (cwd: string, args: string[]): Promise<[string, string]> => {
  const tfInitProc = spawn("terraform", args, {
    cwd,
  })

  const stdout: Array<string> = []
  const stderr: Array<string> = []
  tfInitProc.stdout.on("data", data => stdout.push(data))
  tfInitProc.stderr.on("data", data => stderr.push(data))

  const tfInit = await new Promise((resolve, reject) => {
    tfInitProc.on("close", code => resolve(code))
    tfInitProc.on("error", error => reject(error))
  })

  if (tfInit !== 0) {
    console.error("Terraform command failed:")
    console.error(stdout.join("\n"))
    console.error(stderr.join("\n"))
    throw new Error(`Terraform command failed with code ${tfInit}`)
  }

  return [stdout.join("\n"), stderr.join("\n")]
}

describe(Module.name, () => {
  let rootDir: string
  let outDir: string

  beforeEach(async () => {
    const res = await setup.beforeEach(Module.name)
    rootDir = res.rootDir
    outDir = res.outDir
  })

  afterEach(async () => {
    // await setup.afterEach(rootDir)
  })

  it("test validators", async () => {
    const app = new App({ outdir: outDir })

    const stack = new TerraformStack(app, "main")

    const moduleTop = new Module(stack, "module-top", {})
    const moduleLeft = new Module(moduleTop, "module-left", {})
    const moduleLeftLeft = new Module(moduleLeft, "module-left-left", {})
    const moduleLeftLeftLocal = new TerraformLocal(moduleLeftLeft, "local-module-left-left", "some-value")

    const moduleRight = new Module(moduleTop, "module-right", {})
    const moduleRightRight = new Module(moduleRight, "module-right-right", {})
    const moduleRightRightLocal = new TerraformLocal(
      moduleRightRight,
      "local-module-right-right",
      moduleLeftLeftLocal.expression,
    )

    new TerraformOutput(moduleRightRight, "module-right-right-output", {
      staticId: true,
      value: Fn.nonsensitive(moduleRightRightLocal.expression),
    })

    new TerraformOutput(moduleRight, "module-right-output", {
      staticId: true,
      value: moduleRightRight.output("module-right-right-output"),
    })

    new TerraformOutput(moduleTop, "module-top-output", {
      staticId: true,
      value: moduleRight.output("module-right-output"),
    })

    new TerraformOutput(stack, "output", {
      staticId: true,
      value: moduleTop.output("module-top-output"),
    })

    await app.synth()

    await tfExec(path.join(rootDir, "cdktf.out/stacks/main"), ["init"])
    await tfExec(path.join(rootDir, "cdktf.out/stacks/main"), ["apply", "-auto-approve"])
    const [res] = await tfExec(path.join(rootDir, "cdktf.out/stacks/main"), ["output", "-json"])

    expect(JSON.parse(res)?.output?.value).toBe("some-value")
  })
})
