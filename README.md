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

### Bundler

`Bundler` is a construct for bundling the code for [Lambda](#lambda) functions.

Currently supported languages are: `typescript` and `custom`.
Currently supported bundiling methods are: `none`, `direct`, `s3` and `docker`.

## Examples

- [AWS HTTP API with Lambda Authorizer](./examples/api-lambda-auth/)
