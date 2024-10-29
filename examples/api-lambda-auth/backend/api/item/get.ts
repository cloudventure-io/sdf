import { HttpStatusCodes } from "@cloudventure/sdf/http-api/common/HttpStatusCodes"
import * as Responses from "@cloudventure/sdf/http-api/runtime/common/ApiResponse"

import { OperationHandler, OperationRequest, OperationResponse } from "../../.gen/.entrypoints/api/item/get"

export const handler: OperationHandler = async (request: OperationRequest): Promise<OperationResponse> => {
  return new Responses.JsonResponse(
    {
      item: {
        created: new Date().toISOString(),
        id: request.path.itemId,
        name: "test",
      },
    },
    HttpStatusCodes.Ok,
  )
}
