import { HttpHeaders } from "../enum"
import { HttpApiRequest } from "./HttpApiClient"

export interface HttpApiClientAuthorizer {
  sign(request: HttpApiRequest): Promise<HttpApiRequest>
  isRetryable(request: HttpApiRequest, response: Response): boolean
}

export class HttpApiClientTokenAuthorizer implements HttpApiClientAuthorizer {
  constructor(public token: () => Promise<string>) {}

  async sign(request: HttpApiRequest): Promise<HttpApiRequest> {
    request.headers.set(HttpHeaders.Authorization, `Bearer ${await this.token()}`)
    return request
  }

  isRetryable(): boolean {
    return false
  }
}
