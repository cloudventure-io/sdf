import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document"
import { SqsQueue, SqsQueueConfig } from "@cdktf/provider-aws/lib/sqs-queue"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"

import { Resource } from "../core"

export class ResourceQueue extends Resource {
  public queue: SqsQueue

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
    pull: DataAwsIamPolicyDocument
  }

  public config: {
    arn: string
    name: string
  }

  constructor(
    scope: Construct,
    public id: string,
    queue: SqsQueue | SqsQueueConfig,
  ) {
    super(scope, id)

    this.queue = queue instanceof SqsQueue ? queue : new SqsQueue(this, id, queue)

    this.permissions = {
      pull: new DataAwsIamPolicyDocument(this, "pull", {
        statement: [
          {
            actions: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
            resources: [this.queue.arn],
          },
        ],
      }),
    }

    this.config = {
      arn: this.queue.arn,
      name: this.queue.name,
    }
  }
}
