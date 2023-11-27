import { HttpStatusCodes } from "@cloudventure/sdf/http-api/enum";
import { ApiResponse } from "@cloudventure/sdf/http-api/runtime";

import { Handler, OperationRequest, OperationResponses } from "{{ WrapperImport }}";

export const handler: Handler = async (request: OperationRequest): Promise<OperationResponses> => {
  return new ApiResponse(
    {{ HandlerBody }},
    HttpStatusCodes.Ok
  );
};
