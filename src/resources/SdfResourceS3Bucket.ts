import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document";
import { S3Bucket, S3BucketConfig } from "@cdktf/provider-aws/lib/s3-bucket";
import { Construct } from "constructs";
import { OpenAPIV3 } from "openapi-types";
import { SdfResource } from "../SdfResource";

export class SdfResourceS3Bucket extends SdfResource {
  public bucket: S3Bucket;

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
    };
  }

  public permissions: {
    read: DataAwsIamPolicyDocument;
    write: DataAwsIamPolicyDocument;
  };

  public config: {
    arn: string;
    bucket: string;
  };

  constructor(
    scope: Construct,
    public id: string,
    bucket: S3Bucket | S3BucketConfig
  ) {
    super(scope, id);

    this.bucket =
      bucket instanceof S3Bucket ? bucket : new S3Bucket(this, id, bucket);

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
    };

    this.config = {
      arn: this.bucket.arn,
      bucket: this.bucket.bucket,
    };
  }
}
