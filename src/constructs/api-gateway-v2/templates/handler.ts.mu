import { ApiResponse, HttpStatusCodes } from "@cloudventure/sdf";
import { OperationRequest, OperationResponses } from "{{ WrapperImport }}";

export const handler = async (
  request: OperationRequest
): Promise<OperationResponses> => {
  return new ApiResponse(
    {},
    HttpStatusCodes.Ok
  );
};
