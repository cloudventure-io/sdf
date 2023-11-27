import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"

import { Resource } from "../core/Resource"

export interface ResourceS3BucketConfig {
  arn: string
  bucket: string
}

export class ResourceS3Bucket extends Resource {
  get configSpec(): OpenAPIV3.SchemaObject {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        arn: {
          type: "string",
        },
        bucket: {
          type: "string",
        },
      },
      required: ["arn", "bucket"],
    }
  }

  public permissions: {
    read: DataAwsIamPolicyDocument
    write: DataAwsIamPolicyDocument
  }

  public config: {
    arn: string
    bucket: string
  }

  constructor(
    scope: Construct,
    public id: string,
    public bucket: ResourceS3BucketConfig,
  ) {
    super(scope, id)

    // this.bucket = bucket instanceof S3Bucket ? bucket : new S3Bucket(this, id, bucket)

    this.permissions = {
      read: new DataAwsIamPolicyDocument(this, "read", {
        statement: [
          {
            actions: ["s3:ListBucket", "s3:GetObject"],
            resources: [this.bucket.arn, `${this.bucket.arn}/*`],
          },
        ],
      }),
      write: new DataAwsIamPolicyDocument(this, "write", {
        statement: [
          {
            actions: ["s3:PutObject", "s3:DeleteObject"],
            resources: [this.bucket.arn, `${this.bucket.arn}/*`],
          },
        ],
      }),
    }

    this.config = {
      arn: this.bucket.arn,
      bucket: this.bucket.bucket,
    }
  }
}
