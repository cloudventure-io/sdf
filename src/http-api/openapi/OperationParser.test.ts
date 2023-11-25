import { OpenAPIV3 } from "openapi-types"

import { OperationParser } from "./OperationParser"
import { Document, ParameterObject, RequestBodyObject, ResponseObject } from "./types"

const createDocument = ({
  pathParameters,
  operationParameters,
  requestBody,
  responses,
  security,
}: {
  pathParameters?: Array<ParameterObject<OpenAPIV3.SchemaObject>>
  operationParameters?: Array<ParameterObject<OpenAPIV3.SchemaObject>>
  requestBody?: RequestBodyObject<OpenAPIV3.SchemaObject>
  responses?: {
    [code: string]: ResponseObject<Record<never, string>>
  }
  security?: Array<OpenAPIV3.SecurityRequirementObject>
}): Document<Record<never, string>> => ({
  openapi: "3.0.0",
  info: {
    title: "test",
    version: "1.0.0",
  },
  "x-sdf-spec-path": "test-path",
  paths: {
    "/test": {
      parameters: pathParameters,
      get: {
        parameters: operationParameters,
        operationId: "testOperation",
        requestBody,
        responses: responses || {
          "200": {
            description: "test",
            content: {
              "application/json": {
                schema: { type: "string" },
              },
            },
          },
        },
        security,
      },
    },
  },
})

