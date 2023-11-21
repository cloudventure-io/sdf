import { APIGatewayRequestSimpleAuthorizerHandlerV2WithContext } from "aws-lambda"

import { Unauthorized } from "../error"

export const authorizerWrapper =
  <AuthorizerContext>(
    authorizer: APIGatewayRequestSimpleAuthorizerHandlerV2WithContext<AuthorizerContext>,
  ): APIGatewayRequestSimpleAuthorizerHandlerV2WithContext<AuthorizerContext> =>
  (...args) => {
    const res = authorizer(...args)
    if (res) {
      return res.catch(e => {
        if (e instanceof Unauthorized) {
          return {
            isAuthorized: false,
            context: {} as AuthorizerContext,
          }
        }
        return Promise.reject(e)
      })
    }
  }
