import SwaggerParser from "@apidevtools/swagger-parser"
import { Schema, SchemaObject } from "ajv"
import { camelCase, pascalCase } from "change-case"
import { OpenAPIV3 } from "openapi-types"

import { MimeTypes } from "../../utils/MimeTypes"
import { sanitizeSchema } from "../../utils/sanitizeSchema"
import { DocumentTrace } from "../openapi/DocumentTrace"
import { DereferencedDocument, Document, OperationObject, ParameterObject, PathItemObject } from "../openapi/types"
import { HttpApiOperation } from "./HttpApi"

export interface OperationBundleBase {
  document: Document
  documentTrace: DocumentTrace

  pathPattern: string
  pathSpec: PathItemObject<object, OpenAPIV3.SchemaObject>
  pathTrace: DocumentTrace

  method: OpenAPIV3.HttpMethods
  operationSpec: OperationObject<object, OpenAPIV3.SchemaObject>
  operationTrace: DocumentTrace
  operationId: string
}

export interface OperationBundle extends OperationBundleBase {
  request: ParsedRequestSchema
  responses: Array<OpenAPIV3.SchemaObject>

  security?: ParsedOperationSecurity
}

export enum ParsedParameterType {
  query = "query",
  path = "path",
  header = "header",
  cookie = "cookie",
}

export type ParsedRequestParameters = {
  [type in ParsedParameterType]?: OpenAPIV3.SchemaObject
}

export interface ParsedRequestSchema {
  parameters: ParsedRequestParameters
  body?: ParsedRequestBody
}

export interface ParsedOperationSecurity {
  name: string
  value: Array<string>
}

export interface ParsedRequestBody {
  required: boolean
  schemas?: Record<string, OpenAPIV3.SchemaObject>
}

export class DocumentParser {
  private dereferencedDocument?: PromiseLike<DereferencedDocument>

  private defaultAuthorizer?: ParsedOperationSecurity

  constructor(private rawDocument: Document) {}

  private async initialize(document: DereferencedDocument): Promise<DereferencedDocument> {
    this.defaultAuthorizer = this.parseAuthorizer(
      document.security,
      new DocumentTrace(document["x-sdf-spec-path"], ["security"]),
    )

    // validate and assign operationIds to all operations
    await this.walkOperations(async operation => {
      operation.operationSpec.operationId = this.getOperationId(operation)
    }, document)

    return document
  }

  private operationIds: Record<string, { pathPattern: string; method: OpenAPIV3.HttpMethods; trace: DocumentTrace }> =
    {}

