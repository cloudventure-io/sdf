import { pascalCase } from "change-case"
import { OpenAPIV3 } from "openapi-types"

import { OperationObject, ParameterObject } from "../../openapi/types"
import { OperationHandlerOptions } from "../../openapi/walkOperations"
import { MimeTypes } from "../../utils/MimeTypes"

export type OperationSchemaTitleType = "operation" | "request" | "responses"

export type OperationSchemaTitleCallback<T extends object> = (
  operation: OperationHandlerOptions<T>,
  type: OperationSchemaTitleType,
) => string

const extractParametersSchema = <T extends object>(
  pathParameters: Array<ParameterObject>,
  operationSpec: OperationObject<T>,
): {
  path?: OpenAPIV3.SchemaObject
  query?: OpenAPIV3.SchemaObject
  header?: OpenAPIV3.SchemaObject
} =>
  [...(pathParameters || []), ...(operationSpec.parameters || [])].reduce<{
    [type: string]: OpenAPIV3.SchemaObject
  }>(
    (acc, parameter) => ({
      ...acc,
      [parameter.in]: {
        ...(acc[parameter.in] || {
          additionalProperties: {
            oneOf: [{ type: "string", nullable: true }],
          },
        }),
        properties: {
          ...(acc[parameter.in]?.properties || {}),
          [parameter.in === "header" ? parameter.name.toLowerCase() : parameter.name]: parameter.schema,
        },
        required: parameter.required
          ? [
              ...(acc[parameter.in]?.required || []),
              parameter.in === "header" ? parameter.name.toLowerCase() : parameter.name,
            ]
          : acc[parameter.in]?.required || [],
      },
    }),
    {},
  )

export interface OperationRequestBaseObjectSchema extends OpenAPIV3.NonArraySchemaObject {
  properties: {
    path: OpenAPIV3.SchemaObject
    query: OpenAPIV3.SchemaObject
    header: OpenAPIV3.SchemaObject
  }
  required: Array<string>
}

export interface OperationRequestBodyObjectSchema extends OpenAPIV3.NonArraySchemaObject {
  properties: {
    contentType: OpenAPIV3.NonArraySchemaObject
    body: OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject
  }
}

export interface OperationRequestObjectSchema extends OpenAPIV3.NonArraySchemaObject {
  oneOf: Array<OperationRequestBaseObjectSchema | (OperationRequestBaseObjectSchema & OperationRequestBodyObjectSchema)>
}

const extractOperationRequestSchema = <T extends object>(
  operation: OperationHandlerOptions<T>,
  operationSchemaTitle: OperationSchemaTitleCallback<T>,
): OperationRequestObjectSchema => {
  const { pathSpec, operationSpec } = operation

  const parameters = extractParametersSchema(pathSpec.parameters || [], operationSpec)

  let body: Array<{
    contentType: string
    bodySchema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject
  }> = []

  if (operationSpec.requestBody?.content) {
    body = Object.entries(operationSpec.requestBody?.content).map(([contentType, bodySpec]) => {
      if (contentType !== MimeTypes.APPLICATION_JSON && contentType !== MimeTypes.APPLICATION_X_WWW_FORM_URLENCODED) {
        throw new Error(
          `content type '${contentType}' is not supported at ${operation.trace}/requestBody/content/${contentType}`,
        )
      }

      if (!bodySpec.schema) {
        throw new Error(
          `schema is not defined for the request body at ${operation.trace}/requestBody/content/${contentType}`,
        )
      }

      return {
        contentType,
        bodySchema: bodySpec.schema,
      }
    })
  }

  if (operationSpec.requestBody?.required && !body.length) {
    throw new Error(`the body is required, but ${operation.trace}/content is not set`)
  }

  const createOperationBaseObjectSchema = (): OperationRequestBaseObjectSchema => ({
    type: "object",
    additionalProperties: false,
    properties: {
      path: parameters.path || {
        type: "object",
        additionalProperties: false,
      },
      query: parameters.query || {
        type: "object",
        additionalProperties: false,
      },
      header: parameters.header || {
        type: "object",
        additionalProperties: { type: "string" },
      },
    },

    required: ["path", "query", "header"],
  })

  return {
    title: operationSchemaTitle(operation, "request"),
    oneOf: [
      ...(!operationSpec.requestBody?.required ? [createOperationBaseObjectSchema()] : []),
      ...body.map(({ contentType, bodySchema }) => {
        const baseSchema = createOperationBaseObjectSchema()
        return {
          ...baseSchema,
          properties: {
            ...baseSchema.properties,
            body: bodySchema,
            contentType: {
              type: "string",
              enum: [contentType],
              "x-no-ts-enum": true,
            },
          },
          required: [...baseSchema.required, "body", "contentType"],
        }
      }),
    ],
  }
}

const extractOperationResponsesSchema = <T extends object>(
  operation: OperationHandlerOptions<T>,
  operationSchemaTitle: OperationSchemaTitleCallback<T>,
): OpenAPIV3.SchemaObject => ({
  title: operationSchemaTitle(operation, "responses"),
  oneOf: Object.entries(operation.operationSpec.responses).map(([statusCode, responseSpec]) => ({
    type: "object",
    properties: {
      statusCode: {
        type: "number",
        enum: [parseInt(statusCode)],
        "x-no-ts-enum": true,
      },
      body: responseSpec.content?.[MimeTypes.APPLICATION_JSON].schema || {
        type: "null",
      },
      headers: {
        type: "object",
        properties: Object.entries(responseSpec.headers || {}).reduce<{
          [header in string]: OpenAPIV3.SchemaObject
        }>(
          (acc, [headerName, headerSpec]) => ({
            ...acc,
            [headerName]: headerSpec.schema,
          }),
          {},
        ),
        required: Object.entries(responseSpec.headers || {})
          .filter(([, headerSpec]) => headerSpec.required)
          .map(([headerName]) => headerName),
        additionalProperties: false,
      },
    },
    required: ["statusCode", "body", "headers"],
    additionalProperties: false,
  })),
})

export interface OperationObjectSchema extends OpenAPIV3.NonArraySchemaObject {
  properties: {
    request: OperationRequestObjectSchema
    responses: OpenAPIV3.SchemaObject
  }
}

export const extractOperationSchema = <OperationType extends object>(
  operation: OperationHandlerOptions<OperationType>,
): OperationObjectSchema => ({
  title: defaultOperationTitle(operation, "operation"),
  additionalProperties: false,
  properties: {
    request: extractOperationRequestSchema(operation, defaultOperationTitle),
    responses: extractOperationResponsesSchema(operation, defaultOperationTitle),
  },
  required: ["request", "responses"],
})

export const defaultOperationTitle = <T extends object>(
  { operationSpec }: OperationHandlerOptions<T>,
  type: OperationSchemaTitleType,
): string => pascalCase(`operation-${operationSpec.operationId}${type === "operation" ? "" : `-${type}`}`)
