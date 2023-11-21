import { HttpApiClientTokenAuthorizer } from "@cloudventure/sdf/http-api/client"

import { BaseApiClient } from "../.gen/client/BaseApiClient"

export class ApiClient extends BaseApiClient {
  constructor(baseUrl: string, token: string) {
    const authorizer = new HttpApiClientTokenAuthorizer(async () => {
      return token
    })

    super({ baseUrl, authorizer })
  }
}
