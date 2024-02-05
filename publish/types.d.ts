declare module "*.openapi.yml" {
  const spec: import("./http-api/openapi/types").BundledDocument
  export default spec
}

declare module "*.openapi.yaml" {
  const spec: import("./http-api/openapi/types").BundledDocument
  export default spec
}

declare module "*/openapi.yml" {
  const spec: import("./http-api/openapi/types").BundledDocument
  export default spec
}

declare module "*/openapi.yaml" {
  const spec: import("./http-api/openapi/types").BundledDocument
  export default spec
}

declare module "*?filepath" {
  const result: string
  export default result
}
