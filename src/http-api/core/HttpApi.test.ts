import { ArchiveProvider } from "@cdktf/provider-archive/lib/provider"
import { AwsProvider } from "@cdktf/provider-aws/lib/provider"
import { APIGatewayProxyEventV2, APIGatewayProxyResult } from "aws-lambda"
import { TerraformStack } from "cdktf"
import { OpenAPIV3 } from "openapi-types"
import { join } from "path"

import { Bundler } from "../../bundler/Bundler"
import { App } from "../../core/App"
import { requireFile } from "../../tests/requireFile"
import * as setup from "../../tests/setup"
import { tscCheck } from "../../tests/tscCheck"
import { HttpApiJwtAuthorizer, HttpApiLambdaAuthorizer } from "../authorizer"
import { HttpError } from "../error"
import { BundledDocument } from "../openapi/types"
import { Validators } from "../runtime/wrapper"
import { HttpApi } from "./HttpApi"

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

  it("test validators", async () => {
    const app = new App({ outdir: outDir })
    const stack = new TerraformStack(app, "stack")
    new AwsProvider(stack, "aws")
    new ArchiveProvider(stack, "archive")

    const bundler = new Bundler(stack, bundlerName, {
      language: "typescript",
      bundle: "direct",
      path: rootDir,
      prefix: "src",
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
                  "application/x-www-form-urlencoded": {
                    schema: {
                      title: "MyRequestBodyForm",
                      type: "object",
                      properties: {
                        formRequiredBodyParam: {
                          type: "string",
                        },
                        formOptionalBodyParam: {
                          type: "string",
                        },
                      },
                      required: ["formRequiredBodyParam"],
                    },
                  },
                  // "application/octet-stream": {
                  //   schema: {
                  //     type: "string",
                  //     format: "binary",
                  //   },
                  // },
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

    await tscCheck(rootDir)

    const validators = await requireFile<Validators>(
      "src/.gen/entrypoints/api/validators/testPost.validator.js",
      rootDir,
    )
    expect(typeof validators.path).toBe("function")
    expect(typeof validators.query).toBe("function")
    expect(typeof validators.header).toBe("function")
    expect(typeof validators.body).toBe("function")

    const { entrypoint } = await requireFile<{
      entrypoint: (event: Partial<APIGatewayProxyEventV2>) => Promise<APIGatewayProxyResult>
    }>("src/.gen/entrypoints/api/testPost.ts", rootDir)

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
    const app = new App({ outdir: outDir })
    const stack = new TerraformStack(app, "stack")
    new AwsProvider(stack, "aws")
    new ArchiveProvider(stack, "archive")

    const bundler = new Bundler(stack, bundlerName, {
      language: "typescript",
      bundle: "direct",
      path: rootDir,
      prefix: join("src", bundlerName),
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
    await expect(tscCheck(rootDir)).rejects.toThrowError(/Type 'number' is not assignable to type 'string'/)
  })

  const createDocumentWithAuthorizer = (
    securitySchemes?: OpenAPIV3.ComponentsObject["securitySchemes"],
  ): BundledDocument => ({
    openapi: "3.0.0",
    info: {
      title: "test",
      version: "1.0.0",
    },
    "x-sdf-source": "test",
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
    const app = new App({ outdir: outDir })
    const stack = new TerraformStack(app, "stack")
    new AwsProvider(stack, "aws")
    new ArchiveProvider(stack, "archive")

    const bundler = new Bundler(stack, bundlerName, {
      language: "typescript",
      bundle: "direct",
      path: rootDir,
      prefix: join("src", bundlerName),
    })

    const authorizer = new HttpApiLambdaAuthorizer(bundler, "my-auth", {
      name: "authorizer",
      authorizerResultTtlInSeconds: 5,
      identitySource: "$request.header.Authorization",
      contextSchema: {
        title: "AuthorizerMyAuth",
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
        additionalProperties: false,
      },
      authorizerBody: JSON.stringify({ name: "test" }),
    })

    new HttpApi(bundler, "api", {
      name: "test",
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
    await tscCheck(rootDir)
  })

  it("authorizer - apiKey", async () => {
    const app = new App({ outdir: outDir })
    const stack = new TerraformStack(app, "stack")
    new AwsProvider(stack, "aws")
    new ArchiveProvider(stack, "archive")

    const bundler = new Bundler(stack, bundlerName, {
      language: "typescript",
      bundle: "direct",
      path: rootDir,
      prefix: join("src", bundlerName),
    })

    expect(
      () =>
        new HttpApi(bundler, "api", {
          name: "test",
          document: createDocumentWithAuthorizer({
            myAuth: {
              type: "bad-type",
              in: "header",
            } as unknown as OpenAPIV3.SecuritySchemeObject,
          }),
          authorizers: {
            myAuth: new HttpApiJwtAuthorizer(stack, "authorizer", {
              audience: ["test"],
              issuer: "https://example.com",
              name: "myAuth",
            }),
          },
        }),
    ).toThrow(/unexpected authorizer combination with type bad-type and authorizer HttpApiJwtAuthorizer at/)
  })

  it("authorizer - header", async () => {
    const app = new App({ outdir: outDir })
    const stack = new TerraformStack(app, "stack")
    new AwsProvider(stack, "aws")
    new ArchiveProvider(stack, "archive")

    const bundler = new Bundler(stack, bundlerName, {
      language: "typescript",
      bundle: "direct",
      path: rootDir,
      prefix: join("src", bundlerName),
    })

    expect(
      () =>
        new HttpApi(bundler, "api", {
          name: "test",
          document: createDocumentWithAuthorizer({
            myAuth: {
              type: "apiKey",
              in: "footer",
            } as unknown as OpenAPIV3.SecuritySchemeObject,
          }),
          authorizers: {
            myAuth: new HttpApiJwtAuthorizer(stack, "authorizer", {
              audience: ["test"],
              issuer: "https://example.com",
              name: "myAuth",
            }),
          },
        }),
    ).toThrow(/unexpected authorizer combination with type apiKey and authorizer HttpApiJwtAuthorizer at/)
  })

  it("authorizer - no authorizer", async () => {
    const app = new App({ outdir: outDir })
    const stack = new TerraformStack(app, "stack")
    new AwsProvider(stack, "aws")
    new ArchiveProvider(stack, "archive")

    const bundler = new Bundler(stack, bundlerName, {
      language: "typescript",
      bundle: "direct",
      path: rootDir,
      prefix: join("src", bundlerName),
    })

    expect(
      () =>
        new HttpApi(bundler, "api", {
          name: "test",
          document: createDocumentWithAuthorizer({
            myAuth: {
              type: "apiKey",
              in: "header",
              name: "myAuth",
            },
          }),
        }),
    ).toThrow(/authorizer '.*' is defined in the OpenAPI Document/)
  })
})
