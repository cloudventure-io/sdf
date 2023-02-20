import { ApiResponse, HttpStatusCodes } from "@cloudventure/sdf";
import { Event, Handler, OperationRequest, OperationResponses } from "{{ WrapperImport }}";

export const handler: Handler = async (
  request: OperationRequest,
  event: Event
): Promise<OperationResponses> => {
  return new ApiResponse(
    {{ HandlerBody }},
    HttpStatusCodes.Ok
  );
};
