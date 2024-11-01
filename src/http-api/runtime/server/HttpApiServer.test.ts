import { ArchiveProvider } from "@cdktf/provider-archive/lib/provider"
import { AwsProvider } from "@cdktf/provider-aws/lib/provider"
import { APIGatewayProxyEventV2WithRequestContext, APIGatewayProxyStructuredResultV2 } from "aws-lambda"
import { TerraformStack } from "cdktf"
import { OpenAPIV3 } from "openapi-types"

import { Bundler } from "../../../bundler/Bundler"
import { App } from "../../../core/App"
import { requireFile } from "../../../tests/requireFile"
import * as setup from "../../../tests/setup"
import { tscCheck } from "../../../tests/tscCheck"
import { HttpHeaders } from "../../common/HttpHeaders"
import { HttpStatusCodes } from "../../common/HttpStatusCodes"
import { HttpApi } from "../../core/HttpApi"
import { OperationConfig } from "../../openapi/Operation"
import { OperationSdfGen } from "../../openapi/types"
import { UnsupportedMediaType } from "../errors"

describe("HttpApiServer", () => {
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

  const synthApp = async (
    handlerBody: OperationSdfGen,
    {
      jsonBody,
      formBody,
      responses,
      params,
    }: {
      jsonBody?: OpenAPIV3.SchemaObject
      formBody?: OpenAPIV3.SchemaObject
      responses?: OperationConfig["responses"]
      params?: OperationConfig["parameters"]
    } = {},
  ) => {
    const app = new App({ outdir: outDir })
    const stack = new TerraformStack(app, "stack")
    const aws = new AwsProvider(stack, "aws")
    const archive = new ArchiveProvider(stack, "archive")

    const bundler = new Bundler(stack, bundlerName, {
      language: "typescript",
      bundle: "direct",
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
            post: {
              operationId: "testPost",
              "x-sdf-gen": handlerBody,
              parameters: [
                {
                  in: "header",
                  name: "x-header-required",
                  required: true,
                },
                {
                  in: "header",
                  name: "x-header-optional",
                },
                {
                  in: "query",
                  name: "query-required",
                  required: true,
                },
                {
                  in: "query",
                  name: "query-optional",
                },
                ...(params || []),
              ],
              requestBody: {
                required: false,
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/JsonBody" },
                  },
                  "application/x-www-form-urlencoded": {},
                },
              },
              responses: responses || {
                "200": {
                  description: "with schema",
                  content: {
                    "application/json": {
                      schema: { $ref: "#/components/schemas/JsonBody" },
                    },
                    "application/x-www-form-urlencoded": {
                      schema: { $ref: "#/components/schemas/FormBody" },
                    },
                  },
                  headers: {
                    "x-header": {
                      schema: { type: "string" },
                    },
                  },
                },
                "201": {
                  description: "without schema",
                  content: {
                    "application/json": {},
                    "application/x-www-form-urlencoded": {},
                  },
                },
                "204": {
                  description: "without content",
                },
              },
            },
          },
        },
        components: {
          schemas: {
            JsonBody: jsonBody || {
              title: "JsonBody",
              type: "object",
              properties: { json: { type: "boolean" } },
              required: ["json"],
              additionalProperties: false,
            },
            FormBody: formBody || {
              title: "FormBody",
              type: "object",
              properties: { form: { type: "string" } },
              required: ["form"],
              additionalProperties: false,
            },
          },
        },
      },
      // handlerBody,
    })

    await app.synth()

    return app
  }

  it("response generation - global default - success", async () => {
    await synthApp({ content: { body: JSON.stringify({ json: true }) } })
    await tscCheck(rootDir)
  })

  it("response generation - global default - error", async () => {
    await synthApp({ content: { body: JSON.stringify({ nojson: true }) } })
    await expect(tscCheck(rootDir)).rejects.toThrow(/is not assignable to type 'Response'/)
  })

  it("response generation - status code default with specific body - success", async () => {
    await synthApp({ content: { body: JSON.stringify({ json: true }) }, statusCode: 200 })
    await tscCheck(rootDir)
  })

  it("response generation - status code default with specific body - error", async () => {
    await synthApp({ content: { body: JSON.stringify({ nojson: true }) }, statusCode: 200 })
    await expect(tscCheck(rootDir)).rejects.toThrow(/is not assignable to type 'Response'/)
  })

  it("response generation - status code default with arbitrary body - success", async () => {
    await synthApp({
      content: { body: JSON.stringify({ arbitrary: "content" }), mediaType: "application/json" },
      statusCode: 201,
    })
    await tscCheck(rootDir)
  })

  it("response generation - constrained by codec type - error", async () => {
    await synthApp(
      {
        content: { body: JSON.stringify({ form: false }), mediaType: "application/x-www-form-urlencoded" },
        statusCode: 200,
      },
      {
        formBody: {
          title: "FormBody",
          type: "object",
          properties: { form: { type: "boolean" } },
          required: ["form"],
          additionalProperties: false,
        },
      },
    )
    await expect(tscCheck(rootDir)).rejects.toThrow(/Type 'boolean' is not assignable to type 'string'/)
  })

  it("response generation - global default without content - success", async () => {
    await synthApp({ content: { body: null } }, { responses: { 200: { description: "without content" } } })
    await tscCheck(rootDir)
  })

  it("response generation - global default with arbitrary content - success", async () => {
    const body = JSON.stringify({ arbitrary: "content" })
    await synthApp(
      { content: { body, mediaType: "application/json" }, statusCode: 200 },
      {
        responses: {
          200: {
            description: "without content",
            content: {
              "application/json": {},
            },
          },
        },
      },
    )
    await tscCheck(rootDir)

    const { entrypoint } = await requireFile<{
      entrypoint: (
        event: Partial<APIGatewayProxyEventV2WithRequestContext<unknown>>,
      ) => Promise<APIGatewayProxyStructuredResultV2>
    }>("src/.gen/.entrypoints/api/testPost.ts", rootDir)

    const res = await entrypoint({})

    expect(res).toStrictEqual({
      statusCode: HttpStatusCodes.Ok,
      headers: { [HttpHeaders.ContentType]: "application/json" },
      body: body,
      isBase64Encoded: false,
    })
  })

  it("cookie validation - success", async () => {
    const body = `request.cookie["cookie-required"]`

    await synthApp(
      { content: { body, mediaType: "application/json" }, statusCode: 200 },
      {
        params: [
          {
            in: "cookie",
            name: "cookie-required",
            required: true,
            schema: { type: "string", pattern: "^match" },
          },
        ],
      },
    )
    await tscCheck(rootDir)

    const { entrypoint } = await requireFile<{
      entrypoint: (
        event: Partial<APIGatewayProxyEventV2WithRequestContext<unknown>>,
      ) => Promise<APIGatewayProxyStructuredResultV2>
    }>("src/.gen/.entrypoints/api/testPost.ts", rootDir)

    let res = await entrypoint({ cookies: ["cookie-required=match-value"] })

    expect(res).toStrictEqual({
      statusCode: HttpStatusCodes.Ok,
      headers: { [HttpHeaders.ContentType]: "application/json" },
      body: JSON.stringify("match-value"),
      isBase64Encoded: false,
    })

    res = await entrypoint({ cookies: ["cookie-required=nomatch-value"] })
    expect(res.statusCode).toStrictEqual(HttpStatusCodes.BadRequest)
  })

  it("application/json codec - success", async () => {
    const body = JSON.stringify({ json: true })

    await synthApp({ content: { body } })
    await tscCheck(rootDir)

    const { entrypoint } = await requireFile<{
      entrypoint: (
        event: Partial<APIGatewayProxyEventV2WithRequestContext<unknown>>,
      ) => Promise<APIGatewayProxyStructuredResultV2>
    }>("src/.gen/.entrypoints/api/testPost.ts", rootDir)

    const res = await entrypoint({
      body: body,
      headers: { [HttpHeaders.ContentType]: "application/json" },
    })

    expect(res).toStrictEqual({
      statusCode: 200,
      headers: { [HttpHeaders.ContentType]: "application/json" },
      body: body,
      isBase64Encoded: false,
    })
  })

  it("unsupported media type - error", async () => {
    const body = JSON.stringify({ json: true })

    await synthApp({ content: { body } })
    await tscCheck(rootDir)

    const { entrypoint } = await requireFile<{
      entrypoint: (
        event: Partial<APIGatewayProxyEventV2WithRequestContext<unknown>>,
      ) => Promise<APIGatewayProxyStructuredResultV2>
    }>("src/.gen/.entrypoints/api/testPost.ts", rootDir)

    const res = await entrypoint({
      body: body,
      headers: { [HttpHeaders.ContentType]: "application/aaa" },
    })

    expect(res).toStrictEqual({
      statusCode: HttpStatusCodes.UnsupportedMediaType,
      headers: { [HttpHeaders.ContentType]: "application/json" },
      body: JSON.stringify(
        new UnsupportedMediaType("UNSUPPORTED_MEDIA_TYPE", "unsupported media type 'application/aaa'").toJSON(),
      ),
      isBase64Encoded: false,
    })
  })
})
