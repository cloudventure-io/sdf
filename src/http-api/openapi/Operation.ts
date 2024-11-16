import { camelCase } from "change-case"
import { OpenAPIV3 } from "openapi-types"

import { Document, Links, SchemaDecoder, SecurityRequirementsConfig } from "./Document"
import { DocumentTrace } from "./DocumentTrace"
import { Parameter, ParameterConfig, ParametersMap } from "./Parameter"
import { Path } from "./Path"
import { RequestBody, RequestBodyConfig } from "./RequestBody"
import { Response, ResponseConfig } from "./Response"
import { OperationSdfGen } from "./types"
import { map } from "./utils"

export interface OperationConfig<SchemaType = OpenAPIV3.SchemaObject> {
  operationId?: string
  description?: string

  parameters?: Array<ParameterConfig<SchemaType>>

  requestBody?: RequestBodyConfig<SchemaType>

  responses: {
    [statusCode: string]: ResponseConfig<SchemaType>
  }

  security?: SecurityRequirementsConfig

  "x-sdf-links"?: Links
  "x-sdf-success-codes"?: Array<number>

  "x-sdf-gen"?: OperationSdfGen
}

export class Operation<SchemaType = OpenAPIV3.SchemaObject> {
  description: OperationConfig<SchemaType>["description"]
  operationId: string

  parameters: Array<Parameter<SchemaType>>

  responses: {
    [statusCode: string]: Response<SchemaType>
  }

  requestBody?: RequestBody<SchemaType>

  links: Links

  successCodes: Array<number>

  security?: SecurityRequirementsConfig

  readonly document: Document<SchemaType>

  public data: Record<string, unknown> = {}

  gen: OperationConfig<SchemaType>["x-sdf-gen"]

  constructor(
    public readonly path: Path<SchemaType>,
    public readonly method: OpenAPIV3.HttpMethods,
    {
      description,
      operationId,
      parameters,
      responses,
      requestBody,
      security,

      "x-sdf-links": links,
      "x-sdf-success-codes": successCodes,
      "x-sdf-gen": gen,
    }: OperationConfig<SchemaType>,
  ) {
    this.document = path.document
    this.description = description
    this.gen = gen

    operationId ??= camelCase(`${path.pattern}-${method}`)
    if (operationId in this.document.operations) {
      throw new Error(`Operation with id ${operationId} already exists at ${this.trace()}`)
    }
    this.operationId = operationId
    this.document.operations[operationId] = this

    this.parameters = parameters?.map((param, index) => new Parameter(this, index, param)) || []
    this.responses = map(responses, (response, statusCode) => {
      // LIMIT: OAS3.0 only numeric status codes are supported (https://swagger.io/specification/v3/#responses-object)
      if ("" + parseInt(statusCode) != statusCode) {
        throw new Error(
          `the '${statusCode}' is invalid, only specific status codes are supported at ${this.trace().append("responses")}`,
        )
      }
      return new Response(this, parseInt(statusCode), response)
    })

    if (!Object.keys(this.responses).length) {
      throw new Error(`operation must have at least one response at ${this.trace().append("responses")}`)
    }

    this.requestBody = requestBody ? new RequestBody(this, requestBody) : undefined

    this.links = links ?? {}

    this.successCodes = successCodes?.length
      ? successCodes.filter(code => code in this.responses)
      : Object.keys(this.responses)
          .map(parseInt)
          .filter(code => code < 400)

    if (!this.successCodes.length) {
      throw new Error(`operation must have at least one success code at ${this.trace()}`)
    }

    this.security = security
  }

  resolveParameters(): ParametersMap<SchemaType> {
    const parameters = [this.path.parameters, this.parameters].flat()

    const parametersByTypesMap: ParametersMap<SchemaType> = {}

    for (const param of parameters) {
      const p = parametersByTypesMap[param.in] || {}
      p[param.name] = param
      parametersByTypesMap[param.in] = p
    }

    return parametersByTypesMap
  }

  resolveLinks(): Links {
    return {
      ...this.document.links,
      ...this.path.links,
      ...this.links,
    }
  }

  resolveSecurity(): { name: string; requirements: Array<string> } | undefined {
    const security = this.security || this.document.security

    if (!security || !security.length) {
      return
    } else if (security.length > 1) {
      throw new Error(`only single security requirement is supported at ${this.trace()}`)
    } else if (Object.keys(security[0]).length > 1) {
      throw new Error(`only single security element is supported at ${this.trace()}`)
    }

    const name = Object.keys(security[0])[0]
    const requirements = security[0][name]

    return {
      name,
      requirements,
    }
  }

  decode<ST>(decoder: SchemaDecoder<ST>): OperationConfig<ST> {
    return {
      description: this.description,
      operationId: this.operationId,
      parameters: this.parameters.length > 0 ? this.parameters.map(param => param.decode(decoder)) : undefined,
      responses: map(this.responses, response => response.decode(decoder)),
      requestBody: this.requestBody?.decode(decoder),
      security: this.security,

      "x-sdf-links": this.links,
      "x-sdf-success-codes": this.successCodes,
      "x-sdf-gen": this.gen,

      ...this.data,
    }
  }

  decodeClean<ST>(decoder: SchemaDecoder<ST>): OperationConfig<ST> {
    return {
      description: this.description,
      operationId: this.operationId,
      parameters: this.parameters.length > 0 ? this.parameters.map(param => param.decodeClean(decoder)) : undefined,
      responses: map(this.responses, response => response.decodeClean(decoder)),
      requestBody: this.requestBody?.decodeClean(decoder),
      security: this.security,

      ...this.data,
    }
  }

  trace(): DocumentTrace {
    return this.path.trace().append(this.method)
  }

  defaultResponse(): Response<SchemaType> {
    const statusCode = Object.keys(this.responses).map(parseInt).sort()[0]
    return this.responses[statusCode]
  }
}