describe(OperationParser.name, () => {
  it("check parameter merging", async () => {
    const parser = new OperationParser(
      createDocument({
        pathParameters: [
          {
            in: "query",
            name: "param1",
            schema: { type: "string" },
          },
          {
            in: "query",
            name: "param2",
            schema: { type: "string" },
          },
          {
            in: "path",
            name: "param3",
            schema: { type: "string" },
          },
        ],
        operationParameters: [
          {
            in: "query",
            name: "param1",
            schema: { type: "boolean" },
            required: true,
          },
        ],
      }),
    )

    const operationSchema = await parser.parseOperation("/test", OpenAPIV3.HttpMethods.GET)

    expect(operationSchema.request.parameters.cookie).toBeUndefined()
    expect(operationSchema.request.parameters.header).toBeUndefined()
    expect(operationSchema.request.parameters?.query?.required).toStrictEqual(["param1"])
    expect(operationSchema.request.parameters?.query?.properties?.param1).toStrictEqual({ type: "boolean" })
    expect(operationSchema.request.parameters?.query?.properties?.param2).toStrictEqual({ type: "string" })
    expect(operationSchema.request.parameters?.path?.properties?.param3).toStrictEqual({ type: "string" })
  })

  it("header parameter case-insensitivity", async () => {
    const parser = new OperationParser(
      createDocument({
        pathParameters: [
          {
            in: "header",
            name: "X-test-Header",
            schema: { type: "string" },
          },
          {
            in: "header",
            name: "x-test-Header2",
            schema: { type: "string" },
          },
        ],
        operationParameters: [
          {
            in: "header",
            name: "x-test-header",
            schema: { type: "boolean" },
            required: true,
          },
        ],
      }),
    )

    const operationSchema = await parser.parseOperation("/test", OpenAPIV3.HttpMethods.GET)

    expect(operationSchema.request.parameters.cookie).toBeUndefined()
    expect(operationSchema.request.parameters.query).toBeUndefined()
    expect(operationSchema.request.parameters.path).toBeUndefined()
    expect(Object.keys(operationSchema.request.parameters?.header?.properties || {})).toStrictEqual([
      "x-test-header",
      "x-test-header2",
    ])
    expect(operationSchema.request.parameters.header?.required).toStrictEqual(["x-test-header"])
    expect(operationSchema.request.parameters.header?.properties?.["x-test-header"]).toStrictEqual({ type: "boolean" })
    expect(operationSchema.request.parameters.header?.properties?.["x-test-header2"]).toStrictEqual({ type: "string" })
  })

  it("unknown parameter type", async () => {
    const parser = new OperationParser(
      createDocument({
        pathParameters: [
          {
            in: "aaa",
            name: "test",
            schema: { type: "string" },
          },
        ],
      }),
    )

    expect(parser.parseOperation("/test", OpenAPIV3.HttpMethods.GET)).rejects.toThrow(/unknown value of 'in' attribute/)
  })

  it("request body required error", async () => {
    const parser = new OperationParser(
      createDocument({
        requestBody: {
          required: true,
          content: {},
        },
      }),
    )

    expect(parser.parseOperation("/test", OpenAPIV3.HttpMethods.GET)).rejects.toThrow(
      /requestBody is required, but no body schema is specified/,
    )
  })

  it("request body required error - no schema", async () => {
    const parser = new OperationParser(
      createDocument({
        requestBody: {
          required: true,
          content: {
            "application/json": {},
          },
        },
      }),
    )

    expect(parser.parseOperation("/test", OpenAPIV3.HttpMethods.GET)).rejects.toThrow(
      /requestBody schema is required at/,
    )
  })

  it("request body", async () => {
    const parser = new OperationParser(
      createDocument({
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "string" },
            },
            "text/xml": {
              schema: { type: "boolean" },
            },
          },
        },
      }),
    )

    const operation = await parser.parseOperation("/test", OpenAPIV3.HttpMethods.GET)

    expect(operation.request.body).toBeTruthy()
    expect(operation.request.body?.required).toBeTruthy()
    expect(operation.request.body?.schemas).toMatchObject({
      "application/json": { type: "string" },
      "text/xml": { type: "boolean" },
    })
  })

  it("missing path", async () => {
    const parser = new OperationParser(createDocument({}))

    expect(parser.parseOperation("/not-found", OpenAPIV3.HttpMethods.GET)).rejects.toThrowError(/path is undefined at/)
  })

  it("missing operation", async () => {
    const parser = new OperationParser(createDocument({}))

    expect(parser.parseOperation("/test", OpenAPIV3.HttpMethods.POST)).rejects.toThrowError(/operation is undefined at/)
  })

  it("operation responses", async () => {
    const parser = new OperationParser(
      createDocument({
        responses: {
          "200": {
            description: "test",
            headers: {
              "X-header-1": {
                schema: { type: "string" },
                required: true,
              },
              "X-HEADER-2": {
                schema: { type: "string" },
                required: false,
              },
            },
            content: {
              "application/json": {
                schema: {
                  type: "string",
                },
              },
            },
          },
          "400": {
            description: "test",
            content: {
              "application/json": {
                schema: {
                  type: "boolean",
                },
              },
            },
          },
          "302": {
            description: "test",
          },
        },
      }),
    )

    const operation = await parser.parseOperation("/test", OpenAPIV3.HttpMethods.GET)
    expect(operation.responses.length).toBe(3)
    expect(operation.responses[0].required).toStrictEqual(["statusCode", "headers", "body"])
    expect(operation.responses[0].properties?.statusCode?.["type"]).toBe("number")
    expect(operation.responses[0].properties?.statusCode?.["enum"]).toStrictEqual([200])
    expect(operation.responses[0].properties?.body?.["type"]).toStrictEqual("string")

    expect(operation.responses[0].properties?.headers).toStrictEqual({
      type: "object",
      properties: {
        "x-header-1": {
          type: "string",
        },
        "x-header-2": {
          type: "string",
        },
      },
      required: ["x-header-1"],
      additionalProperties: false,
    })

    expect(operation.responses[1].required).toStrictEqual(["statusCode", "headers"])
    expect(operation.responses[1].properties?.statusCode?.["type"]).toBe("number")
    expect(operation.responses[1].properties?.statusCode?.["enum"]).toStrictEqual([302])
    expect(operation.responses[1].properties?.body).toBeUndefined()

    expect(operation.responses[2].properties?.statusCode?.["type"]).toBe("number")
    expect(operation.responses[2].properties?.statusCode?.["enum"]).toStrictEqual([400])
    expect(operation.responses[2].properties?.body?.["type"]).toStrictEqual("boolean")
  })

  it("operation responses - multiple content types", async () => {
    const parser = new OperationParser(
      createDocument({
        responses: {
          "200": {
            description: "test",
            content: {
              "application/json": {
                schema: {
                  type: "string",
                },
              },
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore
              "text/html": {
                schema: {
                  type: "string",
                },
              },
            },
          },
        },
      }),
    )

    expect(parser.parseOperation("/test", OpenAPIV3.HttpMethods.GET)).rejects.toThrowError(
      /only single resposne content type is supported/,
    )
  })

  it("operation responses - non application/json content type", async () => {
    const parser = new OperationParser(
      createDocument({
        responses: {
          "200": {
            description: "test",
            content: {
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore
              "text/html": {
                schema: {
                  type: "string",
                },
              },
            },
          },
        },
      }),
    )

    expect(parser.parseOperation("/test", OpenAPIV3.HttpMethods.GET)).rejects.toThrowError(
      /only application\/json content type is supported/,
    )
  })

  it("security - multiple authorizers 1", () => {
    const parser = new OperationParser(
      createDocument({
        security: [{ authorizer1: [], authorizer2: [] }],
      }),
    )

    expect(parser.parseOperation("/test", OpenAPIV3.HttpMethods.GET)).rejects.toThrowError(
      /single security element is expected/,
    )
  })

  it("security - multiple authorizers 2", () => {
    const parser = new OperationParser(
      createDocument({
        security: [{ authorizer1: [] }, { authorizer2: [] }],
      }),
    )

    expect(parser.parseOperation("/test", OpenAPIV3.HttpMethods.GET)).rejects.toThrowError(
      /single security requirement is expected/,
    )
  })

  it("security - operation level", async () => {
    const parser = new OperationParser(
      createDocument({
        security: [{ authorizer: ["a", "b"] }],
      }),
    )

    const operation = await parser.parseOperation("/test", OpenAPIV3.HttpMethods.GET)

    expect(operation.authorizer).toBeTruthy()
    expect(operation.authorizer?.name).toBe("authorizer")
    expect(operation.authorizer?.value).toStrictEqual(["a", "b"])
  })

  it("security - document level", async () => {
    const doc = createDocument({})
    doc.security = [{ authorizer: ["a", "b"] }]

    const parser = new OperationParser(doc)

    const operation = await parser.parseOperation("/test", OpenAPIV3.HttpMethods.GET)

    expect(operation.authorizer).toBeTruthy()
    expect(operation.authorizer?.name).toBe("authorizer")
    expect(operation.authorizer?.value).toStrictEqual(["a", "b"])
  })

  it("security - merge", async () => {
    const doc = createDocument({ security: [{ authorizer: ["op", "level"] }] })
    doc.security = [{ authorizer: ["doc", "level"] }]

    const parser = new OperationParser(doc)

    const operation = await parser.parseOperation("/test", OpenAPIV3.HttpMethods.GET)

    expect(operation.authorizer).toBeTruthy()
    expect(operation.authorizer?.name).toBe("authorizer")
    expect(operation.authorizer?.value).toStrictEqual(["op", "level"])
  })

  it("operationId generation", async () => {
    const parser = new OperationParser({
      openapi: "3.0.0",
      info: {
        title: "test",
        version: "1.0.0",
      },
      paths: {
        "/test": {
          get: {
            responses: {
              "200": {
                description: "test",
                content: {
                  "application/json": {
                    schema: {
                      type: "string",
                    },
                  },
                },
              },
            },
          },
        },
      },
      "x-sdf-spec-path": "test",
    })

    const operation = await parser.parseOperation("/test", OpenAPIV3.HttpMethods.GET)
    expect(operation.operationId).toBe("testGet")
  })

  it("operationId duplicate", async () => {
    await expect(
      async () =>
        await new OperationParser({
          openapi: "3.0.0",
          info: {
            title: "test",
            version: "1.0.0",
          },
          paths: {
            "/test": {
              get: {
                responses: {
                  "200": {
                    description: "test",
                    content: {
                      "application/json": {
                        schema: {
                          type: "string",
                        },
                      },
                    },
                  },
                },
              },
              post: {
                operationId: "testGet",
                responses: {
                  "200": {
                    description: "test",
                    content: {
                      "application/json": {
                        schema: {
                          type: "string",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "x-sdf-spec-path": "test",
        }).document,
    ).rejects.toThrow(/duplicate operation id testGet at/)
  })
})
