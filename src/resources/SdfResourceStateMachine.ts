import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document"
import { SfnStateMachine } from "@cdktf/provider-aws/lib/sfn-state-machine"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"

import { SdfResource } from "../SdfResource"

export class SdfResourceStateMachine extends SdfResource {
  get configSpec(): OpenAPIV3.SchemaObject {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        arn: {
          type: "string",
        },
        name: {
          type: "string",
        },
      },
      required: ["arn", "name"],
    }
  }

  public permissions: {
    start: DataAwsIamPolicyDocument
  }

  public config: {
    arn: string
    name: string
  }

  constructor(
    scope: Construct,
    public id: string,
    public sfn: SfnStateMachine,
  ) {
    super(scope, id)

    this.permissions = {
      start: new DataAwsIamPolicyDocument(this, "start", {
        statement: [
          {
            actions: ["states:StartExecution"],
            resources: [this.sfn.arn],
          },
        ],
      }),
    }

    this.config = {
      arn: this.sfn.arn,
      name: this.sfn.name,
    }
  }
}
