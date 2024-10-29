import { APIGatewayProxyStructuredResultV2 } from "aws-lambda"

import { ApiResponse, ApiResponseByMediaType, DefaultMediaType, EmptyResponse } from "../common/ApiResponse"
import { Codec } from "./Codec"
import { HeaderEncoder } from "./HeaderEncoder"

export interface AwsHttpEventData {
  statusCode: number
  headers: Record<string, string> | Headers
  body: string | ArrayBuffer
  isBase64Encoded?: boolean
}

export class AwsHttpEventCodec<Response extends ApiResponse<any>> extends Codec<
  Response,
  APIGatewayProxyStructuredResultV2,
  never,
  AwsHttpEventData
> {
  private headerCodec = new HeaderEncoder()

  encode(res: Response): APIGatewayProxyStructuredResultV2 {
    const { body, isBase64Encoded } = res.encodeBody()

    return {
      statusCode: res.statusCode,
      body,
      isBase64Encoded,
      headers: this.headerCodec.encode({
        "content-type": res.content.mediaType,
        ...res.headers,
      }),
    }
  }

  decode(input: AwsHttpEventData): Response {
    const headers = this.headerCodec.encode(
      input.headers instanceof Headers ? Object.fromEntries(input.headers.entries()) : input.headers || {},
    )
    const mediaType = headers["content-type"]?.split(";")?.[0]?.trim()

    if (!mediaType && !parseInt(headers["content-length"])) {
      return new EmptyResponse(input.statusCode, headers) as unknown as Response
    }

    const ResponseClass =
      mediaType in ApiResponseByMediaType ? ApiResponseByMediaType[mediaType] : ApiResponseByMediaType[DefaultMediaType]

    const res = new ResponseClass(null, input.statusCode, headers)
    res.decodeBody(input)

    return res
  }
}
