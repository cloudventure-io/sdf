import { ApiResponse, HttpStatusCodes } from "@cloudventure/sdf"

import { Handler, OperationRequest, OperationResponses } from "../.gen/entrypoints/api/testing"

export const handler: Handler = async (request: OperationRequest): Promise<OperationResponses> => {
  return new ApiResponse({ ok: true, user: request.authorizer.lambda.name }, HttpStatusCodes.Ok)
}
