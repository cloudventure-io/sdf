# Serverless Development Framework

An opinionated cloud-native and serverless development framwork for AWS and TypeScript.

## Install

```bash
npm i -D @cloudventure/sdf
```

```bash
yarn add -D @cloudventure/sdf
```

```bash
pnpm add -D @cloudventure/sdf
```

## Concepts

### App

`App` class extends Terraform CDK's [App](https://developer.hashicorp.com/terraform/cdktf/concepts/cdktf-architecture#app-class) class and adds capability for async synthesis. The async synth is used by [Bundler](#bundler) for generating all required resources for your application.

### Stack

`Stack` class extends Terraform CDK's [Stack](https://developer.hashicorp.com/terraform/cdktf/concepts/cdktf-architecture#stack-class) class and adds capabilities for [Resources](#resource) managemenet.

### Bundler

`Bundler` is an abstract class for defining the source code or docker image of [Lambda](#lambda) functions.

Currently there are two bundler available:

- `BundlerTypeScript` class for TypeScript lambda function.
- `BundlerDocker` class for dockerized lambda functions.

#### TypeScript

`BundlerTypeScript` class is a bundler for TypeScript language. It include code generation routines which takes care
of generating the boilerplate code for entry-points and automatically links them to AWS HTTP API routes.

### Resource

Resources encapsulate cloud resources (S3 Buckets, DynamoDB tables, etc.) and they can be attached to Lambda functions.

Resources pass parameters to Lambda functions through environment variables and attach IAM policies to the function to allows access to the resource.

Resources are available to all Lambdas withing the Stack.

### Lambda

`Lambda` class is a convinient class for defining a lambda functions within SDF applications.

### API

`HttpApi` class consumes OpenAPI specification and provides:

- generation of entrypoints based on OpenAPI paths
- generation of validators based on OpenAPI parameter and body specification
- AWS HTTP API definition
- AWS Lambda functions and related resources definition
- interfaces file generation based on OpenAPI specs
- resource configuration getters

## Examples

- [AWS HTTP API with Lambda Authorizer](./examples/api-lambda-auth/)
