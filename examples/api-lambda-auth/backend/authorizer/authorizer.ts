import { Unauthorized } from "@cloudventure/sdf/http-api/runtime/errors"
import { HttpApiAuthorizerHandler } from "@cloudventure/sdf/http-api/runtime/server/HttpApiAuthorizerServer"

import { AuthorizerContext } from "./../.gen/.entrypoints/authorizer/authorizer"

export const authorizer: HttpApiAuthorizerHandler<AuthorizerContext> = async event => {
  console.log("event", JSON.stringify(event))

  const token = (event.identitySource?.[0] || "").match(/^[^ ]+\s+(.*?)$/)?.[1] || ""

  if (!token) {
    throw new Unauthorized("UNAUTHORIZED", "missing token")
  }

  return {
    isAuthorized: true,
    context: {
      name: token,
    },
  }
}
