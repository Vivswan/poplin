# The Workflow that runs the install's jobs: Cloudflare runs the rounds of a copy too large for one request, one a step, with nobody asking.

locals {
  # What follows the Worker's name in its Workflow's name, and the class of the Worker that Cloudflare runs as a job.
  jobs_suffix = "-jobs"
  jobs_class  = "PoplinJobs"

  # An account names each Workflow once, in 64 characters at most, so the name holds the Worker's own, cut to fit.
  jobs_workflow = "${substr(var.worker_name, 0, 64 - length(local.jobs_suffix))}${local.jobs_suffix}"
}

# The Worker's upload names this Workflow in its binding, and Cloudflare takes that upload before the Workflow exists: the Workflow is made once the Worker is there.
resource "cloudflare_workflow" "jobs" {
  account_id    = var.account_id
  workflow_name = local.jobs_workflow
  script_name   = cloudflare_workers_script.poplin.script_name
  class_name    = local.jobs_class
}
