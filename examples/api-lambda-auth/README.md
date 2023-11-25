# Sdf Example

Welcome to the Sdf Example! This README provides a step-by-step guide on how to install, build, synthesize, and deploy the application infrastructure.

## Getting Started

### Installation

Begin by installing the necessary dependencies using the package manager [pnpm](https://pnpm.io/):

```bash
pnpm install
```

### Infrastructure Synthesis

To prepare your infrastructure, run the `synth` command. This process creates both the infrastructure code and the TypeScript interfaces required by the application:

```bash
pnpm synth -n test
```

After successful execution, you'll find the generated infrastructure code in the `cdktf.out` directory. Additionally, project-specific TypeScript files will be located in the `backend/.gen` directory, derived from the OpenAPI specification found at [backend/openapi.yml](./backend/openapi.yml).

Typically, the `synth` command is set up as a `prepare` script within your `package.json`.

### Building the Application

To compile the lambda function code bundle:

```bash
pnpm build
```

This command processes all entry points located in `backend/.gen/entrypoints`, bundling them and placing the output in the `cdktd.out/.sdf/build` directory.

Once the build process is complete, the application is fully assembled and ready for deployment.

### Deployment

Deploy your application infrastructure using Terraform by navigating to the `cdktf.out/stacks/deployment` directory:

```bash
cd cdktf.out/stacks/deployment
terraform init
terraform apply
```

You should see an output similar to the following upon successful deployment:

```
Apply complete! Resources: 21 added, 0 changed, 0 destroyed.

Outputs:

api_url = "https://30tobpvjg1.execute-api.eu-central-1.amazonaws.com"
```

### Running End-to-End Tests

To ensure everything is working correctly, replace `{api_url}` with the output from the deployment step and execute the end-to-end tests:

```bash
SDF_TEST_API_URL={api_url} pnpm test
```

These tests use the generated client library.
