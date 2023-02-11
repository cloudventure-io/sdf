import { OpenAPIV3 } from "openapi-types";
import { PathItemObject } from "./types";
import { Document, OperationObject } from "./types";

export interface OperationHandlerOptions<OperationType extends {}> {
  pathPattern: string;
  pathSpec: PathItemObject<OperationType>;

  method: OpenAPIV3.HttpMethods;
  operationSpec: OperationObject<OperationType>;

  document: Document<OperationType>;

  trace: string;
}

export interface walkSpecOptions<OperationType extends {}> {
  document: Document<OperationType>;

  operationHandler: (options: OperationHandlerOptions<OperationType>) => void;
}

export const walkOperations = <T extends {}>({
  document,
  operationHandler,
}: walkSpecOptions<T>) => {
  Object.entries(document.paths).forEach(([pathPattern, pathSpec]) => {
    if (!pathSpec) {
      return;
    }

    Object.values(OpenAPIV3.HttpMethods).forEach(async (method) => {
      const operationSpec = pathSpec[method];

      if (!operationSpec) {
        return;
      }

      operationHandler({
        pathPattern,
        pathSpec,
        method,
        operationSpec,
        document,
        trace: `${document["x-sdf-spec-path"]}#/paths["${pathPattern}"]/${method}`
      });
    });
  });
};
