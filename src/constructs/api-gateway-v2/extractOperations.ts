import { OpenAPIV3 } from "openapi-types";

import {
  Document,
  OperationObject,
  ParameterObject,
} from "../../openapi/types";
import { OperationHandlerOptions, walkOperations } from "../../openapi/walkOperations";
import { MimeTypes } from "../../utils/MimeTypes";
import { pascalCase } from "change-case";

export type OperationSchemaTitleType = "operation" | "request" | "responses";

export type OperationSchemaTitleCallback<T extends {}> = (
  options: OperationHandlerOptions<T>,
  type: OperationSchemaTitleType
) => string;

export interface renderInterfacesOptions<T extends {}> {
  // The Document - it should be clonable and not dereferenced (e.g. the output of `SwaggerParser.bundle`)
  document: Document<T>;

  // Operation title generator function
  operationSchemaTitle: OperationSchemaTitleCallback<T>;
}

const extractParametersSchema = <T extends {}>(
  pathParameters: Array<ParameterObject>,
  operationSpec: OperationObject<T>
): {
  path?: OpenAPIV3.SchemaObject;
  query?: OpenAPIV3.SchemaObject;
  header?: OpenAPIV3.SchemaObject;
} =>
  [...(pathParameters || []), ...(operationSpec.parameters || [])].reduce<{
    [type: string]: OpenAPIV3.SchemaObject;
  }>(
    (acc, parameter) => ({
      ...acc,
      [parameter.in]: {
        ...(acc[parameter.in] || {
          additionalProperties: {
            oneOf: [{ type: "string", nullable: true }],
          },
        }),
        properties: {
          ...(acc[parameter.in]?.properties || {}),
          [parameter.in === "header"
            ? parameter.name.toLowerCase()
            : parameter.name]: parameter.schema,
        },
        required: parameter.required
          ? [
              ...(acc[parameter.in]?.required || []),
              parameter.in === "header"
                ? parameter.name.toLowerCase()
                : parameter.name,
            ]
          : acc[parameter.in]?.required || [],
      },
    }),
    {}
  );

export interface OperationRequestObjectSchema
  extends OpenAPIV3.NonArraySchemaObject {
  properties: {
    path: OpenAPIV3.SchemaObject;
    query: OpenAPIV3.SchemaObject;
    body?: OpenAPIV3.SchemaObject;
    header: OpenAPIV3.SchemaObject;
  };
}

const extractOperationRequestSchema = <T extends {}>(
  operation: OperationHandlerOptions<T>,
  operationSchemaTitle: OperationSchemaTitleCallback<T>
): OperationRequestObjectSchema => {
  const { pathSpec, operationSpec } = operation;

  const parameters = extractParametersSchema(
    pathSpec.parameters || [],
    operationSpec
  );

  let body: OpenAPIV3.SchemaObject | undefined;
  let contentType: string | undefined;

  if (operationSpec.requestBody?.content) {
    const keys = Object.keys(operationSpec.requestBody?.content);

    if (!keys.length) {
      throw new Error(`the ${operation.trace}/content is an empty object`);
    } else if (keys.length !== 1) {
      throw new Error(
        `the ${operation.trace}/content contains multiple elements, only single content is support currently`
      );
    }

    contentType = keys[0];
    if (
      contentType !== MimeTypes.APPLICATION_JSON &&
      contentType !== MimeTypes.APPLICATION_X_WWW_FORM_URLENCODED
    ) {
      throw new Error(
        `only ${MimeTypes.APPLICATION_JSON} or ${MimeTypes.APPLICATION_X_WWW_FORM_URLENCODED} content types are supported, got ${operation.trace}/content["${keys[0]}"]`
      );
    }

    body = operationSpec.requestBody.content[contentType].schema;
  }

  if (operationSpec.requestBody?.required && !body) {
    throw new Error(
      `the body is required, but ${operation.trace}/content is not set`
    );
  }

  return {
    type: "object",
    additionalProperties: false,
    title: operationSchemaTitle(operation, "request"),

    properties: {
      path: parameters.path || {
        type: "object",
        additionalProperties: false,
      },
      query: parameters.query || {
        type: "object",
        additionalProperties: false,
      },
      header: parameters.header || {
        type: "object",
        additionalProperties: { type: "string" },
      },
      ...(body ? { body } : {}),
    },

    required: [
      "path",
      "query",
      "header",
      ...(operationSpec.requestBody?.required ? ["body"] : []),
    ],
  };
};

const extractOperationResponsesSchema = <T extends {}>(
  operation: OperationHandlerOptions<T>,
  operationSchemaTitle: OperationSchemaTitleCallback<T>
): OpenAPIV3.SchemaObject => ({
  title: operationSchemaTitle(operation, "responses"),
  oneOf: Object.entries(operation.operationSpec.responses).map(
    ([statusCode, responseSpec]) => ({
      type: "object",
      properties: {
        statusCode: {
          type: "number",
          enum: [parseInt(statusCode)],
          "x-no-ts-enum": true,
        },
        body: responseSpec.content?.[MimeTypes.APPLICATION_JSON].schema || {
          type: "null",
        },
        headers: {
          type: "object",
          properties: Object.entries(responseSpec.headers || {}).reduce<{
            [header in string]: OpenAPIV3.SchemaObject;
          }>(
            (acc, [headerName, headerSpec]) => ({
              ...acc,
              [headerName]: headerSpec.schema,
            }),
            {}
          ),
          required: Object.entries(responseSpec.headers || {})
            .filter(([, headerSpec]) => headerSpec.required)
            .map(([headerName]) => headerName),
          additionalProperties: false,
        },
      },
      required: ["statusCode", "body", "headers"],
      additionalProperties: false,
    })
  ),
});

export interface OperationObjectSchema extends OpenAPIV3.NonArraySchemaObject {
  properties: {
    request: OperationRequestObjectSchema;
    responses: OpenAPIV3.SchemaObject;
  };
}

export const extractOperations = <OperationType extends {}>({
  document,
  operationSchemaTitle,
}: renderInterfacesOptions<OperationType>): {
  [key in string]: {
    schema: OperationObjectSchema;
    options: OperationHandlerOptions<OperationType>;
  };
} => {
  const operations: {
    [key in string]: {
      schema: OperationObjectSchema;
      options: OperationHandlerOptions<OperationType>;
    };
  } = {};

  walkOperations({
    document,

    operationHandler(options) {
      const schemaTitle = operationSchemaTitle(options, "operation");

      operations[schemaTitle] = {
        options,
        schema: {
          title: schemaTitle,
          additionalProperties: false,
          properties: {
            request: extractOperationRequestSchema(
              options,
              operationSchemaTitle
            ),
            responses: extractOperationResponsesSchema(
              options,
              operationSchemaTitle
            ),
          },
          required: ["request", "responses"],
        },
      };
    },
  });

  return operations;
};

export const defaultOperationTitle = <T extends {}>(
  { operationSpec }: OperationHandlerOptions<T>,
  type: OperationSchemaTitleType
): string =>
  pascalCase(
    `operation-${operationSpec.operationId}${
      type === "operation" ? "" : `-${type}`
    }`
  );
