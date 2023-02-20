import { APIGatewayRequestSimpleAuthorizerHandlerV2WithContext } from "aws-lambda"

export const authorizerWrapper =
  <AuthorizerContext>(
    authorizer: APIGatewayRequestSimpleAuthorizerHandlerV2WithContext<AuthorizerContext>,
  ): APIGatewayRequestSimpleAuthorizerHandlerV2WithContext<AuthorizerContext> =>
  (...args) =>
    authorizer(...args)
