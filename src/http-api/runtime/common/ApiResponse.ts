import { FormDataCodecData } from "../codec/FormDataCodec"
import {
  BinaryMediaContainerCodec,
  FormMediaContainerCodec,
  JsonMediaContainerCodec,
  MediaContainer,
  Utf8MediaContainerCodec,
} from "../codec/MediaContainerCodec"
import { HttpError } from "../errors"

export type ResponseHeaders = Record<string, string | undefined>

export type ContentShape<MediaType extends string = string, Body = any> = {
  mediaType?: MediaType
  body: Body
}

export abstract class ApiResponse<
  Body = any,
  MediaType extends string = string,
  StatusCode extends number = any,
  Headers extends ResponseHeaders = any,
> {
  public statusCode: StatusCode
  public content: ContentShape<MediaType, Body>
  public headers?: Headers

  constructor(content: ContentShape<MediaType, Body>, statusCode: StatusCode, headers?: Headers) {
    this.statusCode = statusCode
    this.content = content
    this.headers = headers
  }

  get body(): Body {
    return this.content.body
  }

  abstract encodeBody(): Partial<MediaContainer>
  abstract decodeBody(output: Partial<MediaContainer>): Body

  static fromError(error: HttpError) {
    return new JsonResponse(error, error.statusCode)
  }
}

export class EmptyResponse<
  Body extends null,
  StatusCode extends number,
  Headers extends ResponseHeaders,
> extends ApiResponse<Body, any, StatusCode, Headers> {
  constructor(statusCode: StatusCode, headers?: Headers) {
    super({ body: null as Body }, statusCode, headers)
  }

  encodeBody() {
    return {}
  }

  decodeBody() {
    return null as Body
  }
}

export class TextResponse<
  Body extends string,
  StatusCode extends number,
  Headers extends ResponseHeaders,
  MediaType extends string = "text/plain",
> extends ApiResponse<Body, MediaType, StatusCode, Headers> {
  private codec = new Utf8MediaContainerCodec()

  constructor(body: Body, statusCode: StatusCode, headers?: Headers, mediaType: MediaType = "text/plain" as MediaType) {
    super({ mediaType, body }, statusCode, headers)
  }

  encodeBody() {
    return this.codec.encode(this.body)
  }

  decodeBody(output: MediaContainer) {
    return (this.content.body = this.codec.decode(output) as Body)
  }
}

export class HtmlResponse<
  Body extends string,
  StatusCode extends number,
  Headers extends ResponseHeaders,
> extends TextResponse<Body, StatusCode, Headers, "text/html"> {
  constructor(body: Body, statusCode: StatusCode, headers?: Headers) {
    super(body, statusCode, headers, "text/html")
  }
}

export class JsonResponse<
  Body,
  StatusCode extends number,
  Headers extends ResponseHeaders = ResponseHeaders,
> extends ApiResponse<Body, "application/json", StatusCode, Headers> {
  private codec = new JsonMediaContainerCodec()

  constructor(
    body: Body,
    public readonly statusCode: StatusCode,
    public readonly headers?: Headers,
  ) {
    super({ mediaType: "application/json", body }, statusCode, headers)
  }

  encodeBody() {
    return this.codec.encode(this.body)
  }

  decodeBody(output: MediaContainer) {
    return (this.content.body = this.codec.decode(output) as Body)
  }
}

export class BinaryResponse<
  Body extends ArrayBuffer,
  StatusCode extends number,
  Headers extends ResponseHeaders,
> extends ApiResponse<Body, "application/octet-stream", StatusCode, Headers> {
  private codec = new BinaryMediaContainerCodec()

  constructor(body: Body, statusCode: StatusCode, headers?: Headers) {
    super({ mediaType: "application/octet-stream", body }, statusCode, headers)
  }

  encodeBody() {
    return this.codec.encode(this.body)
  }

  decodeBody(output: MediaContainer) {
    return (this.content.body = this.codec.decode(output) as Body)
  }
}

export class FormResponse<
  Body extends FormDataCodecData,
  StatusCode extends number,
  Headers extends ResponseHeaders,
> extends ApiResponse<Body, "application/x-www-form-urlencoded", StatusCode, Headers> {
  private codec = new FormMediaContainerCodec()

  constructor(body: Body, statusCode: StatusCode, headers?: Headers) {
    super({ mediaType: "application/x-www-form-urlencoded", body }, statusCode, headers)
  }

  encodeBody() {
    return this.codec.encode(this.body)
  }

  decodeBody(output: MediaContainer) {
    return (this.content.body = this.codec.decode(output) as Body)
  }
}

export const DefaultMediaType = "application/octet-stream" as const
export type DefaultMediaType = typeof DefaultMediaType

export const ApiResponseByMediaType = {
  "text/plain": TextResponse,
  "text/html": HtmlResponse,
  "application/octet-stream": BinaryResponse,
  "application/json": JsonResponse,
  "application/x-www-form-urlencoded": FormResponse,
}
