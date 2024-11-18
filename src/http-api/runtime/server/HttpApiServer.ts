import { APIGatewayProxyEventV2WithRequestContext, APIGatewayProxyStructuredResultV2 } from "aws-lambda"

import { HttpHeaders } from "../../common/HttpHeaders"
import { Operation } from "../../openapi/Operation"
import { AwsHttpEventCodec } from "../codec/AwsHttpEventCodec"
import { Codec, CodecInput } from "../codec/Codec"
import { HeaderEncoder } from "../codec/HeaderEncoder"
import { MediaContainer, MediaContainerCodecs } from "../codec/MediaContainerCodec"
import { ApiResponse, DefaultMediaType } from "../common/ApiResponse"
import { GeneratedRequestShape, GeneratedResponseShape } from "../common/types"
import { BadRequest, HttpError, InternalServerError, UnprocessableContent, UnsupportedMediaType } from "../errors"
import { Middleware } from "./Middleware"
import { Validator, Validators } from "./validator"

export type HttpApiServerRequestShape = Required<Pick<GeneratedRequestShape, "path" | "query" | "header">> & {
  event: APIGatewayProxyEventV2WithRequestContext<unknown>
  authorizer?: unknown
} & ({ mediaType: string; body: unknown } | Record<string, never>)

type ConstrainBodyType<Body, Constraint> = Body extends object
  ? Constraint extends Record<string, unknown>
    ? { [key in keyof Body]: Body[key & keyof Constraint] & Constraint[key & keyof Constraint] }
    : Body extends Constraint
      ? Body
      : never
  : Body extends Constraint
    ? Body
    : never

type IsEqual<A, B, T = A, F = B> = A extends B ? (B extends A ? T : F) : F

type PreserveBodyType<Body, Constraint> = IsEqual<Body, ConstrainBodyType<Body, Constraint>>

export type ConstructServerRequest<Request extends GeneratedRequestShape> = {
  event: APIGatewayProxyEventV2WithRequestContext<unknown>

  path: Record<string, string | number | boolean | undefined> & Required<Request>["path"]
  query: Record<string, string | number | boolean | undefined> & Required<Request>["query"]
  header: Record<string, string | number | boolean | undefined> & Required<Request>["header"]
  cookie: Record<string, string | number | boolean | undefined> & Required<Request>["cookie"]
} & (Request extends {
  authorizer: infer Authorizer
}
  ? { authorizer: Authorizer }
  : Record<string, never>) &
  (Request extends {
    mediaType: infer MediaType extends string
    body: infer Body
  }
    ? { mediaType: MediaType; body: PreserveBodyType<Body, CodecInputType<MediaType>> }
    : Record<string, never>)

type ConditionalExtend<T, U> = T extends U ? T : unknown
type FallbackToDefault<T, D> = unknown extends T ? (T extends unknown ? D : T) : T

export type ConstructResponseBody<
  Response extends GeneratedResponseShape,
  MediaType extends string,
> = FallbackToDefault<ConditionalExtend<Response[MediaType], CodecInputType<MediaType>>, CodecInputType<MediaType>>

type MediaCodecs = typeof MediaContainerCodecs

export type CodecInputType<K extends string> = CodecInput<
  MediaCodecs[K extends keyof MediaCodecs ? K : DefaultMediaType]
>

export type HttpApiServerOperation = {
  request: HttpApiServerRequestShape
  response: ApiResponse
}

export type HttpApiServerHandler<OpType extends HttpApiServerOperation> = (
  request: OpType["request"],
) => Promise<OpType["response"]>

const validate = <T>(name: string, data: any, validator?: Validator): T => {
  if (validator) {
    if (!validator(data)) {
      throw new BadRequest(`VALIDATION_ERROR_${name}`, "request validation failed", validator.errors)
    }
  }
  return data as T
}

export interface HttpApiServerConfig<OpType extends HttpApiServerOperation> {
  operation: Operation
  handler: HttpApiServerHandler<OpType>
  validators: Validators

  middleware?: Middleware
}

