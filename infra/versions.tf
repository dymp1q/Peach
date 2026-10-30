# Sign-in (lab 4), the weekly report (lab 5) and the agenda parser (lab 6),
# described in Terraform since lab 7. The state lives in HCP Terraform; runs
# there assume an AWS role through OIDC, so nobody needs AWS keys to change
# the infrastructure. The backend, the frontend and the GitHub role are still
# CloudFormation stacks; backend.tf reads what it needs from them.

terraform {
  required_version = ">= 1.10"

  cloud {
    organization = "ooad-dymp1"

    workspaces {
      name = "spry-dev"
    }
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
}

provider "aws" {
  region = var.region

  # PROJECT_NAME on everything that takes tags, without repeating it (lab 4).
  default_tags {
    tags = {
      PROJECT_NAME = var.project_name
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.region
}
