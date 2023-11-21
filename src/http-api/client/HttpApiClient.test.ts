import { ArchiveProvider } from "@cdktf/provider-archive/lib/provider"
import { AwsProvider } from "@cdktf/provider-aws/lib/provider"
import { jest } from "@jest/globals"
import { APIGatewayEventRequestContextV2 } from "aws-lambda"

import { App } from "../../App"
import { Stack } from "../../Stack"
import { BundlerTypeScript } from "../../bundler/BundlerTypeScript"
import { HttpServer, createHttpServer } from "../../tests/createHttpServer"
import { requireFile } from "../../tests/requireFile"
import * as setup from "../../tests/setup"
import { tscCheck } from "../../tests/tscCheck"
import { MimeTypes } from "../../utils/MimeTypes"
import { HttpApi } from "../HttpApi"
import { ApiResponse, EventType, Operation } from "../runtime"
import { HttpApiClient } from "./HttpApiClient"

const apiEntrypoints = jest.fn<(op: string) => string | undefined>()

describe(HttpApiClient.name, () => {
  const bundlerName = "test-service"
  let rootDir: string
  let outDir: string
  let apiServer: HttpServer

  beforeEach(async () => {
    const res = await setup.beforeEach(HttpApiClient.name)
    rootDir = res.rootDir
    outDir = res.outDir

    apiServer = await createHttpServer(async (request, response) => {
      const url = request.url
      const op = `${request.method} ${request.url}`
      const entrypointPath = apiEntrypoints(op)

      if (!url || !entrypointPath) {
        response.writeHead(404)
        response.end()
        return
      }

      const chunks: Array<Buffer> = []
      request.on("data", chunk => chunks.push(chunk))
      request.on("end", async () => {
        const { entrypoint }: { entrypoint: (request: EventType<Operation>) => Promise<ApiResponse<any, any>> } =
          await requireFile(entrypointPath, rootDir)

        const requestEvent: EventType<Operation> = {
          headers: Object.fromEntries(
            Object.entries(request.headers)
              .filter<[string, string | string[]]>(
                (entry): entry is [string, string | string[]] => entry[1] !== undefined,
              )
              .map(([key, values]) => [key, typeof values == "string" ? values : values.join("; ")]),
          ),
          isBase64Encoded: false,
          rawPath: url,
          routeKey: op,
          rawQueryString: "TODO", // TODO
          requestContext: null as unknown as APIGatewayEventRequestContextV2,
          version: "2.0",
          body: Buffer.concat(chunks).toString("utf-8"),
        }

        const res = await entrypoint(requestEvent)

        if (res.headers) {
          Object.entries(res.headers).forEach(([key, value]) => response.setHeader(key, value))
        }
        response.writeHead(res.statusCode)
        if (res.body) {
          response.write(res.body)
        }
        response.end()
      })
    })
  })

  afterEach(async () => {
    apiServer && (await apiServer.close())
    apiEntrypoints.mockClear()
    await setup.afterEach(rootDir)
  })

  it("test client", async () => {
    const app = new App({ outdir: outDir })
    const stack = new Stack(app, "stack")
    new AwsProvider(stack, "aws")
    new ArchiveProvider(stack, "archive")

    const bundler = new BundlerTypeScript(stack, bundlerName, {
      path: rootDir,
      prefix: "src",
    })

    new HttpApi(bundler, "api", {
      document: {
        openapi: "3.0.0",
        info: {
          title: "test",
          version: "1.0.0",
        },
        "x-sdf-spec-path": "test",
        paths: {
          "/test": {
            get: {
              operationId: "testGet",
              responses: {
                "200": {
                  description: "test",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
            post: {
              operationId: "testPost",
              requestBody: {
                required: true,
                content: {
                  [MimeTypes.APPLICATION_JSON]: {
                    schema: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                      },
                      required: ["name"],
                    },
                  },
                },
              },
              responses: {
                "200": {
                  description: "test",
                  content: {
                    [MimeTypes.APPLICATION_JSON]: {
                      schema: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },

          "/test/{itemId}": {
            get: {
              operationId: "testGetItem",
              responses: {
                "200": {
                  description: "test",
                  content: {
                    [MimeTypes.APPLICATION_JSON]: {
                      schema: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      generateClient: {
        name: "Api",
      },
      handlerBody: JSON.stringify({ name: "test name" }),
    })

    await app.synth()

    await tscCheck(rootDir)

    type BaseClientIface = HttpApiClient & {
      [key in "testGet" | "testPost" | "testGetItem"]: (
        req: Partial<Omit<Operation["request"], "authorizer">>,
      ) => Promise<Operation["responses"]>
    }

    const { BaseApiClient }: { BaseApiClient: typeof HttpApiClient } = await requireFile(
      "src/.gen/client/BaseApiClient.ts",
      rootDir,
    )

    const client: BaseClientIface = new BaseApiClient({
      baseUrl: `http://${apiServer.address.address}:${apiServer.address.port}`,
    }) as BaseClientIface

    apiEntrypoints.mockImplementation(
      (op: string) =>
        ({
          "GET /test": "src/.gen/entrypoints/api/testGet.ts",
          "POST /test": "src/.gen/entrypoints/api/testPost.ts",
          "GET /test/123": "src/.gen/entrypoints/api/testGetItem.ts",
        })[op],
    )

    let res = await client.testGet({})
    expect(res.statusCode).toBe(200)
    expect(res.body).toStrictEqual({ name: "test name" })

    res = await client.testPost({ body: { name: "asd" } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toStrictEqual({ name: "test name" })

    res = await client.testGetItem({ path: { itemId: "123" } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toStrictEqual({ name: "test name" })

    await expect(client.testGetItem({ path: { asd: "123" } })).rejects.toThrow(
      /Parameter .* not found in the provided parameters map/,
    )
  })
})
