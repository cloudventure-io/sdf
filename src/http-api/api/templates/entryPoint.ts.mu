/**
 * ATTENTION: This file was generated by @cloudventure/sdf package
 * and it will be regenerated when the stack is synthesized.
 */

import { httpApiRuntime, DereferencedDocument } from "@cloudventure/sdf";
import { {{ OperationModel }} as Operation } from "./{{ InterfacesImport }}";
import * as validators from "./{{ ValidatorsImport }}";
import { handler } from "./{{ HandlerImport }}";

export type OperationRequest = Operation["request"];
export type OperationResponses = httpApiRuntime.ExtractResponses<Operation["responses"]>;
export type Event = httpApiRuntime.EventType<Operation>;
export type Handler = httpApiRuntime.LambdaHandler<Operation>;

import document from "./{{ DocumentImport }}"
const operation = httpApiRuntime.createOperationBundle(document as unknown as DereferencedDocument<{}>, {{ PathPatternString }}, {{ MethodString }});

{{#RequestInterceptor}}
import { requestInterceptor } from "./{{ RequestInterceptor }}";
{{/RequestInterceptor}}
{{#ResponseInterceptor}}
import { responseInterceptor } from "./{{ ResponseInterceptor }}";
{{/ResponseInterceptor}}

export const {{ EntryPointFunctionName }} = httpApiRuntime.wrapper<Operation>({
    handler,
    validators,
    operation,
    {{#RequestInterceptor}}
    requestInterceptor,
    {{/RequestInterceptor}}
    {{#ResponseInterceptor}}
    responseInterceptor,
    {{/ResponseInterceptor}}
});