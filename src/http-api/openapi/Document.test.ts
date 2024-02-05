import { OpenAPIV3 } from "openapi-types"

import { Document } from "./Document"
import { BundledDocument, ParameterObject, RequestBodyObject, ResponseObject } from "./types"
import { dereference } from "./utils"

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
}): Document<Record<never, string>> =>
  new Document({
    openapi: "3.0.0",
    info: {
      title: "test",
      version: "1.0.0",
    },
    "x-sdf-source": "test-path",
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

describe("document parser", () => {
  it("should dereference the document with circular references", () => {
    const document = new Document(
      dereference({
        openapi: "3.0.3",
        info: {
          title: "test",
          version: "1.0.0",
        },
        paths: {
          "/test": {
            get: {
              operationId: "test",
              responses: {
                "200": {
                  description: "test",
                  content: {
                    "application/json": {
                      schema: {
                        $ref: "#/components/schemas/TreeNode",
                      },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            TreeNode: {
              title: "TreeNode",
              type: "object",
              properties: {
                name: { type: "string" },
                node: { $ref: "#/components/schemas/TreeNode" },
              },
            },
          },
        },
        "x-sdf-source": "test",
      }),
    )

    expect(
      document?.paths["/test"]?.operations.get?.responses?.["200"]?.content?.["application/json"]?.schema?.value,
    ).toBe(document.schemas?.TreeNode.value)

    expect(document?.schemas?.TreeNode?.value.properties?.node).toBe(document.schemas?.TreeNode.value)
  })

  it("should dereference only internal references", () => {
    const document = {
      openapi: "3.0.3",
      info: {
        title: "test",
        version: "1.0.0",
      },
      paths: {},
      components: {
        schemas: {
          TreeNode: {
            title: "TreeNode",
            type: "object",
            properties: {
              name: { type: "string" },
              node: { $ref: "http://example.com/TreeNode" },
            },
          },
        },
      },
      "x-sdf-source": "test",
    } satisfies BundledDocument

    expect(() => dereference(document)).toThrow(/only internal references/i)
  })

  it("should throw error on invalid reference", () => {
    const document = {
      openapi: "3.0.3",
      info: {
        title: "test",
        version: "1.0.0",
      },
      paths: {},
      components: {
        schemas: {
          TreeNode: {
            oneOf: [
              {
                title: "TreeNode",
                type: "object",
                properties: {
                  name: { type: "string" },
                  node: { $ref: "#/non-existing" },
                },
              },
            ],
          },
        },
      },
      "x-sdf-source": "test",
    } satisfies BundledDocument

    expect(() => dereference(document)).toThrow(/invalid reference/i)
  })

  it("check parameter merging", () => {
    const document = createDocument({
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
    })

    const operation = document.operations["testOperation"]

    const parameters = operation.resolveParameters()

    expect(parameters.cookie).toBeUndefined()
    expect(parameters.header).toBeUndefined()
    expect(parameters.query?.param1?.required).toBe(true)
    expect(parameters.query?.param1?.schema?.value).toStrictEqual({ type: "boolean" })
    expect(parameters.query?.param2?.schema?.value).toStrictEqual({ type: "string" })
    expect(parameters.path?.param3.schema?.value).toStrictEqual({ type: "string" })
  })

  it("header parameter case-insensitivity", () => {
    const document = createDocument({
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
    })

    const operation = document.operations["testOperation"]

    if (!operation) {
      expect(operation).toBeTruthy()
      return
    }
    expect(operation.method).toBe(OpenAPIV3.HttpMethods.GET)
    expect(operation.path.pattern).toBe("/test")

    const parameters = operation.resolveParameters()

    expect(parameters.cookie).toBeUndefined()
    expect(parameters.query).toBeUndefined()
    expect(parameters.path).toBeUndefined()
    expect(Object.keys(parameters?.header || {})).toStrictEqual(["x-test-header", "x-test-header2"])
    expect(parameters.header?.["x-test-header"].required).toBe(true)
    expect(parameters.header?.["x-test-header"].schema?.value).toStrictEqual({ type: "boolean" })
    expect(parameters.header?.["x-test-header2"].schema?.value).toStrictEqual({ type: "string" })
  })

  it("unknown parameter type", () => {
    expect(() =>
      createDocument({
        pathParameters: [
          {
            in: "aaa",
            name: "test",
            schema: { type: "string" },
          },
        ],
      }),
    ).toThrow(/invalid parameter 'in' value 'aaa'/)
  })

  // it("request body required error", () => {
  //   expect(
  //     () =>
  //       new DocumentParser(
  //         createDocument({
  //           requestBody: {
  //             required: true,
  //             content: {},
  //           },
  //         }),
  //       ),
  //   ).toThrow(/requestBody content is required, but content is empty at/)
  // })

  // it("request body schema required error", () => {
  //   expect(
  //     () =>
  //       new DocumentParser(
  //         createDocument({
  //           requestBody: {
  //             required: true,
  //             content: {
  //               "application/json": {},
  //             },
  //           },
  //         }),
  //       ),
  //   ).toThrow(/requestBody schema is required at/)
  // })

  it("request body", () => {
    const document = createDocument({
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
    })

    const operation = document.operations["testOperation"]

    expect(operation.requestBody).toBeTruthy()
    expect(operation.requestBody?.required).toBeTruthy()
    expect(operation.requestBody?.content["application/json"].schema?.value).toMatchObject({ type: "string" })

    expect(operation.requestBody?.content["text/xml"].schema?.value).toMatchObject({ type: "boolean" })
  })

  // it("ignore headers", () => {
  //   const parser = new DocumentParser(
  //     createDocument({
  //       operationParameters: [
  //         {
  //           in: "header",
  //           name: "X-test-Header",
  //           schema: { type: "string" },
  //         },
  //         {
  //           in: "header",
  //           name: "authorization",
  //           schema: { type: "string" },
  //         },
  //       ],
  //     }),
  //   )

  //   const operation = parser.operations[`${OpenAPIV3.HttpMethods.GET} /test`]

  //   expect(operation.parameters.header?.authorization).toBeUndefined()
  // })

  it("security - multiple authorizers 1", () => {
    expect(() =>
      createDocument({
        security: [{ authorizer1: [], authorizer2: [] }],
      }).operations["testOperation"].resolveSecurity(),
    ).toThrow(/only single security element is supported at/)
  })

  it("security - multiple authorizers 2", async () => {
    expect(() =>
      createDocument({
        security: [{ authorizer1: [] }, { authorizer2: [] }],
      }).operations["testOperation"].resolveSecurity(),
    ).toThrow(/only single security requirement is supported at/)
  })

  it("security", async () => {
    const document = createDocument({
      security: [{ authorizer1: ["test"] }],
    })

    const operation = document.operations["testOperation"]

    expect(operation.resolveSecurity()).toStrictEqual({
      name: "authorizer1",
      requirements: ["test"],
    })
  })

  it("security - document level", () => {
    const doc = createDocument({})
    doc.security = [{ authorizer: ["a", "b"] }]

    const operation = doc.operations["testOperation"]

    const security = operation.resolveSecurity()

    expect(security).toBeTruthy()
    expect(security?.name).toBe("authorizer")
    expect(security?.requirements).toStrictEqual(["a", "b"])
  })

  it("security - merge", async () => {
    const document = createDocument({ security: [{ authorizer: ["op", "level"] }] })
    document.security = [{ authorizer: ["doc", "level"] }]

    const operation = document.operations["testOperation"]

    const security = operation.resolveSecurity()

    expect(security).toBeTruthy()
    expect(security?.name).toBe("authorizer")
    expect(security?.requirements).toStrictEqual(["op", "level"])
  })

  it("operationId generation", async () => {
    const document = new Document({
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
      "x-sdf-source": "test",
    })

    const operation = document.operations["testGet"]
    expect(operation.operationId).toBe("testGet")
  })

  it("operationId duplicate", async () => {
    expect(
      () =>
        new Document({
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
          "x-sdf-source": "test",
        }),
    ).toThrow(/Operation with id testGet already exists/)
  })
})
