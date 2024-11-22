import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document"
import { SnsTopic, SnsTopicConfig } from "@cdktf/provider-aws/lib/sns-topic"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"

import { Resource } from "../core"

export class ResourceTopic extends Resource {
  public topic: SnsTopic

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
    publish: DataAwsIamPolicyDocument
    subscribe: DataAwsIamPolicyDocument
  }

  public config: {
    arn: string
    name: string
  }

  constructor(
    scope: Construct,
    public id: string,
    secret: SnsTopic | SnsTopicConfig,
  ) {
    super(scope, id)

    this.topic = secret instanceof SnsTopic ? secret : new SnsTopic(this, id, secret)

    this.permissions = {
      publish: new DataAwsIamPolicyDocument(this, "publish", {
        statement: [
          {
            actions: ["sns:Publish"],
            resources: [this.topic.arn],
          },
        ],
      }),
      subscribe: new DataAwsIamPolicyDocument(this, "subscribe", {
        statement: [
          {
            actions: ["sns:Subscribe", "sns:Unsubscribe"],
            resources: [this.topic.arn],
          },
        ],
      }),
    }

    this.config = {
      arn: this.topic.arn,
      name: this.topic.name,
    }
  }
}
