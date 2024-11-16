import SwaggerParser from "@apidevtools/swagger-parser"
import { pascalCase } from "change-case"
import lodash from "lodash"
import { OpenAPIV3 } from "openapi-types"

import { SchemaRegistry } from "../../core/SchemaRegistry"
import { HttpApiAuthorizer, HttpApiJwtAuthorizer, HttpApiLambdaAuthorizer } from "../authorizer"
import { Document, SchemaDecoder } from "../openapi/Document"
import { Operation } from "../openapi/Operation"
import { ParameterTypes } from "../openapi/Parameter"
import { Response } from "../openapi/Response"
import { SchemaItem } from "../openapi/SchemaItem"

export interface HttpApiOperationAuthorizer {
  securityScheme: OpenAPIV3.SecuritySchemeObject
  authorizer: HttpApiAuthorizer | null
}

/**
 * Expanded request schema.
 */
export interface OperationSchemaRequestExpanded {
  header?: SchemaItem
  query?: SchemaItem
  path?: SchemaItem
  cookie?: SchemaItem
  body?: SchemaItem
  authorizer?: SchemaItem
}

export interface OperationSchema<SchemaType> {
  operation: Operation<SchemaType>

  schemas: {
    title: string

    requestExpanded: OperationSchemaRequestExpanded

    /**
     * Combined request schema.
     *
     * ⚠️ This object references schemas from expanded request parameters.
     */
    request: SchemaItem

    /**
     * Response schemas.
     */
    response: SchemaItem

    /**
     * The combined operation schema.
     *
     * ⚠️ This object references schemas from `request` and `response` fields.
     */
    operation: SchemaItem
  }
}

type SchemaType = OpenAPIV3.SchemaObject

export interface DocumentSchemaAdapterConfig {
  document: Document<SchemaType>
  authorizers: Record<string, HttpApiAuthorizer | null>

  schemaRegistry: SchemaRegistry
}

export class DocumentSchemaAdapter {
  readonly operations: Array<OperationSchema<SchemaType>> = []
  readonly operationsMap: Record<string, OperationSchema<SchemaType>> = {}
  readonly authorizers: Record<string, HttpApiOperationAuthorizer> = {}
  readonly document: Document<SchemaType>

  constructor(config: DocumentSchemaAdapterConfig) {
    this.document = new Document(config.document.decode(schema => config.schemaRegistry.register(this.decode(schema))))

    this.parseAuthorizers(config.authorizers)
    this.parseOperations()
  }

  private encode(schema: OpenAPIV3.SchemaObject): SchemaItem {
    return { type: "json-schema", value: schema }
  }
  private decode(schema: SchemaItem): OpenAPIV3.SchemaObject {
    return schema.value
  }

  private parseAuthorizers(authorizers: Record<string, HttpApiAuthorizer | null>) {
    if (!this.document?.securitySchemes) {
      return
    }
    const securitySchemesTrace = this.document.trace().append(["components", "securitySchemes"])

    for (const [name, securityScheme] of Object.entries(this.document.securitySchemes)) {
      const trace = securitySchemesTrace.append(name)

      const authorizer = authorizers[name]

      if (authorizer === undefined) {
        throw new Error(`authorizer '${name}' is defined in the OpenAPI Document, but not provided at ${trace}`)
      }

      if (
        authorizer !== null &&
        !(
          authorizer instanceof HttpApiLambdaAuthorizer &&
          securityScheme.type === "apiKey" &&
          securityScheme.in === "header"
        ) &&
        !(authorizer instanceof HttpApiJwtAuthorizer && securityScheme.type === "oauth2")
      ) {
        throw new Error(
          `unexpected authorizer combination with type ${securityScheme.type} and authorizer ${authorizer?.constructor?.name} at ${trace}`,
        )
      }

      this.authorizers[name] = {
        authorizer,
        securityScheme: securityScheme,
      }
    }
  }

  private createAuthrozierSchema(operation: Operation<SchemaType>) {
    const security = operation.resolveSecurity()

    if (!security) {
      return
    }

    const authorizer = this.authorizers[security.name]

    if (!authorizer) {
      throw new Error(
        `authorizer is not defined for the security requirement '${security.name}' at ${operation
          .trace()
          .append("security")}`,
      )
    }

    return authorizer.authorizer?.contextSchema
  }

  private createBaseReuqestSchema(operation: Operation<SchemaType>, requestExpanded: OperationSchemaRequestExpanded) {
    const parameters = operation.resolveParameters()

    const baseRequest = {
      type: "object",
      properties: {},
      required: [] as Array<string>,
      additionalProperties: false,
    } satisfies OpenAPIV3.SchemaObject

    for (const [type, params] of Object.entries(parameters)) {
      if (Object.keys(params).length === 0) {
        continue
      }

      const schema = {
        type: "object",
        additionalProperties: {
          anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
        },
        properties: {},
        required: [] as Array<string>,
      } satisfies OpenAPIV3.SchemaObject

      for (const param of Object.values(params)) {
        if (!param.schema) {
          continue
        }
        schema.properties[param.name] = this.decode(param.schema)
        if (param.required) {
          schema.required.push(param.name)
        }
      }

      baseRequest.properties[type as ParameterTypes] = schema

      if (schema.required.length > 0) {
        baseRequest.required.push(type as ParameterTypes)
      }

      requestExpanded[type as ParameterTypes] = this.encode(schema)
    }

    const authorizerSchema = this.createAuthrozierSchema(operation)

    if (authorizerSchema) {
      baseRequest.properties["authorizer"] = authorizerSchema
      baseRequest.required.push("authorizer")

      requestExpanded.authorizer = this.encode(authorizerSchema)
    }

    return baseRequest
  }

