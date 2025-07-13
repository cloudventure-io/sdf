import { Operation } from "../../openapi/Operation"
import { GeneratedRequestShape } from "../common/types"

export type ApiClientRequestShape = Partial<Omit<GeneratedRequestShape, "authorizer">>

export type OperationRequest<Request extends GeneratedRequestShape> = Omit<Request, "authorizer">

export type OperationRequestDefaultMediaType<Request extends GeneratedRequestShape> = Omit<
  OperationRequest<Request>,
  "mediaType"
> & { mediaType?: string }

export interface ApiClientTransport {
  request<Response>(operation: Operation, req: ApiClientRequestShape): Promise<Response>
}
