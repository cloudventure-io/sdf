import { HttpHeaders } from "../../common/HttpHeaders"
import { MimeTypes } from "../../common/MimeTypes"
import { Operation } from "../../openapi/Operation"
import { AwsHttpEventCodec } from "../codec/AwsHttpEventCodec"
import { Codec, EchoCodec } from "../codec/Codec"
import { FormDataCodec } from "../codec/FormDataCodec"
import { HeaderEncoder } from "../codec/HeaderEncoder"
import { JsonCodec } from "../codec/JsonCodec"
import { ApiResponse, DefaultMediaType } from "../common/ApiResponse"
import { GeneratedOperationShape, GeneratedRequestShape } from "../common/types"
import { HttpError } from "../errors"
import { HttpApiClientAuthorizer } from "./HttpApiClientAuthorizer"

export const bodyCodecs = {
  "application/json": new JsonCodec(),
  "application/x-www-form-urlencoded": new FormDataCodec(),
  "application/octet-stream": new EchoCodec(),
}

type RequestInit = Exclude<ConstructorParameters<typeof Request>[1], undefined>

export type OperationRequest<Request extends GeneratedRequestShape> = Omit<Request, "authorizer">

export type OperationRequestDefaultMediaType<Request extends GeneratedRequestShape> = Omit<
  OperationRequest<Request>,
  "mediaType"
> & { mediaType?: string }

export type OperationResponses<
  Response extends GeneratedOperationShape,
  StatusCodes extends number = 200,
> = ApiResponse<Extract<Response["response"], { statusCode: StatusCodes }>>

export type HttpApiClientRequestShape = Partial<Omit<GeneratedRequestShape, "authorizer">>

export class HttpApiRequest extends Request {
  public attempt: number = 0
}

export interface HttpApiClientConfig {
  baseUrl: string
  authorizer?: HttpApiClientAuthorizer
}

export class HttpApiClient {
  public baseUrl: string
  public authorizer?: HttpApiClientAuthorizer

  private responseCodec = new AwsHttpEventCodec()
  private headerCodec = new HeaderEncoder()

  constructor({ baseUrl, authorizer }: HttpApiClientConfig) {
    this.baseUrl = baseUrl
    this.authorizer = authorizer
  }

  private filterUndefined(input: Record<string, string | number | boolean | undefined>): Record<string, string> {
    return Object.entries(input).reduce(
      (acc, [key, value]) => (value === undefined ? acc : { ...acc, [key]: String(value) }),
      {} as Record<string, string>,
    )
  }

  private substitutePathParams(pathPattern: string, params: Record<string, string>) {
    return pathPattern.replace(/\{(\w+)\}/g, (_, paramName) => {
      // Check if the parameter exists in the provided map, if not, throw an error.
      if (!(paramName in params)) {
        throw new Error(`Parameter "${paramName}" not found in the provided parameters map.`)
      }
      // Replace the parameter with the value from the map.
      return encodeURIComponent(params[paramName])
    })
  }

  private async createRequest(operation: Operation, req: HttpApiClientRequestShape) {
    let body: string | ArrayBuffer | undefined

    const requestBodyMediaTypes = Object.keys(operation.requestBody?.content || {})
    const mediaType =
      req.mediaType || (requestBodyMediaTypes.length === 1 && requestBodyMediaTypes[0]) || DefaultMediaType

    if (req.body !== undefined) {
      const codec: Codec<unknown, string | ArrayBuffer> = bodyCodecs[mediaType]
      body = codec.encode(req.body)
    }

    const requestInit: RequestInit = {
      method: operation.method.toUpperCase(),
      headers: this.headerCodec.encode({
        [HttpHeaders.ContentType]: mediaType,
        ...req.header,
      }),
      redirect: "manual",
      body,
    }

    const url = new URL(
      this.substitutePathParams(operation.path.pattern, this.filterUndefined(req.path || {})),
      this.baseUrl,
    )

    for (const [key, value] of Object.entries(this.filterUndefined(req.query || {}))) {
      url.searchParams.append(key, value)
    }

    const httpReq = new HttpApiRequest(url, requestInit)

    return httpReq
  }

  private async createError(response: ApiResponse): Promise<HttpError | ApiResponse> {
    if (response.content.mediaType === MimeTypes.ApplicationJson) {
      try {
        return HttpError.fromJSON(response.body)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_) {
        /* noop */
      }
    }

    return response
  }

  private async createResponse(res: Response): Promise<ApiResponse<{ statusCode: number }>> {
    const response = this.responseCodec.decode({
      statusCode: res.status,
      headers: res.headers,
      body: await res.arrayBuffer(),
      isBase64Encoded: false,
    })
    return response
  }

  public async request<Response>(operation: Operation, req: HttpApiClientRequestShape) {
    let request = await this.createRequest(operation, req)

    if (this.authorizer) {
      request = await this.authorizer.sign(request)
    }

    const response = await this.createResponse(await fetch(request))

    if (operation.successCodes && !operation.successCodes.includes(response.statusCode)) {
      throw await this.createError(response)
    }

    return response as Response
  }
}
