import { APIGatewayProxyEventV2WithRequestContext, APIGatewayProxyStructuredResultV2 } from "aws-lambda"

import { Operation } from "../../openapi/Operation"
import { ApiResponse } from "../common/ApiResponse"
import { HttpApiServerRequestShape } from "./HttpApiServer"

export interface Middleware {
  rawRequest?: (
    event: APIGatewayProxyEventV2WithRequestContext<unknown>,
    operation: Operation,
  ) => Promise<APIGatewayProxyEventV2WithRequestContext<unknown>>

  request?: (request: HttpApiServerRequestShape, operation: Operation) => Promise<HttpApiServerRequestShape>
  response?: (response: ApiResponse, operation: Operation, error?: unknown) => Promise<ApiResponse>

  rawResponse?: (
    response: APIGatewayProxyStructuredResultV2,
    operation: Operation,
  ) => Promise<APIGatewayProxyStructuredResultV2>
}
