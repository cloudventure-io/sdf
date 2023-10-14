import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document"
import { DynamodbTable, DynamodbTableConfig } from "@cdktf/provider-aws/lib/dynamodb-table"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"

import { SdfResource } from "../SdfResource"

export class SdfResourceDynamodbTable extends SdfResource {
  public table: DynamodbTable

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
    read: DataAwsIamPolicyDocument
    write: DataAwsIamPolicyDocument
    subscribe: DataAwsIamPolicyDocument
  }

  public config: {
    arn: string
    name: string
  }

  constructor(
    scope: Construct,
    public id: string,
    table: DynamodbTable | DynamodbTableConfig,
  ) {
    super(scope, id)

    this.table = table instanceof DynamodbTable ? table : new DynamodbTable(this, id, table)

    this.permissions = {
      read: new DataAwsIamPolicyDocument(this, "read", {
        statement: [
          {
            actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"],
            resources: [this.table.arn, `${this.table.arn}/*`],
          },
        ],
      }),
      write: new DataAwsIamPolicyDocument(this, "write", {
        statement: [
          {
            actions: ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem"],
            resources: [this.table.arn, `${this.table.arn}/*`],
          },
        ],
      }),
      subscribe: new DataAwsIamPolicyDocument(this, "subscribe", {
        statement: [
          {
            actions: ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"],
            resources: [this.table.streamArn],
          },
          {
            actions: ["dynamodb:ListStreams"],
            resources: ["*"],
          },
        ],
      }),
    }

    this.config = {
      arn: this.table.arn,
      name: this.table.name,
    }
  }
}