  private createRequestSchema(operation: Operation<SchemaType>) {
    const requestExpanded: OperationSchemaRequestExpanded = {}

    const request = {
      title: pascalCase(`Operation-${operation.operationId}-Request`),
      allOf: [this.createBaseReuqestSchema(operation, requestExpanded)] as Array<OpenAPIV3.SchemaObject>,
    } satisfies OpenAPIV3.SchemaObject

    if (operation.requestBody) {
      const bodies: Array<OpenAPIV3.SchemaObject> = []

      for (const [mediaType, media] of Object.entries(operation.requestBody.content)) {
        bodies.push({
          type: "object",
          properties: {
            mediaType: {
              const: mediaType,
            } as OpenAPIV3.SchemaObject,
            body: media.schema ? this.decode(media.schema) : {},
          },
          required: ["mediaType", "body"],
          additionalProperties: false,
          description: operation.requestBody.description,
        })
      }

      if (!operation.requestBody.required) {
        bodies.push({
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        })
      }

      const requestAllOf = {
        title: pascalCase(`Operation-${operation.operationId}-Body`),
        oneOf: bodies,
      }
      request.allOf.push(requestAllOf)
      requestExpanded.body = this.encode(requestAllOf)
    }

    return { request, requestExpanded }
  }

  private createResponseHeadersSchema(response: Response<SchemaType>): {
    schema: OpenAPIV3.SchemaObject
    required: boolean
  } {
    const schema = {
      type: "object",
      properties: {},
      required: [] as Array<string>,
      additionalProperties: {
        type: "string",
      },
    } satisfies OpenAPIV3.SchemaObject

    let required = false

    if (response.headers) {
      for (const [name, header] of Object.entries(response.headers)) {
        if (!header.schema) {
          continue
        }
        schema.properties[name] = this.decode(header.schema)
        if (header.required) {
          schema.required.push(name)
          required = true
        }
      }
    }

    return { schema, required }
  }

  private createResponseSchema(operation: Operation<SchemaType>) {
    const responses = {
      title: pascalCase(`Operation-${operation.operationId}-Responses`),
      type: "object",
      properties: {},
      required: [] as Array<string>,
      additionalProperties: false,
    } satisfies OpenAPIV3.SchemaObject

    for (const [statusCode, response] of Object.entries(operation.responses)) {
      const responseSchema = {
        type: "object",
        properties: {
          headers: this.createResponseHeadersSchema(response).schema,
        },
        required: ["headers"] as Array<string>,
        additionalProperties: false,
      } satisfies OpenAPIV3.SchemaObject

      responses.properties[statusCode] = responseSchema
      responses.required.push(statusCode)

      for (const [mediaType, media] of Object.entries(response.content || {})) {
        responseSchema.properties[mediaType] = media.schema ? this.decode(media.schema) : {}
        responseSchema.required.push(mediaType)
      }
    }

    return responses
  }

  private parseOperation(operation: Operation<SchemaType>): OperationSchema<SchemaType> {
    const { request, requestExpanded } = this.createRequestSchema(operation)
    const response = this.createResponseSchema(operation)

    const operationSchema = {
      title: pascalCase(`Operation-${operation.operationId}`),
      type: "object",
      properties: {
        request: request,
        response: response,
      },
      required: ["request", "response"],
      additionalProperties: false,
    } satisfies OpenAPIV3.SchemaObject

    return {
      operation,

      schemas: {
        title: operationSchema.title,
        requestExpanded,
        request: this.encode(request),
        response: this.encode(response),
        operation: this.encode(operationSchema),
      },
    }
  }

  private parseOperations() {
    for (const operation of Object.values(this.document.operations)) {
      const op = this.parseOperation(operation)
      this.operations.push(op)
      this.operationsMap[operation.operationId] = op
    }
  }

  /**
   * Bundle the underlying document into OpenAPI specification.
   * @returns The bundled OpenAPI specification.
   */
  bundle(decoder: SchemaDecoder<OpenAPIV3.SchemaObject> = schema => this.decode(schema)): Promise<OpenAPIV3.Document> {
    // ⚠️ This function must be synchronous to make a current copy of the document instantly.
    const document = lodash.cloneDeep(this.document.decodeClean(decoder))

    return SwaggerParser.bundle(document) as Promise<OpenAPIV3.Document>
  }
}
