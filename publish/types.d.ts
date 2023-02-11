declare module "*.openapi.yml" {
  const spec: import("./openapi/types").Document<{}>;
  export default spec;
}

declare module "*.openapi.yaml" {
  const spec: import("./openapi/types").Document<{}>;
  export default spec;
}

declare module "*/openapi.yml" {
  const spec: import("./openapi/types").Document<{}>;
  export default spec;
}

declare module "*/openapi.yaml" {
  const spec: import("./openapi/types").Document<{}>;
  export default spec;
}

declare module "*?filepath" {
  const result: string;
  export default result;
}
