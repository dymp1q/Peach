# 7. Describe sign-in, the report and the parser in Terraform, run by HCP Terraform

- Status: accepted
- Date: 2026-10-30
- Lab: 7, "The cloud as code: from CloudFormation to Terraform"

## Context

Labs 4, 5 and 6 each added a CloudFormation stack: `spry-auth` (5 resources), `spry-reports`
(16) and `spry-ai` (7). Each was deployed from a laptop by a script (`make deploy-auth` and so
on), with parameters read from `.env` and from other stacks. That left three problems:

- **Only one laptop could change the infrastructure.** The Google client secret and the report
  recipients lived in a gitignored `.env`; whoever did not have it could not deploy.
- **Nothing reviewed a change before it landed.** A script ran `aws cloudformation deploy`;
  a change set was possible but never part of the routine.
- **The project already reaches outside AWS.** The Google OAuth client, the GitHub repository
  and the DNS records at the domain's registrar are part of the system, and CloudFormation
  cannot describe any of them.

The user pool holds real accounts and the bucket holds every report, so "delete the stacks and
create everything again" was not an option.

## Decision

1. **Terraform, in `infra/*.tf`, one root module.** `auth.tf`, `reports.tf` and `ai.tf` replace
   the three templates resource for resource, with the same names. The backend, the frontend and
   the GitHub role stay CloudFormation; `backend.tf` reads the image, the VPC, the subnets and the
   database URL from the `spry-backend-ecs` stack with `aws_cloudformation_stack`.
2. **The state lives in HCP Terraform,** organization `ooad-dymp1`, workspace `spry-dev`, in
   Remote execution mode. It is locked during every run and keeps every version.
3. **HCP Terraform applies, nobody else.** The workspace is connected to the repository with
   `infra` as its working directory. A pull request gets a plan as a check; a merge to `main`
   applies it. The Makefile has `make infra-plan` and no `terraform apply`.
4. **No AWS keys anywhere.** Each run gets a token from HCP Terraform and exchanges it for the
   role `hcp-terraform-ooad-dymp1` through an IAM OIDC provider (`TFC_AWS_PROVIDER_AUTH`,
   `TFC_AWS_RUN_ROLE_ARN`). The role and the trust were created once, from a laptop, by a small
   bootstrap folder with a local state outside this repository.
5. **The resources were adopted, not re-created.** The templates got `DeletionPolicy: Retain`
   and `UpdateReplacePolicy: Retain`, the stacks were deleted (the resources stayed), and
   `import` blocks gave them to Terraform. `prevent_destroy` guards the user pool and the bucket.
   The three `aws_lambda_permission` statements were created fresh: their CloudFormation ids are
   random, and a second statement next to the old one changes nothing for the caller. The old
   statements were removed by hand afterwards.

## Alternatives

- **Keep CloudFormation.** AWS keeps the state for us and rolls a failed change back on its own.
  But it stops at the edge of one AWS account: the Google client, GitHub and DNS stay manual.
- **AWS CDK.** Real code, and it compiles to CloudFormation, so it has the same AWS-only limit
  and adds a Node toolchain to the infrastructure.
- **OpenTofu.** The open-source fork reads the same files, and its licence (MPL) is simpler than
  Terraform's BSL. We chose Terraform because HCP Terraform, the place the lab keeps the state
  and runs the pipeline, is built for it. Moving later is a change of binary, not of code.

## Consequences

- **Who can change the infrastructure:** anyone who can open a pull request. Merging to `main`
  is the only way to apply. A member of the HCP organization can also start a run by hand.
- **Where the secrets end up:**
  - `google_client_secret` is a sensitive workspace variable. Plans and logs show
    `(sensitive value)`.
  - **The state holds it in plain text,** next to the database URL that `backend.tf` reads into
    the report builder's environment. HCP Terraform encrypts the state at rest, but anyone with
    read access to the workspace's state can see both secrets. Only the owner has that access.
  - Cognito stores the Google secret, and the report builder's environment holds the database
    URL, exactly as before.
- **If HCP Terraform is down:** nothing that runs stops. The site, sign-in, the report and the
  parser do not depend on it. Only changes to the infrastructure wait. In an emergency, the
  workspace can be switched to Local execution and applied from a laptop with the owner's AWS
  credentials. The state stays in HCP Terraform, so it is not split in two.
- **A failed apply stops halfway.** Nothing is rolled back. We fix the code and apply again.
- **Two roads, in order.** GitHub Actions still deploys the application image to ECS. Terraform
  reads that image from the backend stack and moves the two image-based functions to it on its
  next run. When a change needs both, for example a new environment variable that new code reads,
  the infrastructure goes first. The old code ignores an extra variable, but new code would fail
  without it.
- **The bootstrap role is too broad.** It has `AdministratorAccess`, and its trust admits any
  workspace of the organization. That is acceptable for a one-person class project. A team
  would narrow both.
