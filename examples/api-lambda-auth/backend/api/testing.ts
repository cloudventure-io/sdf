import { ApiResponse, HttpStatusCodes } from "@cloudventure/sdf"

import { Event, Handler, OperationRequest, OperationResponses } from "../.gen/entrypoints/api/testing"

export const handler: Handler = async (request: OperationRequest, event: Event): Promise<OperationResponses> => {
  return new ApiResponse({ ok: true, user: request.authorizer.lambda.name }, HttpStatusCodes.Ok)
}
