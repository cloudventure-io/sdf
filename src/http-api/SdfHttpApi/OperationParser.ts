import SwaggerParser from "@apidevtools/swagger-parser"
import { Schema, SchemaObject } from "ajv"
import { camelCase } from "change-case"
import { OpenAPIV3 } from "openapi-types"

import { MimeTypes } from "../../utils/MimeTypes"
import { DocumentTrace } from "../openapi/DocumentTrace"
import { DereferencedDocument, Document, OperationObject, ParameterObject, PathItemObject } from "../openapi/types"

export interface OperationBundle<
  OperationType extends object,
  SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject = OpenAPIV3.SchemaObject,
> {
  document: Document<OperationType>
  documentTrace: DocumentTrace

  pathPattern: string
  pathSpec: PathItemObject<OperationType, SchemaType>
  pathTrace: DocumentTrace

  method: OpenAPIV3.HttpMethods
  operationSpec: OperationObject<OperationType, SchemaType>
  operationTrace: DocumentTrace
  operationId: string
}

export enum ParsedParameterType {
  query = "query",
  path = "path",
  header = "header",
  cookie = "cookie",
}

export type ParsedRequestParameters = {
  [type in ParsedParameterType]: OpenAPIV3.SchemaObject
}

export interface ParsedRequestSchema {
  parameters: ParsedRequestParameters
  body?: ParsedRequestBody
}

export interface ParsedOperationAuthorizer {
  name: string
  value: Array<string>
}

export interface ParsedOperation<OperationType extends object> {
  operationId: string

  bundle: OperationBundle<OperationType>
  request: ParsedRequestSchema
  responses: Array<OpenAPIV3.SchemaObject>
  authorizer?: ParsedOperationAuthorizer
}

export interface ParsedRequestBody {
  required: boolean
  schemas?: Record<string, OpenAPIV3.SchemaObject>
}

export class OperationParser<OperationType extends object = object> {
  private dereferencedDocument?: PromiseLike<DereferencedDocument<OperationType>>

  private authorizer?: ParsedOperationAuthorizer

  constructor(private rawDocument: Document<OperationType>) {
    // validate and assign operationIds to all operations
    this.walkOperations(operation => (operation.operationSpec.operationId = this.getOperationId(operation)))
  }

  private async initialize(
    document: DereferencedDocument<OperationType>,
  ): Promise<DereferencedDocument<OperationType>> {
    this.authorizer = this.parseAuthorizer(
      document.security,
      new DocumentTrace(document["x-sdf-spec-path"], ["security"]),
    )
    return document
  }

  private operationIds: Record<string, { pathPattern: string; method: OpenAPIV3.HttpMethods; trace: DocumentTrace }> =
    {}

  private getOperationId({
    pathPattern,
    method,
    operationSpec,
    operationTrace,
  }: OperationBundle<OperationType, OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>): string {
    const operationId = operationSpec.operationId ? operationSpec.operationId : camelCase(`${pathPattern}-${method}`)

    const existingOperationId = this.operationIds[operationId]
    if (existingOperationId) {
      if (existingOperationId.pathPattern !== pathPattern || existingOperationId.method !== method) {
        throw new Error(`duplicate operation id ${operationId} at ${existingOperationId.trace} and ${operationTrace}`)
      }
    } else {
      this.operationIds[operationId] = { pathPattern, method, trace: operationTrace }
    }

    return operationId
  }

  public parseAuthorizer(
    security: Array<OpenAPIV3.SecurityRequirementObject> | undefined,
    trace: DocumentTrace,
  ): undefined | ParsedOperationAuthorizer {
    if (!security || !security.length) {
      return
    } else if (security.length !== 1) {
      throw new Error(`single security requirement is expected at ${trace}`)
    }

    const securityItem = security[0]

    const keys = Object.keys(securityItem)

    if (keys.length !== 1) {
      throw new Error(`single security element is expected at ${trace.append(0)}`)
    }

    return {
      name: keys[0],
      value: securityItem[keys[0]],
    }
  }

  private get document(): PromiseLike<DereferencedDocument<OperationType>> {
    if (!this.dereferencedDocument) {
      this.dereferencedDocument = new Promise<DereferencedDocument<OperationType>>(resolve => {
        SwaggerParser.dereference(JSON.parse(JSON.stringify(this.rawDocument))).then(doc =>
          resolve(doc as DereferencedDocument<OperationType>),
        )
      }).then(doc => this.initialize(doc))
    }
    return this.dereferencedDocument
  }

