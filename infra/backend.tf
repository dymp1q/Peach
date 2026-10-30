# What the CloudFormation backend (infra/backend-ecs.yaml, make deploy-backend)
# already has: the image the functions start, the VPC the builder joins, and
# the database URL. Read from the stack, not typed in.

data "aws_cloudformation_stack" "backend" {
  name = "${var.project_name}-backend-ecs"
}

locals {
  # The image ECS runs. GitHub Actions moves it on every push to main; the
  # next Terraform run moves the functions after it.
  image_uri  = data.aws_cloudformation_stack.backend.parameters["ImageUri"]
  vpc_id     = data.aws_cloudformation_stack.backend.parameters["VpcId"]
  subnet_ids = split(",", data.aws_cloudformation_stack.backend.parameters["SubnetIds"])
}

# The API's security group - the one the database already admits.
data "aws_security_group" "api" {
  vpc_id = local.vpc_id

  filter {
    name   = "description"
    values = ["${var.project_name} backend tasks - reachable from the load balancer only"]
  }
}

# Every route table in the VPC: the subnets' own, or the main one they fall back to.
data "aws_route_tables" "vpc" {
  vpc_id = local.vpc_id
}

# Read at plan time into the builder's environment: with no NAT, the function
# could not reach Secrets Manager at run time. The value ends up in the state.
data "aws_secretsmanager_secret_version" "database_url" {
  secret_id = data.aws_cloudformation_stack.backend.outputs["DatabaseUrlSecretArn"]
}
