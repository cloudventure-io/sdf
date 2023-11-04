import { LambdaFunctionConfig } from "@cdktf/provider-aws/lib/lambda-function"

import { SdfApp } from "../SdfApp"
import { SdfStack } from "../SdfStack"
import { SdfHttpApi } from "../http-api/api/SdfHttpApi"
import * as setup from "../tests/setup"
import { SdfBundleManifest, SdfBundler } from "./SdfBundler"

class DummyBundler extends SdfBundler {
  public getBundleManifest(): SdfBundleManifest {
    return {
      id: "test",
      type: "docker",
    }
  }

  public lambdaConfig(): Partial<LambdaFunctionConfig> {
    return {}
  }
}

describe(SdfHttpApi.name, () => {
  const bundlerName = "test-service"
  let rootDir: string
  let outDir: string

  beforeEach(async () => {
    const res = await setup.beforeEach(SdfHttpApi.name)
    rootDir = res.rootDir
    outDir = res.outDir
  })

  afterEach(async () => {
    await setup.afterEach(rootDir)
  })

  it("schema registration - dereferencing", async () => {
    const app = new SdfApp({ outdir: outDir })
    const stack = new SdfStack(app, "stack")

    const bundler = new DummyBundler(stack, bundlerName)

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
    const app = new SdfApp({ outdir: outDir })
    const stack = new SdfStack(app, "stack")

    const bundler = new DummyBundler(stack, bundlerName)

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
