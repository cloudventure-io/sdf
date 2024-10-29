import { APIGatewayRequestAuthorizerEventV2, APIGatewaySimpleAuthorizerWithContextResult } from "aws-lambda"

import { Unauthorized } from "../errors"

export type HttpApiAuthorizerHandler<AuthorizerContext> = (
  event: APIGatewayRequestAuthorizerEventV2,
) => Promise<APIGatewaySimpleAuthorizerWithContextResult<AuthorizerContext>>

export class HttpApiAuthorizerServer<AuthorizerContext> {
  constructor(public readonly handler: HttpApiAuthorizerHandler<AuthorizerContext>) {}

  createLambdaHandler(): HttpApiAuthorizerHandler<AuthorizerContext> {
    return async event => {
      try {
        return await this.handler(event)
      } catch (e) {
        if (e instanceof Unauthorized) {
          return {
            isAuthorized: false,
            context: {},
          } as APIGatewaySimpleAuthorizerWithContextResult<AuthorizerContext>
        }
        throw e
      }
    }
  }
}
