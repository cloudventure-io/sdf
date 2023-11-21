import { APIGatewayProxyStructuredResultV2 } from "aws-lambda"

import { MimeTypes } from "../../utils/MimeTypes"
import { HttpHeaders } from "../enum/HttpHeaders"

export class ApiResponse<
  BodyType,
  StatusCode extends number,
  HeadersType extends Record<string, string> = Record<string, never>,
> {
  constructor(
    public body: BodyType,
    public statusCode: StatusCode,
    public headers?: HeadersType,
  ) {}

  public render(): APIGatewayProxyStructuredResultV2 {
    return {
      statusCode: this.statusCode,
      body: this.body === null || this.body === undefined ? "" : JSON.stringify(this.body),
      headers: {
        [HttpHeaders.ContentType]: MimeTypes.APPLICATION_JSON,
        ...this.headers,
      },
    }
  }
}