  private extractParameters(parameters: Array<ParameterObject<OpenAPIV3.SchemaObject>>, trace: DocumentTrace) {
    type ParsedParameter = {
      schema: OpenAPIV3.SchemaObject
      required: boolean
      description?: string
    }
    return parameters.reduce<Record<string, Record<string, ParsedParameter>>>((acc, param, index) => {
      if (!ParsedParameterType[param.in]) {
        throw new Error(`unknown value of 'in' attribute of parameter at ${trace.append(index, "in")}`)
      }
      // HTTP Headers are case-insensitive
      const paramName = param.in === ParsedParameterType.header ? param.name.toLowerCase() : param.name

      const parsedParam: ParsedParameter = {
        schema: param.schema,
        required: !!param.required,
        description: param.description,
      }

      return {
        ...acc,
        [param.in]: {
          ...acc[param.in],
          [paramName]: parsedParam,
        },
      }
    }, {})
  }

  private extractRequestParameters({
    pathSpec,
    pathTrace,
    operationSpec,
    operationTrace,
  }: OperationBundle<OperationType>): ParsedRequestParameters {
    // Extract path and operation parameters
    const pathParameters = this.extractParameters(pathSpec.parameters || [], pathTrace)
    const operationParameters = this.extractParameters(operationSpec.parameters || [], operationTrace)

    // Merge parameters
    const mergedParameters = Object.keys(ParsedParameterType).reduce<typeof pathParameters>((acc1, parameterType) => {
      const keys = Array.from(
        new Set(
          Object.keys(pathParameters[parameterType] || {}).concat(
            Object.keys(operationParameters[parameterType] || {}),
          ),
        ),
      )

      return {
        ...acc1,
        [parameterType]: keys.reduce(
          (acc2, name) => ({
            ...acc2,
            [name]: operationParameters[parameterType]?.[name] || pathParameters[parameterType][name],
          }),
          {},
        ),
      }
    }, {})

    return Object.entries(mergedParameters).reduce<Partial<ParsedRequestParameters>>(
      (acc, [type, params]) => ({
        ...acc,
        [type]: {
          type: "object",
          additionalProperties: { type: "string" },
          properties: Object.entries(params).reduce(
            (acc, [name, param]) => ({
              ...acc,
              [name]: param.schema,
            }),
            {},
          ),
          required: Object.entries(params)
            .filter(([, { required }]) => required)
            .map(([name]) => name),
        } as OpenAPIV3.SchemaObject,
      }),
      {},
    ) as ParsedRequestParameters
  }

  private extractRequestBody({
    operationSpec,
    operationTrace,
  }: OperationBundle<OperationType>): ParsedRequestBody | undefined {
    let schemas: Record<string, OpenAPIV3.SchemaObject> | undefined
    const requestBody = operationSpec.requestBody

    if (!requestBody) {
      return
    }

    const required = !!requestBody.required

    if (requestBody.content && Object.keys(requestBody.content).length) {
      schemas = Object.entries(requestBody.content).reduce<Record<string, OpenAPIV3.SchemaObject>>(
        (acc, [contentType, body]) => {
          if (!body.schema) {
            throw new Error(
              `requestBody schema is required at ${operationTrace.append("requestBody", "content", contentType)}`,
            )
          }
          return {
            ...acc,
            [contentType]: body.schema,
          }
        },
        {},
      )
    } else if (required) {
      throw new Error(
        `requestBody is required, but no body schema is specified at ${operationTrace.append(
          "requestBody",
          "content",
        )}`,
      )
    }

    return {
      required,
      schemas,
    }
  }

  private extractRequestSchema(operation: OperationBundle<OperationType>): ParsedRequestSchema {
    const parameters = this.extractRequestParameters(operation)
    const body = this.extractRequestBody(operation)

    return { parameters, body }
  }