  private getOperationId({
    pathPattern,
    method,
    operationSpec,
    operationTrace,
  }: Pick<OperationBundleBase, "pathPattern" | "method" | "operationSpec" | "operationTrace">): string {
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

  private parseAuthorizer(
    security: Array<OpenAPIV3.SecurityRequirementObject> | undefined,
    trace: DocumentTrace,
  ): undefined | ParsedOperationSecurity {
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

  public get document(): PromiseLike<DereferencedDocument> {
    if (!this.dereferencedDocument) {
      this.dereferencedDocument = new Promise<DereferencedDocument>((resolve, reject) =>
        // bundle the document so we can clone it
        SwaggerParser.bundle(this.rawDocument)
          // clone the document
          .then(doc => JSON.parse(JSON.stringify(doc)))
          // dereference the document
          .then(doc => SwaggerParser.dereference(doc))
          // initialize the parser
          .then(doc => this.initialize(doc as DereferencedDocument))
          .then(doc => resolve(doc))
          .catch(reject),
      )
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
  }: OperationBundleBase): ParsedRequestParameters {
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

      if (keys.length == 0) {
        return acc1
      }

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

  private extractRequestBody({ operationSpec, operationTrace }: OperationBundleBase): ParsedRequestBody | undefined {
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

  private extractRequestSchema(operation: OperationBundleBase): ParsedRequestSchema {
    const parameters = this.extractRequestParameters(operation)
    const body = this.extractRequestBody(operation)

    return { parameters, body }
  }

  private extractResponsesSchema({
    operationSpec,
    operationTrace,
  }: OperationBundleBase): Array<OpenAPIV3.SchemaObject> {
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
          },
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

  private extractSecurity({ operationSpec, operationTrace }: OperationBundleBase): ParsedOperationSecurity | undefined {
    return this.parseAuthorizer(operationSpec.security, operationTrace.append("security")) || this.defaultAuthorizer
  }

  /**
   * Create list of request validation schemas.
   * The resulting schemas are copies of the original schemas with sanitization applied.
   */
  public createValidtorSchemas(operation: OperationBundle): Array<SchemaObject> {
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

    return (schemas as Array<OpenAPIV3.SchemaObject>).map(sanitizeSchema)
  }

  public async parseOperation(
    pathPattern: string,
    method: OpenAPIV3.HttpMethods,
    doc?: DereferencedDocument,
  ): Promise<OperationBundle> {
    const document = doc ?? (await this.document)
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

    const operation: OperationBundleBase = {
      document,
      documentTrace,
      pathPattern,
      pathSpec,
      method,
      operationSpec,
      pathTrace,
      operationTrace,
      operationId: this.getOperationId({ method, operationSpec, operationTrace, pathPattern }),
    }

    return {
      ...operation,

      request: this.extractRequestSchema(operation),
      responses: this.extractResponsesSchema(operation),
      security: this.extractSecurity(operation),
    }
  }

  public async walkOperations(handler: (operation: OperationBundle) => Promise<void>, doc?: DereferencedDocument) {
    const document = doc ?? (await this.document)

    for (const [pathPattern, pathSpec] of Object.entries(document.paths)) {
      for (const method of Object.values(OpenAPIV3.HttpMethods)) {
        if (!pathSpec[method]) {
          continue
        }

        const operation = await this.parseOperation(pathPattern, method, document)

        await handler(operation)
      }
    }
  }

  public createHttpApiOperation(
    operation: OperationBundle,
    authorizerContext?: OpenAPIV3.SchemaObject,
  ): HttpApiOperation {
    const {
      operationId,
      request: {
        parameters: { path, query, cookie, header },
        body,
      },
      responses,
    } = operation

    // helper function to build the HTTP API request schema
    const buildRequestSchema = (body?: {
      contentType: string
      schema: OpenAPIV3.SchemaObject
    }): OpenAPIV3.SchemaObject => {
      const properties = Object.fromEntries(
        Object.entries({
          path,
          query,
          cookie,
          header,
          contentType: body
            ? {
                type: "string",
                enum: [body.contentType],
              }
            : undefined,
          body: body?.schema,
          authorizer: authorizerContext,
        }).filter((value): value is [string, OpenAPIV3.SchemaObject] => value[1] !== undefined),
      )

      return {
        type: "object",
        properties: properties,
        required: Object.keys(properties),
        additionalProperties: false,
      }
    }

    // combine request and response schemas into the operation schema
    const operationSchema: OpenAPIV3.SchemaObject & Required<Pick<OpenAPIV3.SchemaObject, "title">> = {
      title: pascalCase(`operation-${operationId}`),
      type: "object",
      properties: {
        request: {
          title: pascalCase(`operation-${operationId}-request`),
          oneOf: [
            ...(body?.schemas
              ? Object.entries(body.schemas).map(([contentType, schema]) => buildRequestSchema({ contentType, schema }))
              : []),
            ...(body?.required ? [] : [buildRequestSchema()]),
          ],
        },
        responses: {
          title: pascalCase(`operation-${operationId}-responses`),
          oneOf: responses,
        },
      },
      required: ["request", "responses"],
      additionalProperties: false,
    }

    // create the validator schemas
    const validatorSchemas = this.createValidtorSchemas(operation)

    if (authorizerContext) {
      validatorSchemas.push({
        ...authorizerContext,
        $id: "authorizer",
      })
    }

    return {
      ...operation,
      operationSchema,
      validatorSchemas,
    }
  }

  public trace(trace: Array<string | number>): DocumentTrace {
    const document = this.rawDocument
    return new DocumentTrace(document["x-sdf-spec-path"], trace)
  }

  public async copy(): Promise<DocumentParser> {
    const doc = new DocumentParser(await this.document)
    await doc.document
    return doc
  }

  public async bundle(): Promise<Document> {
    return SwaggerParser.bundle(await this.document) as unknown as Document
  }
}
