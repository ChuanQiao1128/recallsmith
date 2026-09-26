variable "env" {
  type    = string
  default = "prod"
}

provider "aws" {
  region = "ap-southeast-2"

  default_tags {
    tags = {
      Project   = "DeveloperCards"
      Env       = var.env
      ManagedBy = "terraform"
    }
  }
}

provider "aws" {
  alias  = "use1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = "DeveloperCards"
      Env       = var.env
      ManagedBy = "terraform"
    }
  }
}
