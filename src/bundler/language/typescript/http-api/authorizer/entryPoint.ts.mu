/**
 * ATTENTION: This file was generated by @cloudventure/sdf package
 * and it will be regenerated when the stack is synthesized.
 */

import { authorizerWrapper } from "@cloudventure/sdf/http-api/runtime";
import { {{ AuthorizerModel }} as AuthorizerContext } from "./{{ InterfacesImport }}";
import { authorizer } from "./{{ HandlerImport }}";

export { AuthorizerContext }

export const {{ EntryPointFunctionName }} = authorizerWrapper<AuthorizerContext>(authorizer);
