declare module "*.openapi.yml" {
  const spec: import("./types/openapi/types").Document<object>
  export default spec
}

declare module "*.openapi.yaml" {
  const spec: import("./types/openapi/types").Document<object>
  export default spec
}

declare module "*/openapi.yml" {
  const spec: import("./types/openapi/types").Document<object>
  export default spec
}

declare module "*/openapi.yaml" {
  const spec: import("./types/openapi/types").Document<object>
  export default spec
}

declare module "*?filepath" {
  const result: string
  export default result
}
