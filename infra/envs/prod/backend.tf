terraform {
  backend "s3" {
    bucket       = "recallsmith-tfstate-622994489535"
    key          = "envs/prod/terraform.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true
  }
}
