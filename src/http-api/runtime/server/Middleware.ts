import { Operation } from "../../openapi/Operation"
import { ApiResponse } from "../common/ApiResponse"
import { HttpApiServerRequestShape } from "./HttpApiServer"

export interface Middleware {
  request?: (request: HttpApiServerRequestShape, operation: Operation) => Promise<HttpApiServerRequestShape>
  response?: (response: ApiResponse, operation: Operation) => Promise<ApiResponse>
}
