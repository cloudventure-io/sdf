import {
  APIGatewayProxyEventHeaders,
  APIGatewayProxyEventPathParameters,
  APIGatewayProxyEventQueryStringParameters,
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import { HttpHeaders } from "../../../utils/HttpHeaders";
import { MimeTypes } from "../../../utils/MimeTypes";
import { ApiResponse } from "../../../ApiResponse";
import { HttpError } from "../../../http-errors/HttpError";
import { HttpErrors } from "../../../http-errors";

export interface Operation {
  request: {
    path: APIGatewayProxyEventPathParameters;
    query: APIGatewayProxyEventQueryStringParameters;
    header: APIGatewayProxyEventHeaders;

    contentType?: "application/json" | "application/x-www-form-urlencoded";
    body?: unknown;
  };
  responses: {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
  };
}

export type ExtractResponseMap<ResponseTypes extends Operation["responses"]> = {
  [statusCode in ResponseTypes["statusCode"]]: ApiResponse<
    Extract<ResponseTypes, { statusCode: statusCode }>["body"],
    statusCode,
    Extract<ResponseTypes, { statusCode: statusCode }>["headers"]
  >;
};

export type ExtractResponses<ResponseTypes extends Operation["responses"]> =
  ExtractResponseMap<ResponseTypes> extends {
    [statusCode: string]: infer T;
  }
    ? T
    : never;

export type LambdaHandler<OpType extends Operation> = (
  options: OpType["request"],
  event: APIGatewayProxyEventV2
) => Promise<ExtractResponses<OpType["responses"]>>;

interface ValidationError {
  keyword: string; // validation keyword.
  instancePath: string; // JSON Pointer to the location in the data instance (e.g., `"/prop/1/subProp"`).
  schemaPath: string; // JSON Pointer to the location of the failing keyword in the schema
  params: object; // type is defined by keyword value, see below
  // params property is the object with the additional information about error
  // it can be used to generate error messages
  // (e.g., using [ajv-i18n](https://github.com/ajv-validator/ajv-i18n) package).
  // See below for parameters set by all keywords.
  propertyName?: string; // set for errors in `propertyNames` keyword schema.
  // `instancePath` still points to the object in this case.
  message?: string; // the error message (can be excluded with option `messages: false`).
  // Options below are added with `verbose` option:
  schema?: any; // the value of the failing keyword in the schema.
  parentSchema?: object; // the schema containing the keyword.
  data?: any; // the data validated by the keyword.
}

export interface Validator {
  (input: any): boolean;
  errors?: Array<ValidationError>;
}

const buildRequest = <OpType extends Operation>(
  event: APIGatewayProxyEventV2,
  validator?: Validator
): OpType["request"] => {
  const request: OpType["request"] = {
    path: event.pathParameters || {},
    query: event.queryStringParameters || {},
    header: Object.entries(event.headers).reduce(
      (acc, [key, value]) => ({ ...acc, [key.toLowerCase()]: value }),
      {}
    ),
  };

  const contentType = (
    Object.entries(event.headers).find(
      ([key]) => key.toLowerCase() === HttpHeaders.ContentType.toLowerCase()
    )?.[1] || ""
  )
    .split(";")[0]
    .trim();

  let body = event.body;

  if (body) {
    if (contentType === MimeTypes.APPLICATION_JSON) {
      request.contentType = MimeTypes.APPLICATION_JSON;
      request.body = JSON.parse(body);
    } else if (contentType === MimeTypes.APPLICATION_X_WWW_FORM_URLENCODED) {
      const params = new URLSearchParams(body);
      request.contentType = MimeTypes.APPLICATION_X_WWW_FORM_URLENCODED;
      request.body = Array.from(params.entries()).reduce<{
        [key in string]: string | Array<string>;
      }>(
        (acc, [key, value]) => ({
          ...acc,
          [key]: value,
        }),
        {}
      );
    } else {
      throw new HttpErrors.UnsupportedMediaType(
        "UNSUPPORTED_MEDIA_TYPE",
        `Content-Type '${contentType}' is not supported`
      );
    }
  }

  if (validator && !validator(request)) {
    throw new HttpErrors.BadRequest(
      "VALIDATION_ERROR",
      "request validation failed",
      validator.errors
    );
  }

  return request;
};

export const handlerWrapper =
  <OpType extends Operation>(
    cb: LambdaHandler<OpType>,
    validator?: Validator
  ) =>
  async (
    event: APIGatewayProxyEventV2
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    let response: ExtractResponses<OpType["responses"]>;

    try {
      response = await cb(buildRequest(event, validator), event);
    } catch (e) {
      if (e instanceof ApiResponse) {
        response = e as ExtractResponses<OpType["responses"]>;
      } else if (e instanceof HttpError) {
        response = new ApiResponse(e, e.statusCode) as ExtractResponses<
          OpType["responses"]
        >;
      } else {
        console.error(e);
        const error = new HttpErrors.InternalServerError(
          "INTERNAL_SERVER_ERROR",
          "Internal Server Error"
        );
        response = new ApiResponse(error, error.statusCode) as ExtractResponses<
          OpType["responses"]
        >;
      }
    }

    const result = (response as ApiResponse<unknown, number>).render();

    return result;
  };
