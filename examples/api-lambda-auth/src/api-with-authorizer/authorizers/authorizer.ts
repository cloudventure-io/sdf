import { APIGatewayRequestSimpleAuthorizerHandlerV2WithContext } from "aws-lambda"

import { AuthorizerContext } from "./../entrypoints/authorizerAuthorizer"

export const authorizer: APIGatewayRequestSimpleAuthorizerHandlerV2WithContext<AuthorizerContext> = async event => {
  return {
    isAuthorized: true,
    context: {
      name: "test",
    },
  }
}
