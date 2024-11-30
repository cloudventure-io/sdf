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
        url: {
          type: "string",
        },
      },
      required: ["arn", "name", "url"],
    }
  }

  public permissions: {
    subscribe: DataAwsIamPolicyDocument
    publish: DataAwsIamPolicyDocument
  }

  public config: {
    arn: string
    name: string
    url: string
  }

  constructor(
    scope: Construct,
    public id: string,
    queue: SqsQueue | SqsQueueConfig,
  ) {
    super(scope, id)

    this.queue = queue instanceof SqsQueue ? queue : new SqsQueue(this, id, queue)

    this.permissions = {
      subscribe: new DataAwsIamPolicyDocument(this, "subscribe", {
        statement: [
          {
            actions: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
            resources: [this.queue.arn],
          },
        ],
      }),
      publish: new DataAwsIamPolicyDocument(this, "publish", {
        statement: [
          {
            actions: ["sqs:SendMessage"],
            resources: [this.queue.arn],
          },
        ],
      }),
    }

    this.config = {
      arn: this.queue.arn,
      name: this.queue.name,
      url: this.queue.url,
    }
  }
}
