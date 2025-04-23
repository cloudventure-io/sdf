import { Fn, LocalBackend, TerraformLocal, TerraformOutput, TerraformStack, ref } from "cdktf"
import { spawn } from "child_process"
import path from "path"

import * as setup from "../tests/setup"
import { App } from "./App"
import { StackModule } from "./StackModule"

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

describe(StackModule.name, () => {
  let rootDir: string
  let outDir: string

  beforeEach(async () => {
    const res = await setup.beforeEach(StackModule.name)
    rootDir = res.rootDir
    outDir = res.outDir
  })

  afterEach(async () => {
    await setup.afterEach(rootDir)
  })

  it("test inside-stack references", async () => {
    const app = new App({ outdir: outDir })

    const stack = new TerraformStack(app, "main")

    new LocalBackend(stack, {
      path: path.join(rootDir, `terraform.${stack.node.id}.tfstate`),
    })

    const moduleTop = new StackModule(stack, "module-top", {})
    const moduleLeft = new StackModule(moduleTop, "module-left", {})
    const moduleLeftLeft = new StackModule(moduleLeft, "module-left-left", {})
    const moduleLeftLeftLocal = new TerraformLocal(moduleLeftLeft, "local-module-left-left", "some-value")
    const moduleLeftLeftLocalSensitive = new TerraformLocal(
      moduleLeftLeft,
      "local-module-left-left-sensitive",
      Fn.sensitive("some-sensitive-value"),
    )

    const moduleRight = new StackModule(moduleTop, "module-right", {})
    const moduleRightRight = new StackModule(moduleRight, "module-right-right", {})
    const moduleRightRightLocal = new TerraformLocal(
      moduleRightRight,
      "local-module-right-right",
      moduleLeftLeftLocal.expression,
    )
    const moduleRightRightLocalSensitive = new TerraformLocal(
      moduleRightRight,
      "local-module-right-right-sensitive",
      moduleLeftLeftLocalSensitive.expression,
    )

    new TerraformOutput(stack, "output", {
      staticId: true,
      value: moduleRightRightLocal.expression,
      sensitive: true,
    })
    new TerraformOutput(stack, "output-is-sensitive", {
      staticId: true,
      value: ref(`issensitive(${moduleRightRightLocal.expression})`),
      sensitive: true,
    })
    new TerraformOutput(stack, "output-sensitive", {
      staticId: true,
      value: moduleRightRightLocalSensitive.expression,
      sensitive: true,
    })
    new TerraformOutput(stack, "output-sensitive-is-sensitive", {
      staticId: true,
      value: ref(`issensitive(${moduleRightRightLocalSensitive.expression})`),
      sensitive: true,
    })

    await app.synth()

    await tfExec(path.join(rootDir, "cdktf.out/stacks/main"), ["init"])
    await tfExec(path.join(rootDir, "cdktf.out/stacks/main"), ["apply", "-auto-approve"])
    const [res] = await tfExec(path.join(rootDir, "cdktf.out/stacks/main"), ["output", "-json"])
    const output = JSON.parse(res)

    expect(output?.["output"]?.value).toBe("some-value")
    expect(output?.["output-is-sensitive"]?.value).toBe(false)
    expect(output?.["output-sensitive"]?.value).toBe("some-sensitive-value")
    expect(output?.["output-sensitive-is-sensitive"]?.value).toBe(true)
  })

  it("test cross-stack references", async () => {
    const app = new App({ outdir: outDir })

    const stack1 = new TerraformStack(app, "stack1")

    new LocalBackend(stack1, {
      path: path.join(rootDir, `terraform.${stack1.node.id}.tfstate`),
    })

    const stack1ModuleTop = new StackModule(stack1, "module-top", {})
    const stack1ModuleLeft = new StackModule(stack1ModuleTop, "module-left", {})
    const stack1ModuleLeftLeft = new StackModule(stack1ModuleLeft, "module-left-left", {})
    const stack1ModuleLeftLeftLocal = new TerraformLocal(stack1ModuleLeftLeft, "local-module-left-left", "some-value")

    const stack1ModuleRight = new StackModule(stack1ModuleTop, "module-right", {})
    const stack1ModuleRightRight = new StackModule(stack1ModuleRight, "module-right-right", {})
    const stack1ModuleRightRightLocal = new TerraformLocal(
      stack1ModuleRightRight,
      "local-module-right-right",
      stack1ModuleLeftLeftLocal.expression,
    )

    const stack2 = new TerraformStack(app, "stack2")
    new LocalBackend(stack2, {
      path: path.join(rootDir, `terraform.${stack2.node.id}.tfstate`),
    })

    const stack2Module = new StackModule(stack2, "module", {})

    const stack2ModuleLocal = new TerraformLocal(stack2Module, "local-module", stack1ModuleRightRightLocal.expression)

    new TerraformOutput(stack2, "output", {
      staticId: true,
      value: stack2ModuleLocal.expression,
      sensitive: true,
    })

    await app.synth()

    await tfExec(path.join(rootDir, `cdktf.out/stacks/${stack1.node.id}`), ["init"])
    await tfExec(path.join(rootDir, `cdktf.out/stacks/${stack1.node.id}`), ["apply", "-auto-approve"])

    await tfExec(path.join(rootDir, `cdktf.out/stacks/${stack2.node.id}`), ["init"])
    await tfExec(path.join(rootDir, `cdktf.out/stacks/${stack2.node.id}`), ["apply", "-auto-approve"])
    const [res] = await tfExec(path.join(rootDir, `cdktf.out/stacks/${stack2.node.id}`), ["output", "-json"])

    expect(JSON.parse(res)?.output?.value).toBe("some-value")
  })

  it("test pure cross-stack references", async () => {
    const app = new App({ outdir: outDir })

    const stack1 = new TerraformStack(app, "stack1")

    new LocalBackend(stack1, {
      path: path.join(rootDir, `terraform.${stack1.node.id}.tfstate`),
    })

    const local = new TerraformLocal(stack1, "output", "some-value")

    const stack2 = new TerraformStack(app, "stack2")
    new LocalBackend(stack2, {
      path: path.join(rootDir, `terraform.${stack2.node.id}.tfstate`),
    })

    new TerraformOutput(stack2, "output", {
      staticId: true,
      value: local.expression,
      sensitive: true,
    })

    await app.synth()

    await tfExec(path.join(rootDir, `cdktf.out/stacks/${stack1.node.id}`), ["init"])
    await tfExec(path.join(rootDir, `cdktf.out/stacks/${stack1.node.id}`), ["apply", "-auto-approve"])

    await tfExec(path.join(rootDir, `cdktf.out/stacks/${stack2.node.id}`), ["init"])
    await tfExec(path.join(rootDir, `cdktf.out/stacks/${stack2.node.id}`), ["apply", "-auto-approve"])
    const [res] = await tfExec(path.join(rootDir, `cdktf.out/stacks/${stack2.node.id}`), ["output", "-json"])

    expect(JSON.parse(res)?.output?.value).toBe("some-value")
  })
})
