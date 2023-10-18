import { ApiResponse, HttpStatusCodes } from "@cloudventure/sdf"
import { Event, Handler, OperationRequest, OperationResponses } from "../entrypoints/handlerTest"

export const handler: Handler = async (request: OperationRequest, event: Event): Promise<OperationResponses> => {
  return new ApiResponse({ ok: true }, HttpStatusCodes.Ok)
}