export class HttpApiServer<OpType extends HttpApiServerOperation> {
  private codec = new AwsHttpEventCodec()
  private headerEncoder = new HeaderEncoder()

  readonly operation: Operation
  readonly handler: HttpApiServerHandler<OpType>
  readonly validators: Validators
  readonly middleware?: Middleware

  constructor({ operation, handler, validators, middleware }: HttpApiServerConfig<OpType>) {
    this.operation = operation
    this.handler = handler
    this.validators = validators
    this.middleware = middleware
  }

  private async createRequest(
    event: APIGatewayProxyEventV2WithRequestContext<unknown>,
  ): Promise<HttpApiServerRequestShape> {
    const request: HttpApiServerRequestShape = {
      event,
      path: validate("PATH", event.pathParameters || {}, this.validators.path),
      query: validate("QUERY_STRING", event.queryStringParameters || {}, this.validators.query),
      cookie: validate(
        "COOKIE",
        Object.fromEntries((event.cookies || []).map(cookie => cookie.split("=", 2))),
        this.validators.cookie,
      ),
      header: validate("HEADER", this.headerEncoder.encode(event.headers || {}), this.validators.header),
      mediaType: "",
      body: undefined,
    }

    if (this.validators.authorizer) {
      request.authorizer = validate("AUTHORIZER", event.requestContext?.["authorizer"], this.validators.authorizer)
    }

    const requestBody = this.operation.requestBody

    // if the operation doesn't expect a request body, we're done
    if (!requestBody) {
      return request
    }

    const mediaType = String(request.header[HttpHeaders.ContentType] || "")
      .split(";")[0]
      ?.trim()

    if (!mediaType) {
      if (requestBody.required) {
        throw new UnprocessableContent(
          "UNPROCESSABLE_CONTENT",
          "content-type header is required to process the request body",
        )
      } else {
        return request
      }
    } else if (!(mediaType in requestBody.content)) {
      throw new UnsupportedMediaType("UNSUPPORTED_MEDIA_TYPE", `unsupported media type '${mediaType}'`)
    }

    const codec: Codec<MediaContainer, unknown> =
      MediaContainerCodecs[mediaType] || MediaContainerCodecs[DefaultMediaType]

    const media = {
      mediaType,
      body: codec.decode({ body: event.body, isBase64Encoded: event.isBase64Encoded }),
    }

    validate("BODY", media, this.validators.body)

    request.mediaType = media.mediaType
    request.body = media.body

    return request
  }

  private async invokeHandler(
    event: APIGatewayProxyEventV2WithRequestContext<unknown>,
  ): Promise<{ response: ApiResponse; error?: unknown }> {
    try {
      let request = await this.createRequest(event)

      if (this.middleware?.request) {
        request = await this.middleware.request(request, this.operation)
      }

      const response = await this.handler(request)

      if (response && !(response instanceof ApiResponse)) {
        throw new InternalServerError("INTERNAL_SERVER_ERROR", "handler must return an ApiResponse")
      }

      return { response }
    } catch (error) {
      if (error instanceof ApiResponse) {
        return { response: error }
      } else if (error instanceof HttpError) {
        return {
          response: ApiResponse.fromError(error),
          error,
        }
      } else {
        console.error(error)
        return {
          response: ApiResponse.fromError(new InternalServerError("INTERNAL_SERVER_ERROR", "internal server error")),
          error,
        }
      }
    }
  }

  createLambdaHandler() {
    return async (
      event: APIGatewayProxyEventV2WithRequestContext<unknown>,
    ): Promise<APIGatewayProxyStructuredResultV2> => {
      if (this.middleware?.rawRequest) {
        event = await this.middleware.rawRequest(event)
      }
      const result = await this.invokeHandler(event)

      if (this.middleware?.response) {
        result.response = await this.middleware.response(result.response, this.operation, result.error)
      }

      let response = this.codec.encode(result.response)

      if (this.middleware?.rawResponse) {
        response = await this.middleware.rawResponse(response)
      }

      return response
    }
  }
}
