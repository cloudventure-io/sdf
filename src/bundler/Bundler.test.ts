import { TerraformStack } from "cdktf"

import { App } from "../core/App"
import { HttpApi } from "../http-api/core/HttpApi"
import * as setup from "../tests/setup"
import { Bundler } from "./Bundler"

describe(HttpApi.name, () => {
  const bundlerName = "test-service"
  let rootDir: string
  let outDir: string

  beforeEach(async () => {
    const res = await setup.beforeEach(HttpApi.name)
    rootDir = res.rootDir
    outDir = res.outDir
  })

  afterEach(async () => {
    await setup.afterEach(rootDir)
  })

  it("schema registration - dereferencing", async () => {
    const app = new App({ outdir: outDir })
    const stack = new TerraformStack(app, "stack")

    const bundler = new Bundler(stack, bundlerName, {
      language: "custom",
      bundle: "none",
    })

    const schema1 = bundler.registerSchema({
      title: "TEST_TITLE",
      properties: {
        name: { type: "string" },
        p1: { type: "object", title: "SUB", properties: { field: { type: "string" } } },
      },
    })

    const schema2 = bundler.registerSchema({
      title: "TEST_TITLE2",
      properties: {
        name: { type: "string" },
        p2: { type: "object", title: "SUB", properties: { field: { type: "string" } } },
      },
    })

    expect(schema1.properties?.p1).toEqual(schema2.properties?.p2)
  })

  it("schema registration - errors", async () => {
    const app = new App({ outdir: outDir })
    const stack = new TerraformStack(app, "stack")

    const bundler = new Bundler(stack, bundlerName, {
      language: "custom",
      bundle: "none",
    })

    bundler.registerSchema({
      title: "TEST_TITLE",
      properties: {
        name: { type: "string" },
        p1: { type: "object", title: "SUB", properties: { field: { type: "string" } } },
      },
    })

    expect(() =>
      bundler.registerSchema({
        title: "TEST_TITLE",
      }),
    ).toThrowError(/schema with title .* was already registered with different structure/)

    expect(() =>
      bundler.registerSchema({
        type: "object",
      }),
    ).toThrowError(/the top level schema must have a title/)
  })
})
