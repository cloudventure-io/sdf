import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"

import { SdfBundler } from "./SdfBundler"

export interface SdfResourcePermissions {
  [key: string]: DataAwsIamPolicyDocument
}

export abstract class SdfResource extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id)
    const bundler = SdfBundler.getBundlerFromCtx(this)
    bundler._registerResource(this, id)
  }

  abstract get id(): string
  abstract get permissions(): SdfResourcePermissions
  abstract get config(): { [key in string]: string }
  abstract get configSpec(): OpenAPIV3.SchemaObject
}
