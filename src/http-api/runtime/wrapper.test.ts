import { jest } from "@jest/globals"
import Ajv, { SchemaObject, ValidateFunction } from "ajv"
import { APIGatewayProxyEventV2 } from "aws-lambda"
import { OpenAPIV3 } from "openapi-types"

import { SchemaRegistry } from "../../core/SchemaRegistry"
import { MimeTypes } from "../../utils/MimeTypes"
import { DocumentSchemaAdapter } from "../core/DocumentSchemaAdapter"
import { HttpHeaders } from "../enum/HttpHeaders"
import { BadGateway } from "../error"
import { Document } from "../openapi/Document"
import { SchemaItem } from "../openapi/SchemaItem"
import { BundledDocument, OperationObject } from "../openapi/types"
import { dereference } from "../openapi/utils"
import { ApiResponse } from "./ApiResponse"
import { LambdaHandler, wrapper } from "./wrapper"

describe("handler wrapper tests", () => {
  const createDocumentFromOperation = (pathSpec: OperationObject<OpenAPIV3.SchemaObject>): BundledDocument => ({
    info: {
      title: "test",
      version: "1.0.0",
    },
    "x-sdf-source": "test",
    components: {},
    openapi: "3.0.0",
    paths: {
      "/test": {
        post: pathSpec,
      },
    },
  })

  const createDocument = ({ required }: { required: boolean }) =>
    new Document(
      dereference(
        createDocumentFromOperation({
          operationId: "testPost",
          requestBody: {
            required,
            content: {
              [MimeTypes.APPLICATION_JSON]: {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    req: { type: "string" },
                    opt: { type: "string" },
                    array: { type: "array", items: { type: "string" } },
                  },
                  required: ["req"],
                },
              },
              [MimeTypes.APPLICATION_X_WWW_FORM_URLENCODED]: {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    req: { type: "string" },
                    opt: { type: "string" },
                    array: { type: "array", items: { type: "string" } },
                  },
                  required: ["req"],
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
        }),
      ),
    )

  const createHandler = async ({ required, callback }: { required: boolean; callback?: LambdaHandler<any> }) => {
    const document = createDocument({ required })
    const schemaRegistry = new SchemaRegistry()
    const schemaAdapter = new DocumentSchemaAdapter({ document, authorizers: {}, schemaRegistry })

    const op = schemaAdapter.operationsMap["testPost"]

    const schemas = Object.entries(op.schemas.requestExpanded)
      .filter((e): e is [string, SchemaItem] => e[1])
      .map<SchemaObject>(([key, schema]) => ({
        $id: key,
        ...schema.value,
      }))

    const ajv = new Ajv({
      strict: false,
      allErrors: true,
    })

    const validators = schemas.reduce<Record<string, ValidateFunction>>(
      (acc, schema) => ({
        ...acc,
        [schema.$id as string]: ajv.compile(schema),
      }),
      {},
    )

    return wrapper({
      handler:
        callback ||
        (async ({ body }): Promise<ApiResponse<unknown, 200>> => {
          return new ApiResponse(body, 200)
        }),
      validators,
      operation: op.operation,
    })
  }

  it("invalid body", async () => {
    const handler = await createHandler({ required: true })
    const res = await handler({
      headers: {
        [HttpHeaders.ContentType]: MimeTypes.APPLICATION_JSON,
      },
      body: JSON.stringify({
        re: "test",
      }),
    } as unknown as APIGatewayProxyEventV2)

    expect(res.statusCode).toBe(400)
    expect(res.body).toBeTruthy()
    const body = JSON.parse(res.body!)
    expect(body.code).toBe("VALIDATION_ERROR_BODY")
  })

  it("unsupported media type", async () => {
    const handler = await createHandler({ required: true })
    const res = await handler({
      headers: {
        [HttpHeaders.ContentType]: "aaa",
      },
      body: JSON.stringify({
        re: "test",
      }),
    } as unknown as APIGatewayProxyEventV2)

    expect(res.statusCode).toBe(415)
    expect(res.body).toBeTruthy()
    const body = JSON.parse(res.body!)
    expect(body.code).toBe("UNSUPPORTED_MEDIA_TYPE")
  })

  it("no content type", async () => {
    const handler = await createHandler({ required: true })
    const res = await handler({
      headers: {},
      body: JSON.stringify({
        re: "test",
      }),
    } as unknown as APIGatewayProxyEventV2)

    expect(res.statusCode).toBe(415)
    expect(res.body).toBeTruthy()
    const body = JSON.parse(res.body!)
    expect(body.code).toBe("UNSUPPORTED_MEDIA_TYPE")
  })

  it("valid body - application/json", async () => {
    const handler = await createHandler({ required: true })
    const res = await handler({
      headers: {
        [HttpHeaders.ContentType]: MimeTypes.APPLICATION_JSON,
      },
      body: JSON.stringify({
        req: "test",
      }),
    } as unknown as APIGatewayProxyEventV2)

    expect(res.statusCode).toBe(200)
  })

  it("valid body - application/x-www-form-urlencoded", async () => {
    const handler = await createHandler({ required: true })
    const res = await handler({
      headers: {
        [HttpHeaders.ContentType]: MimeTypes.APPLICATION_X_WWW_FORM_URLENCODED,
      },
      body: "req=test",
    } as unknown as APIGatewayProxyEventV2)

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body!)
    expect(body).toStrictEqual({ req: "test" })
  })

  it("optional body", async () => {
    const handler = await createHandler({ required: false })

    const res = await handler({
      headers: {},
    } as unknown as APIGatewayProxyEventV2)
    expect(res.statusCode).toBe(200)
  })

  it("optional body - application/json", async () => {
    const handler = await createHandler({ required: false })

    const res = await handler({
      headers: {
        [HttpHeaders.ContentType]: MimeTypes.APPLICATION_JSON,
      },
      body: JSON.stringify({
        req: "test",
      }),
    } as unknown as APIGatewayProxyEventV2)
    expect(res.statusCode).toBe(200)
  })

  it("throwing ApiResponse", async () => {
    const handler = await createHandler({
      required: false,
      callback: async (): Promise<ApiResponse<unknown, 200>> => {
        throw new ApiResponse(null, 201)
      },
    })

    const res = await handler({
      headers: {},
    } as unknown as APIGatewayProxyEventV2)
    expect(res.statusCode).toBe(201)
  })

  it("throwing HttpError", async () => {
    const handler = await createHandler({
      required: false,
      callback: async (): Promise<ApiResponse<unknown, 200>> => {
        throw new BadGateway("TEST", "hello message")
      },
    })

    const res = await handler({
      headers: {},
    } as unknown as APIGatewayProxyEventV2)

    expect(res.statusCode).toBe(502)
    expect(res.body).toBeTruthy()
    const body = JSON.parse(res.body!)
    expect(body.code).toBe("TEST")
    expect(body.message).toBe("hello message")
  })

  it("throwing generic error", async () => {
    const handler = await createHandler({
      required: false,
      callback: async (): Promise<ApiResponse<unknown, 200>> => {
        throw new Error("generic error")
      },
    })

    const spy = jest.spyOn(console, "error").mockImplementation(() => {
      /* noop */
    })
    const res = await handler({
      headers: {},
    } as unknown as APIGatewayProxyEventV2)
    spy.mockClear()

    expect(res.statusCode).toBe(500)
    expect(res.body).toBeTruthy()
    const body = JSON.parse(res.body!)
    expect(body.code).toBe("INTERNAL_SERVER_ERROR")
  })
})
