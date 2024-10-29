/**
 * ATTENTION: This file was generated by @cloudventure/sdf package
 * and it will be regenerated when the stack is synthesized.
 */

import { HttpApiAuthorizerServer } from "@cloudventure/sdf/http-api/runtime/server/HttpApiAuthorizerServer";
import { {{ AuthorizerModel }} as AuthorizerContext } from "./{{ InterfacesImport }}";
import { authorizer } from "./{{ HandlerImport }}";

export { AuthorizerContext }

const server = new HttpApiAuthorizerServer<AuthorizerContext>(authorizer)

export const {{ EntryPointFunctionName }} = server.createLambdaHandler()