  private extractResponsesSchema({
    operationSpec,
    operationTrace,
  }: OperationBundle<OperationType>): Array<OpenAPIV3.SchemaObject> {
    return Object.entries(operationSpec.responses).map(([statusCode, responseSpec]) => {
      const trace = operationTrace.append("responses", statusCode)
      let body: OpenAPIV3.SchemaObject | undefined

      if (responseSpec.content) {
        const keys = Object.keys(responseSpec.content)
        if (keys.length > 1) {
          throw new Error(`only single resposne content type is supported at ${trace.append("content")}`)
        } else if (keys.length === 1) {
          if (keys[0] !== MimeTypes.APPLICATION_JSON) {
            throw new Error(
              `only ${MimeTypes.APPLICATION_JSON} content type is supported at ${trace.append("content")}`,
            )
          }
          body = responseSpec.content[MimeTypes.APPLICATION_JSON].schema
        }
      }

      return {
        type: "object",
        properties: {
          statusCode: {
            type: "number",
            enum: [parseInt(statusCode)],
            "x-no-ts-enum": true,
          } as OpenAPIV3.SchemaObject,
          headers: {
            type: "object",
            properties: Object.entries(responseSpec.headers || {}).reduce<{
              [header in string]: OpenAPIV3.SchemaObject
            }>(
              (acc, [headerName, headerSpec]) => ({
                ...acc,
                [headerName.toLowerCase()]: headerSpec.schema,
              }),
              {},
            ),
            required: Object.entries(responseSpec.headers || {})
              .filter(([, headerSpec]) => headerSpec.required)
              .map(([headerName]) => headerName.toLowerCase()),
            additionalProperties: false,
          },
          ...(body ? { body } : {}),
        },
        required: ["statusCode", "headers"].concat(body ? ["body"] : []),
        additionalProperties: false,
      }
    })
  }

  private extractAuthorizer({
    operationSpec,
    operationTrace,
  }: OperationBundle<OperationType>): ParsedOperationAuthorizer | undefined {
    return this.parseAuthorizer(operationSpec.security, operationTrace.append("security")) || this.authorizer
  }

  public async parseOperation(
    pathPattern: string,
    method: OpenAPIV3.HttpMethods,
  ): Promise<ParsedOperation<OperationType>> {
    const document = await this.document
    const documentTrace = new DocumentTrace(document["x-sdf-spec-path"])
    const pathSpec = document.paths[pathPattern]
    const pathTrace = documentTrace.append(["paths", pathPattern])

    if (!pathSpec) {
      throw new Error(`path is undefined at ${pathTrace}`)
    }

    const operationSpec = pathSpec[method]
    const operationTrace = pathTrace.append(method)

    if (!operationSpec) {
      throw new Error(`operation is undefined at ${operationTrace}`)
    }

    const operation: OperationBundle<OperationType> = {
      document,
      documentTrace,
      pathPattern,
      pathSpec,
      method,
      operationSpec,
      pathTrace,
      operationTrace,
      operationId: "",
    }
    operation.operationId = this.getOperationId(operation)

    return {
      bundle: operation,
      operationId: operation.operationId,
      request: this.extractRequestSchema(operation),
      responses: this.extractResponsesSchema(operation),
      authorizer: this.extractAuthorizer(operation),
    }
  }

  public createValidtorSchemas(operation: ParsedOperation<OperationType>): Array<SchemaObject> {
    const {
      request: { parameters, body },
    } = operation

    const schemas: Array<SchemaObject> = Object.entries(parameters).map(([type, schema]) => ({
      $id: type,
      ...schema,
    }))

    if (body?.schemas) {
      schemas.push({
        $id: "body",
        oneOf: [
          ...Object.entries(body.schemas).map(
            ([contentType, schema]): Schema => ({
              type: "object",
              additionalProperties: false,
              properties: {
                contentType: {
                  type: "string",
                  enum: [contentType],
                },
                body: schema,
              },
              required: ["contentType", "body"],
            }),
          ),
          ...(body.required ? [] : [{ type: "null" }]),
        ],
      })
    }

    return schemas
  }

  public walkOperations(
    handler: (operation: OperationBundle<OperationType, OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject>) => void,
  ) {
    const documentTrace = new DocumentTrace(this.rawDocument["x-sdf-spec-path"])
    Object.entries(this.rawDocument.paths).forEach(([pathPattern, pathSpec]) => {
      const pathTrace = documentTrace.append(["paths", pathPattern])

      Object.values(OpenAPIV3.HttpMethods).forEach(method => {
        const operationSpec = pathSpec[method]

        if (!operationSpec) {
          return
        }

        handler({
          pathPattern,
          pathSpec,
          method,
          operationSpec,
          document: this.rawDocument,
          documentTrace,
          pathTrace,
          operationTrace: pathTrace.append(method),
          // @ts-expect-error operationId is set in constructor
          operationId: operationSpec.operationId,
        })
      })
    })
  }
}
