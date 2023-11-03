import { APIGatewayRequestSimpleAuthorizerHandlerV2WithContext } from "aws-lambda"

import { AuthorizerContext } from "./../.gen/entrypoints/authorizer/authorizer"

export const authorizer: APIGatewayRequestSimpleAuthorizerHandlerV2WithContext<AuthorizerContext> = async event => {
  return {
    isAuthorized: true,
    context: {
      name: event.identitySource[0],
    },
  }
}
