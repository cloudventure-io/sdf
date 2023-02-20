import { ArchiveProvider } from "@cdktf/provider-archive/lib/provider"
import { AwsProvider } from "@cdktf/provider-aws/lib/provider"
import { jest } from "@jest/globals"
import { APIGatewayProxyEventV2, APIGatewayProxyResult } from "aws-lambda"
import { spawn } from "child_process"
import * as esbuild from "esbuild"
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises"
import { OpenAPIV3 } from "openapi-types"
import { join, relative } from "path"

import { SdfApp } from "../../SdfApp"
import { SdfBundler } from "../../SdfBundler"
import { SdfStack } from "../../SdfStack"
import { SdfHttpApiAuthorizer } from "../SdfHttpApiAuthorizer/SdfHttpApiAuthorizer"
import { HttpError } from "../http-errors"
import { Document } from "../openapi/types"
import { Validators } from "../runtime/wrapper"
import { SdfHttpApi } from "./SdfHttpApi"

describe(SdfHttpApi.name, () => {
  const bundlerName = "test-service"
  let rootDir: string
  let tmpDir: string
  let bundleDir: string
  let packageJsonPath: string

  const tscCheck = async () => {
    const child = spawn("yarn", ["-s", "run", "tsc", "--noEmit", "-p", join(rootDir, "tsconfig.json")], {
      cwd: rootDir,
    })
    const out: Array<string> = []
    child.stdout.on("data", data => out.push(data))
    child.stderr.on("data", data => out.push(data))

    const code = await new Promise(resolve => child.on("close", code => resolve(code)))

    if (code !== 0) {
      throw new Error(`tsc exited with status code ${code}` + out.join("\n"))
    }
  }

  const requireFile = async <T>(path: string): Promise<T> => {
    const outfile = join(tmpDir, path).replace(/\.[^.]+$/, ".js")

    await esbuild.build({
      loader: {
        ".mu": "text",
      },
      absWorkingDir: bundleDir,
      platform: "node",
      entryPoints: [join(bundleDir, path)],
      outfile: outfile,
      format: "cjs",
      bundle: true,
    })

    return jest.requireActual(outfile)
  }

  beforeEach(async () => {
    const testsTmpDir = join(process.cwd(), "tmp", "tests")
    await mkdir(testsTmpDir, { recursive: true })
    rootDir = await mkdtemp(join(testsTmpDir, `${SdfHttpApi.name}-`))

    const relativePathToProjectRoot = relative(rootDir, process.cwd())

    await writeFile(
      join(rootDir, "tsconfig.json"),
      JSON.stringify(
        {
          extends: `${relativePathToProjectRoot}/tsconfig.json`,
          compilerOptions: {
            emitDeclarationOnly: false,
            noEmit: true,
            rootDirs: ["./", `${relativePathToProjectRoot}/src`],
            paths: {
              "@cloudventure/sdf": [`${relativePathToProjectRoot}/src`],
            },
          },
          include: ["./", `${relativePathToProjectRoot}/src`],
        },
        null,
        2,
      ),
    )

    tmpDir = join(rootDir, "tmp")
    await mkdir(tmpDir, { recursive: true })
    bundleDir = join(rootDir, "src", "services", bundlerName)

    await mkdir(bundleDir, {
      recursive: true,
    })

    packageJsonPath = join(bundleDir, "package.json")

    // await writeFile(
    //   packageJsonPath,
    //   JSON.stringify({
    //     name: bundlerName,
    //   }),
    // )
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  it("test validators", async () => {
    const app = new SdfApp({ rootDir, tmpDir })
    const stack = new SdfStack(app, "stack")
    new AwsProvider(stack, "aws")
    new ArchiveProvider(stack, "archive")

    const bundler = new SdfBundler(stack, bundlerName, { packageJsonPath })

    new SdfHttpApi(bundler, "api", {
      document: {
        openapi: "3.0.0",
        info: {
          title: "test",
          version: "1.0.0",
        },
        "x-sdf-spec-path": "test",
        paths: {
          "/test": {
            post: {
              operationId: "testPost",
              parameters: [
                {
                  in: "path",
                  name: "requiredPath",
                  required: true,
                  schema: { type: "string" },
                },
                {
                  in: "query",
                  name: "requiredQuery",
                  required: true,
                  schema: { type: "string" },
                },
                {
                  in: "query",
                  name: "optionalQuery",
                  schema: { type: "string" },
                },
                {
                  in: "header",
                  name: "X-Required-Header",
                  required: true,
                  schema: { type: "string" },
                },
                {
                  in: "header",
                  name: "x-optional-header",
                  schema: { type: "string" },
                },
              ],
              requestBody: {
                required: false,
                content: {
                  "application/json": {
                    schema: {
                      title: "MyRequestBody",
                      type: "object",
                      properties: {
                        requiredBodyParam: {
                          type: "string",
                        },
                        optionalBodyParam: {
                          type: "string",
                        },
                      },
                      required: ["requiredBodyParam"],
                    },
                  },
                },
              },
              responses: {
                "200": {
                  description: "test",
                  content: {
                    "application/json": {
                      schema: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      handlerBody: JSON.stringify(""),
    })

    await app.synth()

    await tscCheck()

    const validators = await requireFile<Validators>(join("api", "entrypoints", "validators", "testPost.validator.js"))
    expect(typeof validators.path).toBe("function")
    expect(typeof validators.query).toBe("function")
    expect(typeof validators.header).toBe("function")
    expect(typeof validators.body).toBe("function")

    const { entrypoint } = await requireFile<{
      entrypoint: (event: Partial<APIGatewayProxyEventV2>) => Promise<APIGatewayProxyResult>
    }>(join("api", "entrypoints", "handlerTestPost.ts"))

    expect(typeof entrypoint).toBe("function")

    // test path parameter validation
    let res = await entrypoint({})
    expect(res.statusCode).toBe(400)
    expect(res.headers?.["Content-Type"]).toBe("application/json")
    let error = HttpError.fromJSON(JSON.parse(res.body))
    expect(error.code).toBe("VALIDATION_ERROR_PATH")

    // test query string validation
    res = await entrypoint({ pathParameters: { requiredPath: "test" } })
    expect(res.statusCode).toBe(400)
    expect(res.headers?.["Content-Type"]).toBe("application/json")
    error = HttpError.fromJSON(JSON.parse(res.body))
    expect(error.code).toBe("VALIDATION_ERROR_QUERY_STRING")

    // test header validation
    res = await entrypoint({
      pathParameters: { requiredPath: "test" },
      queryStringParameters: { requiredQuery: "test" },
      headers: {},
    })
    expect(res.statusCode).toBe(400)
    expect(res.headers?.["Content-Type"]).toBe("application/json")
    error = HttpError.fromJSON(JSON.parse(res.body))
    expect(error.code).toBe("VALIDATION_ERROR_HEADER")

    // test not-required body validation
    res = await entrypoint({
      pathParameters: { requiredPath: "test" },
      queryStringParameters: { requiredQuery: "test" },
      headers: { "x-required-header": "test" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers?.["Content-Type"]).toBe("application/json")
    expect(JSON.parse(res.body)).toBe("")

    // test body validation
    res = await entrypoint({
      pathParameters: { requiredPath: "test" },
      queryStringParameters: { requiredQuery: "test" },
      headers: { "x-required-header": "test", "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.statusCode).toBe(400)
    expect(res.headers?.["Content-Type"]).toBe("application/json")
    error = HttpError.fromJSON(JSON.parse(res.body))
    expect(error.code).toBe("VALIDATION_ERROR_BODY")

    // test successfult response
    res = await entrypoint({
      pathParameters: { requiredPath: "test" },
      queryStringParameters: { requiredQuery: "test" },
      headers: { "x-required-header": "test", "content-type": "application/json" },
      body: JSON.stringify({ requiredBodyParam: "test" }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers?.["Content-Type"]).toBe("application/json")
    expect(JSON.parse(res.body)).toBe("")
  })

  it("broken typescript", async () => {
    const app = new SdfApp({ rootDir, tmpDir })
    const stack = new SdfStack(app, "stack")
    new AwsProvider(stack, "aws")
    new ArchiveProvider(stack, "archive")

    const bundler = new SdfBundler(stack, bundlerName, { packageJsonPath })

    new SdfHttpApi(bundler, "api", {
      document: {
        openapi: "3.0.0",
        info: {
          title: "test",
          version: "1.0.0",
        },
        "x-sdf-spec-path": "test",
        paths: {
          "/test": {
            post: {
              operationId: "testPost",
              responses: {
                "200": {
                  description: "test",
                  content: {
                    "application/json": {
                      schema: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      handlerBody: `5`,
    })

    await app.synth()
    await expect(tscCheck()).rejects.toThrowError(/Type 'number' is not assignable to type 'string'/)
  })

  const createDocumentWithAuthorizer = (
    securitySchemes?: OpenAPIV3.ComponentsObject["securitySchemes"],
  ): Document<Record<never, string>> => ({
    openapi: "3.0.0",
    info: {
      title: "test",
      version: "1.0.0",
    },
    "x-sdf-spec-path": "test",
    paths: {
      "/test": {
        post: {
          operationId: "testPost",
          security: [{ myAuth: [] }],
          responses: {
            "200": {
              description: "test",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: securitySchemes,
    },
  })

  it("authorizer", async () => {
    const app = new SdfApp({ rootDir, tmpDir })
    const stack = new SdfStack(app, "stack")
    new AwsProvider(stack, "aws")
    new ArchiveProvider(stack, "archive")

    const bundler = new SdfBundler(stack, bundlerName, { packageJsonPath })

    const authorizer = new SdfHttpApiAuthorizer(bundler, "my-auth", {
      authorizerResultTtlInSeconds: 5,
      identitySource: "$request.header.Authorization",
      context: {
        title: "AuthorzierMyAuth",
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
        additionalProperties: false,
      },
      authorizerBody: JSON.stringify({ name: "test" }),
    })

    new SdfHttpApi(bundler, "api", {
      document: createDocumentWithAuthorizer({
        myAuth: {
          in: "header",
          type: "apiKey",
          name: "myAuth",
        },
      }),
      authorizers: {
        myAuth: authorizer,
      },
      handlerBody: `{}`,
    })

    await app.synth()
    await tscCheck()
  })

  it("authorizer - $ref in security scheme", async () => {
    const app = new SdfApp({ rootDir, tmpDir })
    const stack = new SdfStack(app, "stack")
    new AwsProvider(stack, "aws")
    new ArchiveProvider(stack, "archive")

    const bundler = new SdfBundler(stack, bundlerName, { packageJsonPath })

    expect(() => {
      new SdfHttpApi(bundler, "api", {
        document: createDocumentWithAuthorizer({
          myAuth: {
            $ref: "#/",
          },
        }),
      })
    }).toThrowError(/\$ref in securityScheme definition is not supported/)
  })

  it("authorizer - apiKey", async () => {
    const app = new SdfApp({ rootDir, tmpDir })
    const stack = new SdfStack(app, "stack")
    new AwsProvider(stack, "aws")
    new ArchiveProvider(stack, "archive")

    const bundler = new SdfBundler(stack, bundlerName, { packageJsonPath })

    expect(() => {
      new SdfHttpApi(bundler, "api", {
        document: createDocumentWithAuthorizer({
          myAuth: {
            type: "bad-type",
            in: "header",
          } as unknown as OpenAPIV3.SecuritySchemeObject,
        }),
      })
    }).toThrowError(/only 'apiKey' authorizer type is supported/)
  })

  it("authorizer - header", async () => {
    const app = new SdfApp({ rootDir, tmpDir })
    const stack = new SdfStack(app, "stack")
    new AwsProvider(stack, "aws")
    new ArchiveProvider(stack, "archive")

    const bundler = new SdfBundler(stack, bundlerName, { packageJsonPath })

    expect(() => {
      new SdfHttpApi(bundler, "api", {
        document: createDocumentWithAuthorizer({
          myAuth: {
            type: "apiKey",
            in: "footer",
          } as unknown as OpenAPIV3.SecuritySchemeObject,
        }),
      })
    }).toThrowError(/only 'header' value is supported/)
  })

  it("authorizer - no authorizer", async () => {
    const app = new SdfApp({ rootDir, tmpDir })
    const stack = new SdfStack(app, "stack")
    new AwsProvider(stack, "aws")
    new ArchiveProvider(stack, "archive")

    const bundler = new SdfBundler(stack, bundlerName, { packageJsonPath })

    expect(() => {
      new SdfHttpApi(bundler, "api", {
        document: createDocumentWithAuthorizer({
          myAuth: {
            type: "apiKey",
            in: "header",
            name: "myAuth",
          },
        }),
      })
    }).toThrowError(/authorizer '.*' is defined in the document, but not provided/)
  })
})
