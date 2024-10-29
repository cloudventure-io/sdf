import { HttpStatusCodes } from "@cloudventure/sdf/http-api/common/HttpStatusCodes"
import * as Responses from "@cloudventure/sdf/http-api/runtime/common/ApiResponse"

import { OperationHandler, OperationRequest, OperationResponse } from "../../.gen/.entrypoints/api/identity/me"

export const handler: OperationHandler = async (request: OperationRequest): Promise<OperationResponse> => {
  return new Responses.JsonResponse({ ok: true, user: request.authorizer.lambda.name }, HttpStatusCodes.Ok)
}
