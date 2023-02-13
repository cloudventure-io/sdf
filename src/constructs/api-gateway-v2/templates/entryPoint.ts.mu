/**
 * ATTENTION: This file was generated by @cloudventure/sdf package
 * and it will be regenerated when the stack is synthesized.
 */

import { handlerWrapper, ExtractResponses } from "@cloudventure/sdf";
import { {{ OperationModel }} as Operation } from "./{{ InterfacesImport }}";
import validator from "./{{ ValidatorsImport }}";
import { handler } from "./{{ HandlerImport }}";

export type OperationRequest = Operation["request"];
export type OperationResponses = ExtractResponses<Operation["responses"]>;

export const {{ EntryPointFunctionName }} = handlerWrapper<Operation>(handler, validator);
