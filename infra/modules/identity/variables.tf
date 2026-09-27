variable "env" {
  type = string
}

variable "account_id" {
  type = string
}

variable "region" {
  type = string
}

variable "core_vpc_role_name" {
  type = string
}

variable "edge_public_role_name" {
  type = string
}

variable "manage_cognito" {
  type = bool
}

variable "console_pool_id" {
  type = string
}

variable "mobile_pool_id" {
  type = string
}

variable "snowflake_external_id" {
  type      = string
  sensitive = true
  default   = null
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "worker_role_name" {
  type = string
} # prod "developercards-worker-lambda-role"

variable "content_bucket_name" {
  type = string
} # prod "core-vpc"

variable "premium_bucket_name" {
  type = string
} # prod "core-vpc-premium"

variable "publish_queue_name" {
  type = string
} # prod "recallsmith-publish-jobs"

variable "core_vpc_function_name" {
  type = string
} # prod "core-vpc"

variable "worker_function_name" {
  type = string
} # prod "worker-lambda"

variable "secret_parameter_names" {
  description = "Kebab-case leaf names under /developercards/<env>/; values are written by the supervisor with put-parameter, never by Terraform."
  type        = list(string)
  default     = []
}

variable "console_hostname" {
  type        = string
  default     = ""
  description = "Console hostname added to the spa client's callback/logout URLs; \"\" adds nothing (staging)."
}

variable "webhook_queue_name" {
  type = string
} # prod "developercards-webhook-events"

variable "webhook_dispatcher_function_name" {
  type = string
} # prod "developercards-webhook-dispatcher"

variable "ai_qa_queue_name" {
  type = string
} # prod "developercards-ai-qa-jobs"

variable "ai_qa_function_name" {
  type = string
} # prod "developercards-ai-qa"

variable "bedrock_mantle_model_id" {
  type        = string
  description = "The one model id ai-qa may call through bedrock-mantle:CreateInference (bedrock-mantle:Model condition); must equal the function's AI_MODEL."
} # prod "anthropic.claude-opus-5"

variable "bedrock_mantle_project_id" {
  type        = string
  default     = "default"
  description = "The Mantle project ai-qa's calls land in. The client sends no OpenAI-Project header, so this is the account's default project."
}

variable "ai_qa_converse_profile_ids" {
  type        = list(string)
  default     = []
  description = "Owner-approved Bedrock inference profile ids (global./au./apac. prefixed) ai-qa may call through Converse (bedrock:InvokeModel). Empty = no Converse grant."
  validation {
    condition     = alltrue([for id in var.ai_qa_converse_profile_ids : can(regex("^(global|au|apac)\\.[a-z0-9-]+\\.[A-Za-z0-9.:-]+$", id)) && !strcontains(id, "*")])
    error_message = "Each entry must be an exact inference profile id with a global./au./apac. prefix; no wildcards."
  }
}
