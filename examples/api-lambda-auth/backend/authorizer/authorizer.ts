import { APIGatewayRequestSimpleAuthorizerHandlerV2WithContext } from "aws-lambda"

import { Unauthorized } from "@cloudventure/sdf/http-api/error"

import { AuthorizerContext } from "./../.gen/entrypoints/authorizer/authorizer"

export const authorizer: APIGatewayRequestSimpleAuthorizerHandlerV2WithContext<AuthorizerContext> = async event => {
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
