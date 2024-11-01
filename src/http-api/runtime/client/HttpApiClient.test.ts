import { ArchiveProvider } from "@cdktf/provider-archive/lib/provider"
import { AwsProvider } from "@cdktf/provider-aws/lib/provider"
import { jest } from "@jest/globals"
import {
  APIGatewayEventRequestContextV2,
  APIGatewayProxyEventV2WithRequestContext,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda"
import { TerraformStack } from "cdktf"

import { Bundler } from "../../../bundler"
import { App } from "../../../core"
import { HttpServer, createHttpServer } from "../../../tests/createHttpServer"
import { requireFile } from "../../../tests/requireFile"
import * as setup from "../../../tests/setup"
import { tscCheck } from "../../../tests/tscCheck"
import { MimeTypes } from "../../common/MimeTypes"
import { HttpApi } from "../../core/HttpApi"
import { ApiResponse } from "../common/ApiResponse"
import { HttpApiClient, HttpApiClientRequestShape } from "./HttpApiClient"

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
        const {
          entrypoint,
        }: {
          entrypoint: (
            request: Partial<APIGatewayProxyEventV2WithRequestContext<unknown>>,
          ) => Promise<APIGatewayProxyStructuredResultV2>
        } = await requireFile(entrypointPath, rootDir)

        const requestEvent: Partial<APIGatewayProxyEventV2WithRequestContext<unknown>> = {
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
          Object.entries(res.headers).forEach(([key, value]) => value && response.setHeader(key, "" + value))
        }
        response.writeHead(res.statusCode || 200)
        if (res.body) {
          response.write(res.body)
        }
        response.end()
      })
    })
  })

  afterEach(async () => {
    if (apiServer) {
      await apiServer.close()
    }
    apiEntrypoints.mockClear()
    await setup.afterEach(rootDir)
  })

  it("test client", async () => {
    const app = new App({ outdir: outDir })
    const stack = new TerraformStack(app, "stack")
    const aws = new AwsProvider(stack, "aws")
    const archive = new ArchiveProvider(stack, "archive")

    const bundler = new Bundler(stack, bundlerName, {
      language: "typescript",
      bundle: "none",
      path: rootDir,
      prefix: "src",
      providers: [aws, archive],
    })

    new HttpApi(bundler, "api", {
      name: "test",
      document: {
        openapi: "3.0.0",
        info: {
          title: "test",
          version: "1.0.0",
        },
        "x-sdf-source": "test",
        paths: {
          "/test": {
            get: {
              operationId: "testGet",
              "x-sdf-gen": {
                content: {
                  body: JSON.stringify({ name: "test get response" }),
                },
              },
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
                "400": {
                  description: "error",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          error: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
            post: {
              operationId: "testPost",
              "x-sdf-gen": {
                content: {
                  body: JSON.stringify({ name: "test post response" }),
                },
              },
              requestBody: {
                required: true,
                content: {
                  [MimeTypes.ApplicationJson]: {
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
                    [MimeTypes.ApplicationJson]: {
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
              "x-sdf-gen": {
                content: {
                  body: JSON.stringify({ name: "test get item response" }),
                },
              },
              responses: {
                "200": {
                  description: "test",
                  content: {
                    [MimeTypes.ApplicationJson]: {
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
    })

    await app.synth()

    await tscCheck(rootDir)

    type BaseClientIface = HttpApiClient & {
      [key in "testGet" | "testPost" | "testGetItem"]: (req?: HttpApiClientRequestShape) => Promise<ApiResponse>
    }

    const { BaseApiClient }: { BaseApiClient: typeof HttpApiClient } = await requireFile(
      "src/.gen/api/BaseApiClient.ts",
      rootDir,
    )

    const client: BaseClientIface = new BaseApiClient({
      baseUrl: `http://${apiServer.address.address}:${apiServer.address.port}`,
    }) as BaseClientIface

    apiEntrypoints.mockImplementation(
      (op: string) =>
        ({
          "GET /test": "src/.gen/.entrypoints/api/testGet.ts",
          "POST /test": "src/.gen/.entrypoints/api/testPost.ts",
          "GET /test/123": "src/.gen/.entrypoints/api/testGetItem.ts",
        })[op],
    )

    let res = await client.testGet()
    expect(res.statusCode).toBe(200)
    expect(res.body).toStrictEqual({ name: "test get response" })

    res = await client.testPost({ body: { name: "asd" } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toStrictEqual({ name: "test post response" })

    res = await client.testGetItem({ path: { itemId: "123" } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toStrictEqual({ name: "test get item response" })

    await expect(client.testGetItem({ path: { asd: "123" } })).rejects.toThrow(
      /Parameter .* not found in the provided parameters map/,
    )
  })
})
