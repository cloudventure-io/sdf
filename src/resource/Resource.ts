import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"

import { App } from "../App"

export interface ResourcePermissions {
  [key: string]: DataAwsIamPolicyDocument
}

export abstract class Resource extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id)
    const app = App.getAppFromContext(this)
    app.registerResource(this, id)
  }

  abstract get id(): string
  abstract get permissions(): ResourcePermissions
  abstract get config(): { [key in string]: string }
  abstract get configSpec(): OpenAPIV3.SchemaObject
}
