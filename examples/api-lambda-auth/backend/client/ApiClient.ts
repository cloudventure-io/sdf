import { HttpApiClient } from "@cloudventure/sdf/http-api/runtime/client/HttpApiClient"
import { HttpApiClientTokenAuthorizer } from "@cloudventure/sdf/http-api/runtime/client/HttpApiClientAuthorizer"

import { BaseApiClient } from "../.gen/api/BaseApiClient"

export class ApiClient extends BaseApiClient {
  constructor(baseUrl: string, token: string) {
    const authorizer = new HttpApiClientTokenAuthorizer(async () => {
      return token
    })
    const transport = new HttpApiClient({
      baseUrl,
      authorizer,
    })

    super(transport)
  }
}
