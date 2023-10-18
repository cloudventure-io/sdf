# Serverless Development Framework

An opinionated Serverless Development Framework based on Terraform CDK and OpenAPI.
SDF provides convenient interfaces for implementing cloud-native applications.

It includes a bundler for TypeScript language and a basic bundler for dockerized Lambda functions.

## Install

```
npm i -D @cloudventure/sdf
```

```
yarn add -D @cloudventure/sdf
```

## Concepts

### App

`SdfApp` class extends Terraform CDK's [App](https://developer.hashicorp.com/terraform/cdktf/concepts/cdktf-architecture#app-class) class and adds capability for async synthesis. The async synth is used by [Bundler](#bundler) for generating all required resources for your application.

### Stack

`SdfStack` class extends Terraform CDK's [Stack](https://developer.hashicorp.com/terraform/cdktf/concepts/cdktf-architecture#stack-class) class and adds capabilities for [Resources](#resource) managemenet.

### Bundler

`SdfBundler` is an abstract class for defining the source code or docker image of [Lambda](#lambda) functions.

Currently there are two bundler available:

- `SdfBundlerTypeScript` class for TypeScript lambda function.
- `SdfBundlerDocker` class for dockerized lambda functions.

#### TypeScript

`SdfBundlerTypeScript` class is a bundler for TypeScript language. It include code generation routines which takes care
of generating the boilerplate code for entry-points and automatically links them to AWS HTTP API routes.

### Resource

Resources encapsulate cloud resources (S3 Buckets, DynamoDB tables, etc.) and they can be attached to Lambda functions.

Resources pass parameters to Lambda functions through environment variables and attach IAM policies to the function to allows access to the resource.

Resources are available to all Lambdas withing the Stack.

### Lambda

`SdfLambda` class is a convinient class for defining a lambda functions within SDF applications.

### API

`SdfHttpApi` class consumes OpenAPI specification and provides:

- generation of entrypoints based on OpenAPI paths
- generation of validators based on OpenAPI parameter and body specification
- AWS HTTP API definition
- AWS Lambda functions and related resources definition
- interfaces file generation based on OpenAPI specs
- resource configuration getters

## Examples

- [AWS HTTP API with Lambda Authorizer](./examples/api-lambda-auth/)
