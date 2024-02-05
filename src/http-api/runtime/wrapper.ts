import {
  APIGatewayProxyEventHeaders,
  APIGatewayProxyEventPathParameters,
  APIGatewayProxyEventQueryStringParameters,
  APIGatewayProxyEventV2,
  APIGatewayProxyEventV2WithLambdaAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda"
import { OpenAPIV3 } from "openapi-types"

import { MimeTypes } from "../../utils/MimeTypes"
import { HttpHeaders } from "../enum/HttpHeaders"
import { BadRequest, InternalServerError, UnsupportedMediaType } from "../error"
import { HttpError } from "../error/HttpError"
import { Document } from "../openapi/Document"
import { Operation } from "../openapi/Operation"
import { BundledDocument } from "../openapi/types"
import { dereference } from "../openapi/utils"
import { ApiResponse } from "./ApiResponse"

export interface HttpOperation {
  request: {
    path?: APIGatewayProxyEventPathParameters
    query?: APIGatewayProxyEventQueryStringParameters
    header?: APIGatewayProxyEventHeaders

    contentType?: string | null
    body?: unknown

    authorizer?: unknown
  }
  response: {
    statusCode: number
    body?: unknown
    contentType?: string | null
    headers?: Record<string, string>
  }
}

export type ExtractResponseMap<ResponseTypes extends HttpOperation["response"]> = {
  [statusCode in ResponseTypes["statusCode"]]: ApiResponse<
    Extract<ResponseTypes, { statusCode: statusCode }>["body"],
    statusCode,
    Extract<ResponseTypes, { statusCode: statusCode }>["headers"]
  >
}

export type ExtractResponses<ResponseTypes extends HttpOperation["response"]> =
  ExtractResponseMap<ResponseTypes> extends {
    [statusCode: string]: infer T
  }
    ? T
    : never

export type EventType<OpType extends HttpOperation> = OpType extends { request: { authorizer: unknown } }
  ? APIGatewayProxyEventV2WithLambdaAuthorizer<OpType["request"]["authorizer"]>
  : APIGatewayProxyEventV2

export type LambdaHandler<OpType extends HttpOperation> = (
  options: OpType["request"],
  event: EventType<OpType>,
) => Promise<ExtractResponses<OpType["response"]>>

interface ValidationError {
  keyword: string // validation keyword.
  instancePath: string // JSON Pointer to the location in the data instance (e.g., `"/prop/1/subProp"`).
  schemaPath: string // JSON Pointer to the location of the failing keyword in the schema
  params: object // type is defined by keyword value, see below
  // params property is the object with the additional information about error
  // it can be used to generate error messages
  // (e.g., using [ajv-i18n](https://github.com/ajv-validator/ajv-i18n) package).
  // See below for parameters set by all keywords.
  propertyName?: string // set for errors in `propertyNames` keyword schema.
  // `instancePath` still points to the object in this case.
  message?: string // the error message (can be excluded with option `messages: false`).
  // Options below are added with `verbose` option:
  schema?: any // the value of the failing keyword in the schema.
  parentSchema?: object // the schema containing the keyword.
  data?: any // the data validated by the keyword.
}

export interface Validator {
  (input: any): boolean
  errors?: Array<ValidationError>
}

const validate = <T>(name: string, data: any, validator?: Validator): T => {
  if (validator) {
    if (!validator(data)) {
      throw new BadRequest(`VALIDATION_ERROR_${name}`, "request validation failed", validator.errors)
    }
  }
  return data as T
}

const buildRequest = <OpType extends HttpOperation>(
  event: APIGatewayProxyEventV2 | APIGatewayProxyEventV2WithLambdaAuthorizer<OpType["request"]["authorizer"]>,
  validators: Validators,
): OpType["request"] => {
  const request: OpType["request"] = {
    path: validate("PATH", event.pathParameters || {}, validators.path),
    query: validate("QUERY_STRING", event.queryStringParameters || {}, validators.query),
    header: validate(
      "HEADER",
      Object.entries(event.headers).reduce((acc, [key, value]) => ({ ...acc, [key.toLowerCase()]: value }), {}),
      validators.header,
    ),
  }

  const contentType =
    (
      Object.entries(event.headers).find(([key]) => key.toLowerCase() === HttpHeaders.ContentType.toLowerCase())?.[1] ||
      ""
    )
      .split(";")[0]
      .trim() || null

  let eventBody: string | Buffer | undefined = event.body
  let body: Pick<OpType["request"], "contentType" | "body"> = {
    contentType: null,
    body: null,
  }

  if (eventBody) {
    if (event.isBase64Encoded) {
      eventBody = Buffer.from(eventBody, "base64")
    } else {
      eventBody = Buffer.from(eventBody)
    }

    if (contentType === MimeTypes.APPLICATION_JSON) {
      body = {
        contentType,
        body: JSON.parse(eventBody.toString("utf-8")),
      }
    } else if (contentType === MimeTypes.APPLICATION_X_WWW_FORM_URLENCODED) {
      const params = new URLSearchParams(eventBody.toString("utf-8"))
      body = {
        contentType,
        body: Array.from(params.entries()).reduce<{
          [key in string]: string | Array<string>
        }>(
          (acc, [key, value]) => ({
            ...acc,
            [key]: value,
          }),
          {},
        ),
      }
    } else {
      body = {
        contentType,
        body: eventBody,
      }
      throw new UnsupportedMediaType("UNSUPPORTED_MEDIA_TYPE", `Content-Type '${contentType}' is not supported`)
    }
  }

  validate("BODY", body, validators.body)

  request.body = body?.body
  request.contentType = body?.contentType

  if (validators.authorizer) {
    const authorizerContext = (event as APIGatewayProxyEventV2WithLambdaAuthorizer<OpType["request"]["authorizer"]>)
      .requestContext.authorizer

    if (!validators.authorizer(authorizerContext)) {
      throw new Error(`Authorizer context validation failed: ${JSON.stringify(validators.authorizer.errors)}`)
    }
    request.authorizer = authorizerContext
  }

  return request
}

export interface Validators {
  path?: Validator
  query?: Validator
  cookie?: Validator
  header?: Validator

  body?: Validator
  authorizer?: Validator
}

export type RequestInterceptor = <OpType extends HttpOperation>(
  event: EventType<OpType>,
  operation: Operation,
) => Promise<EventType<OpType>>

export type ResponseInterceptor = (
  response: APIGatewayProxyStructuredResultV2,
  operation: Operation,
) => Promise<APIGatewayProxyStructuredResultV2>

export interface wrapperOptions<OpType extends HttpOperation> {
  handler: LambdaHandler<OpType>
  validators: Validators
  operation: Operation

  requestInterceptor?: RequestInterceptor
  responseInterceptor?: ResponseInterceptor
}

export const wrapper =
  <OpType extends HttpOperation>({
    handler,
    validators,
    operation,
    requestInterceptor,
    responseInterceptor,
  }: wrapperOptions<OpType>) =>
  async (event: EventType<OpType>): Promise<APIGatewayProxyStructuredResultV2> => {
    type Responses = ExtractResponses<OpType["response"]>
    let response: Responses

    try {
      if (requestInterceptor) {
        event = await requestInterceptor(event, operation)
      }
      const request = buildRequest(event, validators)

      response = await handler(request, event)
    } catch (e) {
      if (e instanceof ApiResponse) {
        response = e as Responses
      } else if (e instanceof HttpError) {
        response = new ApiResponse(e, e.statusCode) as Responses
      } else {
        console.error(e)
        const error = new InternalServerError("INTERNAL_SERVER_ERROR", "Internal Server Error")
        response = new ApiResponse(error, error.statusCode) as Responses
      }
    }

    let result = (response as ApiResponse<unknown, number>).render()

    if (responseInterceptor) {
      result = await responseInterceptor(result, operation)
    }

    return result
  }

export const getOperationSchema = (
  bundledDocument: BundledDocument,
  pathPattern: string,
  method: string,
): Operation => {
  const document = new Document(dereference(bundledDocument))

  const operation = document.paths[pathPattern]?.operations[method as OpenAPIV3.HttpMethods]

  if (!operation) {
    throw new Error(`operation not found for ${method} ${pathPattern}`)
  }

  return operation
}
