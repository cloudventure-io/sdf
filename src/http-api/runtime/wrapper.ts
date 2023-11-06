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
import { HttpHeaders } from "../HttpHeaders"
import { OperationBundle } from "../api/OperationParser"
import { HttpErrors } from "../http-errors"
import { HttpError } from "../http-errors/HttpError"
import { DocumentTrace } from "../openapi/DocumentTrace"
import { DereferencedDocument } from "../openapi/types"
import { ApiResponse } from "./ApiResponse"

export interface Operation {
  request: {
    path: APIGatewayProxyEventPathParameters
    query: APIGatewayProxyEventQueryStringParameters
    header: APIGatewayProxyEventHeaders

    contentType?: "application/json" | "application/x-www-form-urlencoded"
    body?: unknown

    authorizer?: unknown
  }
  responses: {
    statusCode: number
    body?: unknown
    headers: Record<string, string>
  }
}

export type ExtractResponseMap<ResponseTypes extends Operation["responses"]> = {
  [statusCode in ResponseTypes["statusCode"]]: ApiResponse<
    Extract<ResponseTypes, { statusCode: statusCode }>["body"],
    statusCode,
    Extract<ResponseTypes, { statusCode: statusCode }>["headers"]
  >
}

export type ExtractResponses<ResponseTypes extends Operation["responses"]> = ExtractResponseMap<ResponseTypes> extends {
  [statusCode: string]: infer T
}
  ? T
  : never

export type EventType<OpType extends Operation> = OpType extends { request: { authorizer: unknown } }
  ? APIGatewayProxyEventV2WithLambdaAuthorizer<OpType["request"]["authorizer"]>
  : APIGatewayProxyEventV2

export type LambdaHandler<OpType extends Operation> = (
  options: OpType["request"],
  event: EventType<OpType>,
) => Promise<ExtractResponses<OpType["responses"]>>

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
      throw new HttpErrors.BadRequest(`VALIDATION_ERROR_${name}`, "request validation failed", validator.errors)
    }
  }
  return data as T
}

const buildRequest = <OpType extends Operation>(
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

  const contentType = (
    Object.entries(event.headers).find(([key]) => key.toLowerCase() === HttpHeaders.ContentType.toLowerCase())?.[1] ||
    ""
  )
    .split(";")[0]
    .trim()

  const eventBody = event.body
  let body: Pick<OpType["request"], "contentType" | "body"> | null = null

  if (eventBody) {
    if (contentType === MimeTypes.APPLICATION_JSON) {
      body = {
        contentType,
        body: JSON.parse(eventBody),
      }
    } else if (contentType === MimeTypes.APPLICATION_X_WWW_FORM_URLENCODED) {
      const params = new URLSearchParams(eventBody)
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
      throw new HttpErrors.UnsupportedMediaType(
        "UNSUPPORTED_MEDIA_TYPE",
        `Content-Type '${contentType}' is not supported`,
      )
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

export type RequestInterceptor = <OpType extends Operation>(
  event: EventType<OpType>,
  operation: OperationBundle<object>,
) => Promise<EventType<OpType>>

export type ResponseInterceptor = (
  response: APIGatewayProxyStructuredResultV2,
  operation: OperationBundle<object>,
) => Promise<APIGatewayProxyStructuredResultV2>

export interface wrapperOptions<OpType extends Operation> {
  handler: LambdaHandler<OpType>
  validators: Validators
  operation: OperationBundle<object>

  requestInterceptor?: RequestInterceptor
  responseInterceptor?: ResponseInterceptor
}

export const wrapper =
  <OpType extends Operation>({
    handler,
    validators,
    operation,
    requestInterceptor,
    responseInterceptor,
  }: wrapperOptions<OpType>) =>
  async (event: EventType<OpType>): Promise<APIGatewayProxyStructuredResultV2> => {
    type Responses = ExtractResponses<OpType["responses"]>
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
        const error = new HttpErrors.InternalServerError("INTERNAL_SERVER_ERROR", "Internal Server Error")
        response = new ApiResponse(error, error.statusCode) as Responses
      }
    }

    let result = (response as ApiResponse<unknown, number>).render()

    if (responseInterceptor) {
      result = await responseInterceptor(result, operation)
    }

    return result
  }

export const createOperationBundle = <OperationType extends object>(
  document: DereferencedDocument<OperationType>,
  pathPattern: string,
  method: string,
): OperationBundle<OperationType> => {
  const documentTrace = new DocumentTrace(document["x-sdf-spec-path"])
  const pathSpec = document.paths[pathPattern]
  const pathTrace = documentTrace.append(["paths", pathPattern])

  const operationSpec = pathSpec[method] as OperationBundle<OperationType>["operationSpec"]
  const operationTrace = pathTrace.append([method])

  return {
    document,
    documentTrace,

    pathPattern,
    pathSpec,
    pathTrace,

    method: method as OpenAPIV3.HttpMethods,

    operationId: operationSpec?.operationId as string,
    operationSpec,
    operationTrace,
  }
}
