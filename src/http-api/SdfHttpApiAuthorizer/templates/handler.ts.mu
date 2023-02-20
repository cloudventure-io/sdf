import { APIGatewayRequestSimpleAuthorizerHandlerV2WithContext } from "aws-lambda"

import { AuthorizerContext } from "./{{ WrapperImport }}";

export const authorizer: APIGatewayRequestSimpleAuthorizerHandlerV2WithContext<AuthorizerContext> = async event => {
  return {
    isAuthorized: false,
    context: {{ AuthorizerBody }},
  }
}
