# deck: aws-saa-c03

## aws-s3-storage-classes | d1
TOPIC: 4.1 Cost-optimized storage
Q:
An application writes logs to S3 that are read often for 30 days and almost never afterwards, but must be kept for 7 years. Which storage classes and mechanism fit?
A:
Keep the first 30 days in S3 Standard, then use a lifecycle rule to transition objects to S3 Glacier Flexible Retrieval or Deep Archive for the retention period, and expire them after 7 years. Lifecycle rules run automatically; you do not write code or move objects yourself. Use Intelligent-Tiering instead only when the access pattern is unknown.
USAGE:
Age out build artefacts and logs with a lifecycle rule instead of a cleanup script: keep 30 days hot, then transition to Glacier and expire at the retention deadline.

## aws-s3-cloudfront-oac | d2
TOPIC: 1.2 Secure workloads
Q:
You serve a static site from S3 through CloudFront. Why keep the bucket private and use Origin Access Control instead of making the bucket public?
A:
With Origin Access Control the bucket policy grants read access only to the CloudFront distribution's service principal, so every request must come through CloudFront: the edge cache, HTTPS, WAF and logging all apply, and nobody can skip them with a direct S3 URL. A public bucket leaks the origin and lets clients skip the CDN. OAC replaced the older Origin Access Identity and supports SSE-KMS objects.
USAGE:
A single-page app on S3 behind CloudFront with OAC needs a 403/404 to index.html custom error response for client-side routes.

## aws-iam-roles-vs-users | d1
TOPIC: 1.1 Secure access
Q:
An EC2 application needs to read from S3. A reviewer asks whether it should use an IAM user's access keys or a role, and what the rest of the account's IAM setup should look like. What do you answer?
A:
Attach a role to the instance profile. IAM is global and free; its objects are users (long-term passwords or keys, avoid wherever a role can work), groups (attach policies to many users at once), roles (assumed by services, federated people or other accounts, always temporary credentials) and policies (identity-based, resource-based, permissions boundaries, SCPs, session policies). Every request starts as an implicit deny, an explicit deny beats any allow, and tag conditions such as aws:PrincipalTag give you ABAC. The rest of the checklist: MFA and no access keys on the root user, humans through Identity Center, least privilege with conditions, rotate any long-term keys left, CloudTrail on everywhere. Any option that puts long-lived access keys on a server is wrong.
USAGE:
Give every function or task its own role scoped to the tables and buckets it touches; a shared role is the first thing an auditor flags.

## aws-lambda-cold-start-init | d2
TOPIC: 3.2 Elastic compute
Q:
A team is splitting a monolith into serverless pieces: a bursty API, a nightly 40-minute report, an S3-triggered thumbnailer with occasional slow cold starts, and a queue of 200,000 small messages. Which of Lambda or Fargate runs each, and what shortens the cold start?
A:
Lambda takes the short, event-driven, bursty units: API Gateway plus Lambda for the API, an S3 event for the thumbnailer, and an SQS event source mapping for the queue, which polls and hands over batches of up to 10 messages by default. Fargate takes the report: Lambda's 900-second timeout, 10,240 MB memory ceiling and 6 MB synchronous payload push anything long-running or container-shaped to a Fargate task or AWS Batch, and Step Functions coordinates multi-step flows. A cold start downloads the code, starts the runtime and runs the code outside the handler once per execution environment, so put database connections and SDK clients there; Provisioned Concurrency pre-initialises environments, and SnapStart resumes Java, Python and .NET functions from a snapshot.
CODE: csharp
// Created once per environment, reused by every warm invocation
private static readonly NpgsqlDataSource Db = NpgsqlDataSource.Create(ConnString);
USAGE:
Create the database connection and SDK clients outside the handler so they are built once per execution environment and reused by every warm invocation, and check whether a connection already exists before opening a new one.

## aws-sqs-visibility-timeout-dlq | d2
TOPIC: 3.2 Elastic compute
QUALIFIER: MOST performant
Q:
A web tier drops uploaded images into S3 and a fleet of EC2 workers resizes them. During spikes the workers fall behind, and when a worker crashes halfway through an image that upload is sometimes lost or processed twice. Which design is the MOST performant way to keep up with spikes without losing work?
OPT: a *
Send S3 event notifications to an SQS queue, have workers delete a message only after the resize succeeds, attach a dead-letter queue through a redrive policy, and scale the worker Auto Scaling group with target tracking on a backlog-per-instance metric derived from ApproximateNumberOfMessagesVisible.
OPT: b
Have the web tier call the worker fleet's resize API synchronously for each upload and return only once the image is processed.
WHY:
A synchronous call couples the tiers: a spike in uploads becomes a spike of open requests held on the workers, and a worker crash fails the user's request instead of leaving the job safely queued for another worker.
OPT: c
Publish each upload to an SNS topic that pushes directly to the workers over HTTPS, so every upload is delivered immediately.
WHY:
SNS pushes each notification as it arrives and, for an HTTPS endpoint, retries a failed delivery only three times by default and never for more than an hour before discarding it; with no queue in front of the workers there is nothing to absorb the spike and nothing to hand a crashed worker's image to another one.
OPT: d
Keep the queue but scale the worker group on average CPU utilization so more instances launch when the fleet is busy.
WHY:
CPU says how busy the current workers are, not how far behind the queue is; a backlog can grow for minutes before CPU moves, and the documented approach is a backlog-per-instance metric with an acceptable-latency target.
A:
Put an SQS queue between the tiers and scale the workers on backlog per instance. S3 event notifications feed the queue; a received message stays hidden for the visibility timeout and reappears if the worker never deletes it, so a crash hands the image to another worker and consumers must be idempotent, while a redrive policy moves a message received more than maxReceiveCount times to a dead-letter queue instead of looping. Because ApproximateNumberOfMessagesVisible alone does not scale with fleet size, target tracking uses that count divided by InService instances against an acceptable backlog. Synchronous calls and SNS push have no buffer, CPU lags the backlog, and Kinesis Data Streams is a replayable ordered stream, not a work queue that hides and deletes items.
USAGE:
A DLQ with a reprocessing path catches poison messages early instead of letting them trigger expensive downstream jobs on every retry.

## aws-sqs-sns-eventbridge-choice | d2
TOPIC: 2.1 Loosely coupled architectures
Q:
An order service publishes events that a billing worker, a fraud checker and an analytics pipeline each consume, and last week a duplicate event double-charged a customer. When do you pick SQS, SNS or EventBridge, and what must every consumer do?
A:
Sources emit events: S3 notifications, DynamoDB Streams, AWS services and SaaS through EventBridge, or an application calling PutEvents. A router fans them out: SQS is a queue one consumer group drains with buffering and retries; SNS pushes one message to many subscribers with no buffer; EventBridge is a bus whose rules route by event content, with schema registry and archive/replay. Consumers (Lambda, SQS, Step Functions) must be idempotent, because delivery is at least once and ordering is not guaranteed, which double-charged the customer. Producers never wait for consumers, so spikes are absorbed. EventBridge retries a target up to 24 hours and 185 attempts, then drops the event unless a dead-letter queue exists; archive replay recovers a bad deploy.
USAGE:
Put one SQS job between an API that must answer in under a second and a worker that takes minutes; SNS when several teams need the same event; EventBridge when routing depends on the event body.

## aws-rds-multi-az-vs-read-replica | d1
TOPIC: 3.3 High-performing databases
Q:
An RDS PostgreSQL instance must survive an Availability Zone failure and also serve a growing reporting load. Which of Multi-AZ and read replicas answers each need, and how does the replica story differ on Aurora and DynamoDB?
A:
Multi-AZ keeps a synchronous standby in another Availability Zone and fails over to it automatically; the one-standby instance deployment serves no reads from the standby, only the two-standby Multi-AZ DB cluster deployment does. A read replica is an asynchronous copy you can query, up to 15 per primary, in the same or another Region, with its own endpoint, promotable to a standalone instance as a manual disaster-recovery step. Aurora replicas share the cluster volume instead of copying it: up to 15 per cluster behind one reader endpoint, lag usually well under 100 milliseconds, and they double as failover targets. DynamoDB global tables are multi-active, so every replica Region serves reads and writes. Multi-AZ answers "keep running"; replicas answer "handle more reads", never "write faster".
USAGE:
Multi-AZ is the first switch to flip when uptime starts to matter more than cost; add a replica only once reads, not availability, are the problem.

## aws-vpc-private-subnet-nat | d1
TOPIC: 1.2 Secure workloads
Q:
An application in a private subnet must call a third-party HTTPS API, and a colleague wants to move the RDS instance into the public subnet to make it reachable. Why has the app no internet path, what do you add, and where does each tier belong?
A:
A subnet is public only because its route table sends 0.0.0.0/0 to an internet gateway and its instances carry public IPs; the app's private subnet has neither, so outbound traffic has nowhere to go. Add a NAT gateway in a public subnet and a 0.0.0.0/0 route to it from the private subnet: outbound connections work, inbound stays blocked. The third tier is isolated: no internet route at all. The standard layout puts load balancers, NAT gateways and bastions in public subnets, application servers in private subnets, databases in isolated subnets, each tier repeated per Availability Zone. RDS and Lambda never need a public subnet; a database reachable from the internet is the trap, not a feature.
USAGE:
Databases and workers live in private subnets; only the load balancer and NAT need a public subnet.

## aws-vpc-security-group-vs-nacl | d2
TOPIC: 1.2 Secure workloads
Q:
A team attaches a custom network ACL allowing inbound HTTPS to a subnet and its instances stop responding; they also need to block one abusive IP address for the whole subnet. What went wrong, and how do NACLs differ from security groups?
A:
A security group sits on the network interface, is stateful, has allow rules only, and the reply to allowed traffic returns automatically. A network ACL sits on the subnet, is stateless, and evaluates numbered allow and deny rules from the lowest number, first match wins, with an implicit deny at the asterisk rule; the default NACL allows everything, a custom one denies everything until you add rules. The team's NACL lets requests in but has no outbound rule for the ephemeral ports 1024-65535 that replies use, so responses die: return traffic must be allowed both ways. Blocking one IP is the NACL's real job: a low-numbered deny rule a security group cannot express. Security groups stay the primary control.
USAGE:
Reach for a NACL deny only to block a known bad CIDR; every other rule belongs in a security group referencing another group.

## aws-ec2-purchase-options | d1
TOPIC: 4.2 Cost-optimized compute
Q:
A web tier runs steadily all year, and a nightly batch job can be interrupted and restarted. Which purchase options minimise cost?
A:
Cover the steady baseline with a Savings Plan or Reserved Instances, which discount committed usage over one or three years, and run the interruptible batch on Spot Instances, which are spare capacity at a large discount that AWS can reclaim with a two-minute warning. On-Demand is for unpredictable or short workloads. Never put a stateful single instance on Spot without a way to resume.
USAGE:
Buy the Savings Plan for the floor you have measured over 30 days, not the peak, and let Spot and On-Demand cover the rest.

## aws-ebs-vs-efs-vs-instance-store | d1
TOPIC: 2.1 Loosely coupled architectures
Q:
An application needs three kinds of storage: a PostgreSQL data volume, a shared directory that web servers in three Availability Zones read and write, and user uploads served straight to browsers. Which AWS storage type fits each, and what rule decides?
A:
Decide by who needs the data and how they reach it. Block storage (EBS) is a raw device for one instance in one Availability Zone with the lowest latency, persistent and snapshot-able, so it takes the boot and database volumes; instance store is host-attached disk that is faster still but empties when the instance stops or the host fails, so it holds only caches and scratch. File storage (EFS, or FSx for SMB and Lustre) is a POSIX or SMB file system that many instances across Availability Zones mount at once, so the shared directory goes on EFS. Object storage (S3) is reached over an HTTPS API by anything with credentials, stores whole objects up to 5 GB in one PUT and up to 50 TB with multipart, has effectively unlimited capacity and is designed for eleven nines of durability, so browser-served uploads live there. Trap: S3 cannot be mounted as a boot or database volume, and an EBS volume cannot be shared across Availability Zones.
USAGE:
Put scratch and cache on instance store and anything you would miss on EBS with snapshots; if two instances in different AZs need the same files it is EFS, full stop.

## aws-alb-vs-nlb | d2
TOPIC: 3.4 Scalable network
QUALIFIER: MOST performant
Q:
A financial feed streams a custom TCP protocol to millions of client connections with sudden spikes at market open, and client firewalls allow-list only fixed IP addresses. Which load balancer is the MOST performant choice for these requirements?
OPT: a *
A Network Load Balancer with an Elastic IP address in each enabled Availability Zone.
OPT: b
An Application Load Balancer with a TCP listener and a static IP per Availability Zone.
WHY:
An Application Load Balancer works at layer 7 for HTTP and HTTPS only, has no TCP listener, and its node IP addresses change as it scales, so nothing here can be allow-listed or carry a custom protocol.
OPT: c
A CloudFront distribution in front of the feed servers.
WHY:
CloudFront is an HTTP content delivery network: it terminates HTTP and HTTPS only, so a custom TCP feed protocol cannot pass through it whatever IP addresses it exposes.
OPT: d
A single large EC2 instance with an Elastic IP address that fans connections out to the fleet.
WHY:
One instance gives a fixed IP but becomes the ceiling and the single point of failure; it cannot absorb millions of connections or a market-open spike the way a managed layer-4 balancer scales.
A:
Use a Network Load Balancer. It operates at layer 4, handles millions of requests per second with volatile, spiky traffic, and gets a static IP address per enabled Availability Zone that you can replace with your own Elastic IP, which is what partner firewalls need to allow-list. An Application Load Balancer is the layer-7 choice for HTTP and HTTPS routing by host, path or header with TLS termination and WAF; its IPs are not fixed. For fixed IPs that stay the same across several Regions, put AWS Global Accelerator in front. Remember that cross-zone load balancing is off by default on a Network Load Balancer, so spread targets across the enabled zones.
USAGE:
One ALB with host and path rules fronts a dozen microservices; reach for NLB only when a partner needs a fixed IP or the protocol is not HTTP.

## aws-dynamodb-capacity-and-keys | d3
TOPIC: 3.3 High-performing databases
Q:
A DynamoDB table keyed on event date throttles writes every morning even though total consumption is far below the provisioned capacity, because one day's key receives all the writes. A nightly job must still read a whole day's events. Which two changes remove the throttling while keeping that read possible? (Choose two.)
OPT: a *
Change the partition key to the date plus a calculated suffix derived from the event ID, so each day's writes spread across many partitions while a single event can still be fetched with GetItem.
OPT: b *
Rewrite the nightly job to issue one Query per suffix value of that date, run them in parallel, and merge the results in the application.
OPT: c
Switch the table to on-demand capacity mode.
WHY:
On-demand removes the table-level provisioning decision, but every partition still tops out at 1,000 write units per second, so a single hot key throttles exactly as before.
OPT: d
Add a DAX cluster in front of the table.
WHY:
DAX is a read-through and write-through cache that speeds repeated reads; writes still flow to the same hot partition, so it cannot lift a write throttle.
OPT: e
Raise the table's provisioned write capacity units.
WHY:
Provisioned capacity is spread across partitions and a single partition is still limited to 1,000 write units per second; buying more table capacity leaves the one hot key exactly where it was.
OPT: f
Add a global secondary index with the date as its partition key and read the day through the index.
WHY:
Index writes are distributed by the index's own partition key, so every write for the day lands in one index partition under the same per-partition cap, and a write the index cannot absorb throttles the base table as well; only a high-cardinality key, on the table or on the index, spreads the load.
A:
Reshape the key and read across the shards. Every partition delivers at most 3,000 read units and 1,000 write units per second, so a date-only partition key funnels a whole day's writes into one partition and throttles while the table looks idle. Appending a suffix calculated from the event ID spreads writes across partitions and still lets GetItem find one event; reading a day becomes one Query per suffix, run in parallel and merged. On-demand mode, more provisioned capacity, DAX and an index keyed on the same hot date all leave that single partition where it is, and a local secondary index cannot be added after table creation and would share the hot key anyway.
USAGE:
Start on-demand, read ConsumedCapacity for a month, then switch to provisioned with auto scaling if the curve is flat; a date-only partition key will throttle on day one.

## aws-kms-envelope-encryption | d2
TOPIC: 1.3 Data security controls
Q:
An app must encrypt 50 MB uploads under a key the security team can audit and revoke; a regulator asks how data is protected in transit and whether a dedicated HSM is needed. How does KMS handle the object, and what do you pick for each half?
A:
Envelope encryption: GenerateDataKey returns a data key in plaintext and encrypted under the KMS key; the app encrypts the object locally, stores the wrapped key beside it, discards the plaintext copy, and later sends the wrapped key to Decrypt. KMS never sees the data, the 4,096-byte Encrypt limit does not apply, and S3 SSE-KMS does exactly this. Key type decides control: AWS owned is free and invisible, AWS managed rotates yearly with no editable policy, customer managed gives your own key policy, rotation and cross-account use, so audit and revoke means customer managed; CloudHSM is for single-tenant FIPS 140-3 Level 3 custody. In transit: ACM certificates on ALB, CloudFront and API Gateway, TLS to RDS, VPN or MACsec on links.
USAGE:
Use the AWS Encryption SDK or S3 SSE-KMS and you get envelope encryption for free; only code that calls kms:Encrypt on payloads over 4 KB is doing it wrong.

## aws-cloudwatch-alarm-vs-eventbridge-rule | d2
TOPIC: D2 services
Q:
You want to be paged when a Lambda's error rate exceeds 5%, and separately to run a job when an EC2 instance changes state. Which service handles each?
A:
The error rate is a metric threshold, so use a CloudWatch alarm on the Errors and Invocations metrics with a math expression, and send the alarm to an SNS topic that pages you. The instance state change is an event, so use an EventBridge rule matching the EC2 instance state-change event and target a Lambda or Step Functions workflow. Alarms watch metrics over time; EventBridge rules react to discrete events.
USAGE:
Emit EMF metrics from the function and alarm on the error metric with an SNS action; use an EventBridge rule for the discrete state-change events, not a metric.

## aws-iam-policy-evaluation-explicit-deny | d2
TOPIC: 1.1 Secure access
Q:
A developer's role has AdministratorAccess, but an SCP on the account denies s3:DeleteBucket. Can the developer delete a bucket, which policy types took part in the decision, and which of them can actually grant anything?
A:
No. Six types matter: identity-based (what can this principal do), resource-based (who can touch this resource; cross-account access without a role, and in the same account sufficient on its own), permissions boundary (cap on one user or role), SCP (cap on a whole member account), session policy (cap on one AssumeRole session) and ACLs (legacy S3 cross-account grants). Only the first two grant; boundaries, SCPs and session policies only shrink. Evaluation starts as implicit deny, any explicit deny in any layer ends the request as denied, then an allow must exist in every cap that applies and in an identity or resource policy. The trap is believing AdministratorAccess cancels a Deny; nothing overrides an explicit Deny.
USAGE:
When debugging an unexpected AccessDenied, search every policy layer for a matching Deny before adding Allow statements, because extra permissions can never fix an explicit deny.

## aws-iam-permissions-boundary | d3
TOPIC: 1.1 Secure access
Q:
You want developers to create IAM roles for their own workloads without ever creating a role more powerful than they are. Which feature enforces that, and why does a restrictive identity policy on the developers not solve it?
A:
Use a permissions boundary: a managed policy attached to a user or role that caps what its identity-based policies can grant, so effective permissions are the intersection of the two, and the boundary grants nothing on its own. To delegate safely, allow iam:CreateRole and iam:AttachRolePolicy only with a Condition that iam:PermissionsBoundary equals your approved boundary ARN, and deny editing or removing that boundary policy. A restrictive identity policy is the distractor: it limits the developer, but any role the developer creates carries whatever permissions the developer chooses, so the escalation path stays open. A boundary is also not an SCP; it applies per entity, not per account.
CODE: json
{
  "Effect": "Allow",
  "Action": ["iam:CreateRole", "iam:AttachRolePolicy"],
  "Resource": "*",
  "Condition": {"StringEquals": {"iam:PermissionsBoundary": "arn:aws:iam::111122223333:policy/DevBoundary"}}
}
USAGE:
If a role created by automation cannot do something its policy plainly allows, check whether a permissions boundary was attached to it, since the console shows the boundary separately from the permissions policies.

## aws-sts-assume-role-cross-account | d2
TOPIC: 1.1 Secure access
Q:
A SaaS vendor needs read access to CloudWatch metrics in your account. Why do you create a role rather than an IAM user, what does the external ID add, and which other STS calls and session limits should you know?
A:
Create a role whose trust policy names the vendor's account, attach a least-privilege policy and share only the role ARN; the vendor calls sts:AssumeRole for credentials that expire, so no long-lived secret leaves your account. The external ID, checked by an sts:ExternalId condition, blocks the confused deputy who would reuse your role elsewhere; it is not a secret. Other calls: AssumeRoleWithSAML for an enterprise IdP, AssumeRoleWithWebIdentity for Cognito or OIDC, GetSessionToken for MFA-protected calls by an IAM user (15 minutes to 36 hours), GetFederationToken for a legacy broker. Role sessions run 15 minutes to the role's maximum of 12 hours, but role chaining caps at one hour. Issued credentials cannot be recalled early except by a deny on aws:TokenIssueTime.
CODE: json
{
  "Effect": "Allow",
  "Principal": {"AWS": "999999999999"},
  "Action": "sts:AssumeRole",
  "Condition": {"StringEquals": {"sts:ExternalId": "vendor-generated-id"}}
}
USAGE:
Before storing a customer's role ARN, test that the role cannot be assumed without the correct external ID, otherwise you have inherited the confused deputy problem.

## aws-organizations-scp | d2
TOPIC: 1.1 Secure access
Q:
An SCP on a member account's OU allows only ec2:* and s3:*, a user there has no IAM policies, and the CTO asks what else Organizations offers beyond that guardrail. What can the user do, and how do the multi-account layers fit together?
A:
Nothing: an SCP never grants, it caps what identity-based and resource-based policies can grant to every user and role in member accounts, root included, so someone must still attach an IAM policy. SCPs bind neither the management account nor service-linked roles, and they need all-features mode, as do tag policies and delegated administrators. Beyond guardrails, Organizations gives one management account with nested OUs that inherit policies, consolidated billing that shares volume tiers plus Reserved Instance and Savings Plans discounts, and delegated administrator accounts for services such as GuardDuty. Multi-account access stacks four layers: prevent with SCPs, grant with cross-account roles, give humans permission sets through Identity Center, and share subnets or transit gateways with RAM instead of copying them.
USAGE:
Test a new SCP on an OU holding a single sandbox account before attaching it near the root, since one typo can lock every member account out of a service at once.

## aws-iam-identity-center | d2
TOPIC: 1.1 Secure access
Q:
Dozens of accounts need single sign-on from corporate Okta, a second team runs one standalone account, and a mobile app's customers must upload to S3. Which federation path fits each, and where do IAM users still belong?
A:
Workforce across many accounts: IAM Identity Center, an organization instance in the management account connected to Okta over SAML 2.0 with SCIM provisioning; permission sets become IAM roles in each account and users get short-lived credentials from the access portal. One standalone account: a SAML 2.0 or OIDC identity provider created in IAM, whose assertion is exchanged through AssumeRoleWithSAML or AssumeRoleWithWebIdentity for one role in that account. App customers: a Cognito user pool signs them in and an identity pool exchanges the token for an IAM role's temporary credentials (its classic flow calls AssumeRoleWithWebIdentity directly). In every case the person lands in a role with STS credentials; IAM users with long-term keys are only for tools that cannot federate.
USAGE:
Assign a least-privilege permission set alongside the administrative one and choose the smaller role in the access portal for day-to-day work.

## aws-s3-bucket-policy-vs-iam-policy | d2
TOPIC: 1.1 Secure access
Q:
A Lambda role in account B must read objects from a bucket owned by account A. Which policy must account A write, and is an identity policy on the role still needed?
A:
Account A must attach a bucket policy, a resource-based policy, naming the role's ARN as Principal and allowing s3:GetObject on the objects, because an identity-based policy in account A cannot grant to a principal it does not own. The role in account B also needs an identity policy allowing s3:GetObject on the object ARN, arn:aws:s3:::bucket/*, not the bucket ARN, because s3:GetObject is an object operation and a cross-account request must be allowed in both accounts. Within one account either policy type alone is enough. Keep Object Ownership on bucket owner enforced so ACLs are disabled and account A owns every object. The distractor is an object ACL, or an IAM policy in account A naming account B's role.
USAGE:
If a cross-account read still fails after the bucket policy looks right, check whether the objects use SSE-KMS, because the key policy must also allow the other account and the AWS managed key cannot be shared.

## aws-s3-block-public-access | d1
TOPIC: 1.3 Data security controls
Q:
A team adds a bucket policy with Principal "*" to serve images publicly, but S3 rejects the PutBucketPolicy call. What is blocking it, and how do account-level and bucket-level settings interact?
A:
S3 Block Public Access. Every new bucket has all four settings on, and BlockPublicPolicy rejects any bucket policy that S3 classifies as public, while BlockPublicAcls and IgnorePublicAcls neutralise public ACLs and RestrictPublicBuckets cuts off cross-account access to a bucket whose policy is public. The settings exist at account level and bucket level, and S3 applies the most restrictive combination, so turning them off on one bucket achieves nothing while the account-level block stays on. The feature overrides policies and ACLs without editing them, so switching it off makes an existing public policy live again. The distractor is rewriting the policy when the block is the real cause; for public content prefer CloudFront in front of a private bucket.
USAGE:
When a static website served straight from S3 returns 403 on every object, check Block Public Access at both the bucket and the account before touching the policy.

## aws-s3-object-lock-worm | d2
TOPIC: 1.3 Data security controls
Q:
Financial records must be undeletable for seven years, even by root, application logs must vanish after 90 days, and PII must be findable and locked down separately. Which Object Lock mode do you choose, and what sets the other two controls?
A:
Enable Object Lock on the bucket (it turns on Versioning) and apply a retention period in compliance mode: nobody, root included, can delete or shorten it before the retain-until date, and the only exit is closing the account. Governance mode is the distractor: a principal with the governance override permission can lift it, and a legal hold is a separate no-expiry lock. Retention floors come from Object Lock or Glacier Vault Lock; retention ceilings come from lifecycle expiration rules and CloudWatch Logs retention, which defaults to never expire and runs from 1 to 3,653 days. Classification is tags plus Macie discovery, then ABAC policies and a separate KMS key per class so PII has its own audit trail and revocation.
USAGE:
Trial the retention settings in governance mode on a test bucket first, because a compliance-mode retention period applied to the wrong prefix cannot be undone.

## aws-s3-encryption-options-sse | d2
TOPIC: 1.3 Data security controls
Q:
Auditors require proof of which principal decrypted each object and the ability to revoke a key for one dataset. Which S3 server-side encryption option satisfies this, and what cost issue follows?
A:
SSE-KMS with a customer managed key. SSE-S3 is the default and encrypts every new object with keys S3 manages, but it gives no key policy, no key lifecycle control and no CloudTrail record of key use, so it fails the audit. With SSE-KMS every upload and download calls KMS for GenerateDataKey or Decrypt, which is billed and counts against the KMS request quota; enable an S3 Bucket Key so S3 derives data keys from a bucket-level key and reduces KMS traffic. DSSE-KMS adds a second encryption layer for regulations demanding it and cannot use Bucket Keys. SSE-C means you send your own key on every request and S3 never stores it, so losing the key loses the object.
USAGE:
Keep buckets that receive S3 server access logs on SSE-S3, because switching the destination to SSE-KMS can produce log objects encrypted with a key you cannot read.

## aws-s3-presigned-urls | d1
TOPIC: 1.2 Secure workloads
Q:
A mobile app must let users upload photos to a private S3 bucket without AWS credentials on the device. Why is a presigned URL the answer rather than opening the bucket?
A:
A presigned URL is a signed request that carries the permissions of the IAM principal who generated it, valid only until the expiry you set, so the bucket stays private and no credentials leave your backend. It works for downloads with GET and for uploads with PUT, and the client makes a plain HTTPS request. The trap is expiry: the URL dies when the signing credentials do, so one generated from an EC2 instance role or an STS session expires with that session even if you asked for longer, and only long-lived IAM user credentials reach the seven-day maximum. The exam distractor is making the bucket public, which exposes every object instead of one for a short time.
USAGE:
Sign URLs with a credential that outlives the URL, and remember an upload URL overwrites any existing object with the same key.

## aws-kms-key-rotation-and-multi-region | d2
TOPIC: 1.3 Data security controls
Q:
Compliance demands yearly rotation, the DR plan decrypts backups in a second Region, and a new team asks which KMS key type to create, who controls access to it and what it costs. What do you tell them?
A:
KMS is Regional. Three ownership types: AWS owned (free, invisible, no policy), AWS managed aws/service (no monthly fee, rotated yearly, policy not editable, not shareable across accounts) and customer managed ($1 per key per month plus $0.03 per 10,000 requests, your key policy, optional rotation, cross-account use). Keys are symmetric by default or asymmetric/HMAC; Encrypt takes 4,096 bytes at most, so larger data needs envelope encryption. The key policy comes first and must delegate to IAM before IAM policies can allow; grants give services temporary access. Customer managed rotation defaults to 365 days and keeps old material, never re-encrypting. Deletion waits 7 to 30 days. Multi-Region keys share material so ciphertext decrypts in the replica Region; single-Region keys cannot convert.
USAGE:
Rotation never re-encrypts existing data or data keys, so a leaked data key is not fixed by rotating the KMS key; re-encrypt the data instead.

## aws-acm-certificates-and-cloudfront-region | d2
TOPIC: 1.3 Data security controls
Q:
A team requests one ACM certificate in ap-southeast-2 and attaches it to an ALB, then cannot select it for their CloudFront distribution. What went wrong, and when can an ACM certificate be exported?
A:
ACM certificates are Regional resources and cannot be copied between Regions. An ALB uses a certificate from its own Region, but CloudFront accepts only certificates in us-east-1, so request a second one there. Public certificates used with integrated services cost nothing extra and ACM renews them automatically when DNS validation is in place; imported certificates are never renewed. For export, an ordinary public certificate cannot be exported, and only one requested with export enabled, which carries a charge, or one issued by AWS Private CA gives you the private key for EC2 or on-premises servers. The distractor is exporting the existing certificate or attaching it directly to EC2, which ACM allows only through Nitro Enclaves.
USAGE:
Prefer DNS validation over email so renewals need no human action, and treat us-east-1 as the home for anything CloudFront will serve.

## aws-cognito-user-pool-vs-identity-pool | d2
TOPIC: 1.2 Secure workloads
Q:
A mobile app needs sign-in with MFA and social login, and afterwards must upload files straight to S3. Which Cognito component does each job?
A:
A user pool is the user directory and authentication server: it handles sign-up, sign-in, MFA and federation with Google, Apple, SAML or OIDC providers, and issues OIDC JSON web tokens (ID, access and refresh) that your app or API can verify directly. It never hands out AWS credentials. An identity pool is a credentials broker: it takes a token from a user pool or another trusted provider and exchanges it through STS for temporary AWS credentials tied to an IAM role, so the app can call S3 or DynamoDB itself. It also supports unauthenticated guest identities with a limited role. The distractor is a user pool alone for S3 access, or IAM users for end customers.
USAGE:
Configure the IAM role trust policy so only your identity pool can assume it, and give the unauthenticated role the narrowest permissions you can.

## aws-guardduty-inspector-macie-detective | d1
TOPIC: 1.2 Secure workloads
Q:
Which service do you pick to find a leaked access key being used from an unusual country, an unpatched CVE in a container image, credit card numbers in a bucket, and the root cause after an alert?
A:
Match the verb. GuardDuty detects threats with no agents: it ingests CloudTrail management events, VPC Flow Logs and DNS logs, adds optional protection plans (S3, EKS, RDS login, Lambda, malware, runtime), is enabled organization-wide from a delegated administrator, and sends findings to EventBridge, so the leaked key is GuardDuty. Inspector manages vulnerabilities: it continuously rescans EC2 through the SSM Agent, ECR images and Lambda functions for CVEs and network reachability, so the CVE is Inspector. Macie is S3 only: it inventories buckets, flags public or unencrypted ones, and runs discovery jobs with managed and custom data identifiers, so the card numbers are Macie. Detective investigates after the alert, building a behavior graph from CloudTrail, flow logs and GuardDuty findings.
USAGE:
Route GuardDuty and Inspector findings through EventBridge to a ticket queue or chat channel, because findings nobody reads are the same as no detection.

## aws-vpc-endpoints-gateway-vs-interface | d2
TOPIC: 1.2 Secure workloads
Q:
Instances in a private subnet need S3 without a NAT gateway, and later an on-premises data centre must reach the same bucket privately. Gateway or interface endpoint, and why?
A:
A gateway endpoint exists only for S3 and DynamoDB, works as a prefix-list route in the subnet route table at no additional charge. It cannot be used from on premises, a peered VPC or another Region. For the data centre add an interface endpoint: a PrivateLink elastic network interface with a private IP in your subnet, guarded by a security group, and reachable over VPN, Direct Connect or a peered VPC. Both accept an endpoint policy that narrows which principals and buckets are reachable without replacing IAM or bucket policies. The distractor is an interface endpoint for traffic that never leaves the VPC, or a gateway endpoint for a client outside it.
USAGE:
Add an S3 bucket policy condition on aws:sourceVpce once the endpoint exists, but test it first because a wrong endpoint ID locks everyone out, including the console.

## aws-vpc-peering-vs-transit-gateway | d2
TOPIC: 3.4 Scalable network
QUALIFIER: LEAST operational overhead
Q:
A company has 20 VPCs across several accounts and a data centre connected through AWS Direct Connect. Every VPC must reach every other VPC and the data centre. Which design meets this with the LEAST operational overhead?
OPT: a *
Attach all 20 VPCs to a Transit Gateway, associate a Direct Connect gateway with it through a transit virtual interface, and add a Site-to-Site VPN attachment as backup.
OPT: b
Create a full mesh of VPC peering connections and attach a virtual private gateway to the VPC that hosts the Direct Connect private virtual interface.
WHY:
Peering is not transitive, so 20 VPCs need 190 one-to-one peerings with routes on both sides of each, and the data centre still reaches only the one VPC that owns the gateway; the mesh grows with the square of the VPC count.
OPT: c
Attach a virtual private gateway to each of the 20 VPCs and associate all of them with the Direct Connect gateway.
WHY:
That gives the data centre a path to every VPC, but the VPCs still cannot talk to each other, and 20 gateway associations with 20 sets of BGP prefixes is exactly the per-VPC administration a hub removes.
OPT: d
Expose each VPC's services to the others through AWS PrivateLink endpoint services behind Network Load Balancers.
WHY:
PrivateLink publishes one service to consumer VPCs, one-way and consumer-initiated, with no route exchange; it is not layer-3 connectivity between networks, and it does nothing for the data centre requirement.
A:
Use a Transit Gateway hub: a Regional router to which VPCs, VPN connections, Direct Connect gateways and other transit gateways attach, with route tables that let every attachment reach every other or isolate groups. The hybrid pattern hangs off it: the Direct Connect gateway attaches through a transit virtual interface, a Site-to-Site VPN attachment stands by as backup, Route 53 Resolver inbound and outbound endpoints carry DNS between on-premises and VPC, and PrivateLink covers a service that on-premises clients need without opening a network. Peering stays right for a handful of VPCs, because a transit gateway bills hourly per attachment plus data processing, but a growing mesh signals the move to the hub. The trap is assuming peering is transitive.
USAGE:
Plan non-overlapping CIDR ranges across accounts from day one, because peering refuses overlapping VPCs and a transit gateway cannot route sensibly between them.

## aws-vpc-flow-logs | d1
TOPIC: 1.2 Secure workloads
Q:
Connections to an EC2 instance are timing out and you suspect a security group is dropping them. What do VPC Flow Logs show you, and what do they not show?
A:
Flow logs record metadata about IP traffic to and from network interfaces: source and destination address and port, protocol, packet and byte counts, and an ACCEPT or REJECT action. You enable them at VPC, subnet or network interface level and publish to CloudWatch Logs, S3 or Data Firehose. A REJECT record on the inbound flow proves the packets never reached the instance, which points at the security group or network ACL rather than the application. They do not capture packet payloads, they are not real time, and they skip some traffic such as Amazon DNS, instance metadata and DHCP. The distractor is Traffic Mirroring or a packet capture when the question only asks which layer blocked the connection.
USAGE:
If you see ACCEPT for the request and REJECT for the reply, look at the stateless network ACL, because a stateful security group would have let the response through.

## aws-ssm-session-manager-vs-bastion | d2
TOPIC: 1.2 Secure workloads
Q:
Auditors require that no EC2 instance accepts inbound SSH and that every administrative shell session is logged. Do you build a bastion host, or something else?
A:
Use Systems Manager Session Manager. The SSM Agent on the instance opens an outbound HTTPS connection to the Systems Manager endpoints, so the instance needs no inbound port 22, no key pair and no public IP; a bastion still leaves SSH open somewhere and keys to rotate. Who may connect, and to which nodes, is decided by IAM policies, and session activity can be sent to CloudWatch Logs or S3 while CloudTrail records the API calls. The prerequisites the exam probes: SSM Agent installed, an instance profile with the AmazonSSMManagedInstanceCore permissions, and outbound reach to the ssm, ssmmessages and ec2messages endpoints, which in a private subnet means a NAT gateway or interface VPC endpoints. The bastion host is the distractor.
USAGE:
When Session Manager cannot connect, the cause is almost always a missing instance profile or no route to the SSM endpoints, not a security group.

## aws-site-to-site-vpn-vs-direct-connect | d2
TOPIC: 3.4 Scalable network
Q:
A company needs its data centre connected to a VPC within days, and later wants predictable throughput for large nightly transfers. When is Site-to-Site VPN the answer, when is Direct Connect, and when is neither the right tool?
A:
Site-to-Site VPN runs IPsec tunnels over the public internet: encrypted and up in days, but capped at 1.25 Gbps per standard tunnel. Direct Connect is dedicated fibre into an AWS location: consistent latency, 1, 10, 100 or 400 Gbps ports, but it needs a physical cross connect, AWS can take up to 72 business hours just to provision the port, and it is unencrypted unless you add MACsec or run a VPN over it. Pair them, Direct Connect primary and VPN backup: AWS prefers the Direct Connect route for the same prefix, so failover is automatic. Neither is right for exposing one service rather than a network: PrivateLink publishes it through a Network Load Balancer to consumer VPCs, one-way, even with overlapping CIDRs; peering or a Transit Gateway gives VPC-to-VPC layer-3 reach. The trap is Direct Connect for an urgent deadline.
USAGE:
Test the VPN backup path before you need it; a backup that has never carried traffic tends to have a stale route or a misconfigured customer gateway.

## aws-direct-connect-encryption | d2
TOPIC: 1.2 Secure workloads
Q:
A regulated workload must encrypt everything crossing its Direct Connect link and reach VPCs in two Regions. What does Direct Connect give you on its own, and what do you add?
A:
A private physical link, not an encrypted one: dedicated ports of 1, 10, 100 or 400 Gbps from AWS, or hosted connections of 50 Mbps to 25 Gbps from a partner, provisioned over weeks. A private VIF reaches one VPC or, through a Direct Connect gateway, VPCs in many Regions and accounts; a transit VIF reaches transit gateways; a public VIF reaches public endpoints such as S3. To encrypt, run a Site-to-Site VPN over the link, or use MACsec, which only dedicated 10, 100 and 400 Gbps ports at selected locations support, never hosted connections, and only to the Direct Connect location. Resilience needs a second connection elsewhere or a VPN backup; a lone private VIF is the distractor.
USAGE:
Assume the DX circuit is a shared-carrier link: run a VPN over it from day one, or budget for MACsec ports, rather than retrofitting when the auditor asks.

## aws-cloudhsm-vs-kms | d2
TOPIC: 1.3 Data security controls
Q:
A bank must keep its encryption keys in a single-tenant HSM that its own staff administer, yet still use those keys with RDS and EBS. KMS, CloudHSM, or both?
A:
KMS is a managed, multi-tenant service: AWS runs a shared fleet of FIPS 140-3 Level 3 validated HSMs, integrates with most AWS services, and you govern use through key policies. CloudHSM gives you a dedicated, single-tenant cluster in your VPC where you create the users and keys, AWS cannot see the key material, and applications use PKCS#11, JCE or CNG libraries; in return you own availability, backups and scaling. When the requirement is both single-tenant hardware and native AWS service integration, use a KMS custom key store backed by your CloudHSM cluster, symmetric encryption keys only. Exam questions use FIPS 140-2 Level 3 as the CloudHSM hint, but the real discriminator is single tenancy and customer-run key management.
USAGE:
Reach for CloudHSM only when a regulation names a dedicated HSM; the docs say custom key stores are not more secure than the standard key store, only more work.

## aws-ec2-imdsv2 | d3
TOPIC: 1.2 Secure workloads
Q:
A web app on EC2 has a server-side request forgery bug. Why can an attacker use it to steal the instance role's credentials, and which setting closes the hole?
A:
Applications obtain the instance role's temporary credentials from the metadata service at 169.254.169.254 under iam/security-credentials/role-name. Under IMDSv1 a plain GET returns them, so any bug that makes the app fetch an attacker-chosen URL leaks live keys. IMDSv2 is session based: the caller first sends a PUT to /latest/api/token with a TTL header (up to six hours), then presents that token in a header on every GET. SSRF bugs and open proxies rarely issue PUTs with custom headers, PUTs carrying X-Forwarded-For are rejected, and the default hop limit of 1 keeps the token on the instance. Enforce it with HttpTokens set to required at launch or via modify-instance-metadata-options; tokenless requests get a 401. Disabling the endpoint is the distractor.
CODE: bash
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
curl -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/iam/security-credentials/
USAGE:
Set the AMI's imds-support to v2.0 or the account-level default so new instances require IMDSv2 without anyone remembering a launch flag.

## aws-rds-encryption-and-iam-auth | d2
TOPIC: 1.3 Data security controls
Q:
An unencrypted RDS MySQL instance must now be encrypted at rest and reachable from an EC2 application without a stored password. What are the steps, and what cannot be done in place?
A:
Encryption at rest is chosen only when an RDS instance is created; you cannot switch it on for a running one, nor take an encrypted snapshot of an unencrypted instance. The path is: snapshot the instance, copy the snapshot with encryption and a KMS key, restore a new instance from the encrypted copy, then repoint the application. The setting then flows into backups, snapshots and read replicas, and can never be removed. For access, enable IAM database authentication (MariaDB, MySQL and PostgreSQL): the application uses its instance profile credentials to request a token valid for 15 minutes and presents it instead of a password over SSL or TLS. The distractor is a modify-instance encryption option, which does not exist.
USAGE:
Because IAM tokens expire after 15 minutes, generate a fresh one for each new connection rather than caching it in a connection pool's configuration.

## aws-ebs-encryption-default | d2
TOPIC: 1.3 Data security controls
Q:
A compliance rule says every new EBS volume in the account must be encrypted, and some existing unencrypted volumes must be fixed. How do you handle each?
A:
Turn on EBS encryption by default; it is a per-Region setting, so enable it in every Region you use. From then on new volumes and snapshot copies are encrypted with the default key, the AWS managed aws/ebs key unless you nominate a customer managed key, and individual volumes cannot opt out. It does nothing to existing volumes or snapshots. To fix those, snapshot the volume and either create a new encrypted volume from that snapshot or copy the snapshot with encryption enabled and restore from the copy; there is no in-place encrypt. Encryption is inherited and permanent: snapshots of encrypted volumes and volumes restored from them are encrypted for good. The trap is assuming the switch retrofits old volumes.
USAGE:
Copying a snapshot to a different KMS key produces a full rather than incremental copy, so budget for the extra snapshot storage.

## aws-security-group-referencing | d1
TOPIC: 3.4 Scalable network
Q:
Web servers behind an ALB scale in and out, and the database must accept connections only from those web servers. How do you write the rule without maintaining IP lists, and where does each tier live in the VPC?
A:
Set the source of the inbound rule to a security group ID rather than a CIDR: a rule that references the web tier's group admits the private IP of every network interface carrying that group, so new instances are covered at launch. Chain the tiers: the load balancer group allows 0.0.0.0/0 on 443, the web group allows only the load balancer group, the database group allows only the web group on the database port. That chain is the multi-tier topology: an internet-facing ALB in public subnets, the application Auto Scaling group in private subnets, RDS Multi-AZ and ElastiCache in isolated data subnets, an internal ALB or NLB between tiers, NAT gateways or VPC endpoints for egress, every tier in at least two Availability Zones. Referencing works within a VPC, across peering and inbound across a transit gateway. The subnet CIDR, which admits everything there, is the distractor.
USAGE:
A rule that references a security group counts as one rule regardless of how many instances sit behind it, which keeps you well under the per-group rule quota.

## aws-alb-authentication-cognito-oidc | d2
TOPIC: 1.2 Secure workloads
Q:
A web app behind an Application Load Balancer must require single sign-on before requests reach the EC2 targets, admins want shell access, and reports must be downloadable without a public bucket. What do you configure at each access surface?
A:
Users: an authenticate-cognito or authenticate-oidc action on the HTTPS listener rule; the ALB redirects to the IdP, exchanges the code, sets a session cookie and forwards claims in the signed x-amzn-oidc-data header, which targets must verify (an internal ALB needs a NAT gateway to reach the IdP). Admins: Session Manager instead of SSH keys and bastions. Objects: S3 presigned URLs or CloudFront signed URLs with OAC on a private bucket, never a public bucket. Service to service: IAM roles plus VPC endpoints rather than public endpoints. Classify the scenario first (user, admin, object, service), then pick the service. The distractor is a Lambda or Cognito authorizer, which belongs to API Gateway; on an ALB, authentication lives on the listener rule.
USAGE:
Check that the signer field in the x-amzn-oidc-data JWT matches your ALB ARN before trusting any claim, and restrict the target security group to the ALB so nobody can inject those headers directly.

## aws-api-gateway-auth-options | d2
TOPIC: 1.2 Secure workloads
Q:
A REST API on API Gateway must accept calls from mobile app users, from internal AWS services, and from partners who send a custom bearer token. Which authoriser fits each caller, and where do API keys belong?
A:
Match the authoriser to the caller. IAM authorisation, set as AWS_IAM on the method, suits AWS principals that can sign requests with Signature Version 4 and hold execute-api:Invoke. A Cognito user pool authoriser suits app users who sign in and present a user pool token. A Lambda authoriser suits anything custom: it receives the bearer token or request parameters, returns an IAM policy and a principal, and its decision can be cached. Resource policies then restrict where calls may come from, such as source IP ranges, VPC endpoints or other accounts. The trap is API keys: they identify a client for usage plan throttling and quotas, and AWS states that they must not be used for authentication or authorisation.
USAGE:
Pair an API key with a real authoriser; a key on its own lets any holder call every API in that usage plan.

## aws-lambda-vpc-access | d2
TOPIC: 1.2 Secure workloads
Q:
A Lambda function must query an RDS instance in a private subnet, and after you attach the function to the VPC its calls to a public third-party API start timing out. Why, and what fixes both needs?
A:
Attaching a function to a VPC gives it a Hyperplane network interface in the subnets and security group you pick, so it can reach RDS or ElastiCache over private IPs; the execution role needs the AWSLambdaVPCAccessExecutionRole permissions to create that interface. The cost is that the function now reaches only what the VPC can reach, and the default internet access is gone. Fix it by choosing private subnets whose route table sends 0.0.0.0/0 to a NAT gateway in a public subnet. The trap is selecting a public subnet, which does not help because the function never gets a public IP. For S3, DynamoDB and other AWS APIs, add VPC endpoints so traffic stays on the AWS network without NAT.
USAGE:
Reuse the same subnet and security group combination across functions so Lambda shares one network interface instead of creating more.

## aws-privatelink-expose-service | d2
TOPIC: 1.2 Secure workloads
Q:
A team runs an internal API in its VPC and must expose it to dozens of consumer VPCs in other accounts, several of which use the same 10.0.0.0/16 range. Peering is rejected; what do you build instead?
A:
Use AWS PrivateLink. The provider puts a Network Load Balancer in front of the service, creates a VPC endpoint service and grants permission to the consumer principals. Each consumer creates an interface endpoint in its own subnets, which places an endpoint network interface with a private IP inside the consumer VPC, and the provider accepts the connection. Traffic stays on the AWS network and only the consumer initiates it, so the provider never routes into the consumer network. Because the consumer reaches the service through DNS and a local interface rather than through routes into the provider VPC, overlapping CIDR blocks are fine, whereas VPC peering refuses matching or overlapping ranges and exposes networks rather than one service.
USAGE:
Make the NLB available in at least two Availability Zones, because consumers can only create endpoints in zones where the endpoint service is available.

## aws-iam-access-analyzer-credential-report | d2
TOPIC: 1.3 Data security controls
Q:
An auditor asks which buckets, keys or roles outsiders can reach, which IAM users lack MFA or hold stale keys, and how you prove who read a confidential object and that only the right classification could. Which tools answer each?
A:
Access Analyzer answers the first: an external access analyzer takes the account or organization as its zone of trust and raises a finding for every resource a principal outside it can reach. The credential report answers the second: a CSV with password_enabled, mfa_active and access_key_1_last_rotated per user. Governance is prevent, detect, prove: S3 Block Public Access (all four settings, ideally at account or organization level) prevents exposure, Access Analyzer detects it, CloudTrail data events log object-level reads for the proof, ABAC policies on classification tags such as aws:ResourceTag scope who may touch which class, Macie discovers where sensitive data sits, and Lake Formation centralizes table and column grants for analytics. None of them replaces CloudTrail for what actually happened.
USAGE:
External access findings are per Region, so create an external access analyzer in every Region where you hold resources.

## aws-route53-routing-policies | d3
TOPIC: 3.4 Scalable network
QUALIFIER: LOWEST latency
Q:
A dynamic HTTP application runs behind one Application Load Balancer in a single Region, and users on three continents complain about slow responses. Which design gives them the LOWEST latency?
OPT: a *
Deploy the stack in a Region on each continent behind Route 53 latency-based routing, and add CloudFront in front for cacheable content and edge-terminated connections.
OPT: b
Keep the single Region and add Route 53 geolocation routing that maps each continent to the load balancer.
WHY:
Geolocation picks a record by where the query originates, which serves content rights and compliance; with one load balancer every continent still resolves to the same distant Region, so nothing gets faster.
OPT: c
Keep the single Region and put a CloudFront distribution in front of the load balancer.
WHY:
CloudFront caches static responses at the edge and shortens the TCP path, but every dynamic request still travels to the one Region's compute, so the backend round trip that causes the complaint remains.
OPT: d
Keep the single Region and put AWS Global Accelerator in front of the load balancer.
WHY:
Global Accelerator moves traffic onto the AWS backbone at the nearest edge, which trims jitter, but with a single Regional endpoint there is no nearer compute to route to; it earns its place when static anycast IPs or fast failover across several Regions are required.
A:
Run the stack in three Regions and let Route 53 latency-based routing answer each user with the Region that responds fastest, with CloudFront on top for cached objects and edge-terminated connections. That is the global topology pattern: Route 53 latency or geolocation routing in front of Regional load balancers, CloudFront for HTTP, Global Accelerator when static anycast IPs or non-HTTP protocols matter, and data kept close through Aurora Global Database, DynamoDB global tables or S3 replication. Choose latency routing for lowest latency worldwide and geolocation only when law or licensing dictates who is served from where; weighted routing is for shifting a percentage between versions, not for geography.
USAGE:
Always add a default geolocation record; without one, queries from unmapped IP addresses get no answer at all.

## aws-route53-health-checks-failover | d2
TOPIC: 2.2 HA and fault tolerance
Q:
A failover record set points to a primary web tier in a private subnet with no public IPs, and the endpoint health check stays unhealthy even though the site works. What is wrong, how do you fix it, and how fast can each failover layer react?
A:
Route 53 health checkers sit outside your VPC and can only probe a public IP or DNS name, so for private resources create a CloudWatch alarm (for example on StatusCheckFailed) and a health check that monitors the alarm's data stream; failover routing is active-passive, answering with the primary until every primary resource is unhealthy. Pick the failover layer by scope and accept its timing: inside a fleet the load balancer drops a target after a few failed health checks, in seconds; inside a Region an RDS Multi-AZ instance fails over in typically 60 to 120 seconds, Aurora in under 60 and often under 30, ElastiCache Multi-AZ in a few seconds; across Regions Route 53 failover takes the check interval (30 seconds standard, 10 fast) times the failure threshold plus whatever TTL resolvers cached, and an Aurora Global Database managed failover promotes a secondary within a few minutes; clients bound to an IP address need an Elastic IP reassociation, not DNS. Active-active makes failover pure routing; active-passive makes it a switch. The trap is giving private servers public IPs to satisfy the checker.
USAGE:
For an alias record pointing at an ALB or another AWS resource, set Evaluate Target Health to yes rather than attaching a separate health check.

## aws-route53-alias-vs-cname | d1
TOPIC: 4.4 Cost-optimized network
Q:
You need example.com, the bare domain, to resolve to an Application Load Balancer at the lowest DNS cost. Why does a CNAME fail here, and what do you use instead?
A:
DNS forbids a CNAME at the zone apex, so Route 53 refuses one for example.com. An alias record answers as an A or AAAA record but points at an AWS resource such as an ALB, CloudFront, API Gateway or S3 website endpoint. Cost is the second reason: a hosted zone is $0.50 a month and standard queries $0.40 per million, but queries to alias records that target AWS resources are free, while CNAME queries are billed. Health checks cost $0.50 a month each beyond 50 free ones on AWS endpoints, and Resolver endpoints $0.125 per ENI-hour, so do not create them by reflex. The trap is a CNAME because it works for www.example.com; it never sits at the apex.
USAGE:
An alias to an AWS resource has no TTL of its own; Route 53 uses the resource's default, so plan cutovers with that in mind.

## aws-asg-scaling-policies | d2
TOPIC: 3.2 Elastic compute
QUALIFIER: LEAST operational overhead
Q:
An Auto Scaling group behind an Application Load Balancer must keep each instance at about 1,000 requests per minute and must already have extra capacity running before the 09:00 login rush every weekday. Which configuration meets both needs with the LEAST operational overhead?
OPT: a *
Attach a target tracking policy on ALBRequestCountPerTarget with a target value of 1,000, and add a scheduled action that raises the group's minimum and desired capacity at 08:45 on weekdays.
OPT: b
Create step scaling policies on average CPU utilization with CloudWatch alarms at 60, 75 and 90 percent, and pre-warm capacity by hand each morning.
WHY:
CPU is only a proxy for request load, every alarm threshold and step adjustment is yours to define and retune, and a manual morning capacity change is exactly the recurring task the requirement wants removed.
OPT: c
Create scheduled actions that set desired capacity to a high value at 08:45 and a low value at 18:00 on weekdays, with no dynamic policy.
WHY:
Schedules cover the known rush but cannot see an unexpected surge or a quiet day; capacity is either over-provisioned all day or overwhelmed by traffic the calendar did not predict, and someone must keep editing the numbers as usage grows.
OPT: d
Attach a target tracking policy on ASGAverageNetworkIn and have an operator bump desired capacity before 09:00 each day.
WHY:
Bytes received on the network interfaces track downloads and uploads, not request count per instance, so the target drifts with payload size; the daily manual bump is the overhead being eliminated and a scheduled action does it for free.
A:
Target tracking on ALBRequestCountPerTarget keeps the average request count per instance at the target and creates and manages its own CloudWatch alarms, scaling out promptly and in gradually; a scheduled action moves minimum and desired capacity ahead of the known 09:00 peak, and predictive scaling can replace that schedule once the metric has at least 24 hours of history. Step scaling is for breach-size responses you tune yourself, CPU and NetworkIn only approximate request load, schedules alone cannot see a surprise, and manual capacity changes are the overhead being removed. Under every policy sits the group itself: a launch template, minimum, desired and maximum sizes, subnets in several AZs kept balanced, ELB health checks that replace failed instances, and optionally mixed instance types with Spot.
USAGE:
When several policies fire at once Auto Scaling applies the one that yields the largest capacity, so a scheduled floor and a target tracking policy coexist safely; never reach for simple scaling, which ignores new alarms until its cooldown ends.

## aws-asg-lifecycle-hooks-and-warm-pools | d3
TOPIC: 3.2 Elastic compute
Q:
An Auto Scaling group must copy logs off each instance before termination, scale-out is slow because bootstrap takes minutes, and a colleague wants the same group to scale the ECS service and DynamoDB table too. Which features fit, and why does the last idea fail?
A:
A lifecycle hook pauses an instance in Pending:Wait or Terminating:Wait, one hour by default and extendable with heartbeats, while a script or Lambda function installs software or copies logs off; you then complete it with CONTINUE or ABANDON. A warm pool keeps pre-initialised instances beside the group, normally Stopped so you pay for volumes only, and scale-out draws from it instead of cold booting; without a launch hook the pool stops half-built instances. The colleague's idea fails because EC2 Auto Scaling groups scale EC2 instances only: ECS services, DynamoDB tables and indexes, Aurora Replicas, Lambda provisioned concurrency and Spot Fleets belong to Application Auto Scaling, and AWS Auto Scaling scaling plans, the tag-discovered console across both, now come with AWS's own advice to set predictive scaling policies directly on each resource instead.
USAGE:
Have the user data script call complete-lifecycle-action as its last line, so the launch hook holds the instance until bootstrap really finishes and a warm pool never stops a half-built one.

## aws-asg-health-checks-elb-vs-ec2 | d2
TOPIC: 2.2 HA and fault tolerance
Q:
An instance behind an Application Load Balancer returns HTTP 500 on every request and the target group marks it unhealthy, yet the Auto Scaling group never replaces it. Why, and what do you change?
A:
By default an Auto Scaling group uses only the Amazon EC2 status checks, which detect a stopped or terminated instance or impaired hardware; a web server answering with errors still passes them, so the group considers the instance healthy. Elastic Load Balancing health checks are ignored until you turn them on. Once enabled, an instance the target group reports as unhealthy is marked Unhealthy on the next periodic check, drained, then terminated and replaced. Set a health check grace period so a new instance is not killed before it finishes starting; the console default is 300 seconds, the CLI default is 0. The distractor is changing the target group health check interval, which alters nothing on the group side.
USAGE:
After enabling ELB health checks, watch the group for a few minutes: a health check path that needs authentication or returns a redirect will get every instance replaced in a loop.

## aws-elb-cross-zone-and-sticky-sessions | d2
TOPIC: 3.4 Scalable network
QUALIFIER: LEAST amount of change
Q:
A Network Load Balancer has two targets in one Availability Zone and eight in another. The two are overloaded, and a developer proposes sticky sessions to fix it. Which action fixes the imbalance with the LEAST amount of change?
OPT: a *
Enable cross-zone load balancing on the Network Load Balancer.
OPT: b
Enable sticky sessions on the target group.
WHY:
Network Load Balancer stickiness pins traffic by client source IP, so every client behind one NAT device lands on the same target; it makes the distribution more uneven, not less, and sessions reset whenever a target's health changes.
OPT: c
Replace the Network Load Balancer with an Application Load Balancer, which balances across zones by default.
WHY:
An Application Load Balancer does have cross-zone balancing always on, but it is a layer-7 HTTP balancer; rebuilding a TCP listener stack to gain a setting the Network Load Balancer already offers is the opposite of least change.
OPT: d
Put AWS Global Accelerator in front of the load balancer.
WHY:
Global Accelerator steers clients to the nearest healthy endpoint across Regions; it does not change how one load balancer's nodes distribute traffic among targets inside a Region.
A:
Enable cross-zone load balancing on the Network Load Balancer. With it off, the default for Network and Gateway Load Balancers, each node sends traffic only to targets in its own zone, so each zone gets half the requests and the two targets take 25 percent each; with it on, all ten targets get 10 percent. Application Load Balancers have it always on at the load balancer level. Enabling it on a Network Load Balancer incurs EC2 data transfer charges, and Network Load Balancer stickiness uses no cookie, only source IP, so it worsens hotspots rather than curing them.
USAGE:
Prefer stateless targets with session state in ElastiCache or DynamoDB; if you must use source IP stickiness, expect corporate NAT ranges to pile onto one target and sessions to reset when targets change health.

## aws-elb-deregistration-delay | d1
TOPIC: 2.2 HA and fault tolerance
Q:
When an Auto Scaling group scales in, users with long downloads in progress receive 5xx errors. Which target group setting prevents that, and what is its default?
A:
Deregistration delay, also called connection draining, keeps a deregistering target in the draining state so in-flight requests can finish while no new requests are sent to it. The default is 300 seconds; a target with no in-flight requests completes immediately, and a target that closes connections before the delay ends causes a 500-level error for the client. Auto Scaling waits for draining before terminating the instance. Set the value just above your longest normal request, because the full delay must elapse before termination, otherwise scale-in and deployments look slow. The distractor is the health check grace period, which protects new instances at launch, not existing ones on the way out.
USAGE:
A five-minute default on an API with 200 millisecond responses makes every deploy and scale-in painfully slow, so tune it down to a few seconds above your slowest legitimate request.

## aws-aurora-vs-rds | d2
TOPIC: 3.3 High-performing databases
QUALIFIER: LEAST amount of change
Q:
An e-commerce site runs simple OLTP on RDS for MySQL 8. Growth requires about five times the current throughput, storage that expands without downtime, and more read capacity, with the LEAST amount of change to the application. Which migration fits?
OPT: a *
Migrate to Aurora MySQL-Compatible Edition by restoring a snapshot or replicating from the RDS instance, then add Aurora Replicas behind the reader endpoint.
OPT: b
Migrate to Aurora PostgreSQL-Compatible Edition.
WHY:
Aurora PostgreSQL would perform, but changing engines means converting the schema, SQL dialect and drivers with SCT and DMS, which is precisely the application change the requirement minimises.
OPT: c
Move the RDS for MySQL instance to a much larger DB instance class and enable storage autoscaling.
WHY:
A bigger instance scales vertically and RDS storage autoscaling grows the volume, but throughput is still bounded by one instance's engine, read replicas each carry their own copy, and the stock engine gives no five-fold gain.
OPT: d
Re-platform the catalogue and orders onto DynamoDB.
WHY:
A key-value redesign of an SQL-shaped OLTP application is the largest change available, and the workload's joins and transactions map poorly to it.
A:
Aurora MySQL keeps the engine, drivers and SQL while changing the storage and replication underneath: the cluster volume keeps six copies across three AZs and grows automatically, up to 256 TiB on supported engine versions, up to 15 Aurora Replicas read from that shared volume and double as failover targets with service typically restored in under 60 seconds, and AWS quotes up to five times the throughput of standard MySQL. RDS Multi-AZ standbys serve no reads and RDS read replicas each hold their own copy. Aurora PostgreSQL is an engine change, a larger RDS instance is a vertical ceiling, DynamoDB is a redesign, and Redshift is a warehouse for analytics. Choose plain RDS for small workloads or engines Aurora lacks, such as Oracle or SQL Server.
USAGE:
Always connect through the cluster endpoint rather than an instance endpoint, otherwise a failover leaves your application pointing at what is now a reader.

## aws-aurora-global-database | d2
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: LEAST operational overhead
Q:
A company's Aurora PostgreSQL cluster in Frankfurt must survive a full Regional outage with an RPO of about one second and an RTO of a few minutes, and users in Singapore need low-latency reads. Which solution meets these requirements with the LEAST operational overhead?
OPT: a *
Convert the cluster into an Aurora Global Database with a secondary cluster in Singapore and use managed failover if Frankfurt becomes unavailable.
OPT: b
Create an RDS cross-Region read replica in Singapore and promote it during an outage.
WHY:
Aurora PostgreSQL does not support cross-Region Aurora Replicas at all; where an engine-level cross-Region replica does exist (RDS, Aurora MySQL binlog) its lag is higher and less predictable, and promotion is manual and breaks the replication topology, so both the RPO and the hands-off requirement slip.
OPT: c
Deploy the cluster as a Multi-AZ DB cluster with reader instances in three Availability Zones.
WHY:
Multi-AZ protects against an Availability Zone failure inside one Region; it keeps no copy in another Region, so a Regional outage takes it down.
OPT: d
Run AWS DMS continuous replication from Frankfurt to a standalone Aurora cluster in Singapore.
WHY:
DMS needs a replication instance to size, patch and monitor, and its change-data-capture lag is seconds to minutes with no managed failover, so it is the most work for the weakest guarantee.
A:
Aurora Global Database is built for this: one primary Region and up to 10 read-only secondary Regions replicated through the storage layer with lag typically under a second, a global writer endpoint that survives a Region change, and a managed failover that promotes a secondary within a few minutes and adds the old Region back automatically once it recovers. Because replication is asynchronous, unplanned failover has a non-zero RPO measured in seconds; Aurora PostgreSQL can bound it with the rds.global_db_rpo parameter, and a planned switchover synchronises first for an RPO of zero. The distractors are all real replication tools that either stay inside one Region or leave promotion and monitoring to you.
USAGE:
Configure applications with the global writer endpoint from day one, so a switchover or failover needs no connection string change.

## aws-rds-backups-snapshots-pitr | d2
TOPIC: 4.3 Cost-optimized database
Q:
A developer ran an accidental DELETE on an RDS database 40 minutes ago and asks you to roll back; the team also asks whether taking more snapshots will raise the backup bill. What do you use, and what actually drives backup cost?
A:
Point-in-time restore depends on automated backups: RDS takes a daily snapshot and ships transaction logs to S3 every five minutes, so you can restore to any point inside the retention period, 0 to 35 days. On cost, backup storage is free up to the total provisioned database storage in the Region and snapshots are incremental, so more frequent snapshots barely move the bill; longer retention and manual snapshots do, because manual snapshots never expire, survive instance deletion and bill per GB until deleted. A cross-Region copy pays transfer plus destination storage. For cheap long-term analysis, export a snapshot to S3 as Parquet and query it with Athena. Automated backups vanish with the instance unless retained.
USAGE:
Take a manual snapshot before any risky migration, then delete it once the change is proven, because it bills until you do.

## aws-rds-cross-region-read-replica-dr | d2
TOPIC: 3.3 High-performing databases
QUALIFIER: LEAST amount of change
Q:
An RDS for PostgreSQL instance runs in the Asia Pacific (Sydney) Region. A growing user base in Ireland complains that read-heavy pages are slow; the business accepts reads that lag the primary by a few seconds, and all writes stay in Sydney. Which solution serves the Ireland users faster with the LEAST amount of change to the application and database?
OPT: a *
Create a cross-Region read replica of the instance in the Europe (Ireland) Region and route the application's read queries from Ireland to the replica's endpoint.
OPT: b
Convert the instance to a Multi-AZ DB instance deployment and send Ireland's read traffic to the standby.
WHY:
The Multi-AZ standby is a synchronous copy in another Availability Zone of the same Region: it never serves reads and it is still in Sydney, so latency for Ireland does not change.
OPT: c
Migrate the database to Amazon Aurora PostgreSQL and add a secondary cluster in Ireland with Aurora Global Database.
WHY:
Aurora Global Database is Aurora-only, so this is an engine migration plus new endpoints and cutover testing; it works, but it is the largest change on the list for a problem a read replica solves.
OPT: d
Deploy an Amazon ElastiCache cluster in Ireland in front of the Sydney database.
WHY:
A cache holds only what has already been read: every miss still crosses to Sydney, invalidation becomes the application's job, and the cache does not replicate the database, so the code change is larger and the latency win partial.
A:
Create a cross-Region read replica in Ireland and point local reads at it. RDS supports cross-Region replicas for PostgreSQL, replicates asynchronously (expect more lag than a same-Region replica, within the accepted seconds), and the only application change is a second connection string for reads. Multi-AZ is same-Region, synchronous and unreadable; Aurora Global Database needs an engine migration; a cache does not replicate. The replica doubles as disaster recovery: if Sydney fails you promote it, which stops replication, reboots it and leaves a standalone instance you then repoint traffic to and re-replicate from. Data transferred out of Sydney is charged on every change. Do not use it for reads that must be current: a replica is eventually consistent.
USAGE:
Rehearse the promotion in a test account so you know the replication lag, the reboot time and the DNS change before a real outage forces the decision.

## aws-dynamodb-global-tables | d3
TOPIC: 2.2 HA and fault tolerance
Q:
A mobile game must accept DynamoDB writes in both us-east-1 and eu-west-1, keep serving players if one Region is impaired, and fail over without an operator rebuilding anything. What does the full active-active design look like, and what does its conflict rule mean for the data model?
A:
Active-active means both Regions take live traffic all the time, so failover is routing, not rebuilding. Data layer: DynamoDB global tables replicate multi-active, every replica accepts reads and writes, and the default multi-Region eventual consistency mode replicates through DynamoDB Streams with last-writer-wins, so a concurrent write to the same item in two Regions silently discards one; design around it with idempotent writes or a home Region per player, keep a version attribute, and watch ReplicationLatency, which is your RPO. Multi-Region strong consistency removes the conflict but is single-account only, drops TTL and transactions, and adds write latency. Traffic layer: Route 53 latency or weighted records with health checks (Evaluate Target Health on alias records) or Global Accelerator send each player to the nearest healthy Region. Against warm standby this buys near-zero RPO and RTO at the highest cost: two full stacks, quotas raised in both Regions, and conflict handling in code. The distractor is a backup copied to another Region: disaster recovery, not active replication.
USAGE:
Store a version or last-updated attribute on each item so you can detect when last writer wins discarded a change during a Regional incident.

## aws-dynamodb-streams-and-ttl | d2
TOPIC: 4.3 Cost-optimized database
Q:
Session records must be archived to S3 when they expire without paying for the delete writes, and a reviewer asks which other stores bill forever unless retention is set. How do you build this, and what is the retention rule?
A:
Set a TTL attribute holding a Unix epoch timestamp in seconds: DynamoDB deletes expired items itself, typically within a few days, without consuming write throughput. Enable a stream with new and old images and attach a Lambda event source mapping to archive the old image; TTL deletes are marked as service deletes, so an event filter fires only for expirations. Expired items still appear in scans until the delete runs. The retention rule: every store needs an explicit setting or it bills forever. DynamoDB PITR bills per GB-month; RDS automated backups are free up to the provisioned storage and keep 0 to 35 days, but manual snapshots bill until deleted; CloudWatch Logs defaults to never expire; S3 needs expiration rules.
USAGE:
Store the TTL value in seconds, not milliseconds, or every item lands centuries in the future, nothing expires and the table bills for all of it.

## aws-s3-cross-region-replication | d2
TOPIC: 2.2 HA and fault tolerance
Q:
A compliance rule requires copies of a bucket's objects in a second Region, including objects uploaded last year. What must be true of both buckets, why does enabling CRR alone not satisfy the rule, and where does CRR sit among AWS replication mechanisms?
A:
Live replication, Cross-Region or Same-Region, requires versioning on both buckets plus an IAM role that S3 assumes to copy objects asynchronously; a rule copies only objects created after it exists, so last year's objects need an S3 Batch Replication job. Replicas may land in a cheaper class, the owner override can hand ownership to the destination account, delete markers are replicated only if you opt in, and deleting a specific version ID is never replicated, which protects the copy from malicious deletes; Replication Time Control adds an SLA that 99.99 percent of new objects arrive within 15 minutes. CRR is on the asynchronous side of a taxonomy worth knowing: synchronous replication (an RDS Multi-AZ standby, Aurora's six storage copies, S3 within a Region across three Availability Zones) gives an RPO of about zero but needs low latency, so it stays inside a Region; asynchronous replication (read replicas, S3 CRR, DynamoDB global tables, Aurora Global with lag typically under a second) spans Regions at a seconds-to-minutes RPO. Either kind propagates deletes and corruption, so it complements backups and never replaces them.
USAGE:
After enabling a rule, check the ReplicationStatus of a few source objects; a FAILED status usually means the destination lost versioning or the role lacks permissions.

## aws-s3-versioning-and-mfa-delete | d1
TOPIC: 1.3 Data security controls
Q:
An operator accidentally deleted objects from a bucket. What makes that recoverable, and what stops the same thing happening under stolen credentials?
A:
With versioning enabled, a DELETE without a version ID removes nothing; S3 inserts a delete marker that becomes the current version, and deleting the marker brings the object back. Overwrites create new versions instead of replacing the old one. Once enabled, versioning can only be suspended, never returned to unversioned. MFA delete adds a second factor to permanently deleting a version or changing the versioning state; only the bucket owner's root account can enable it, and only through the CLI or API, not the console. The trap is believing versioning alone blocks permanent deletes: a delete that names a version ID still succeeds without MFA delete.
USAGE:
Every version is billed as a full object, so pair versioning with a lifecycle rule that expires noncurrent versions or the bill grows silently.

## aws-s3-durability-availability | d1
TOPIC: 2.2 HA and fault tolerance
Q:
A team wants to keep the only copy of scanned contracts in S3 One Zone-IA because the console shows the same eleven nines of durability as S3 Standard at a lower price. What is the difference between durability and availability, why is this the wrong class for a primary copy, and how do other storage services compare?
A:
Durability is the chance data survives; availability is the chance you can read it now. Every mainstream S3 class including One Zone-IA is designed for 99.999999999 percent (eleven nines) durability, while availability varies: Standard 99.99, Standard-IA and Intelligent-Tiering 99.9, One Zone-IA 99.5 percent; most classes spread objects across at least three Availability Zones and survive losing one, but One Zone-IA keeps a single zone, so it suits only recreatable data such as replicas, and choosing it for a primary copy because it shows the same eleven nines is the trap. Other services differ sharply: EFS is also eleven nines, though EFS One Zone data can be lost with its zone; EBS gp2, gp3, io1, st1 and sc1 volumes are 99.8 to 99.9 percent (a 0.1 to 0.2 percent annual failure rate) and only io2 Block Express reaches 99.999; instance store promises nothing; Aurora writes six copies across three zones. Durability protects against media loss, not against deletes or corruption, which replicate faithfully, so versioning and backups remain mandatory.
USAGE:
Durability figures protect against hardware loss, not against your own mistaken deletes; that is what versioning and replication are for.

## aws-sqs-fifo-vs-standard | d2
TOPIC: D2 services
Q:
An order system must apply price updates for each product in the order they were sent and must never process the same update twice. Standard or FIFO queue, and what does the choice cost you?
A:
Choose FIFO. Standard queues give nearly unlimited throughput but only at-least-once delivery and best-effort ordering, so consumers must be idempotent and tolerate reordering. FIFO queues keep strict order within each message group ID and give exactly-once processing: a SendMessage retry carrying the same MessageDeduplicationId within the 5 minute deduplication window is accepted but not delivered again, and content-based deduplication can derive that ID from a SHA-256 hash of the body. The cost is throughput: 300 API calls per second per action without batching, 3,000 messages per second with batching, more only in high throughput mode. Use one group per product so unrelated products still process in parallel. The trap is a standard queue with reordering logic in the consumer.
USAGE:
Make the deduplication ID an order or event identifier you control, because a timestamp or random UUID defeats deduplication on retries.

## aws-sqs-long-polling | d1
TOPIC: 2.1 Loosely coupled architectures
Q:
A worker fleet polls an SQS queue in a tight loop and the bill shows millions of empty ReceiveMessage responses. What setting fixes it, and why does it help?
A:
Turn on long polling by setting ReceiveMessageWaitTimeSeconds on the queue, or WaitTimeSeconds on each ReceiveMessage request, to a value above zero, up to the maximum of 20 seconds. With the default of zero, short polling samples only a subset of SQS servers and answers immediately, so it returns empty responses even when messages exist elsewhere, and every one of those responses is a request you pay for. Long polling queries all servers and holds the connection until at least one message arrives or the wait expires, so consumers receive messages sooner and issue far fewer requests. The trap is choosing a longer visibility timeout or a delay queue, which control when a message is hidden, not how often you poll.
USAGE:
Pair long polling with a receive batch of up to ten messages so each round trip carries several messages instead of one.

## aws-sqs-message-retention-and-size | d1
TOPIC: 2.1 Loosely coupled architectures
Q:
A producer needs to enqueue 5 MB documents, and consumers may be offline for a week. Which SQS defaults get in the way, and what do you change?
A:
SQS keeps a message for 4 days by default; retention runs from 60 seconds to 14 days, so raise it when consumers lag. Bodies have a hard size cap: 256 KB for years, and the figure exam questions still use, though the current quota is 1 MiB. A 5 MB document needs the SQS Extended Client Library, which stores the payload in S3 and sends only a reference, allowing payloads up to 2 GB. A delay queue is a different control: DelaySeconds hides a new message for up to 15 minutes after it is sent, whereas visibility timeout hides it after it is received. The trap is a queue attribute that lifts the body limit; none exists.
USAGE:
Put a lifecycle rule on the S3 bucket used by the Extended Client so orphaned payloads from deleted messages do not accumulate.

## aws-sns-fanout-filtering | d2
TOPIC: 3.2 Elastic compute
Q:
An e-commerce platform emits an order event for every purchase. The fulfilment, analytics and fraud teams each consume the events, must scale and fail independently of one another, and the fraud team wants only orders above a value threshold. Which combination of steps delivers the events this way? (Choose two.)
OPT: a *
Publish every order event once to an SNS topic.
OPT: b *
Subscribe one SQS queue per team to the topic, put a filter policy on the fraud queue's subscription, and scale each team's consumers on its own queue depth.
OPT: c
Create one SQS queue that the producer writes to and let all three teams poll it.
WHY:
A queue delivers each message to one consumer and deletes it after processing, so the three teams would compete for the same events instead of each receiving every one, and a slow team would starve the others.
OPT: d
Subscribe each team's Lambda function directly to the SNS topic with no queue in between.
WHY:
SNS hands each event to the function's own asynchronous queue, which retries a failing invocation twice and holds a throttled event for at most six hours before discarding it, so a team whose consumer is down for an afternoon loses orders; nothing here filters the fraud team's events either, so this option cannot complete the pair.
OPT: e
Write the events to a Kinesis Data Stream and have a single consumer application dispatch them to the three teams.
WHY:
A single dispatcher recreates the coupling the requirement forbids: its failure or backlog stops all three teams at once, and a stream's shard-based consumers are a different model from three independent pull queues.
OPT: f
Model the three consumers as parallel branches of a Step Functions state machine started for each order.
WHY:
Step Functions orchestrates a workflow you own end to end; it does not give three teams independently scaling, independently failing subscriptions, and a failed branch fails the execution rather than one team's queue.
A:
Publish once to an SNS topic and subscribe one SQS queue per consumer: fan-out copies each message to every subscriber, and each queue buffers and retries for its own team, so fulfilment can fall behind without slowing analytics. By default every subscriber gets every message, so a filter policy on the fraud subscription, matched against message attributes or the body, delivers only orders above the threshold and removes filtering code from that consumer. When ordering matters, an SNS FIFO topic feeding SQS FIFO queues preserves order and deduplication per message group. The traps are a single shared queue, which consumes each message once, and SNS pushing straight to consumers, which retries for a while but never lets a consumer drain a backlog at its own pace.
USAGE:
Put the fields you plan to filter on into message attributes at publish time; adding them later means changing every producer.

## aws-lambda-retries-and-destinations | d3
TOPIC: 2.1 Loosely coupled architectures
Q:
A Lambda function fails intermittently. Why does the same code seem to retry twice when triggered by S3, never when called through API Gateway, and endlessly when reading a Kinesis stream?
A:
Retry behaviour belongs to the invoker. Asynchronous invokers such as S3 and SNS queue the event inside Lambda; on a function error Lambda tries twice more, then discards the event unless a DLQ or on-failure destination catches it. A destination (SQS, SNS, Lambda, EventBridge, S3 for failures) gets the full invocation record with the response; a DLQ carries only the event. Synchronous callers like API Gateway get the error back and choose whether to retry. Stream sources retry the batch until it succeeds or the records expire, blocking the shard; an SQS source returns messages after the visibility timeout and uses the queue's redrive policy. The async queue can deliver an event more than once, so handlers must be idempotent.
USAGE:
Never attach a DLQ to a function triggered by an SQS queue; configure the redrive policy on the source queue instead, or failures land nowhere useful.

## aws-lambda-concurrency-reserved-provisioned | d2
TOPIC: 2.2 HA and fault tolerance
Q:
A payment Lambda function is being throttled because a noisy batch function in the same account is using all the available concurrency. Do you set reserved or provisioned concurrency, what does each change, and why does the fix not carry over to your disaster recovery Region?
A:
All functions in a Region draw from one shared pool, 1,000 concurrent executions by default, so a busy neighbour can starve a critical function. Reserved concurrency carves out a slice only that function may use and is also a hard ceiling; it costs nothing. Provisioned concurrency pre-initialises execution environments to remove cold starts and is billed; choosing it to fix throttling is the trap, because it addresses latency, not the shared quota. That pool is one service quota among many, and quotas apply per account per Region (Lambda concurrency, EC2 On-Demand vCPUs, five Elastic IP addresses, load balancers), so a standby Region starts at the defaults: request the same increases there before a disaster, use a Service Quotas request template so new accounts in the Organization get them automatically, and monitor utilisation so you are notified before a quota is hit. API throttling is a separate mechanism from quotas: retry with exponential backoff and jitter, and remember that a reserved-concurrency cap doubles as a throttle for a fragile downstream.
USAGE:
Reserve concurrency on a function that calls a fragile downstream such as a small database, because the cap doubles as a throttle that protects it.

## aws-dr-strategies-rpo-rto | d2
TOPIC: 2.2 HA and fault tolerance
Q:
A workload may lose no more than a few minutes of data, but the business accepts a recovery time measured in hours rather than seconds. Which disaster recovery strategy fits, and why not its cheaper or dearer neighbours?
A:
Set the recovery point objective (tolerable data loss) and recovery time objective (tolerable outage) from a business impact analysis before choosing. The four strategies then rise in cost as RPO and RTO fall: backup and restore, pilot light, warm standby, multi-site active/active. Pilot light fits here: data replicates continuously to a live database in the recovery Region, giving a low RPO, while application servers are provisioned but switched off, so recovery means starting and scaling them, which takes time. Warm standby keeps a scaled-down copy running and can serve traffic immediately, more than this business needs. Periodic backups alone would miss the RPO. The trap: pilot light cannot serve requests without action first, warm standby can.
USAGE:
Write the agreed RPO and RTO into the runbook and rehearse a failover against them, because an untested strategy is only a cost line.

## aws-backup-service | d2
TOPIC: 1.3 Data security controls
Q:
A team scripts EBS, RDS and DynamoDB backups separately and cannot prove retention; the same team lost a table to an accidental delete last month. Which service replaces the scripts, and how do you match each recovery need to a mechanism?
A:
AWS Backup: a plan sets schedule and retention, resources join by tag, recovery points sit in vaults, copyable to another Region or account, and Organizations pushes one policy everywhere. Match need to mechanism: accidental overwrite or delete is S3 Versioning or point-in-time recovery, which RDS and DynamoDB keep for at most 35 days; an image of one moment is a snapshot; loss of a Region is a cross-Region copy; "even an administrator cannot delete" means Backup Vault Lock in compliance mode, immutable once its grace time of at least 72 hours ends, or compliance-mode S3 Object Lock, which root cannot undo at all. Backup frequency sets your RPO; AWS Backup does not govern snapshots taken elsewhere.
USAGE:
Check every recovery point's retention before locking a vault in compliance mode, because anything retained indefinitely becomes permanent and billed forever.

## aws-multi-az-vs-multi-region | d1
TOPIC: 2.2 HA and fault tolerance
Q:
When is deploying across multiple Availability Zones enough, when does a workload genuinely need a second Region, and what do those choices cost in data transfer and instance pricing?
A:
Availability Zones are separate data centre groups inside one Region, linked by low-latency fibre so synchronous replication works, and Multi-AZ is the default high-availability design. Regions are isolated and replicate nothing automatically, so a second Region is what survives a Regional outage, meets residency rules or serves distant users, at the price of asynchronous lag. The cost side: traffic between AZs costs $0.01 per GB each direction and between Regions about $0.02 per GB, while the same AZ over private IPs is free; instance prices differ per Region, an m5.large being $0.096 an hour in N. Virginia and $0.153 in Sao Paulo; Spot prices are set per instance type per AZ, so spreading across AZs cuts cost and interruptions.
USAGE:
Check that the database, queue and cache tiers are each Multi-AZ as well, because one single-AZ dependency undoes the resilience of the compute layer.

## aws-cloudfront-origin-failover | d2
TOPIC: 2.2 HA and fault tolerance
Q:
A static site served by CloudFront from an S3 bucket must keep serving if that bucket's Region has problems. How do you make CloudFront fall back, and what exactly triggers the fallback?
A:
Create an origin group of a primary and a secondary origin and assign it to the cache behaviour. On a cache miss CloudFront tries the primary; if it returns a status code you listed as failover criteria (such as 500, 502, 503 or 504), or cannot be reached or times out once 503 and 504 are listed, CloudFront retries the same request against the secondary. Failover is per request, the next one goes to the primary again, and only GET, HEAD and OPTIONS qualify. For a static site, replicate the bucket with S3 Cross-Region Replication so both origins hold the same objects. The trap is expecting one origin's connection retries to do this; only an origin group reroutes.
USAGE:
Lower the primary origin's connection timeout and attempts for latency-sensitive content, otherwise viewers wait through every retry before the secondary is tried.

## aws-ecs-fargate-vs-ec2-launch | d2
TOPIC: D2 services
Q:
One team needs GPU containers on reserved capacity, another has a spiky API and nobody to patch hosts. Which ECS launch type suits each, what are Fargate's hard limits, and how do the containers get AWS permissions in both cases?
A:
Fargate is serverless: you declare CPU and memory per task from 0.25 vCPU with 512 MiB up to 32 vCPU with 244 GB, get 20 GiB of ephemeral storage by default and up to 200 GiB on request, run Linux or Windows containers with each task isolated on its own kernel, and pay per second only while the task runs, which suits the spiky API; Fargate Spot takes interruption-tolerant tasks at a discount. Its exclusions decide the other team: a Fargate task definition cannot request a GPU or a privileged container, so GPU containers on reserved capacity use the EC2 launch type, where you manage the instances but gain instance choice, custom AMIs and dense packing that is cheaper at steady scale. Either way give containers a task IAM role rather than the instance profile: the SDK in the container uses the task role exclusively, so each service gets least privilege, and Fargate has no instance profile at all. The trap is EC2 for bursty traffic, or application permissions on the instance role.
USAGE:
Create one task role per service with only the permissions that service needs, rather than one broad role shared across a cluster.

## aws-eks-vs-ecs | d1
TOPIC: D2 services
Q:
When do you choose Amazon EKS over Amazon ECS for a containerised workload, given that both can run on Fargate, and what do you still have to choose once you pick EKS?
A:
Choose EKS when the requirement says Kubernetes: a team with Kubernetes skills, manifests or Helm charts, or a need to stay portable to other clouds or on-premises clusters; EKS is certified Kubernetes-conformant and AWS runs the control plane. Its building blocks are what you pick after that: nodes as managed node groups (AWS-optimised AMIs with one-click updates), self-managed instances, Fargate profiles for hostless pods, EKS Auto Mode that also runs the data plane, or hybrid nodes on-premises; add-ons such as the VPC CNI, CoreDNS, kube-proxy and the EBS and EFS CSI drivers; IAM per pod by mapping Kubernetes service accounts to roles (IAM roles for service accounts or Pod Identity); and Karpenter or the Cluster Autoscaler for scaling. Choose ECS otherwise: simpler, AWS-native, no per-cluster charge and no Kubernetes upgrade cadence. Fargate is a capacity choice under either orchestrator, not the deciding factor. The trap is EKS as the stronger default: Kubernetes or portability signals EKS, their absence points to ECS.
USAGE:
Do not adopt EKS just to keep options open; the recurring cluster upgrades need an owner, which small teams often lack.

## aws-elastic-ip-and-eni-failover | d2
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: LEAST amount of change
Q:
A licensing server runs on one EC2 instance. Hundreds of factory-floor clients have its public IP address hard-coded in firmware and never resolve DNS. The company adds a standby instance in the same VPC and wants failover to be automatic. Which solution meets the requirement with the LEAST amount of change to the clients?
OPT: a *
Associate an Elastic IP address with the active instance and use a CloudWatch alarm on StatusCheckFailed_System that invokes a Lambda function to reassociate the Elastic IP with the standby.
OPT: b
Create a Route 53 failover record set with health checks for the primary and standby instances.
WHY:
Failover records only change what a DNS query returns; clients that never resolve DNS keep sending packets to the old address, so nothing fails over.
OPT: c
Put both instances behind an Application Load Balancer and point the clients at the load balancer.
WHY:
An ALB has no static IP; its addresses change over time and the clients would have to be re-flashed with a DNS name, which is the opposite of least change.
OPT: d
Put both instances behind a Network Load Balancer, which provides static IP addresses.
WHY:
The NLB's static IPs are new addresses, not the one already burned into the clients, so every client still needs a change.
A:
Keep the address the clients already know by moving an Elastic IP: it is a static public IPv4 address owned by the account and can be reassociated to the standby in seconds, so a StatusCheckFailed_System alarm plus a small automation masks the failure with no DNS or client change. An Elastic IP moves only the public address; when clients use a private IP, or the MAC address and security groups must follow, attach a secondary network interface to a hot standby in the same Availability Zone instead, because a primary interface cannot be detached and an interface cannot cross zones. Route 53 failover, an ALB and an NLB each present a different address or a DNS name, so each forces a change on every client.
USAGE:
Close active connections before moving an Elastic IP and script the interface attach so failover is a single command, not a console hunt.

## aws-eventbridge-archive-replay | d2
TOPIC: D2 services
Q:
A Lambda target silently mishandled a week of order events because of a bug. How can EventBridge let you reprocess those events after the fix, what must already be in place, and where does EventBridge stop being the right tool?
A:
An archive must already be attached to the bus; it keeps matching events for the retention you set, indefinitely by default, and after the fix you replay a time window to every rule or only the rules you name; replayed events carry a replay-name field and may arrive out of order, so targets must be idempotent. The model around that: the default bus receives AWS service events, custom buses take your own and partner buses take SaaS events; rules match on event content and route to targets with retries for up to 24 hours and 185 attempts using exponential backoff and jitter, after which a dead-letter queue keeps what could not be delivered. That DLQ is the trap: it holds events EventBridge could not deliver, not events a target accepted and mishandled. Scheduler runs cron and rate schedules at scale; Pipes joins a source such as SQS, Kinesis or DynamoDB Streams to a target with filtering and enrichment. Not for high-volume streaming (Kinesis), ordered buffering (SQS FIFO) or plain push fan-out where SNS is cheaper.
USAGE:
Wait about ten minutes after the incident window before replaying, because events can lag on their way into the archive and an early replay may miss the tail.

## aws-rds-multi-az-cluster-vs-instance | d3
TOPIC: D2 services
Q:
A team on RDS for PostgreSQL wants automatic failover and also wants to send reporting queries to a standby. Do they choose a Multi-AZ DB instance or a Multi-AZ DB cluster, why, and what does RDS itself give and withhold?
A:
A Multi-AZ DB instance keeps one synchronous standby in a second Availability Zone purely for failover; it cannot serve reads, and failover typically takes 60 to 120 seconds. A Multi-AZ DB cluster runs a writer plus two readers across three zones with semisynchronous replication, where a commit needs one reader's acknowledgement; both readers are failover targets and serve reads, and failover is typically under 35 seconds, so it is the answer here. The trap is "add a read replica", which is asynchronous and gives no automatic failover; Multi-AZ DB clusters exist only for RDS for MySQL and PostgreSQL. Step back to what RDS is: managed MySQL, PostgreSQL, MariaDB, Oracle, SQL Server and Db2 with automated backups kept 0 to 35 days, patching, encryption, IAM authentication and storage that autoscales up to 64 TiB (16 TiB for SQL Server), in exchange for no OS or shell access and only engine-level features. It is the wrong pick for key-value scale (DynamoDB), for engines or extensions RDS does not offer (run them on EC2), and when Aurora's six-copy storage and sub-minute failover justify its price.
USAGE:
If write latency on a Multi-AZ DB instance is the complaint, a Multi-AZ DB cluster typically commits faster because it waits for only one of the two readers rather than a fully synchronous standby.

## aws-elasticache-redis-cluster-mode-and-multi-az | d2
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: HIGHEST availability
Q:
A web tier keeps user sessions in a single-node ElastiCache for Redis OSS cache. When the node was replaced last month every user was logged out and an engineer updated the endpoint by hand. Which change gives the session store the HIGHEST availability with automatic recovery?
OPT: a *
Recreate the cache as a replication group with at least one read replica in a different Availability Zone, enable Multi-AZ with automatic failover, and point the application at the primary endpoint.
OPT: b
Move the sessions to an ElastiCache for Memcached cluster with several nodes.
WHY:
Node-based Memcached has no replication, automatic failover or backup, so a lost node still loses its share of sessions and nothing promotes a copy.
OPT: c
Scale the single node to a larger node type.
WHY:
A bigger node is still one node in one Availability Zone; it changes capacity, not the number of failure points.
OPT: d
Enable daily automatic backups so the cache can be restored after a failure.
WHY:
A snapshot restore is manual, builds a new cluster and loses every session written since the backup, so it neither recovers automatically nor keeps users logged in.
A:
A Valkey or Redis OSS replication group with a replica in another Availability Zone and Multi-AZ automatic failover removes the single point of failure: when the primary fails ElastiCache promotes the replica with the least replication lag, typically within seconds, and repoints the primary endpoint's DNS, so an application that uses that endpoint needs no change. Replication is asynchronous, so a little data can be lost at failover. For a dataset larger than one node, cluster mode enabled shards the keyspace across node groups, each with its own primary and replicas, and supports online resharding. Memcached, a bigger node and backups each solve a different problem and leave the single point of failure in place.
USAGE:
Point clients at the primary endpoint rather than an individual node address, so a failover needs no application change.

## aws-ebs-snapshot-cross-region-copy-and-dlm | d2
TOPIC: 4.1 Cost-optimized storage
Q:
A company must keep nightly EBS backups for 30 days and hold a copy in a second Region for disaster recovery, with no custom scripting. What do you set up, and why does the first cross-Region copy cost more than later ones?
A:
EBS snapshots are incremental, point-in-time backups held in S3 buckets you cannot access directly; only blocks changed since the previous snapshot are stored, and the data is replicated across every Availability Zone in the Region. Amazon Data Lifecycle Manager automates creation, retention and deletion of snapshots and EBS-backed AMIs on a schedule, at no additional cost, and its policies can copy backups to other Regions or accounts for disaster recovery. The first copy into a new Region is a full copy; later copies are incremental only while the previous copy still exists there with the same encryption key. The trap is assuming a snapshot alone survives a Region outage: it stays in one Region until copied.
USAGE:
Deleting old snapshots saves less than expected, because blocks still referenced by a newer snapshot are kept and billed.

## aws-ec2-auto-recovery-and-status-checks | d2
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: LEAST amount of change
Q:
A legacy licensing application runs on a single EBS-backed EC2 instance whose licence key is bound to the instance ID and private IP address. Last quarter the underlying host failed and the instance was unreachable for hours. The company wants automatic recovery from host failure. Which solution meets this with the LEAST amount of change?
OPT: a *
Keep the instance as it is and rely on EC2 automatic recovery, backed by a CloudWatch alarm on StatusCheckFailed_System with the recover action, so a host failure moves the instance to new hardware.
OPT: b
Put the instance in an Auto Scaling group with minimum, desired and maximum capacity of 1.
WHY:
The group replaces a failed instance with a new one that has a new instance ID and private IP, which breaks the licence binding unless extra automation re-attaches an ENI or Elastic IP, and simplified automatic recovery is disabled for instances in an Auto Scaling group.
OPT: c
Enable a Multi-AZ deployment for the instance so a standby in another Availability Zone takes over.
WHY:
Multi-AZ standby deployments exist for RDS and other managed services, not for EC2 instances; there is no such setting to enable.
OPT: d
Create a daily AMI and restore the instance from it when the host fails.
WHY:
Restoring from an image is a manual step that produces a new instance ID and private IP and loses up to a day of changes, so it is neither automatic nor free of change.
A:
Automatic recovery is the least-change answer because a recovered instance is the same instance: it keeps its instance ID, private, public and Elastic IP addresses, metadata and attached EBS volumes, and to the operating system the migration looks like an unplanned reboot; only RAM contents and uptime are lost. It reacts to a failed system status check (host power, network or hardware), never to a failed instance status check (guest problems such as a full disk or bad kernel), and simplified recovery is on by default for supported types but not for metal sizes, instance-store volumes, Dedicated Hosts or Auto Scaling members; the CloudWatch recover action covers some of those cases. An Auto Scaling group of one, a nonexistent Multi-AZ switch and AMI restores all change the identity or need a human.
USAGE:
Recovery restores a single instance; put it behind a load balancer or Auto Scaling group anyway, because one recovered host is not a highly available system.

## aws-aurora-backtrack-and-cloning | d1
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: FASTEST
Q:
A deployment at 09:40 ran a migration that corrupted rows in an RDS for MySQL Multi-AZ DB instance that has automated backups with 7-day retention and one read replica. The team wants the application back on a database in the state it was in at 09:30. What is the FASTEST way to get there?
OPT: a *
Restore the DB instance to 09:30 with point-in-time recovery, which creates a new DB instance, then repoint the application to the new endpoint.
OPT: b
Restore the most recent daily automated snapshot to a new DB instance and repoint the application.
WHY:
A snapshot is a once-a-day copy, so restoring it loses every write since the last backup window, up to a full day, instead of the ten minutes the team can afford.
OPT: c
Promote the read replica to a standalone DB instance and repoint the application.
WHY:
The replica applied the same corrupting statements asynchronously seconds after the primary did, so it holds the bad rows too.
OPT: d
Reboot the DB instance with failover so the Multi-AZ standby takes over.
WHY:
The standby is a synchronous copy of the primary, corruption included; failover changes which host serves the data, not what the data is.
A:
Point-in-time recovery is the only option that actually reaches 09:30: RDS keeps automated snapshots plus transaction logs uploaded every five minutes, so anywhere inside the retention window (1 to 35 days; 0 switches automated backups off) you can restore to any second, always into a new DB instance whose endpoint the application must then use. Snapshots, replicas and Multi-AZ standbys all carry the corruption forward because they copy data, not time. On Aurora MySQL the faster undo is Backtrack, which rewinds the existing cluster in place up to 72 hours with no endpoint change, but it must have been enabled when the cluster was created or restored from a snapshot, cannot be switched on later, and does not exist for RDS or Aurora PostgreSQL; Aurora cloning is the copy-on-write way to get a production-sized test copy in minutes instead of restoring a backup.
USAGE:
Check LatestRestorableTime before promising a recovery point: the last few minutes of transaction log may not have been uploaded yet, and on Aurora stop application writes before backtracking because it discards uncommitted work.

## aws-ebs-volume-types | d2
TOPIC: 3.1 High-performing storage
QUALIFIER: HIGHEST performance
Q:
A latency-sensitive OLTP database on a Nitro-based EC2 instance needs 120,000 sustained IOPS on one volume with consistent sub-millisecond latency, and the data must survive instance stops. Which storage option delivers the HIGHEST performance for this requirement?
OPT: a *
A Provisioned IOPS SSD io2 Block Express volume provisioned with 120,000 IOPS.
OPT: b
A General Purpose SSD gp3 volume with additional provisioned IOPS and throughput.
WHY:
gp3 tops out at 80,000 IOPS and 2,000 MiB/s per volume and offers single-digit millisecond latency, so it can reach neither 120,000 IOPS nor the sub-millisecond target.
OPT: c
A Throughput Optimized HDD st1 volume sized for the database.
WHY:
st1 is built for large sequential streams and caps at 500 IOPS per volume; it is the right service but the wrong volume type for random IOPS, and it cannot even be a boot volume.
OPT: d
An instance store NVMe volume on a storage-optimised instance type.
WHY:
Instance store is fast but its data is gone when the instance stops or the host fails, which violates the persistence requirement.
A:
io2 Block Express is the only choice that satisfies both numbers: up to 256,000 IOPS and 4,000 MiB/s on one volume, average latency under 500 microseconds, 99.999 percent durability, and it persists independently of the instance. gp3 is the default for everything below its 80,000 IOPS ceiling, with a baseline of 3,000 IOPS and 125 MiB/s included and no burst credits, unlike gp2 whose performance scales with size; st1 and sc1 are HDDs for sequential streams and cold data, offer hundreds of IOPS and cannot boot an instance; instance store is scratch space. Related traps: EFS is shared file storage rather than a block device, and Multi-Attach shares an io2 volume without raising its ceiling.
USAGE:
Moving gp2 to gp3 is an online Elastic Volumes change that usually lowers cost and removes burst-credit surprises.

## aws-ebs-multi-attach-io2 | d3
TOPIC: 3.1 High-performing storage
Q:
Two EC2 instances in the same Availability Zone must both read and write a single block volume for a clustered database. Can EBS do this, and why is it not simply shared storage like EFS?
A:
Yes, with Multi-Attach: an io1 or io2 volume can attach to several Nitro-based instances in the same Availability Zone, each with full read and write access. It is raw block storage with no coordination, so the instances need a cluster-aware file system or an application that manages write ordering; plain XFS or ext4 mounted from both sides corrupts data. io2 supports NVMe reservations for I/O fencing, io1 does not. Multi-Attach volumes cannot be boot volumes or cross zones, and gp2, gp3, st1 and sc1 do not support it. The trap is picking Multi-Attach for ordinary shared files across many instances or zones: that job belongs to EFS, a managed NFS service which handles concurrency.
USAGE:
Set delete-on-termination the same way on every attached instance; the last instance terminated decides whether the shared volume is deleted.

## aws-efs-performance-and-throughput-modes | d2
TOPIC: 3.1 High-performing storage
QUALIFIER: LEAST operational overhead
Q:
Several hundred Linux web servers spread across three Availability Zones must share one POSIX file system for uploaded assets. Load is spiky and hard to forecast, and the team has no capacity to tune storage. Which solution meets these requirements with the LEAST operational overhead?
OPT: a *
Create an EFS Regional file system with General Purpose performance mode and Elastic throughput, and mount it from every server.
OPT: b
Create an io2 volume with Multi-Attach enabled and attach it to all the servers.
WHY:
Multi-Attach allows at most 16 Nitro instances in a single Availability Zone and needs a cluster-aware file system; it cannot span three zones or hundreds of servers.
OPT: c
Create an EFS file system with Provisioned throughput set to the expected peak.
WHY:
Provisioned throughput is billed at the level you set whether or not it is used and must be re-tuned as load changes, so an unknown, spiky curve either pays for idle throughput or throttles at peaks.
OPT: d
Mount the assets bucket on every server with Mountpoint for Amazon S3.
WHY:
Mountpoint gives a file interface to S3 but cannot modify existing files or use file locking, so it is not a POSIX file system for read-write shared assets.
A:
EFS Regional with General Purpose mode and Elastic throughput needs no tuning: a serverless NFS file system that stores data across multiple Availability Zones, mounts on many Linux clients at once, gives the lowest per-operation latency, and scales throughput up and down automatically while billing only for data moved, which is exactly what a spiky, unforecastable load wants. Max I/O is a previous-generation mode with higher latency that cannot pair with Elastic throughput; Provisioned fixes a level you must manage; Bursting ties throughput to stored size through credits and starves small busy file systems. Multi-Attach and Mountpoint solve single-zone block sharing and read-heavy S3 access respectively, and FSx for Lustre is the HPC pick when raw throughput, not simplicity, is the requirement.
USAGE:
If a Bursting-mode file system slows down as it empties, switch to Elastic rather than padding it with dummy files to raise the baseline.

## aws-fsx-windows-vs-lustre-vs-ontap | d2
TOPIC: 3.1 High-performing storage
Q:
Windows home directories on Active Directory, an ML job reading an S3 dataset at speed, and a NetApp migration needing NFS and SMB. Which FSx flavour serves each, and where do S3, EFS and EBS fit?
A:
FSx for Windows File Server: SMB with Windows ACLs and Active Directory, Single-AZ or Multi-AZ. FSx for Lustre: POSIX, Linux-only, built for HPC and ML; link it to an S3 bucket and the objects appear as files. FSx for NetApp ONTAP: NFS, SMB and iSCSI from one file system with snapshots and SnapMirror, for NetApp migrations. Around them: S3 for objects over HTTP at unlimited scale; EFS when many Linux hosts across AZs share one POSIX file system over NFS; EBS for one instance's low-latency block volume for boot or a database. Traps: EFS is NFS and Linux only, so Windows or SMB means FSx; an EBS volume lives in one AZ and attaches to one instance, unless io1 or io2 Multi-Attach shares it with up to 16 Nitro instances in that AZ.
USAGE:
FSx for Windows shares are also reachable from Linux clients over SMB, so a mixed fleet does not automatically force you onto ONTAP.

## aws-s3-performance-prefixes-multipart | d3
TOPIC: 3.1 High-performing storage
Q:
A data pipeline writes millions of small objects per hour plus a few 20 GB files into one S3 bucket under a single date prefix and has started receiving HTTP 503 Slow Down errors. Volume will grow tenfold next quarter. Which two changes should a solutions architect recommend to stop the errors and speed up the large uploads without adding unnecessary resources? (Choose two.)
OPT: a *
Distribute object keys across many prefixes, for example by hashing an identifier into the key, so writes spread over several partitions.
OPT: b
Split the data across additional buckets in the same Region.
WHY:
Request capacity scales per prefix, not per bucket, and there is no limit on prefixes within a bucket, so extra buckets add operational sprawl without adding anything that prefixes do not.
OPT: c *
Upload the 20 GB files with multipart upload so parts transfer in parallel and only a failed part is retried.
OPT: d
Enable S3 Transfer Acceleration on the bucket.
WHY:
Transfer Acceleration routes uploads through CloudFront edge locations to shorten geographic distance; it does nothing for request rate on a hot prefix, so the 503 errors continue.
OPT: e
Open a Service Quotas request to raise the bucket's requests-per-second limit.
WHY:
There is no per-prefix or per-bucket request quota to raise; S3 scales prefixes automatically and the 503 errors are the signal that it is still partitioning.
A:
Spread keys across prefixes and use multipart for the large files. S3 supports at least 3,500 PUT, COPY, POST or DELETE and 5,500 GET or HEAD requests per second per partitioned prefix with no limit on the number of prefixes, so ten prefixes give ten times the capacity; 503 Slow Down under one hot prefix means S3 is still scaling that partition, and a key layout with many prefixes stops it recurring. Multipart upload is recommended from 100 MB, mandatory above the 5 GB single PUT ceiling (an object can reach 50 TB), and uploads parts in parallel; byte-range GETs do the same for downloads. Extra buckets, Transfer Acceleration and quota requests each target a limit that does not exist here.
USAGE:
Add a lifecycle rule with AbortIncompleteMultipartUpload, because abandoned parts are billed as storage until the upload is completed or aborted.

## aws-s3-transfer-acceleration | d1
TOPIC: 3.1 High-performing storage
Q:
Users on several continents upload large video files to one S3 bucket in us-east-1 and complain about slow uploads. Which S3 feature helps, and what does it not fix?
A:
Enable S3 Transfer Acceleration on the bucket and point clients at the bucket-name.s3-accelerate.amazonaws.com endpoint. Data then enters the nearest CloudFront edge location and travels to the bucket over an optimised AWS network path instead of the public internet, which is why it helps clients that are far from the bucket Region or cannot fill their available bandwidth. It is a bucket-level setting, the bucket name must not contain periods, and it adds a data transfer charge. It does not replace multipart upload: acceleration shortens the network path, multipart parallelises a single large object, and the two can be combined. The exam distractor is suggesting acceleration for clients in the same Region, where it gains little.
USAGE:
Run the Transfer Acceleration Speed Comparison tool from where your clients actually are before enabling it, since the gain depends entirely on distance and route quality.

## aws-s3-select-and-athena | d2
TOPIC: 3.5 Data ingestion and transformation
QUALIFIER: MOST cost-effective
Q:
An analytics team queries years of CSV application logs in S3 with Athena, and the per-query bill grows with the data. New logs arrive daily. Which change cuts the scan cost in the MOST cost-effective way?
OPT: a *
Run a scheduled AWS Glue ETL job that converts the logs to compressed, partitioned Parquet, and point Athena at the Parquet table.
OPT: b
Launch an Amazon EMR cluster running Spark to convert the logs to Parquet each night.
WHY:
EMR converts files just as well, but you pay for and operate a cluster for a daily job that a serverless Glue job runs per DPU-second with nothing to patch or scale; the idle time and operations make it the dearer route.
OPT: c
Replace the Athena queries with S3 Select expressions against the log objects.
WHY:
S3 Select filters one CSV, JSON or Parquet object per request and cannot join or aggregate across a bucket, so it is not an analytics engine; it is also no longer available to new customers.
OPT: d
Keep the CSV files and set a per-query data-scanned limit on the Athena workgroup.
WHY:
A workgroup limit cancels any query that scans more than the threshold; it caps the bill by failing queries, it does not make a query read fewer bytes.
A:
Convert the logs with a Glue ETL job into compressed, partitioned Parquet. Athena bills per terabyte scanned, so a columnar format lets a query read only the columns it names, compression shrinks the bytes, and partitions on the filter key such as date skip whole prefixes; the Athena pricing example shows a 3x saving from compression and 4x from reading one column. Glue is serverless Spark, so the nightly conversion needs no cluster. For a one-off conversion an Athena CREATE TABLE AS SELECT into Parquet is enough. S3 Select is per object and closed to new customers, so the exam's S3 Select rule is filter one object, never analyse a bucket.
USAGE:
Point new designs at Athena over Parquet; S3 Select is closed to new customers, so fetch byte ranges when you truly need part of one object.

## aws-cloudfront-caching-ttl-and-invalidation | d1
TOPIC: 3.4 Scalable network
Q:
A team deploys a new app.js behind CloudFront but users keep getting the old file for a day. Why does that happen, what is the cheaper long-term fix than invalidating, and what is CloudFront for in the first place?
A:
CloudFront is a global HTTP content delivery network with more than 750 points of presence: it caches responses from any HTTP origin (S3 behind Origin Access Control, a load balancer, any HTTP server), protects private content with signed URLs and cookies, collapses origin requests with Origin Shield, trims cost with price classes, and runs CloudFront Functions or Lambda@Edge at the edge. It is not a load balancer and carries only HTTP; custom TCP or UDP goes to Global Accelerator. The stale file: CloudFront picks a cache behaviour by path pattern and its cache policy sets the TTL; an origin Cache-Control max-age, s-maxage or Expires header is honoured inside the minimum and maximum TTL, and with no header the default TTL of 24 hours applies, hence the day-old file. Invalidation works, but only the first 1,000 paths per month per account are free, so use versioned file names.
USAGE:
A wildcard such as /images/* counts as one invalidation path however many files it clears, so invalidate by prefix rather than listing individual files.

## aws-cloudfront-signed-urls-vs-cookies | d2
TOPIC: 1.2 Secure workloads
Q:
A subscription video site serves hundreds of HLS segment files per stream through CloudFront, and a separate page offers a single paid installer download. Which private-content mechanism suits each, and what stops a user getting around it?
A:
Use a signed URL for the installer: it grants access to one file and works for clients that cannot hold cookies. Use signed cookies for the video, because one Set-Cookie response covers every segment without rewriting hundreds of URLs. Both are signed with the private key of a signer attached to the cache behaviour; prefer a trusted key group over the root-account CloudFront key pair, since key groups are managed by API and IAM and support rotation. Signing only protects the CloudFront path, so lock the S3 origin to the distribution with origin access control, otherwise the direct S3 URL sidesteps everything. The subtle trap is behaviour ordering: an earlier path pattern without a signer serves the file unsigned.
USAGE:
Rotate signing keys by adding the new public key to the key group first and removing the old one only after every URL or cookie signed with it has expired.

## aws-cloudfront-lambda-edge-vs-functions | d3
TOPIC: 3.4 Scalable network
Q:
A site must rewrite URLs and add a security header on every viewer request at millions of requests per second, and fetch a personalisation record from DynamoDB before requests reach the origin. Which two edge placements meet both needs? (Choose two.)
OPT: a *
Run a CloudFront Function on the viewer request event to rewrite the URL and add the header.
OPT: b *
Run a Lambda@Edge function on the origin request event to look up the record in DynamoDB.
OPT: c
Run a Lambda@Edge function on the viewer request event to rewrite the URL and add the header.
WHY:
Lambda@Edge scales to 10,000 requests per second per Region and takes milliseconds, while CloudFront Functions run in under a millisecond at millions of requests per second and cost less; for a trivial header edit on every request it is the wrong tool.
OPT: d
Run a CloudFront Function on the viewer request event to look up the record in DynamoDB.
WHY:
CloudFront Functions have no network access, no file system and no access to the request body; they cannot call DynamoDB or any other service.
OPT: e
Add an Application Load Balancer listener rule at the origin to rewrite the URL and add the header.
WHY:
A load balancer rule runs at the origin, after the request has crossed the internet to the Region; it is not edge compute and never touches responses CloudFront serves from cache.
A:
Use a CloudFront Function on viewer request for the header rewrite and Lambda@Edge on origin request for the DynamoDB lookup. CloudFront Functions are JavaScript that runs in under a millisecond on viewer request and viewer response only, scale to millions of requests per second, and have no network, file system or body access, which suits header edits, redirects and cache-key normalisation. Lambda@Edge runs Node.js or Python for up to 30 seconds, can call AWS services, and also hooks origin request and origin response, which fire only on a cache miss, the right place to enrich a request before the origin sees it.
USAGE:
Attach heavy logic to the origin request event rather than viewer request so it runs only on cache misses and CloudFront caches its result with the object.

## aws-global-accelerator-vs-cloudfront | d1
TOPIC: 3.4 Scalable network
Q:
A multiplayer game uses a custom UDP protocol, partner firewalls must allow-list fixed IP addresses, and players are on several continents. Why is CloudFront the wrong answer and Global Accelerator the right one?
A:
CloudFront is an HTTP content delivery network: it caches responses at edge locations and understands only HTTP, so it cannot carry a custom UDP game protocol. Global Accelerator gives an accelerator two static anycast IPv4 addresses that stay fixed for its lifetime, so partners allow-list them once; clients enter at the nearest edge and ride the AWS global network to Application or Network Load Balancers, EC2 instances or Elastic IPs in one or many Regions. Listeners carry TCP and UDP, traffic dials shift a percentage of traffic per Region, health checks take an unhealthy endpoint out of service in under a minute, and nothing is cached. Keywords: static IP, gaming or VoIP, fast Regional failover. Choose CloudFront for cacheable HTTP content; the trap is assuming either service does both jobs.
USAGE:
Deleting an accelerator releases its static IPs permanently, so restrict delete permissions with IAM and disable rather than delete when pausing a service.

## aws-elasticache-redis-vs-memcached | d2
TOPIC: 3.3 High-performing databases
Q:
A gaming backend needs a real-time top-10 leaderboard, a pub/sub channel for match events, and the cache must survive a node failure. Which ElastiCache engine, and when would Memcached have been the better pick?
A:
Choose Redis OSS or Valkey. Sorted sets rank every score on insert, so a ZADD plus a range query is the whole leaderboard; pub/sub is native; and replication with automatic failover plus backup and restore survive a node loss. Memcached has none of that: simple values, no replication or automatic failover, no pub/sub, no sorted sets, and no backups for node-based clusters. Its strengths are a multithreaded engine that uses every core of a large node and easy scale-out by adding or removing nodes, so it wins when the question wants the simplest object cache that can lose data without harm. The trap is picking Memcached for simplicity when the scenario names a data structure, durability or messaging.
USAGE:
If the cache only holds rendered fragments or query results you can regenerate, Memcached scale-out is enough; reach for Redis or Valkey when the cache holds anything you would mind losing.

## aws-elasticache-lazy-loading-vs-write-through | d2
TOPIC: 3.3 High-performing databases
QUALIFIER: MOST performant
Q:
A product catalogue on RDS for MySQL serves 95 percent reads. Prices change a few times an hour and must never be shown more than 60 seconds stale. Which caching approach is the MOST performant way to serve the catalogue?
OPT: a *
Add ElastiCache in front of the database with lazy loading and a 60-second TTL on every cached item.
OPT: b
Add DynamoDB Accelerator in front of the catalogue.
WHY:
DAX caches only DynamoDB API calls; it cannot sit in front of an RDS for MySQL database, so it is the right idea aimed at the wrong data store.
OPT: c
Add ElastiCache with write-through on every price update and no TTL.
WHY:
Write-through keeps prices fresh but fills the cache with items nobody reads, and a replacement or scaled-out node stays empty until the next write touches each item, so a cold node sends every read to the database for hours.
OPT: d
Add RDS read replicas and route catalogue reads to them.
WHY:
Replicas offload the primary but each read still travels to a database engine on disk with millisecond latency; an in-memory cache answers repeated reads in microseconds and removes the 95 percent that repeat from the database entirely.
A:
ElastiCache with lazy loading plus a 60-second TTL: only requested items are cached, a replacement node warms itself from misses, and the TTL bounds staleness to the 60 seconds the business allows. Lazy loading alone never refreshes an entry, write-through alone churns unread data and leaves new nodes empty, and the ElastiCache guidance is to combine the two with a TTL; write-through on price updates plus a TTL is the stricter variant. DAX only fronts DynamoDB, read replicas are still disk-bound database reads, and CloudFront caching of API responses fits only public, identical GETs. Strongly consistent reads defeat any cache.
USAGE:
A session store is the textbook fit: write each session through with a TTL equal to the session lifetime, so expiry and eviction become the same operation.

## aws-dynamodb-dax | d2
TOPIC: 3.3 High-performing databases
QUALIFIER: LEAST amount of change
Q:
A mobile game keeps its leaderboard in DynamoDB. Millions of players read the same few hundred top-score items, latency must drop from milliseconds to microseconds, and the team cannot afford a rewrite. Which option delivers this with the LEAST amount of change?
OPT: a *
Create a DAX cluster in the VPC and swap the DynamoDB client for the DAX client.
OPT: b
Deploy ElastiCache for Redis OSS and cache leaderboard items in application code.
WHY:
ElastiCache knows nothing of the DynamoDB API, so every read path must be rewritten to check the cache, fall back to the table and invalidate entries on writes; it is the larger change the question rules out.
OPT: c
Increase the table's provisioned read capacity units.
WHY:
More RCUs raise how many reads per second the table serves; each read still takes single-digit milliseconds, so capacity does not buy the microsecond latency required.
OPT: d
Convert the table to a global table with a replica in a second Region.
WHY:
Global Tables replicate data across Regions for locality and disaster recovery; a replica still answers in milliseconds and adds cross-Region write replication the leaderboard never asked for.
A:
DAX. It is API-compatible with DynamoDB, so the change is the client library: eventually consistent GetItem, Query and Scan results come from memory in microseconds, hot items stop hammering one partition, and fewer read units need provisioning. It runs as a cluster inside your VPC and is write-through, so writes made through DAX land in the table and the cache. It does not cache strongly consistent or transactional reads, which pass straight to DynamoDB, and it suits write-heavy tables poorly. ElastiCache needs cache code, extra RCUs buy throughput not latency, and Global Tables solve geography, not speed.
USAGE:
Set the item and query cache TTLs deliberately, because writes that go around DAX stay invisible to cached readers until the TTL expires.

## aws-dynamodb-gsi-vs-lsi | d2
TOPIC: 3.3 High-performing databases
Q:
A DynamoDB table already exists and you need to query by an attribute outside the primary key. Which index type can you add now, and is the new index a read-scaling or a write-scaling decision?
A:
Only a global secondary index can be added later; local secondary indexes exist only from table creation. A GSI takes any partition and sort key, has its own throughput and serves eventually consistent reads only; an LSI keeps the table's partition key, shares its capacity, allows strongly consistent reads, and caps each partition key value's item collection at 10 GB. Every index is a write-side cost, because each write also updates every index that projects the item. That is the general rule: read-heavy load has cheap levers (read replicas, reader endpoints, ElastiCache or DAX, eventually consistent reads); write-heavy load has only expensive ones (a larger writer, Provisioned IOPS, partition-key spread or write sharding, on-demand capacity, a queue that buffers bursts). The trap is adding read replicas to fix write throughput: they replay every write, they never absorb one.
USAGE:
Model your access patterns before creating the table, because forgetting an LSI later means recreating the table and migrating the data.

## aws-rds-proxy | d2
TOPIC: 3.3 High-performing databases
QUALIFIER: LEAST amount of change
Q:
Thousands of concurrent Lambda invocations each open a short-lived connection to an RDS for MySQL instance, which now returns too many connections errors under load. Which fix resolves the errors with the LEAST amount of change to the application?
OPT: a *
Create an RDS Proxy for the instance and point the functions at the proxy endpoint.
OPT: b
Raise the max_connections parameter in the DB parameter group.
WHY:
Each open connection costs memory on the instance, so the ceiling rises only as far as memory allows, and the churn of a fresh connection per invocation stays; it is a stopgap that moves the failure point.
OPT: c
Move the instance to a larger DB instance class.
WHY:
More memory raises the same ceiling at a permanently higher price without touching the root cause: thousands of clients each holding a connection they use for milliseconds.
OPT: d
Rewrite the data layer to use DynamoDB.
WHY:
A new data model and a rewrite of every query is the largest possible change, when the requirement is to stop connection exhaustion on the database the application already uses.
A:
Add RDS Proxy. It keeps a pool of long-lived connections to the database and lets many client connections share them, so the memory and CPU cost of a fresh connection per invocation disappears and surplus requests are queued rather than failed. It also shortens Multi-AZ failover by sidestepping DNS caches, lets clients authenticate with IAM, and fetches database credentials from Secrets Manager. It must sit in the same VPC as the database and is never publicly accessible. Raising max_connections or the instance class only moves the ceiling, reserved concurrency on the functions caps throughput instead of fixing churn, and DynamoDB is a rewrite.
USAGE:
Point every client at the proxy endpoint rather than the instance endpoint, otherwise client-side DNS caching brings back the slow failover the proxy was meant to remove.

## aws-aurora-reader-endpoint-and-autoscaling | d2
TOPIC: 3.3 High-performing databases
QUALIFIER: MOST performant
Q:
Reporting queries are slowing the primary instance of an Aurora MySQL cluster, and read demand spikes unpredictably during the day. Which change is the MOST performant way to serve the reports without hurting writes?
OPT: a *
Point the reporting application at the cluster's reader endpoint and attach an Aurora Auto Scaling policy that adds Aurora Replicas when their average CPU utilization exceeds a target.
OPT: b
Point the reporting application at the cluster endpoint so its connections are balanced across every instance.
WHY:
The cluster endpoint always resolves to the writer; it exists for DDL and DML and follows failover, so pointing reports at it keeps every reporting query on the primary and changes nothing.
OPT: c
Scale the writer instance up to a larger DB instance class.
WHY:
Upsizing the primary is vertical scaling: it buys headroom for a while at a permanently higher price, still serves reads from the instance that also handles writes, and cannot follow unpredictable spikes.
OPT: d
Put RDS Proxy in front of the cluster and send the reports through it.
WHY:
RDS Proxy pools and multiplexes connections and shortens failover; connection pooling is a different problem from read offload, and by itself it does not move a single reporting query off the writer.
A:
Use the reader endpoint with Aurora Auto Scaling. The cluster endpoint always resolves to the primary and follows failover; the reader endpoint balances each new connection, not each query, across the Aurora Replicas, so a long-lived connection stays on one replica. An Auto Scaling policy targeting average CPU or average connections of the replicas adds readers up to your maximum, 15 at most, and removes only those it created. Custom endpoints group specific instances, such as larger readers reserved for analytics. Scaling up the writer is vertical and costly, RDS Proxy solves connection storms rather than read offload, and an RDS Multi-AZ standby serves no reads at all. The distractor is the instance endpoint, which pins clients to one node.
USAGE:
Auto scaling only helps if clients connect through the reader endpoint, so hard-coded instance hostnames silently ignore every replica it adds.

## aws-ec2-instance-families | d2
TOPIC: 3.2 Elastic compute
Q:
Match the EC2 family letter to the workload, a web tier with idle periods, a video encoder, an in-memory database, a node with heavy local disk I/O and a deep learning trainer, and explain when the cheap-looking T instance ends up costing more than an M.
A:
The letter is the resource ratio: M balanced for web servers; T burstable, earning CPU credits below its baseline and spending them to burst; C compute-optimised for transcoding and HPC; R and X memory-optimised; I and D storage-optimised for local disk I/O; P and G GPU-accelerated. Sizes double vCPU, memory and price together; a newer generation usually costs the same or less per unit of performance. The T trap: a t3.medium's baseline is 20 percent, and T3, T3a and T4g launch in unlimited mode, billing surplus credits at $0.05 per vCPU-hour once the 24-hour average exceeds baseline; a T3 pinned at 100 percent costs about 1.5 times an M5; a t3.large breaks even with an m5.large at 42.5 percent.
USAGE:
If a T instance slows down or its bill grows under steady load, check its CPU credit metrics before blaming the application; sustained CPU belongs on M or C.

## aws-ec2-placement-groups | d2
TOPIC: 3.2 Elastic compute
Q:
Which placement group serves a tightly coupled HPC job, which one cannot hold fifty instances in one Availability Zone, and when is the right lever a Local Zone, a Wavelength Zone or an Outpost rather than any placement group?
A:
Cluster packs instances close together in one AZ for the low latency tightly coupled HPC needs. Spread puts each instance on distinct hardware, can span AZs, but allows only seven running instances per AZ, so it cannot hold fifty. Partition splits the group into up to seven partitions per AZ on separate racks with no instance cap, for Hadoop and Cassandra. Placement groups only move instances within an AZ; latency to users or data is a global-infrastructure choice: a Region for residency and the full catalogue, several AZs for fault isolation, a Local Zone for metro latency with fewer services, a Wavelength Zone inside a carrier's 5G network, an Outpost on your premises, and edge locations for CloudFront and Global Accelerator, which run no EC2. Place compute nearest the latency that matters.
USAGE:
Use one instance type and a single launch request for a cluster group, because topping it up later with a different size is the classic insufficient capacity error.

## aws-kinesis-data-streams-vs-firehose | d3
TOPIC: 3.5 Data ingestion and transformation
QUALIFIER: LEAST operational overhead
Q:
A clickstream must feed a custom real-time anomaly detection application, allow reprocessing of the last 7 days whenever its model changes, and be archived to S3 as Parquet within about a minute with no consumer code to run. Which combination meets all three with the LEAST operational overhead? (Choose two.)
OPT: a *
Kinesis Data Streams with retention set to 7 days; the detection application reads it as an enhanced fan-out consumer.
OPT: b *
Amazon Data Firehose reading the data stream as its source, converting records to Parquet and delivering to S3.
OPT: c
Amazon Data Firehose alone, with the detection application reading the S3 objects it writes.
WHY:
Firehose is a delivery service: it buffers and lands data but lets no application subscribe to or replay the stream, so the application would read files at least one buffer interval late and could never re-consume the last 7 days.
OPT: d
An SQS standard queue that both the detection application and an archiver poll.
WHY:
A queue hands each message to one consumer and deletes it on acknowledgement; consumed messages cannot be replayed, a second reader cannot see the same events, and even unconsumed messages expire after at most 14 days.
OPT: e
Amazon MSK Serverless topics with a Kafka Connect sink to S3.
WHY:
MSK works, but it is the Kafka-compatible option: you manage topics, partitions, connectors and consumer groups yourself, which is more to operate than a Firehose stream configured once. It wins only when producers already speak Kafka.
OPT: f
DynamoDB Streams with a Lambda function archiving records to S3.
WHY:
DynamoDB Streams is the change log of a table, not a general event ingest service: the clickstream would first have to be written into DynamoDB, and the log keeps only 24 hours, so 7-day replay is impossible.
A:
Kinesis Data Streams plus Firehose reading the stream as its source. A data stream keeps records for 24 hours by default and up to 365 days, so 7-day replay is a setting; many consumers read independently, and enhanced fan-out gives each one 2 MB/s per shard at about 70 ms delay. Firehose then delivers to S3, Redshift, OpenSearch or Splunk with buffering of 1 to 128 MiB or 0 to 900 seconds, optional Lambda transforms and JSON-to-Parquet conversion from a Glue schema, but it can be neither consumed nor replayed. SQS is a work queue that delivers each message once; MSK is Kafka compatibility at the price of cluster operations; Kinesis Video Streams is for camera feeds.
USAGE:
Set the Firehose buffer interval to 60 seconds and the stream retention to 7 days explicitly; the defaults are a 300-second buffer and 24-hour retention, and both quietly miss the requirement.

## aws-kinesis-shards-and-partition-keys | d3
TOPIC: 3.5 Data ingestion and transformation
Q:
An IoT platform writes 5 MB/s into a provisioned Kinesis stream with 8 shards, yet producers keep getting ProvisionedThroughputExceededException. Two shards take most of the traffic; the partition key is the factory gateway ID, one of about 30. Which two actions stop the throttling? (Choose two.)
OPT: a *
Change the partition key to a high-cardinality value such as the device ID so records spread evenly across all shards.
OPT: b *
Split the two hot shards so the gateway keys that collide on them land on separate shards.
OPT: c
Register the consumer application for enhanced fan-out.
WHY:
Enhanced fan-out gives each consumer its own 2 MB/s per shard on the read side; the exception here is raised on writes, which are capped at 1 MB/s and 1,000 records per second per shard no matter how consumers read.
OPT: d
Increase the stream's retention period to 7 days.
WHY:
Retention changes how long records stay readable, from 24 hours up to 365 days; it has no effect on per-shard write capacity or on which shard a key hashes to.
OPT: e
Replace the stream with an Amazon Data Firehose stream.
WHY:
Firehose removes shard sizing but is a delivery pipeline to S3, Redshift or OpenSearch: the platform's custom consumers could no longer read or replay records, so it trades the throttling for a lost requirement.
OPT: f
Add more consumer applications to drain the stream faster.
WHY:
Consumers read what is already written; producers are throttled because the write side of two shards is full, and extra readers only share, or compete for, the 2 MB/s read allowance.
A:
Spread the key and split the hot shards. Limits are per shard, 1 MB/s or 1,000 records per second in and 2 MB/s out, and the partition key is MD5-hashed to choose a shard, so 30 gateway IDs on 8 shards collide and two shards saturate while the stream as a whole sits at 5 of 8 MB/s. A device-level key restores an even spread; splitting the hot shards is the immediate relief provisioned mode offers. On-demand mode auto-splits shards above 500 KB/s but cannot isolate a single key that alone exceeds 1 MB/s. Fan-out, retention and extra consumers act on the read side, and Firehose drops custom consumption.
USAGE:
Enable shard-level metrics and chart IncomingBytes per shard before touching the shard count; a stream that throttles at 60 percent utilisation has a key problem, and doubling shards only halves it.

## aws-api-gateway-caching-and-throttling | d2
TOPIC: 2.1 Loosely coupled architectures
Q:
A REST API backed by Lambda returns the same catalogue to thousands of clients, a few clients hammer it, the team wants v2 on 5 percent of traffic under api.example.com, and someone asks whether an ALB would do. Where does each feature live?
A:
Caching is per stage on REST APIs: repeated GETs are served for the TTL, 300 seconds default, 3,600 maximum. Per-client limits need a usage plan tying an API key to a stage with rate, burst and quota; a key alone throttles nothing, and the account default is 10,000 requests per second with a 5,000 burst per Region. Stages map to environments and carry stage variables; a canary release on the stage sends a chosen percentage to the new deployment until promoted. A custom domain needs an ACM certificate in the API's Region, or in us-east-1 when edge-optimized. Integration timeout defaults to 29 seconds. An ALB or Lambda function URL suffices when you need no metering, caching or auth transformation.
USAGE:
Never use API keys as your authentication mechanism; pair a usage plan with IAM, Cognito or a Lambda authorizer, and treat plan quotas as best effort targets rather than hard cost controls.

## aws-api-gateway-rest-vs-http-vs-websocket | d2
TOPIC: D2 services
Q:
When do you pick an HTTP API over a REST API in API Gateway, and when is neither of them the right answer?
A:
HTTP APIs suit a plain Lambda or HTTP proxy front end: they are minimal so they cost less, they have native JWT authorisers and automatic deployments, and their integration timeout is capped at 30 seconds. REST APIs are required whenever the question mentions API keys and usage plans, per client throttling, response caching, request validation, AWS WAF, resource policies, private endpoints, canary releases or X-Ray, because HTTP APIs support none of these. Neither fits a chat or live dashboard where the server must push messages: that is a WebSocket API, which holds a persistent two way connection and routes messages through $connect, $disconnect and custom routes. The trap is choosing HTTP for price when a listed requirement needs REST.
USAGE:
Check whether the API must be reachable only from inside a VPC before committing to an HTTP API, because only REST APIs offer the private endpoint type.

## aws-lambda-performance-memory-and-layers | d2
TOPIC: 3.2 Elastic compute
QUALIFIER: FASTEST
Q:
A CPU-bound Lambda function configured with 128 MB of memory takes about 8 seconds per invocation. The team wants each invocation to finish FASTEST without raising the cost per invocation. Which change achieves this?
OPT: a *
Raise the function's memory to about 1,769 MB so it receives a full vCPU, and measure duration and cost at several memory sizes.
OPT: b
Configure provisioned concurrency for the function's alias.
WHY:
Provisioned concurrency pre-initialises execution environments to remove cold-start latency; it does nothing for the 8 seconds of CPU work inside an already warm invocation, and it adds a standing charge.
OPT: c
Set a reserved concurrency of 100 on the function.
WHY:
Reserved concurrency caps or guarantees how many invocations can run at once; it changes throughput limits, not the CPU available to a single invocation.
OPT: d
Increase the function timeout from 10 seconds to 60 seconds.
WHY:
A longer timeout only lets a slow invocation keep running; it changes nothing about how quickly the work gets done.
A:
Raise the memory. Lambda allocates CPU in proportion to memory across 128 MB to 10,240 MB, with a full vCPU at 1,769 MB, so a CPU-bound function finishes far sooner, and because billing multiplies memory by duration in GB-seconds a run that is many times shorter can cost the same or less despite the higher rate. Provisioned concurrency fixes cold starts, reserved concurrency limits parallelism, a longer timeout only tolerates slowness, and moving to Fargate is a rewrite the question never asked for. Keep the other levers straight: layers are shared zip archives extracted to /opt, at most five per function within the 250 MB unzipped limit; container image functions cannot use layers but may be up to 10 GB.
USAGE:
Use the AWS Lambda Power Tuning tool to choose memory from measured cost and duration rather than guessing, and raise /tmp ephemeral storage separately when a job must stage large files.

## aws-lambda-event-source-mappings-sqs-batching | d2
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: MOST efficient
Q:
A Lambda function polls a standard SQS queue in batches of ten. One malformed message per batch makes the handler throw, all ten messages reappear after the visibility timeout, and nine good orders are processed again on every retry. The team wants to stop the duplicate processing without lowering throughput. Which change fixes this in the MOST efficient way?
OPT: a
Set the batch size on the event source mapping to 1 so each invocation handles a single message.
WHY:
It does stop the nine good messages from being retried, but it multiplies invocations tenfold and throws away the throughput a batch gives, so it violates the efficiency requirement.
OPT: b *
Enable ReportBatchItemFailures on the event source mapping and have the handler catch exceptions per message and return the failed message IDs in batchItemFailures.
OPT: c
Raise the queue's visibility timeout so retries happen less often.
WHY:
A longer timeout only delays the retry; the mapping still treats the batch as one failure, so the whole batch, good messages included, becomes visible again and is reprocessed.
OPT: d
Attach a dead-letter queue to the source queue with maxReceiveCount set to 3.
WHY:
A DLQ takes the poison message only after its third failed receive, and until then every batch it lands in fails whole, so its companions are reprocessed each time; it is where the bad message ends up, not what stops the duplicates.
A:
Enable ReportBatchItemFailures on the event source mapping and return only the failed message IDs, so only those messages return to the queue while the batch keeps its size. The mapping polls the queue and invokes the function per batch, up to 10,000 messages for standard queues with a batching window of up to 300 seconds or a 6 MB payload; by default any error fails the whole batch. Throwing an exception still fails everything, so the handler must catch per message. Batch size 1, a longer visibility timeout and a DLQ each leave the good messages retried.
CODE: json
{
  "batchItemFailures": [
    { "itemIdentifier": "id2" }
  ]
}
USAGE:
Make the handler idempotent regardless, because event source mappings deliver at least once and a batch can be redelivered after a timeout even when every message succeeded.

## aws-step-functions-standard-vs-express | d2
TOPIC: 2.1 Loosely coupled architectures
Q:
An order pipeline charges a card, waits up to two days for a warehouse callback, then emails the customer. Which Step Functions workflow type do you choose, and when would Express be right instead?
A:
Choose Standard: it runs for up to a year, executes each state exactly once, supports the .sync and .waitForTaskToken patterns that pause a workflow for a human or an external callback, and bills per state transition. Express runs for at most five minutes, bills by executions, duration and memory, keeps history only in CloudWatch Logs, and its asynchronous form is at-least-once, so it suits high-volume idempotent work such as IoT ingestion or stream transformation, never payments. The wider rule is orchestration versus choreography: use a state machine when steps are ordered, branch, fan out through Parallel or Map, need Retry with IntervalSeconds, BackoffRate, MaxAttempts and jitter, Catch fallbacks, TimeoutSeconds or HeartbeatSeconds, or when someone must see where an execution is; use events and queues when services are independent and nobody needs the end-to-end state. Trap: one Lambda function invoking the next synchronously to sequence work pays for both while one waits and loses the failure history.
USAGE:
Whichever type you choose, put retries, error catching, branching and parallel fan out in the state machine rather than hand coding them into a chain of Lambda functions that call each other.

## aws-opensearch-use-cases | d1
TOPIC: D3 services
Q:
Which AWS service handles full text search and log analytics with dashboards, and when are CloudWatch Logs Insights or Athena the better answer?
A:
Amazon OpenSearch Service runs managed OpenSearch clusters, a search and analytics engine built for full text search, log analytics, application monitoring and clickstream analysis, with OpenSearch Dashboards for visualisation. It is usually fed from other stores such as S3, Kinesis, DynamoDB and CloudWatch Logs. Treat it as a searchable index beside your system of record, not as the primary database. CloudWatch Logs Insights is the answer when the requirement is only to query logs already in CloudWatch Logs with no extra infrastructure, and Athena is the answer for SQL over files in S3. The trap is reaching for an OpenSearch domain, billed by instance hour, when a query on existing logs or S3 data would do.
USAGE:
Plan index retention from day one, because indexes grow without limit and the UltraWarm and cold storage tiers exist precisely to move old read only data off the expensive hot nodes.

## aws-redshift-vs-athena-vs-emr | d2
TOPIC: D3 services
QUALIFIER: LEAST operational overhead
Q:
One team runs occasional SQL over a few terabytes of CSV and Parquet files already in S3. Another runs nightly BI reports that join dozens of multi-terabyte tables in a petabyte-scale warehouse. Which two services meet these needs with the LEAST operational overhead? (Choose two.)
OPT: a *
Amazon Athena querying the S3 files through AWS Glue Data Catalog tables for the ad hoc SQL team.
OPT: b *
Amazon Redshift, Serverless or RA3 provisioned, as the warehouse for the nightly joins, with Spectrum for any data left in S3.
OPT: c
An Amazon EMR cluster running Presto or Trino for both teams.
WHY:
EMR is a managed cluster you size, patch and pay for while it runs, so it adds operations that two serverless SQL services avoid; it wins only when you need custom Spark, Hive or Presto code or control of the cluster.
OPT: d
Amazon RDS for PostgreSQL loaded with all the data for the nightly reports.
WHY:
RDS is a row-oriented transactional engine on a single instance; it is not built for petabyte-scale columnar joins, and loading the whole lake into it is the scale trap the warehouse exists to avoid.
OPT: e
Amazon OpenSearch Service with its SQL plugin for both workloads.
WHY:
OpenSearch is a search and log-analytics engine: it excels at full-text and time-series queries over indexed documents, not at multi-table joins and warehouse aggregation.
OPT: f
AWS Glue ETL jobs written to answer each ad hoc query.
WHY:
Glue is the serverless ETL and catalog service; it transforms and catalogs data so query engines can read it, but a job per question is not an interactive query service.
A:
Athena for the occasional SQL over S3 and Redshift for the nightly warehouse joins. Athena is serverless and billed per query at $5 per TB scanned against Glue Data Catalog tables, so ad hoc queries over data left in S3 need no cluster; Redshift is the petabyte-scale columnar warehouse whose engine is built for complex joins, and Spectrum reads S3 without loading. EMR is a managed Hadoop, Spark and Presto cluster for custom big-data code, overkill for plain SQL. Around them: Lake Formation governs column-, row- and cell-level permissions on the Catalog that Athena, Redshift Spectrum, EMR and Glue enforce; Amazon Quick Sight builds dashboards over Athena or Redshift with its in-memory SPICE engine; OpenSearch is for search and logs.
USAGE:
Land data in S3 as partitioned Parquet, catalog it with Glue and query it with Athena; move it into Redshift only when the same joins run every night, and put Lake Formation in front once teams need different column access.

## aws-glue-etl-and-catalog | d1
TOPIC: 3.5 Data ingestion and transformation
Q:
New JSON files land in S3 every hour and must be cleaned, converted to Parquet and made queryable by Athena with no servers to manage. Which service does it, what does the Data Catalog add, and when would DataBrew, EMR, Lambda or Firehose be the better transform?
A:
AWS Glue: a crawler infers the schema into the Glue Data Catalog, and a serverless Spark ETL job, coded or built visually in Glue Studio, transforms the files on a schedule or trigger. The Catalog is the shared metadata store, so Athena, EMR and Redshift Spectrum see the tables at once. Pick the neighbours by the shape of the work: DataBrew for no-code preparation with over 250 built-in transformations; EMR for a long-running cluster you tune or frameworks beyond Spark; Lambda for small per-record transforms inside its 15-minute timeout; Firehose when the data is streaming and the transform is inline, including JSON-to-Parquet on the way to S3. Trap: EMR or Lambda for a batch conversion Glue does serverless.
USAGE:
Run the crawler after each ETL job, because a new partition or column that is missing from the Catalog stays invisible to Athena until the table definition is refreshed.

## aws-aurora-vs-dynamodb-choice | d2
TOPIC: 3.3 High-performing databases
QUALIFIER: LEAST operational overhead
Q:
A new service looks up session and profile records by user ID, with peaks of millions of requests per second, no joins, and no team to run databases. Which database meets the requirement with the LEAST operational overhead?
OPT: a *
A DynamoDB table in on-demand capacity mode keyed on user ID, with a global secondary index for any secondary lookup.
OPT: b
Aurora Serverless v2 for PostgreSQL with the profiles in one table.
WHY:
Aurora Serverless v2 scales compute in half-ACU steps and can even pause to zero, but it is still a relational cluster with a schema, connections and engine versions to manage, chosen when you need the SQL joins this workload never issues.
OPT: c
ElastiCache for Redis OSS as the primary store.
WHY:
ElastiCache is an in-memory cache built to sit in front of a database; it is not the durable system of record for profile data.
OPT: d
RDS for MySQL with several read replicas.
WHY:
Replicas add read capacity but you still size instances, manage failover and connections and pay for idle headroom, and millions of key lookups per second is exactly the scale the relational model strains at.
A:
DynamoDB. Decide on access pattern, not the word serverless: DynamoDB is a serverless NoSQL key-value and document store with single-digit-millisecond latency at any scale, on-demand capacity that needs no sizing, and no JOIN, so you denormalise around known key lookups. Its feature map: partition and optional sort key, GSIs for alternate keys (LSIs only at table creation), DAX for microsecond reads, Streams for change events, TTL for expiry, Global Tables for multi-Region, and transactions capped at 100 items and 4 MB that consume double capacity; an item maxes out at 400 KB, so large blobs go to S3 with a pointer. Aurora, including Serverless v2, is the answer when joins or unpredictable queries appear; DocumentDB only when the question says MongoDB.
USAGE:
If you find yourself planning a second DynamoDB table just to answer a query the first cannot, check whether the real requirement is relational; secondary indexes cover alternate keys, not joins.

## aws-lambda-limits-timeout-payload | d2
TOPIC: 3.2 Elastic compute
QUALIFIER: MOST cost-effective
Q:
A genomics pipeline runs thousands of containerised jobs every night, each taking 2 to 6 hours, and every job can be interrupted and restarted from a checkpoint. Which compute choice is the MOST cost-effective way to run them?
OPT: a *
Submit the jobs to an AWS Batch job queue backed by a managed compute environment of EC2 Spot Instances, with job retries enabled.
OPT: b
Package each job as a Lambda function with the timeout raised to its maximum and invoke one function per job.
WHY:
A standard Lambda invocation is capped at 900 seconds (15 minutes), so a two-hour job is killed long before it finishes; only Lambda Managed Instances, which run on EC2 capacity you pay for, stretch asynchronous runs to 90 minutes, still far short of the requirement.
OPT: c
Run each job as a standalone ECS task on Fargate, started by a script that launches one task per job.
WHY:
Fargate is the right family but the wrong shape: the script becomes your job queue, retry logic and dependency tracker, and hours of on-demand Fargate task time cost more than the interruptible Spot capacity that Batch schedules for you.
OPT: d
Launch an EC2 Auto Scaling group of On-Demand Instances and have each instance pull jobs from a queue you write.
WHY:
On-Demand pricing for work that tolerates interruption gives away the Spot discount, and you must build and operate the scheduler, queue and retry logic that Batch provides at no additional charge.
A:
AWS Batch: jobs go to a queue, a managed compute environment of Spot Instances scales up for the night and back down, interrupted jobs are retried, and Batch itself costs nothing beyond the instances. Lambda's ceilings are 900 seconds (15 minutes), 10,240 MB of memory and a 6 MB synchronous or 1 MB asynchronous payload, so the limit rules it out before price does; Fargate tasks or an On-Demand Auto Scaling group work but make you build the queue and pay more. The map: event-driven work under 15 minutes is Lambda; containers without hosts is Fargate; long or queued batch on managed EC2 or Spot is Batch; Spark or Hadoop is EMR; full control, licences or GPUs is EC2; deploy code and forget infrastructure is Elastic Beanstalk.
USAGE:
Profile the slowest inputs, not only the typical ones, before committing to Lambda; a job that overruns the timeout only occasionally is the hardest kind of failure to diagnose and forces a redesign later.

## aws-appsync-graphql | d1
TOPIC: D2 services
Q:
A mobile app needs one endpoint that reads from DynamoDB and a Lambda function, pushes live updates to clients, and keeps working offline. Why is AppSync a better fit than an API Gateway REST API?
A:
AppSync is a managed GraphQL service: clients request exactly the fields they need and resolvers fetch them from DynamoDB, Lambda, RDS, OpenSearch or HTTP endpoints through one endpoint, avoiding the over-fetching and round trips of REST. Subscriptions fire in response to mutations over WebSockets that AppSync establishes and maintains, and Amplify DataStore clients generated from the schema give mobile apps offline sync. Caching, WAF and API keys are not differentiators: AppSync has them too. A REST API wins when you need request validation against a JSON schema, usage plans, or a plain proxy for an ordinary HTTP backend. The distractor is an API Gateway WebSocket API: it pushes both ways, but you write connection handling and data fetching yourself.
USAGE:
Do not reach for GraphQL because it is newer; if every client needs the same fixed payloads, a REST API is simpler to build, cache and secure.

## aws-s3-glacier-retrieval-tiers | d2
TOPIC: D4 services
Q:
Compliance archives are read perhaps once a year, but when auditors ask, a handful of files must be back within minutes. Which Glacier class and retrieval tier do you pick, and what does Deep Archive change?
A:
Pick S3 Glacier Flexible Retrieval: minimum storage 90 days, with three restore tiers, Expedited in about 1 to 5 minutes, Standard in 3 to 5 hours, and Bulk in 5 to 12 hours as the cheapest option, free for this class. S3 Glacier Deep Archive costs least but carries a 180 day minimum, Standard restores of up to 12 hours, Bulk up to 48 hours, and no Expedited tier, so it suits data you can wait half a day for. If the need is millisecond access with no restore step, that is S3 Glacier Instant Retrieval, which charges a per-GB retrieval fee. The distractor is Deep Archive for any 'minutes' requirement: nothing there returns in minutes.
USAGE:
Expedited retrievals can be refused during periods of high demand unless you buy provisioned capacity, so do not promise minute-level restores without it.

## aws-s3-requester-pays-and-data-transfer | d2
TOPIC: 4.1 Cost-optimized storage
Q:
A research group publishes a multi-terabyte dataset in S3. Compare the four ways outsiders can read it, a public bucket, presigned URLs, CloudFront in front, and Requester Pays, by who pays for storage, requests and data transfer out.
A:
Storage is always billed to the bucket owner; only requests and transfer out move. A public bucket or a presigned URL, signed with the owner's credentials, bills the owner for every GET and for internet egress at $0.09 per GB for the first 10 TB a month. CloudFront in front turns that egress into CloudFront pricing: origin fetches from S3 are free, the first 1 TB out per month is free, and caching cuts S3 requests. Requester Pays flips request and download charges to the caller, who must authenticate and send the x-amz-request-payer header; anonymous access is refused, so a fully public dataset cannot use it. A cross-account VPC endpoint avoids egress but still bills the owner for requests.
USAGE:
Consumers must opt in with the request-payer flag, so document it for anyone you share the bucket with or their downloads fail with 403.

## aws-savings-plans-vs-reserved-instances | d2
TOPIC: 4.2 Cost-optimized compute
Q:
A company runs steady EC2 workloads plus some Fargate and Lambda, and may move between instance families and Regions next year. Which commitment gives the discount without locking them in, and when does a Reserved Instance still win?
A:
A Compute Savings Plan: commit to a dollar amount per hour and the discount, up to 66 percent, applies to EC2 of any family, size, OS, tenancy or Region, plus Fargate and Lambda; an EC2 Instance Savings Plan reaches 72 percent but ties you to one family in one Region. Standard RIs give the same 72 percent yet can only be modified or resold on the RI Marketplace; Convertible RIs exchange across family, OS and tenancy but cap at 66 percent. An RI still wins twice: a zonal RI reserves capacity in one Availability Zone, which Savings Plans never do, and RDS, ElastiCache, OpenSearch, Redshift and DynamoDB sell reservations Savings Plans do not cover.
USAGE:
Size the hourly commitment on the On-Demand baseline only: Savings Plans skip Spot usage and anything already covered by an RI.

## aws-spot-fleet-and-interruption-handling | d2
TOPIC: 4.2 Cost-optimized compute
Q:
A rendering farm on Spot keeps losing instances mid-job. How should the fleet be configured, and how does the application survive an interruption?
A:
Diversify: run an Auto Scaling group mixed instances policy or EC2 Fleet across many instance types and Availability Zones with the price-capacity-optimized allocation strategy, so instances come from the pools least likely to be reclaimed; lowest-price carries the highest interruption risk. EC2 sends an interruption notice two minutes before stopping or terminating a Spot Instance, as an EventBridge event and in instance metadata, on a best-effort basis, and a rebalance recommendation can arrive earlier. The application must checkpoint progress to S3, EBS or DynamoDB and split jobs into small tasks so a replacement instance can resume. The distractor is Spot blocks with a defined duration: they are no longer available, so no answer can promise an uninterrupted run.
USAGE:
Poll the instance metadata interruption endpoint every few seconds and drain work on notice, then test with a forced interruption because the two-minute warning is best effort.

## aws-ec2-dedicated-hosts-vs-instances | d2
TOPIC: 4.2 Cost-optimized compute
Q:
One team must bring its own per-core Windows Server and SQL Server licences to AWS; another team simply needs hardware not shared with other customers. Which tenancy option does each need?
A:
The licensing team needs Dedicated Hosts: a physical server allocated to your account, billed per host, that shows the number of sockets and physical cores and supports host affinity, which per-socket, per-core or per-VM licence terms require. The isolation team only needs Dedicated Instances: hardware dedicated to one account, billed per instance, with no placement visibility and only partial BYOL support (SQL Server with License Mobility, Windows VDA). Security and performance are identical, and Dedicated Instances add an hourly fee in each Region where one runs. Capacity Reservations work with Dedicated Instances but not with Dedicated Hosts. The distractor is picking Dedicated Instances for per-core licences: without core visibility the licence cannot be applied.
USAGE:
Dedicated Instances may still share a host with your own non-dedicated instances, so they satisfy 'not shared with other customers', not 'a whole box to myself'.

## aws-nat-gateway-cost-vs-vpc-endpoint | d2
TOPIC: 4.4 Cost-optimized network
Q:
Private-subnet instances push terabytes into S3 every night through a NAT Gateway, and dozens of VPCs each call SQS and Secrets Manager through their own NAT. What is being charged, and what removes it?
A:
A NAT Gateway bills $0.045 per hour plus $0.045 per GB processed, so bulk S3 or DynamoDB traffic pays a processing charge on the whole volume. Add a gateway endpoint for S3 (and DynamoDB): no hourly or data charge, and its prefix-list route beats the 0.0.0.0/0 route to the NAT. Other services need an interface endpoint (PrivateLink) at $0.01 per AZ-hour plus $0.01 per GB: cheaper than NAT at volume but dearer at near-zero traffic, so centralise interface endpoints in one shared VPC reached through Transit Gateway and a Route 53 private hosted zone instead of paying per VPC. Keep one NAT per AZ for internet destinations; the distractor is an interface endpoint for S3.
USAGE:
Gateway endpoints are Region-specific and unreachable over peering, VPN or Direct Connect, so traffic to a bucket in another Region still falls back to the NAT.

## aws-data-transfer-costs-az-region | d2
TOPIC: 4.4 Cost-optimized network
Q:
A web tier in one Availability Zone talks constantly to a cache tier in another, and static files are served straight from S3 to the internet. Where are the hidden transfer charges, and how do you cut them?
A:
Inter-AZ traffic is charged, and both the inbound and outbound bytes are metered, so chatty tiers pay twice; traffic that stays in one zone is free. Data in from the internet is free, data out is charged per GB at rates that fall with volume, and cross-Region transfer is charged on the outbound side. Using an instance's public or Elastic IP is billed as regional or internet transfer, so use private IPs. For static files put CloudFront in front of S3: transfer from an AWS origin to CloudFront is free, edge caching cuts origin fetches, and you pay only CloudFront egress. The distractor is splitting tightly coupled tiers across zones without noticing every call crosses a metered boundary.
USAGE:
Before pinning tiers to a single zone to save transfer cost, weigh it against losing zone-level resilience; the cheapest design is also the most fragile.

## aws-cloudfront-cost-reduction | d1
TOPIC: 4.4 Cost-optimized network
Q:
A static site served straight from S3 is paying for data transfer and requests from viewers worldwide. How does CloudFront lower that bill, and which three distribution settings cut it further?
A:
CloudFront caches objects at edge locations, so repeat requests never reach S3, and transfer from AWS origins such as S3 or ELB into CloudFront is free; you pay for CloudFront to viewer transfer and requests. A price class other than PriceClass_All serves only from cheaper edge regions, so viewers near excluded regions may see slower responses. Origin Shield adds a regional caching layer that consolidates duplicate requests from many edge caches into as few as one origin fetch, cutting origin load and data transfer out, at an additional per-request charge. Compression with Gzip or Brotli shrinks text assets, and transfer is billed by bytes served. The trap is picking a price class to improve performance; it only lowers cost.
USAGE:
Enable compression and check that the origin returns a Content-Length header, because CloudFront skips compression for objects outside its size range or without that header.

## aws-aurora-serverless-v2 | d1
TOPIC: 3.3 High-performing databases
Q:
A team runs a dev database and a production API whose traffic spikes unpredictably. When is Aurora Serverless v2 the right choice over provisioned Aurora, and which serverless option covers the key-value, warehouse and graph cases?
A:
Aurora Serverless v2 scales compute in Aurora capacity units of roughly 2 GiB of memory each, in steps as small as 0.5 ACU across a 0 to 256 ACU range, in place without waiting for a quiet point, billed per second; it keeps Multi-AZ readers, Global Database and the engine's features, and recent versions pause to 0 ACUs when idle. That suits spiky, unpredictable, multi-tenant or dev and test relational workloads. A flat 24x7 load belongs on provisioned instances; v1 doubled or halved capacity and is deprecated. The rest of the serverless map: DynamoDB on-demand for key-value, Redshift Serverless (RPUs of 16 GB each) for the warehouse, Neptune Serverless (1 to 128 NCUs) for graph. Rule: unpredictable or idle-heavy relational, Aurora Serverless v2; key-value, DynamoDB. The trap is serverless for a steady load because the name sounds cheaper.
USAGE:
Set the minimum ACU high enough to keep the working set in the buffer pool, otherwise every idle period evicts the cache and the first busy minute pays for it in latency.

## aws-dynamodb-standard-ia-table-class | d1
TOPIC: 4.3 Cost-optimized database
Q:
A DynamoDB table holds years of order history that is rarely read but must stay queryable. Which table class lowers the bill, and what is the trade-off?
A:
Switch the table to the DynamoDB Standard-IA table class. It charges less per GB stored but more per read and write request than the default Standard class, so it pays off when storage exceeds 50 percent of the table's throughput cost under Standard. Performance, durability and availability are identical, and features such as TTL, PITR and on-demand mode still work, though every index inherits the table's class. You can switch back, but only two class changes are allowed in a trailing 30-day period. Reserved capacity is a separate lever for provisioned Standard tables only; it is not offered for Standard-IA or on-demand tables. The trap is treating Standard-IA as a general discount for a busy table.
USAGE:
Compare the table's storage cost against its throughput cost in Cost Explorer before switching, because you only get two class changes per 30 days to undo a wrong call.

## aws-lambda-pricing-and-graviton | d1
TOPIC: 4.2 Cost-optimized compute
Q:
A Linux stack of EC2 instances, Fargate tasks, Lambda functions and RDS PostgreSQL must cost less without a redesign. Which single change applies to all four, what does Lambda bill for, and what blocks the change?
A:
Switch to Graviton (arm64). AWS prices Graviton EC2 instances up to 20 percent below comparable x86, and the same lever exists as RDS and Aurora db.*g classes, Fargate arm64 tasks (20 percent cheaper, launched with up to 40 percent better price performance) and Lambda arm64 functions (about 20 percent less per GB-second). Lambda bills per request plus duration in GB-seconds rounded up to the millisecond, so memory right-sizing is the other free lever: CPU scales with memory (one vCPU at 1,769 MB), so a CPU-bound function at 128 MB runs about eight times longer than at 1,024 MB and rarely costs less. Windows, x86-only binaries and layers or images without arm64 builds block the switch; open-source stacks move first.
USAGE:
Before flipping a function or task to arm64, rebuild every layer, extension and container image for arm64; the price cut is worthless if the binary will not start.

## aws-fargate-spot-and-compute-savings-plans | d2
TOPIC: 4.2 Cost-optimized compute
Q:
An ECS service on Fargate runs a steady web tier plus a fleet of retry-safe batch workers. How do you cut the bill without risking the web tier?
A:
Use an ECS capacity provider strategy mixing FARGATE and FARGATE_SPOT. Fargate Spot uses spare capacity at a discount, but AWS reclaims it with a two-minute warning, and during shortages Spot tasks are delayed, never backfilled with on-demand. Put a base on FARGATE to guarantee the web tier's minimum tasks, then weight interruption-tolerant workers onto FARGATE_SPOT. For the steady portion, buy a Compute Savings Plan: a one or three year hourly commitment covering EC2, Fargate and Lambda regardless of instance family, size or Region, whereas an EC2 Instance Savings Plan is locked to one family in one Region and covers neither Fargate nor Lambda. The trap is a single-task service entirely on Spot; one interruption takes it down until capacity returns.
CODE: json
[
  {"capacityProvider": "FARGATE", "base": 2, "weight": 1},
  {"capacityProvider": "FARGATE_SPOT", "weight": 3}
]
USAGE:
Handle SIGTERM in the container and keep stopTimeout within the two-minute window, otherwise in-flight work is killed with SIGKILL when Spot capacity is reclaimed.

## aws-cost-explorer-budgets-cur | d1
TOPIC: D4 services
Q:
Finance wants a per-team spend chart with purchase recommendations, an alert that can stop instances before a project overspends, and hourly line items with amortised commitments for their warehouse. Which tool answers each request?
A:
Cost Explorer is the view: up to 13 months of history, an 18-month forecast, and rightsizing plus Savings Plans and RI recommendations; API requests cost $0.01 each and hourly granularity is an opt-in extra. Budgets is the alerting layer: cost, usage, RI and Savings Plans utilisation or coverage budgets notify by email or SNS, and budget actions apply an IAM policy or SCP or stop EC2 and RDS instances; the first two action-enabled budgets are free, then $0.10 a day, and data refreshes only three times a day. The Cost and Usage Report (CUR 2.0 in Data Exports) is the raw feed: hourly line items with resource IDs, tags and amortised commitment costs, delivered to S3 for Athena.
USAGE:
Because Budgets data lags by hours, pair a cost budget with a usage budget on the specific service and treat the stop action as a backstop, not a circuit breaker.

## aws-trusted-advisor | d1
TOPIC: D4 services
Q:
A company on the Basic support plan wants Trusted Advisor to flag idle EC2 instances and underused EBS volumes. Why do those checks not appear, and what does Trusted Advisor cover?
A:
Trusted Advisor checks your account against AWS best practice in six categories: cost optimisation, performance, security, fault tolerance, service limits and operational excellence. Basic and Developer plans (Developer is being discontinued) get only the service limits checks plus a few security and fault tolerance checks such as MFA on the root account. The full set, including cost checks like low-utilisation EC2 instances, underused EBS volumes, idle load balancers and unassociated Elastic IPs, needs Business Support+ or Enterprise Support, which also unlock the API and EventBridge notifications; legacy Business Support keeps them only for existing customers until it ends. The trap is picking Trusted Advisor for a cost question on a Basic plan; use Compute Optimizer or Cost Explorer there.
USAGE:
The low-utilisation check looks at CPU and network only, so a memory-bound instance can look idle; confirm with CloudWatch agent memory metrics before downsizing.

## aws-compute-optimizer-and-rightsizing | d1
TOPIC: D4 services
Q:
Before committing to a three-year Savings Plan, an architect wants evidence that the fleet is not over-provisioned. Which service gives instance-level rightsizing recommendations, and what does it need?
A:
AWS Compute Optimizer. Once you opt in, it analyses configuration and CloudWatch utilisation metrics over the last 14 days and classifies each instance as under-provisioned, over-provisioned or optimised, with an estimated monthly saving and performance risk. It covers EC2 instances and Auto Scaling groups, EBS volumes, Lambda function memory, ECS services on Fargate, RDS and more, and can show Graviton alternatives. Memory utilisation only counts when the CloudWatch agent is installed. Rightsize first and commit second, because a Savings Plan locks in spend on whatever size you run, so committing to an oversized fleet freezes the waste. The trap is picking Trusted Advisor, which flags low-utilisation instances against fixed thresholds but does not suggest a target instance type.
USAGE:
Compute Optimizer only produces Lambda memory recommendations for x86_64 functions, so arm64 functions still need Power Tuning.

## aws-ebs-gp3-vs-gp2-and-snapshot-archive | d2
TOPIC: 4.1 Cost-optimized storage
Q:
An account has hundreds of 100 GiB gp2 volumes, some no longer attached, and thousands of monthly snapshots kept for seven years of compliance. What are the three cheapest fixes?
A:
First, migrate gp2 to gp3 with a no-downtime Elastic Volumes modify: gp3 costs 20 percent less per GiB and includes a flat 3,000 IOPS and 125 MiB/s baseline regardless of size, whereas gp2 gives 3 IOPS per GiB, so small gp2 volumes only reach 3,000 IOPS by burst credits. Second, delete unattached volumes, which Trusted Advisor flags as underutilised because they still cost money. Third, move long-retained snapshots to the EBS Snapshots Archive tier, up to 75 percent cheaper for snapshots kept 90 days or longer. Archived snapshots become full copies, restores can take up to 72 hours, and you must restore before creating a volume. The trap is archiving daily incrementals, which can cost more than the standard tier.
USAGE:
Deleting or permanently restoring an archived snapshot before 90 days still bills the remaining days, so do not archive anything you might need back next month.

## aws-efs-ia-and-lifecycle | d1
TOPIC: 4.1 Cost-optimized storage
Q:
A shared EFS file system holds years of project files that nobody has opened in months, yet the storage bill keeps growing. Which feature do you enable, and when does it backfire?
A:
Turn on EFS lifecycle management. Its policies move files not accessed in Standard for a set number of days into Infrequent Access (default 30 days) and then Archive (default 90 days), and a third policy can return a file to Standard on first access. Listing a directory does not count as access. The trap is that IA and Archive charge per read, deliver first bytes in tens of milliseconds and bill a 128 KiB minimum per file, so they suit data read a few times a quarter or year, never hot data. A One Zone file system is the alternative for data that does not need the highest availability, but it does not survive loss of its Availability Zone.
USAGE:
After a month, check how much data still sits in Standard; if most of it does, the workload touches files more often than assumed and IA access charges can outweigh the savings.

## aws-rds-reserved-and-stop-start | d1
TOPIC: 4.3 Cost-optimized database
Q:
A team runs a production PostgreSQL instance 24 hours a day and a dev instance used a few hours a week. What is the cheapest setup for each, and what surprises people who simply stop the dev instance?
A:
For the steady production database buy a reserved DB instance: a one or three year commitment that discounts the hourly instance charge for a matching engine, class and Region; storage, backups and I/O are not discounted. Stop the dev instance when idle so instance hours stop, though provisioned storage and backup storage are still billed. The trap is that RDS automatically restarts a stopped instance after seven consecutive days so it does not miss maintenance, so a database parked for a month runs and bills again. For longer gaps take a snapshot and delete it, or use Aurora Serverless with a minimum of zero ACUs, which pauses after an idle interval and resumes on the next connection.
USAGE:
Automate the stop and start with a scheduler rather than relying on memory, and keep in mind that each stop resets the seven day clock, not the calendar month.

## aws-cloudwatch-logs-metric-filters-and-insights | d2
TOPIC: D2 services
Q:
An application writes ERROR lines to CloudWatch Logs; the team wants to be paged when errors spike, to investigate them interactively, and to stream them to an external SIEM. Which CloudWatch Logs feature serves each need?
A:
A metric filter matches a pattern in incoming events and publishes a numeric CloudWatch metric, and an alarm on that metric does the paging; filters are not retroactive, so only events arriving after creation count. CloudWatch Logs Insights is the query tool: an interactive query language across many log groups, charged by data scanned. A subscription filter streams matching events in near real time, base64 encoded and gzip compressed, to Kinesis Data Streams, Data Firehose, Lambda or OpenSearch Service, and a cross-account destination lets a central security account receive logs from others. The distractor is picking Insights for alerting: it runs on demand, not continuously. Retention is set per log group and defaults to never expire.
USAGE:
Set a default value of 0 on metric filters so periods with logs but no matches still report a data point; otherwise the metric is sparse and alarms flap between OK and INSUFFICIENT_DATA.

## aws-cloudwatch-agent-custom-metrics | d1
TOPIC: 2.2 HA and fault tolerance
Q:
An operations team wants an alarm when an EC2 instance runs low on memory or disk space, but CloudWatch shows only CPU and network for the instance. Why, what do they add, and which tool answers the questions memory metrics cannot?
A:
EC2 publishes what the hypervisor can see: CPUUtilization, network bytes, disk I/O and status checks; memory and file system usage live inside the guest, so install the CloudWatch agent, which reports mem_used_percent, disk_used_percent and more to the CWAgent namespace (billed as custom metrics) and can ship log files too. Detailed monitoring is the distractor: it only moves the existing metrics from five-minute to one-minute periods, for a charge. Memory and disk belong to the metrics pillar, which answers how much; the other two pillars answer different questions. Logs (CloudWatch Logs with Logs Insights) answer what happened, and traces (X-Ray) answer where the time went: an instrumented request becomes segments and subsegments that X-Ray assembles into a trace map of every downstream call, which is how you find the slow microservice or database behind a latency spike, and CloudWatch's application monitoring views show the three together. Trap: CloudTrail records API calls for audit and is not workload visibility.
USAGE:
Roll the agent configuration out once through Systems Manager rather than hand-editing each host, so every new instance publishes the same memory and disk metrics from first boot.

## aws-cloudtrail-vs-config-vs-cloudwatch | d1
TOPIC: 1.3 Data security controls
Q:
A security group changed last week; the auditor asks who changed it, what its rules were each day since, whether any group now allows 0.0.0.0/0 on port 22, and wants a tamper-evident record across 40 accounts. Which service answers each?
A:
CloudTrail answers who: management events are recorded automatically and kept 90 days in Event history at no charge; a trail delivers them to S3 (one copy free), log file validation signs digest files so tampering is detectable, and an organization trail from the management account covers every account in one locked-down bucket. Data events (S3 object reads, Lambda invokes) and Insights cost extra and are off by default; CloudTrail Lake keeps queryable events for up to ten years. AWS Config answers what it looked like: configuration items over time and rules that flag the open port 22. CloudWatch answers how it performs: metrics, logs, alarms. The distractor is expecting CloudTrail to show configuration history or Config to name the caller.
USAGE:
Send the trail to CloudWatch Logs and put a metric filter on root account use or security group changes; that one pipeline joins the audit trail to real-time alerting.

## aws-systems-manager-run-command-patch-and-parameters | d2
TOPIC: 1.2 Secure workloads
Q:
A fleet of 200 EC2 instances and 50 on-premises servers needs a one-off script, monthly OS patching in a fixed window, and a shared database endpoint injected into apps, all without opening SSH. Which Systems Manager capabilities do you combine?
A:
Everything rides on the SSM Agent, which calls out to Systems Manager endpoints, so no inbound port or SSH key is needed; targets are chosen by tag or resource group. Run Command executes a document once across the fleet. Patch Manager uses a patch baseline to define approved patches and runs Scan or Scan and install operations, scheduled through a patch policy or a maintenance window. State Manager keeps a defined configuration applied on a schedule, and Automation runbooks orchestrate multi-step tasks such as building golden AMIs. Parameter Store holds the endpoint as a String or KMS-encrypted SecureString, free in the standard tier. The distractor is Secrets Manager for a plain endpoint, or Parameter Store for credentials that need rotation.
USAGE:
When an instance is missing from the managed node list, check the instance role and whether the agent can reach the Systems Manager endpoints (a VPC endpoint if there is no internet path) before touching security groups.

## aws-snow-family-selection | d3
TOPIC: D4 services
Q:
A research site holds 500 TB on local disks behind a 500 Mbps internet link. The data must be in Amazon S3 within 3 weeks, and about 50 GB of new results must follow every night after that. Which two actions meet both requirements? (Choose two.)
OPT: a *
Order three Snowball Edge Storage Optimized devices, copy the 500 TB onto them and ship them back for import into S3.
OPT: b *
Deploy an AWS DataSync agent on site with a scheduled nightly task that copies the new results into the bucket.
OPT: c
Run the whole 500 TB through DataSync over the existing link.
WHY:
The link sets the floor: 500 TB is 4,000,000 gigabits, and at 500 Mbps with 80 percent utilisation that is about 116 days, so no transfer engine on that line meets a 3-week deadline.
OPT: d
Enable S3 Transfer Acceleration on the bucket and upload through the accelerated endpoint.
WHY:
Acceleration routes uploads over CloudFront's edge network to cut long-distance latency; it cannot push more bits per second than the 500 Mbps line carries, so the 116-day estimate barely moves.
OPT: e
Order a 10 Gbps AWS Direct Connect dedicated connection for the bulk copy.
WHY:
A dedicated connection needs AWS to provision the port, up to 72 business hours, and then a partner cross connect and circuit; it is a long-lived link for repeated traffic, not something that lands 500 TB inside 3 weeks.
OPT: f
Install an S3 File Gateway on site and copy the 500 TB onto its share.
WHY:
A File Gateway caches and uploads through the same 500 Mbps link and is built for ongoing hybrid file access, not bulk migration; the bytes still take about 116 days to arrive.
A:
Snowball Edge for the bulk and DataSync for the deltas. Start with the formula: days is roughly TB x 8,000 divided by (Mbps x 0.8 x 86.4), so 100 TB over 1 Gbps takes about 12 days and 500 TB over 500 Mbps about 116. When network time misses the deadline, ship: each Storage Optimized device carries 210 TB, so three cover 500 TB. Once the base is in S3, a DataSync agent copies the nightly 50 GB in minutes with no per-job device cost. Online levers that do help: more bandwidth, Direct Connect for recurring traffic, parallel agents, Transfer Acceleration across continents. AWS no longer offers Snow devices to new customers, yet the exam still tests this rule.
USAGE:
Run the bandwidth formula with the usable share of the link and real working hours; a line shared with production traffic often delivers a fraction of its label.

## aws-storage-gateway-modes | d2
TOPIC: 3.1 High-performing storage
Q:
An office file server must keep its NFS and SMB shares while the data lives in S3, and the backup team wants to retire physical tapes without changing backup software. Which Storage Gateway types fit, and when is DataSync the wrong answer?
A:
S3 File Gateway presents NFS and SMB shares whose files become S3 objects, with a local cache for recently used data. Tape Gateway presents a virtual tape library over iSCSI, so existing backup software writes to virtual tapes held in S3 and ejected tapes archive to S3 Glacier Flexible Retrieval or Deep Archive. Volume Gateway covers iSCSI block: stored volumes keep the whole dataset on site and back up to S3 as EBS snapshots, cached volumes make S3 primary. The rule: ongoing on-premises access with cloud backing is Storage Gateway; a one-time or scheduled bulk copy is DataSync, a mover that leaves no persistent mount behind; NetApp features on both sides is FSx for ONTAP; AWS services on site is Outposts.
USAGE:
Size the cache and upload buffer disks before go-live: the guidance is a cache of at least 20 percent of the file store and larger than the upload buffer, and an undersized cache shows up as slow reads and stalled uploads.

## aws-dms-and-sct | d2
TOPIC: 3.3 High-performing databases
QUALIFIER: MOST cost-effective
Q:
An on-premises Oracle database with thousands of lines of PL/SQL must move to AWS. The company wants to stop paying Oracle licence fees, keep the application online during the move, and cut over with minutes of downtime. Which approach is the MOST cost-effective way to do this?
OPT: a *
Run AWS SCT to assess and convert the schema and PL/SQL to Aurora PostgreSQL, then migrate with DMS using a full load followed by change data capture until cutover.
OPT: b
Migrate to RDS for Oracle using the Bring Your Own License model.
WHY:
RDS for Oracle removes server administration, but BYOL means you keep buying Oracle licences, so the cost goal is untouched, and a Multi-AZ deployment needs licences for both the primary and the standby.
OPT: c
Convert the schema with SCT to Aurora MySQL and migrate with DMS.
WHY:
Aurora MySQL also drops the licence, but MySQL's procedural language and feature set are further from Oracle than PostgreSQL's, so more of the PL/SQL fails automatic conversion and must be rewritten by hand.
OPT: d
Use DMS alone with continuous replication from Oracle to Aurora PostgreSQL.
WHY:
DMS moves data and creates basic tables and primary keys; it does not convert PL/SQL packages, triggers, views or sequences, so the application arrives on a target with none of its stored code to run.
A:
SCT plus DMS into Aurora PostgreSQL. SCT assesses the source, converts the schema and code objects to the target engine and flags what it cannot convert so you finish those parts by hand; AWS's Oracle to Aurora PostgreSQL migration playbook maps PL/SQL to its PostgreSQL counterparts feature by feature, which is why PostgreSQL is the usual target for PL/SQL-heavy schemas. DMS then runs a full load followed by change data capture from the source's transaction logs, so Oracle keeps serving traffic and the cutover shrinks to a final sync. Homogeneous moves such as Oracle to Oracle need DMS only, and one endpoint must be in AWS. RDS for Oracle keeps the licence bill, Aurora MySQL converts less cleanly, DMS alone leaves the schema unconverted, and DynamoDB is the wrong data model for PL/SQL-heavy OLTP.
USAGE:
Watch the task's CDCLatencySource and CDCLatencyTarget metrics and let them settle near zero before you point the application at the target; spikes during heavy source activity such as batch jobs are normal.

## aws-application-migration-service-mgn | d1
TOPIC: D4 services
Q:
A company wants to move two hundred on-premises virtual machines to EC2 with no code changes and only minutes of downtime. Which service does the move, and which services help plan and track it?
A:
Application Migration Service (MGN) is the lift and shift tool. An agent on each source server performs continuous block-level replication into a staging area in your account, and the servers keep running while replication happens. You launch test instances from the replicated data without pausing replication, then launch cutover instances, so the cutover window is typically minutes. Application Discovery Service comes first: its agentless collector or agent inventories servers, utilisation and network connections so you can group them into applications. Migration Hub is the single place that tracks the status of each application migration across MGN and DMS. The distractor is Database Migration Service, which moves databases rather than whole servers.
USAGE:
The console now brands MGN as AWS Transform MGN, and Migration Hub and Application Discovery Service are closed to new customers, but the exam still uses the classic names.

## aws-migration-strategies-7rs | d1
TOPIC: 3.5 Data ingestion and transformation
Q:
A migration assessment tags each application with one of the 7 Rs. How do you tell rehost, relocate, replatform, refactor, repurchase, retain and retire apart when the exam gives you a constraint?
A:
Rank them by how much change they allow. Rehost (lift and shift) moves servers unchanged, suiting tight deadlines and large fleets. Relocate moves servers to a cloud version of the same platform, or an RDS instance to another account, with no rewrite; it is the quickest. Replatform (lift, tinker and shift) adds some optimisation, a few changes or many, without redesigning the core, such as self-managed SQL Server to RDS. Refactor redesigns core components for cloud-native features, is the most complex and costly, and AWS advises modernising after a large migration instead. Repurchase (drop and shop) swaps to SaaS to shed licences. Retain defers an application; retire decommissions it. The trap is choosing refactor when the question stresses time.
USAGE:
Idle or zombie servers found during discovery are retire candidates, and cutting them is the cheapest migration win.

## aws-cloudformation-vs-cdk-vs-elastic-beanstalk | d1
TOPIC: D2 services
Q:
When do you choose CloudFormation, the CDK, or Elastic Beanstalk to stand up an application's infrastructure?
A:
CloudFormation is the declarative engine: a template describes resources, a stack creates and updates them, drift detection reports changes made outside the stack, and StackSets push one template into many accounts and Regions. The CDK sits on top: you write constructs in TypeScript, Python or another supported language, it synthesises a CloudFormation template, and CloudFormation still performs the deployment, so you gain loops and reuse without a new provisioning service. Elastic Beanstalk sits higher again: you upload code and it provisions instances, load balancing, scaling and health monitoring at no charge beyond the resources, so pick it when developers should not manage infrastructure. The trap is treating the CDK as a rival to CloudFormation; it is a generator for it.
USAGE:
Drift detection only reports; you still have to fix the resource or update the template, and it skips properties the template never set explicitly.

## aws-elastic-beanstalk-deployment-policies | d2
TOPIC: 2.2 HA and fault tolerance
Q:
An Elastic Beanstalk environment must deploy a new version with no loss of capacity and a fast, safe rollback if health checks fail. Which deployment policy do you choose, why not rolling, and what wider principle is it applying?
A:
Choose immutable: it launches a full set of new instances in a separate Auto Scaling group; if they fail health checks Beanstalk terminates them and leaves the originals untouched, so rollback is discarding the new group. Rolling updates existing instances a batch at a time, so capacity drops and a failure leaves a mixed fleet; rolling with an additional batch keeps capacity but rollback stays manual; all at once takes every instance offline; traffic splitting adds a canary on top of immutable; blue/green is a CNAME swap between environments, not a policy. Immutable is Beanstalk's form of immutable infrastructure: never patch a running server; bake a golden AMI with EC2 Image Builder (free beyond the resources it uses), roll it out with a launch template and an Auto Scaling instance refresh, and roll back by relaunching the previous image, so fleets never drift; in-place tools such as Systems Manager Patch Manager are the mutable distractor when a question says drift or integrity. Beanstalk itself costs nothing extra: upload Go, Java, .NET, Node.js, PHP, Python, Ruby or Docker code and it provisions EC2, Auto Scaling, a load balancer, CloudWatch and optionally RDS while you keep full access to them; pick ECS or EKS for multi-service container fleets and CloudFormation when the resource set must be custom.
USAGE:
After a CNAME swap keep the old environment alive until DNS caches expire, because resolvers do not always honour your TTL.

## aws-codedeploy-blue-green-lambda-ecs | d2
TOPIC: D2 services
Q:
A team wants CodeDeploy to send 10 percent of traffic to a new Lambda version, watch an error alarm, then shift the rest automatically. Which deployment type and configuration do they need, and how does this differ from EC2?
A:
Lambda and ECS deployments in CodeDeploy are always blue/green: traffic on a Lambda alias or an ECS task set shifts to the new version according to a deployment configuration. Canary moves a first slice, waits a set number of minutes, then moves the rest; linear moves the same slice every interval; all-at-once moves everything. Attach CloudWatch alarms to the deployment group, up to ten, and enable automatic rollback: if any alarm fires the deployment stops and the last known good revision is redeployed. Only EC2 and on-premises also allow in-place deployment, which updates instances in batches under a minimum healthy hosts rule; EC2 blue/green provisions replacement instances. The trap is offering in-place for Lambda or ECS, which does not exist.
USAGE:
A rollback is a brand new deployment with its own ID, so scripts that key on the deployment ID must expect it.

## aws-config-rules-remediation | d2
TOPIC: 1.3 Data security controls
Q:
Security wants every unencrypted EBS volume and every security group open to the internet on port 22 detected and fixed automatically across all accounts. Which service, and how do the pieces fit?
A:
AWS Config. It records configuration history and evaluates resources against rules: managed rules are predefined and customisable, for example that EBS volumes are encrypted or a security group blocks a port, while custom rules run your Lambda function or a Guard policy. A failing resource is marked noncompliant. Remediation attaches a Systems Manager Automation runbook to the rule; set it to automatic and Config runs the runbook, with optional retries, whenever a resource is noncompliant. A conformance pack bundles rules and remediation into one unit deployed to an account or a whole organisation; an aggregator gives a read-only view across accounts and Regions but cannot deploy rules. The trap is CloudTrail, which logs API calls but never judges compliance.
USAGE:
Automatic remediation works from a periodic compliance snapshot, so it can occasionally run against a resource that was already fixed; make runbooks idempotent.

## aws-resource-access-manager | d1
TOPIC: 1.1 Secure access
Q:
Ten accounts in an organisation each need subnets in one central VPC and a route through one Transit Gateway. Do you build these in every account or share them, and with what?
A:
Share them with AWS Resource Access Manager. The owning account creates a resource share naming the resources and the principals: the whole organisation, an OU or individual accounts. Consuming accounts then see the shared subnet or Transit Gateway in their own console as if it were native, while the owner keeps ownership and one set of permissions, so nothing is duplicated per account. Sharing inside an organisation needs no invitation once enabled; an outside account must accept one. Shareable types include subnets, Transit Gateways, Route 53 Resolver rules, License Manager configurations and prefix lists. Subnets can only be shared within the organisation, and default subnets not at all. The distractor is VPC peering, which links separate VPCs instead.
USAGE:
A resource share is Regional, so a Transit Gateway in one Region needs a share created in that same Region.

## aws-well-architected-pillars | d1
TOPIC: D2 services
Q:
What are the six pillars of the AWS Well-Architected Framework, and what does the Well-Architected Tool actually do with them?
A:
The pillars are operational excellence (run and improve workloads and processes), security (protect data, systems and assets), reliability (perform the intended function correctly and consistently), performance efficiency (use computing resources efficiently as demand and technology change), cost optimisation (deliver business value at the lowest price point) and sustainability (cut energy use and total resources required). You trade pillars by business context: a development environment might trade reliability for cost, but security and operational excellence are generally not traded away. The Well-Architected Tool is a no-charge service where you answer the framework's questions for a workload and receive recommendations; custom lenses add your own questions. The trap is a five-pillar answer that forgets sustainability, or claiming the Tool changes your architecture.
USAGE:
Record a milestone in the Tool before each major release so the review history shows what changed and why.

## aws-outposts-local-zones-wavelength | d2
TOPIC: 3.4 Scalable network
Q:
A game studio needs single-digit-millisecond EC2 latency for players in a city far from any Region, and a hospital must run EC2 and RDS on its own site so patient records never leave the building. Which two placements meet these requirements? (Choose two.)
OPT: a *
Enable the AWS Local Zone for that city and create a subnet in it for the game servers.
OPT: b *
Order an AWS Outposts rack for the hospital and run the EC2 and RDS resources in an Outpost subnet.
OPT: c
Deploy the game servers in an AWS Wavelength Zone for that city.
WHY:
Wavelength Zones sit inside a telecommunications carrier's 5G network and serve mobile devices on that carrier; players on home broadband or another carrier get no benefit, so the placement fails for a general audience.
OPT: d
Serve the game from CloudFront edge locations near the city.
WHY:
CloudFront caches and accelerates HTTP; it hosts no EC2 instances, so a stateful game server cannot run at an edge location.
OPT: e
Launch the hospital's instances in a cluster placement group in the nearest Region.
WHY:
A placement group packs instances close together inside one Availability Zone to cut latency between them; the data still lives in an AWS Region, which breaks the never-leaves-the-site rule.
A:
Use a Local Zone subnet for the players and an Outposts rack for the hospital. A Local Zone is an extension of its parent Region placed near a large population centre; you enable it, add a subnet, and serve that metro with single-digit-millisecond latency while the Region's control plane keeps managing it. Outposts is AWS-managed hardware installed in your own facility, so compute and data stay on premises. A Wavelength Zone only helps devices on the carrier's 5G network, and CloudFront has no compute. Choose by where the users and the data must physically sit.
USAGE:
Order the rack form factor: the 1U and 2U Outposts servers are no longer sold to new customers and never ran EBS, RDS, ElastiCache, EMR or ALB, so a hospital that needs RDS on site gets it only on a rack.

## aws-secrets-manager-vs-parameter-store | d2
TOPIC: 1.2 Secure workloads
Q:
An RDS master password must rotate on a schedule with no custom code, the free Parameter Store SecureString is proposed, and a reviewer finds an access key in EC2 user data. Which store fits, and how should the app hold credentials at all?
A:
Secrets Manager whenever rotation is required: managed rotation for RDS, Aurora, DocumentDB and Redshift, Lambda rotation for anything else, cross-account access through a resource policy, about $0.40 per secret per month plus $0.05 per 10,000 calls. Parameter Store SecureString is KMS-encrypted and free in the standard tier, so it wins for plain configuration, but has no rotation. Neither store is where AWS credentials belong: compute gets a role, delivered by IMDSv2 on EC2 (session token from a PUT, hop limit 1), a task role on ECS and an execution role on Lambda, and the SDK picks them up. Keys in user data, an AMI, a repo or an env file are the anti-pattern; fetch third-party secrets at runtime.
USAGE:
When sharing a secret across accounts, encrypt it with a customer managed KMS key and grant the other account in the key policy, because the AWS managed key aws/secretsmanager cannot be used for cross-account access.

## aws-waf-vs-shield | d1
TOPIC: 1.2 Secure workloads
Q:
An Application Load Balancer fronting a public API receives SQL injection payloads while a SYN flood hits the network layer, and finance asks what each protection costs. Which service handles each, and when is Shield Advanced worth it?
A:
WAF is layer 7: a web ACL of AWS managed rule groups (SQLi, XSS, bot control), custom geo, header and IP-set rules, and rate-based rules, attached to CloudFront, ALB, API Gateway REST, AppSync, Cognito user pools, App Runner and Amplify, never to an NLB or EC2, billed $5 per web ACL, $1 per rule and $0.60 per million requests. Shield Standard is free and always on for layer 3 and 4 floods. Shield Advanced costs $3,000 a month with a one-year commitment: Shield Response Team, DDoS cost protection credits, WAF at no extra charge on protected resources, health-based detection; pick it only when the stem names those. The trap: WAF for a volumetric flood, Shield for an injection payload.
USAGE:
Deploy a new WAF rule with the Count action first so you can confirm what it would match before switching it to Block.

## aws-ec2-enhanced-networking-efa | d3
TOPIC: 3.2 Elastic compute
QUALIFIER: MOST performant
Q:
A CFD team runs a tightly coupled MPI simulation across 64 EC2 instances that exchange messages constantly, and they want the lowest inter-node latency AWS can offer. Which deployment is MOST performant for this workload?
OPT: a *
Launch 64 instances of one EFA-capable instance type in a single request into a cluster placement group in one Availability Zone, attach an EFA to each, and run MPI over Libfabric.
OPT: b
Launch the instances into a spread placement group across three Availability Zones with enhanced networking enabled.
WHY:
Spread places each instance on distinct hardware to isolate failures, allows only seven running instances per AZ, and cross-AZ links add distance; it is the opposite of the locality a latency-bound MPI job needs.
OPT: c
Launch the instances into a partition placement group with seven partitions in one Availability Zone.
WHY:
Partition groups keep each partition on separate racks so large replicated systems such as HDFS and Cassandra survive a rack failure; that isolation is a fault-tolerance feature, not the tight packing that minimises latency between every pair of nodes.
OPT: d
Enable enhanced networking with ENA on a current-generation instance type and rely on TCP/IP between the nodes.
WHY:
ENA raises bandwidth and packets per second and is all a web fleet needs, but the traffic still goes through the kernel TCP/IP stack; only the EFA device gives MPI a path around the kernel that cuts latency.
A:
A cluster placement group packs the instances into one low-latency, high-bisection-bandwidth segment inside a single AZ, and an Elastic Fabric Adapter adds a device whose Libfabric interface goes around the operating system kernel so Open MPI and NCCL talk to the hardware directly, at no extra charge. Launch all 64 as one instance type in one request to avoid insufficient-capacity errors, and remember EFA traffic cannot cross AZs or VPCs. Spread and partition groups exist to separate instances for fault tolerance, so they add distance; ENA alone is enhanced networking without the kernel-skipping path, fine for an API fleet but slower for MPI. For the working files, pair the cluster with FSx for Lustre.
USAGE:
Give EFA instances a security group with self-referencing rules allowing all inbound and outbound traffic to and from the group itself, since without them EFA traffic between instances is blocked.

## aws-datasync-vs-transfer-family | d2
TOPIC: D4 services
QUALIFIER: LEAST operational overhead
Q:
About 40 trading partners push CSV files every day over SFTP with their existing clients and credentials. Each file must land in Amazon S3 and immediately trigger a processing job. Which design meets this with the LEAST operational overhead?
OPT: a *
An AWS Transfer Family SFTP endpoint backed by the S3 bucket, with a user per partner, and an S3 event notification that starts the processing job.
OPT: b
Install an AWS DataSync agent at each partner site and schedule tasks that copy the files into S3.
WHY:
DataSync moves data from storage you control, NFS, SMB, HDFS or object stores, on your schedule; you cannot install and operate agents inside 40 partners' networks, and it gives them no SFTP login at all.
OPT: c
Run an SFTP server on an EC2 instance that writes to an EBS volume and syncs to S3 with a cron job.
WHY:
You now patch the OS, rotate host keys, manage users, size the instance and keep it highly available; Transfer Family is that same server delivered as a managed service.
OPT: d
Deploy an S3 File Gateway and give the partners its NFS or SMB share.
WHY:
Storage Gateway gives your own on-premises applications ongoing file access to S3; it is a hybrid access appliance inside your network, not an internet-facing SFTP endpoint partners can log into.
A:
Transfer Family: a fully managed SFTP, FTPS, FTP and AS2 endpoint that stores files in S3 or EFS, authenticates users through its own store, a directory or a custom identity provider, and needs no server; an S3 event or a managed workflow then fires the job. The four transfer tools divide by direction and duration. Transfer Family receives from outsiders. DataSync is your scheduled bulk copy from NFS, SMB, HDFS or object storage, and one task can fill a 10 Gbps link. Storage Gateway is ongoing hybrid access, not a migration tool. Snow devices ship data offline when network time misses the deadline. Trap: DataSync for partner uploads, or Transfer Family for a one-off internal copy.
USAGE:
Give each partner a Transfer Family user scoped to its own S3 prefix and wire the bucket's ObjectCreated event to the job, so nobody has to poll a directory.

## aws-purpose-built-databases-selection | d2
TOPIC: 3.3 High-performing databases
Q:
A fraud-detection feature must traverse millions of relationships between accounts, devices and cards in milliseconds, and a separate IoT feature stores sensor readings queried by time window with retention rules. Which two purpose-built databases fit? (Choose two.)
OPT: a *
Amazon Neptune for the account, device and card relationship graph.
OPT: b *
Amazon Timestream for the sensor readings.
OPT: c
Aurora PostgreSQL with recursive common table expressions for the relationship traversal.
WHY:
SQL against highly connected data needs a self-join per hop, so a traversal that is trivial at two hops degrades sharply at five or six; a graph engine exists precisely because such queries are hard to write and tune in relational tables.
OPT: d
DynamoDB with adjacency-list items for both features.
WHY:
Adjacency lists can store edges and time-keyed items, but every hop is another round trip and every time window needs careful key design and manual expiry; it is a workable design, not the purpose-built engine the question asks for.
OPT: e
Amazon Redshift for both features.
WHY:
Redshift is a warehouse optimised for large analytical scans and joins over tables; it is not built for millisecond point traversals or high-volume sensor ingestion with retention tiers.
OPT: f
Amazon OpenSearch Service for the relationship traversal.
WHY:
OpenSearch indexes documents for full-text and log search; it can find accounts matching a term but does not walk the relationships between them.
A:
Neptune for relationship traversal and Timestream for time-series data. Map the scenario keyword to the engine: highly connected data is Neptune; timestamped IoT or metrics data is Timestream; MongoDB-compatible documents are DocumentDB; Cassandra workloads are Keyspaces; a durable Redis or Valkey compatible primary store is MemoryDB; key-value access at any scale is DynamoDB. Aurora or RDS wins only when the question stresses tables, joins and referential integrity, and AWS expects one application to combine several best-fit engines rather than force everything into one. Amazon QLDB, once the ledger answer, is no longer among the services AWS's database decision guide covers.
USAGE:
AWS guidance expects one application to combine several best-fit databases, so a scenario may legitimately need more than one engine rather than a single relational store.

## aws-route53-resolver-hybrid-dns | d2
TOPIC: 3.4 Scalable network
Q:
On-premises servers connected over Site-to-Site VPN must resolve names in a Route 53 private hosted zone, and EC2 instances must resolve corp.internal names on an on-premises DNS server. What do you deploy in the VPC?
A:
Deploy a Route 53 Resolver inbound endpoint so on-premises resolvers can forward private hosted zone queries into the VPC, and an outbound endpoint with a forwarding rule for corp.internal so the VPC resolver sends those queries to the on-premises DNS server. Each endpoint is backed by elastic network interfaces with private IP addresses in your subnets, reachable over a private connection such as Direct Connect or Site-to-Site VPN. The default resolver at the VPC CIDR plus two is intended for resources inside the VPC; AWS states that forwarding queries to it from on-premises or other VPC DNS servers is not supported and can give unstable results. The distractor is pointing on-premises servers at that .2 address.
USAGE:
Give each Resolver endpoint IP addresses in at least two Availability Zones, and associate the private hosted zone with the VPC that hosts the inbound endpoint.

## aws-s3-lifecycle-rules-minimums | d2
TOPIC: 4.1 Cost-optimized storage
Q:
A single S3 lifecycle rule moves log objects to S3 Standard-IA at day 7 and then to S3 Glacier Deep Archive at day 20. Which step does S3 reject, and why?
A:
The day 20 step is the fault, not the day 7 step. A single lifecycle rule cannot schedule the next transition before the previous class's minimum storage duration has elapsed. Minimums include 30 days for Standard-IA and One Zone-IA, 90 days for Glacier Flexible Retrieval and 180 days for Deep Archive, so after a day 7 move to Standard-IA the Deep Archive step must be day 37 or later. Moving to Standard-IA at day 7 alone is valid; a prorated charge for the rest of the 30 day minimum applies only if the object later leaves Standard-IA before day 37, for example through a second rule. Objects under 128 KB are not transitioned by default. The distractor blames the day 7 IA step or accepts the rule unchanged.
USAGE:
Expiration rules do not remove incomplete multipart uploads; add an AbortIncompleteMultipartUpload action with DaysAfterInitiation so abandoned parts are cleaned up.

## aws-least-privilege-pattern | d1
TOPIC: 1.1 Secure access
Q:
A new deployment role must write build artifacts to one S3 bucket and update one Lambda function. A teammate proposes attaching the AWS managed AdministratorAccess policy to save time. What does the least-privilege version of this role look like, and how do you keep it tight over time?
A:
Grant only s3:PutObject on that bucket's ARN and lambda:UpdateFunctionCode on that function's ARN, adding conditions where they buy safety (a source VPC endpoint, resource tags, aws:MultiFactorAuthPresent for humans). AWS managed policies are a starting point, not an end state: AWS's own guidance is to begin broad while exploring, then shrink to customer managed policies. Prune with IAM Access Analyzer policy generation, which drafts a policy from the role's CloudTrail activity, and with last accessed information, which shows which allowed services (tracked for at least 400 days) and, for supported services, which actions went unused. Option-scanning rule: the answer naming exact actions on exact ARNs beats the one attaching a broad managed policy or a wildcard.
USAGE:
Ship each new role with a policy generated from a staging run, then revisit it after a month with last accessed data before anyone asks for a little more.

## aws-mfa-pattern | d2
TOPIC: 1.1 Secure access
Q:
A security team wants MFA on every human path into an account: console sign-in, destructive API calls, and permanent deletion of S3 object versions. Which mechanism covers each, and what is the trap when they add an MFA condition to a service control policy?
A:
IAM MFA devices (passkeys and security keys, virtual TOTP apps, hardware TOTP tokens, up to eight per user) protect console sign-in for root and IAM users. For API calls, write a Deny with BoolIfExists on aws:MultiFactorAuthPresent equal to false: the key exists only with temporary credentials and is absent for long-term access keys, so BoolIfExists catches both. S3 MFA delete is separate: only the root account can enable it, via CLI or API, never the console. The trap: role sessions (EC2, Lambda, AssumeRole) carry no MFA information, so the key reads false and an MFA Deny in an SCP blocks every workload role; check MFA on sts:AssumeRole in the trust policy instead. Identity Center and Cognito bring their own MFA.
USAGE:
Put the MFA check on the trust policy of human roles and leave workload roles alone; an SCP that demands MFA everywhere breaks the automation first.

## aws-vpc-service | d1
TOPIC: 1.2 Secure workloads
Q:
A team is designing its first VPC for a three-tier application in one Region and wants to know which decisions are fixed at creation and which settings control reachability. What is a VPC made of, and what exactly turns a subnet public?
A:
A VPC is a Regional private network with a primary IPv4 CIDR from /16 to /28; secondary CIDRs can be added (5 blocks per VPC by default, primary included) but never resize one. Each subnet lives in one Availability Zone and loses five addresses (network, router, DNS at base plus two, future use, broadcast). A subnet uses one route table (the main table unless you associate another) and is public only when that table has a route, normally 0.0.0.0/0, to an Internet Gateway; otherwise it needs NAT. Set enableDnsSupport and enableDnsHostnames true (hostnames default to false outside the default VPC): private hosted zones and PrivateLink private DNS need both. Default quota: 5 VPCs and 5 Internet Gateways per Region.
USAGE:
Plan the CIDR before the first subnet exists: you can add secondary ranges later but never grow or shrink one, and every subnet gives up five addresses off the top.

## aws-network-traffic-control-concept | d2
TOPIC: 1.2 Secure workloads
Q:
Three requests land on one VPC team in a week: block a known malicious IP range from a public subnet, let only the web tier's instances reach the database port, and stop application servers from downloading from unapproved domains. Which control handles each, and in what order does a packet meet them?
A:
A packet meets controls in layers: the route table (is there a path), the network ACL at the subnet edge (stateless, numbered allow and deny rules evaluated in ascending order until one matches), the security group on the network interface (stateful, allow only), then the OS firewall. Match the requirement to the layer that owns the verb: a deny by CIDR is a network ACL job because security groups cannot deny; "only from these instances" is a security group rule whose source is the web tier's security group; domain allow-lists and intrusion prevention need Network Firewall endpoints that route tables steer traffic through; HTTP rules belong to WAF. Security groups are the primary mechanism; network ACLs are coarse, secondary.
USAGE:
Write the requirement as a verb (deny, restrict to, allow-list) and the verb tells you which layer owns it.

## aws-kms-key-policy-grants | d2
TOPIC: 1.3 Data security controls
Q:
A developer's IAM policy allows kms:Decrypt on a customer managed key, yet every call is denied, while an EBS volume encrypted with the same key attaches fine without any Decrypt permission in the instance role. What explains both, and how do you set the key up for cross-account use and a clean administrator/user split?
A:
The key policy is the root of access: unlike other resource policies it grants the account nothing by default, so IAM policies work only while the key policy keeps the "Enable IAM User Permissions" statement (kms:* to the account root principal); remove it and identity policies become ineffective, which is the developer's denial. EBS works through a grant: integrated services create a temporary grant on the user's behalf, permitted by the kms:GrantIsForAWSResource condition, and retire it afterwards. Cross-account use needs both halves, a key policy statement allowing the external account and an IAM policy there delegating it. Separate key administrators (Create*, Put*, ScheduleKeyDeletion, no cryptographic use) from key users (Encrypt, Decrypt, GenerateDataKey*), and pin use to one service with kms:ViaService.
USAGE:
When a KMS AccessDenied appears with a correct-looking IAM policy, read the key policy before touching IAM.

## aws-tls-in-transit-pattern | d2
TOPIC: 1.3 Data security controls
Q:
An auditor requires encryption in transit end to end for a web app behind an Application Load Balancer, for its S3 uploads and for its RDS PostgreSQL connections. Where does the ACM certificate go, how do the hops behind the load balancer stay encrypted, and how do you force clients to use TLS on S3 and RDS?
A:
Terminate TLS with an ACM certificate on the edge service: CloudFront, ALB, NLB or API Gateway. ACM-managed certificates deploy only to integrated services, and EC2 needs a Nitro Enclave to attach one, so "install the ACM certificate on the instance" is the distractor; instances use ACME or exportable certificates. Behind the ALB use an HTTPS target group: the ALB re-encrypts and does not validate target certificates, so self-signed ones work; use an NLB TCP listener on 443 when the load balancer must not decrypt. Force TLS on S3 with a bucket policy Deny when aws:SecureTransport is false, on RDS with rds.force_ssl=1 (PostgreSQL, default on from version 15) or require_secure_transport=ON (MySQL, default OFF), and on private links with VPN or MACsec.
USAGE:
An HTTP target group quietly turns "encrypted in transit" into "encrypted as far as the load balancer"; check the target group protocol, not just the listener.

## aws-stateless-vs-stateful-workloads | d1
TOPIC: 2.1 Loosely coupled architectures
Q:
A web tier grew from 2 to 10 instances behind an ALB and users started losing their shopping carts whenever an instance was replaced, so someone enabled sticky sessions as the fix. Why is that a stop-gap, and where does a stateless design put the session, the uploads and the shared files instead?
A:
A stateless tier keeps nothing between requests in local memory or disk, so any instance can serve any user, scale-in loses nothing and a failed node is simply replaced; that is what allows horizontal scaling and a later move to Lambda or Fargate. Session data goes to ElastiCache (Redis, Multi-AZ) for low latency or to DynamoDB with a TTL attribute that expires sessions without consuming write throughput; uploads to S3; shared files to EFS. Sticky sessions bind a user to one target with a cookie (1 second to 7 days): they concentrate load, and when that target turns unhealthy the ALB picks another and the session is gone. Databases and brokers get EBS or EFS plus failover, not horizontal scaling.
USAGE:
If a request would fail when served by a different instance than the last one, that instance holds state you should move out.

## aws-dr-pilot-light | d2
TOPIC: 2.2 HA and fault tolerance
Q:
A payments API must limit data loss to minutes if its Region fails, but the business accepts a recovery measured in tens of minutes and refuses to pay for idle application servers. Which DR strategy fits, what exactly runs in the DR Region, and what happens at failover?
A:
Pilot light: the data tier is live and replicating continuously to the DR Region (RDS cross-Region read replica, Aurora global database, DynamoDB global tables, S3 replication) while the application tier exists only as AMIs, launch templates and Auto Scaling groups at zero capacity. Failover promotes the replica (minutes plus a reboot for RDS, under a minute for Aurora global database), scales the groups and shifts traffic with Route 53 failover records or Global Accelerator. RPO is minutes because replication never stops; RTO is tens of minutes because compute must be switched on and scaled. Cheaper than warm standby because no application compute runs, dearer than backup and restore because the database is always on. Keep backups: replication copies corruption.
USAGE:
If the DR Region cannot serve a request until you act, you are running pilot light; script the "act" so a failover is one button.

## aws-dr-warm-standby | d2
TOPIC: 2.2 HA and fault tolerance
Q:
An e-commerce site needs its DR Region to take traffic within minutes of a Regional failure and wants to exercise failover routinely without a maintenance window. Which strategy fits, how does traffic move, and what question separates it from pilot light?
A:
Warm standby: a complete, fully functional copy of the workload runs in the DR Region at reduced capacity, so it takes traffic immediately and only scales up (raise the Auto Scaling group's desired capacity) afterwards. Route 53 failover records with health checks, Application Recovery Controller switches or Global Accelerator move the traffic, and because the standby is live you can send it test traffic any time. RPO is seconds with the same continuous replication as pilot light; RTO is minutes rather than tens of minutes. It costs more than pilot light because the application tier is always running, less than multi-site active/active. The separating question: is the DR application tier already serving requests? Yes means warm standby.
USAGE:
Size the standby for the first minutes of real traffic and let Auto Scaling do the rest; raise the DR Region's service quotas before you need them.

## aws-d4-storage-services-use-cases | d2
TOPIC: 4.1 Cost-optimized storage
Q:
A cost review finds four lines of storage spend: a data lake read over HTTP, one database server's volume, a home-directory share mounted by twenty Linux instances across two AZs, and a Windows file share joined to Active Directory. Ranking by price per GB, which service is the cheapest correct answer for each, and where is the trap?
A:
Pick the cheapest service whose access model fits. Object data read over HTTP goes to S3, cheapest per GB (S3 Standard $0.023 per GB-month in US East) with colder tiers below it. One instance needing low-latency block storage gets EBS (gp3 $0.08 per GB-month, 3,000 IOPS and 125 MB/s included). POSIX files shared by many instances across AZs need EFS, pay per GB used, but $0.30 per GB-month in the Standard class, about thirteen times S3 Standard and nearly four times gp3, so it wins only when shared multi-instance access is a hard requirement. SMB with Active Directory, Lustre for HPC, or ONTAP and ZFS mean FSx. The trap is EFS for data one instance could read from EBS.
USAGE:
When EFS shows up in a cost question, ask whether more than one instance really needs the same files at the same time.

## aws-d4-pat-s3-intelligent-tiering | d1
TOPIC: 4.1 Cost-optimized storage
Q:
A media archive holds objects whose popularity is unpredictable: some are fetched daily for years, others never again after upload. Why is S3 Intelligent-Tiering the right class, what does it cost, and when does it stop being a good idea?
A:
Intelligent-Tiering moves each object on its own: after 30 consecutive days without access it drops to Infrequent Access, after 90 to Archive Instant Access, and, if you opt in, to Archive Access (90 days or more, up to 730) and Deep Archive Access (180 or more); any access moves it back to Frequent. Frequent Access costs the same as S3 Standard, there are no retrieval fees or minimum duration, and the only extra is a monitoring charge of $0.0025 per 1,000 objects per month. It stops paying off for tiny objects: anything under 128 KB is not monitored, never tiers and always pays the Frequent Access rate. When the access pattern is known and age-based, a lifecycle rule is cheaper.
USAGE:
Use Intelligent-Tiering when you cannot predict access and lifecycle rules when you can; aggregate small files before either.

## aws-d4-compute-utilization-optimization | d2
TOPIC: 4.2 Cost-optimized compute
Q:
A platform team runs 40 small microservices on a fleet of EC2 container hosts averaging 15 percent CPU, plus a thumbnail job that runs for 3 seconds a few hundred times a day. Which compute model lowers the bill for each, and what is the rule for choosing between EC2, Fargate and Lambda?
A:
Cost follows idle capacity. Containers on EC2 bin-pack many services onto fewer hosts and you pay only for instances, so they are cheapest when utilization is high and steady under a Savings Plan, but you patch hosts. Fargate charges per vCPU-second and GB-second from image pull to task exit (one-minute minimum) with no idle host, so it is cheapest for spiky or small services that leave hosts empty. Lambda charges per request plus GB-seconds at 1 ms granularity, capped at 15 minutes and 10,240 MB, so it is cheapest for sporadic, short invocations. Here: the 40 services onto Fargate or a smaller committed fleet, the thumbnail job onto Lambda. Steady high utilization favours EC2; bursty work favours Fargate or Lambda.
USAGE:
Look at average utilization before the instance type: the half-empty host is the cost, not the hourly rate.

## aws-d4-pat-nat-single-vs-per-az | d2
TOPIC: 4.4 Cost-optimized network
Q:
A production VPC spans three AZs and every private subnet routes 0.0.0.0/0 to one NAT gateway in AZ-a. Finance sees a data-transfer line nobody can explain, and the last AZ-a event cut all outbound traffic. What is wrong, what does the fix cost, and when is the single NAT still the right choice?
A:
A NAT gateway lives in one AZ, so instances in AZ-b and AZ-c cross a zone boundary to reach it and pay $0.01 per GB each direction on top of the $0.045 per GB processing fee, and an AZ-a failure cuts their egress. The fix is one NAT gateway per AZ, with one private route table per AZ whose default route points at the local NAT; cross-AZ charges disappear and an AZ failure stays inside its zone. The price is the hourly fee per AZ: $0.045 per hour, about $33 per month per gateway. A single shared NAT still fits non-production or low-traffic VPCs where losing an AZ is tolerable. A gateway endpoint removes NAT charges for S3 and DynamoDB.
USAGE:
One route table per AZ is the whole trick: the subnet's default route must name the NAT in its own zone, or the extra gateways change nothing.

## aws-svc-ec2-when-and-when-not | d1
TOPIC: D4 services
Q:
A team is deciding whether a new workload belongs on EC2 or on a managed service. When is a virtual machine the right and cheapest choice, when is it the wrong one, and in what order do you pull EC2's cost levers?
A:
EC2 is the general-purpose virtual machine: you pick an instance type, pay per second with a 60-second minimum, and own the operating system. Choose it for OS control, GPUs, steady long-running load that a Savings Plan discounts by up to 72 percent, server-bound licences that need Dedicated Hosts, or a lift-and-shift. Do not choose it for sporadic short tasks Lambda runs per invocation, containers Fargate runs without hosts, or a database, queue or file service AWS already manages. Cost levers in order: rightsize the instance, move to Graviton (up to 20 percent cheaper), pick the purchasing option, stop or schedule idle instances, and put interruptible work on Spot for up to 90 percent off.
USAGE:
Before comparing instance prices, ask whether the instance should exist at all: an idle t3 kept alive for a cron job costs more than the Lambda invocations that would replace it.

## aws-svc-s3-when-and-when-not | d1
TOPIC: D4 services
Q:
An architect is asked whether S3 can replace a file server, a database and a set of EBS volumes. What is S3 built for, where does it stop, and which levers control its cost?
A:
S3 is object storage: whole objects up to 50 TB (5 GB per single PUT), unlimited count, designed for 99.999999999 percent durability, billed per GB-month by storage class plus requests and internet egress. It is the cheapest durable store and the default for static content, backups, logs and data lakes. It is not a boot or block volume, has no POSIX file semantics or locks, cannot modify part of an object in place, and is not a transactional database. Cost levers: pick the storage class and lifecycle rules, batch small objects to cut request charges, serve through CloudFront to cut internet egress, and reach it from a VPC through a gateway endpoint so no NAT gateway meters the traffic.
USAGE:
If the code needs to seek inside a file, hold a lock or edit bytes in place, it wants EBS or EFS; if it only writes and reads whole files, S3 is the cheaper answer.

## aws-control-tower-service | d1
TOPIC: 1.1 Secure access
Q:
A company is about to build its first multi-account AWS environment. It wants dedicated log archive and audit accounts, guardrails that block or flag non-compliant configuration in every account, and a self-service way for teams to request new accounts that are governed from the moment they exist. Which service should the architect use, and when would plain AWS Organizations be the better answer?
A:
Use AWS Control Tower. It orchestrates AWS Organizations, IAM Identity Center and Service Catalog to build a landing zone: organizational units, the shared Log Archive and Audit accounts, and controls (guardrails). Preventive controls are SCPs and RCPs that deny actions; detective controls are AWS Config rules that flag drift; proactive controls are CloudFormation hooks that stop non-compliant resources before they are provisioned. Account Factory vends new accounts with those controls already applied. Choose plain Organizations when you already run a custom multi-account structure or only need SCPs and consolidated billing: Control Tower expects to own the landing zone it creates, and an existing organization must be registered and its OUs and accounts enrolled before it governs them.
USAGE:
Start a greenfield multi-account estate with Control Tower so governance arrives through Account Factory rather than through tickets; retrofitting it onto a hand-built organization is an enrollment project.

## aws-directory-service | d2
TOPIC: 1.1 Secure access
Q:
Three teams each need Active Directory on AWS. Team one runs RDS for SQL Server and wants a trust with the on-premises forest. Team two only wants on-premises users to sign in to WorkSpaces and the AWS console with their existing credentials plus RADIUS MFA, and must keep no directory data in the cloud. Team three needs a small, cheap standalone directory for Linux hosts that speak LDAP. Which AWS Directory Service option fits each team?
A:
Team one: AWS Managed Microsoft AD, real Windows Server AD run by AWS. It supports forest trusts with on-premises AD, RADIUS MFA, schema extensions and LDAPS, and it is the only option compatible with RDS for SQL Server (Standard Edition holds about 30,000 objects, Enterprise about 500,000). Team two: AD Connector, a proxy that forwards sign-in requests to on-premises domain controllers over VPN or Direct Connect, stores nothing in AWS and supports RADIUS MFA, but cannot form trusts and is not compatible with RDS SQL Server. Team three: Simple AD, Samba 4 based with basic AD features but no MFA, no trusts and no LDAPS. IAM Identity Center can use Managed Microsoft AD or AD Connector as its identity source.
USAGE:
If the stem mentions RDS for SQL Server or a trust relationship, only Managed Microsoft AD qualifies; "no directory data in the cloud" points to AD Connector.

## aws-global-infrastructure-security-concept | d1
TOPIC: 1.1 Secure access
Q:
A European bank must guarantee that customer data never leaves the EU, yet its engineers still need IAM, Route 53 and CloudFront, whose API endpoints sit in us-east-1. Which boundary actually keeps the data in place, and how do you enforce it across 40 accounts without breaking those global services?
A:
The Region is the residency boundary: AWS states it will not move or replicate your content outside the Regions you choose, so data leaves only when you configure replication. Availability Zones are isolated fault domains inside a Region, not residency units. Enforce the rule once with an SCP that denies every action whose aws:RequestedRegion is outside the approved list, using NotAction to exempt global services (IAM, Organizations, Route 53, CloudFront, Support), which are served from us-east-1 and would otherwise be blocked. KMS keys, ACM certificates and VPCs are Regional, so create them in the approved Region. Per-account IAM policies are the wrong tool: they must be copied everywhere and any account admin can edit them.
USAGE:
Whenever a residency question mentions many accounts, answer SCP plus aws:RequestedRegion, then check the NotAction list for the global services the workload still needs.

## aws-shared-responsibility-model | d1
TOPIC: 1.1 Secure access
Q:
An auditor asks who patches the operating system, who configures encryption and who secures the physical hosts for three workloads: an application on EC2, a PostgreSQL database on RDS, and a Lambda function reading from S3. How does the answer change across the three?
A:
AWS is responsible for security of the cloud: the hardware, software, networking and facilities that run every service, including the hypervisor and the patching of managed platforms. The customer owns security in the cloud, and what that covers depends on the service chosen. On EC2 you patch the guest OS, configure security groups and choose encryption. On RDS, AWS patches the engine and OS, while you still decide encryption, access, IAM and network rules. On Lambda and S3, abstracted services, AWS runs the OS and platform; you own only your data, code, permissions and encryption settings. The line moves with the service, but data classification, IAM and encryption choices never move to AWS.
USAGE:
When a question asks who is responsible for something, first decide whether the service is infrastructure, managed platform or abstracted; the answer follows from that level.

## aws-ddos-mitigation-pattern | d2
TOPIC: 1.2 Secure workloads
Q:
A public web application on EC2 behind an ALB has been knocked offline twice by volumetric floods and once by an HTTP request flood aimed at its login page. The team proposes larger instances and blocking attacker IPs in a network ACL. What layered design should replace that proposal?
A:
Put CloudFront (or Global Accelerator for TCP and UDP apps) and Route 53 in front so the AWS Global Edge Network absorbs layer 3 and 4 floods, with Shield Standard applied automatically at no cost. Attach AWS WAF to CloudFront or the ALB with rate-based rules and Bot Control for the login flood. Hide the origin in private subnets: instances admit only the ALB's security group, the ALB only the CloudFront managed prefix list. Use Auto Scaling to absorb legitimate surges. For high-value apps, add Shield Advanced: cost protection against scaling charges, automatic application-layer mitigation and the Shield Response Team (needs Business Support+ or Enterprise). Bigger instances only raise the ceiling, and NACL entries cannot keep up with rotating IPs.
USAGE:
Requests rejected at CloudFront or by WAF are not charged for data transfer, so an edge-first design is also the cheaper one while an attack is running.

## aws-sqli-owasp-waf-pattern | d1
TOPIC: 1.2 Secure workloads
Q:
A REST API on API Gateway backed by RDS is receiving requests whose query strings and bodies contain SQL injection and path traversal payloads. Shield Standard and GuardDuty are already on. What stops these requests, and why do the existing services not?
A:
Injection, cross-site scripting and path traversal are application-layer attacks visible only inside the HTTP request, so the answer is AWS WAF on the API Gateway REST API, or on the CloudFront distribution or ALB in front of it. Attach the managed Core rule set, which covers OWASP Top 10 patterns such as XSS and local file inclusion, plus the SQL database rule group, which inspects query arguments, body, cookies, headers and URI path for SQL injection. Back it with parameterised queries and a database user granted only the rights the app needs. Shield handles network and transport floods, security groups filter by port and source, and GuardDuty detects threats after the fact; none of them read request bodies.
USAGE:
Deploy managed rule groups in Count mode first and watch their labels in CloudWatch before switching to Block, so a false positive does not take down a legitimate form.

## aws-containerize-migration-path | d2
TOPIC: 2.1 Loosely coupled architectures
Q:
A team is moving a Java web application off a single EC2 instance into containers. It writes uploaded files to its local disk, keeps user sessions in memory, and reads database credentials from a config file. What is the migration path, and which three habits must change before it can scale horizontally?
A:
Build an OCI image with a Dockerfile (App2Container automated this for Java and ASP.NET apps but has been closed to new customers since November 2025), push it to Amazon ECR, then run it as an ECS or EKS service, choosing Fargate when nobody should manage hosts. Then externalise state: uploads go to S3 or an EFS volume mounted into the task, sessions move to ElastiCache or DynamoDB, and credentials are injected from Secrets Manager or SSM Parameter Store through the task definition. A container that writes to its own filesystem cannot be replaced or duplicated safely, so it is not horizontally scalable, and an image with baked-in secrets cannot be promoted across environments.
USAGE:
Run the containerised app as two replicas behind a load balancer on day one; anything that breaks with two copies is state you forgot to externalise.

## aws-horizontal-vs-vertical-scaling | d1
TOPIC: 2.1 Loosely coupled architectures
Q:
An online store's stateless web tier and its single RDS for PostgreSQL writer are both saturated. The team wants zero downtime for the web tier and accepts a short window for the database. Which scaling direction fits each tier, and what is the hard limit of the direction you pick for the database?
A:
Scale the web tier horizontally: an Auto Scaling group or ECS service adds instances or tasks behind a load balancer with no ceiling and no downtime, which works only because the tier is stateless. A single-writer database can only be scaled vertically, by changing the DB instance class, and RDS documents that this change causes downtime; Multi-AZ keeps the window short. Vertical scaling also has a ceiling, the largest instance class. On EC2 the same limit applies and you must stop an EBS-backed instance to change its type. Read replicas add horizontal read capacity, but writes stay on one node; Aurora Serverless v2 resizes that writer in place without interrupting connections, and only DynamoDB removes the single-writer ceiling.
USAGE:
If a question says a database resize cannot tolerate downtime, look for the Multi-AZ or Aurora option rather than a bigger instance class.

## aws-managed-vs-self-hosted-rule | d2
TOPIC: 2.1 Loosely coupled architectures
Q:
A migration inventory lists an SFTP server on EC2, a RabbitMQ broker on EC2, a cron box that runs nightly jobs, and passwords stored in application config files. The requirement for every item is the least operational overhead. Which managed replacement fits each, and when is the self-run version still the right answer?
A:
Map each self-run component to its managed twin: SFTP on EC2 becomes AWS Transfer Family (SFTP, FTPS, FTP and AS2 into S3 or EFS); RabbitMQ or ActiveMQ on EC2 becomes Amazon MQ, which runs those same engines so JMS and AMQP clients keep working; a home-grown queue becomes SQS; the cron box becomes EventBridge Scheduler, which fires cron or rate schedules at more than 270 services; config-file secrets move to Secrets Manager with rotation. Keep the self-run version only when the requirement names something the managed service cannot give: a custom broker plugin, an unsupported protocol, or OS-level control. Least operational overhead is the exam's signal to stop patching servers.
USAGE:
Amazon MQ is for moving an existing broker without rewriting messaging code; a new application should start on SQS or SNS instead.

## aws-microservice-design-principles | d2
TOPIC: 2.1 Loosely coupled architectures
Q:
A review of a microservices platform finds that six services read and write the same RDS database, and the ALB uses sticky sessions because each service keeps user carts in memory. Why is this still a monolith in disguise, and what changes make the services independently scalable and replaceable?
A:
Two habits undo microservices: a shared database and sticky sessions. Each service should own its data store and expose it only through APIs or events, so a schema change or a slow query in one service cannot break the others; the microservices whitepaper calls this distributed data management and accepts eventual consistency, sagas and event sourcing as the price. State such as carts, sessions, uploads and locks belongs in ElastiCache, DynamoDB, S3 or EFS, so any instance can serve any request and be replaced. Sticky sessions pin clients to one target, which makes load uneven and turns a target failure into lost sessions. Services must also deploy independently and fail in isolation.
USAGE:
Ask of every service whether you can deploy it alone and kill one instance without a user noticing; a no to either points at shared state.

## aws-multi-tier-architecture | d1
TOPIC: 2.1 Loosely coupled architectures
Q:
A draft design for a three-tier web application puts the ALB, the application servers and the RDS instance in one public subnet in a single Availability Zone, with security group rules written as CIDR ranges. Which four changes turn it into a correct multi-tier layout?
A:
First, split the tiers into subnets by exposure: the ALB and any NAT gateway in public subnets, the application Auto Scaling group in private subnets that reach the internet only through NAT, and the database in isolated subnets with no internet route at all. Second, replicate every tier across at least two Availability Zones, including RDS Multi-AZ. Third, let tiers talk only through a load balancer or a queue so each scales and fails independently. Fourth, write security group rules that reference the upstream tier's security group rather than CIDRs, so scaling never needs a rule change. A database in a public subnet or in a single AZ is the classic wrong answer.
USAGE:
Draw the layout as three rows (public, private, isolated) by two columns (AZ a, AZ b) before naming a single service; the grid exposes any single point of failure.

## aws-cdn-edge-caching-pattern | d1
TOPIC: 2.1 Loosely coupled architectures
Q:
A news site serves article pages and images from an Application Load Balancer in one Region. Readers on other continents see slow page loads, and the origin fleet is sized for peak read traffic. Which pattern offloads the origin and cuts latency, and what decides how much of the traffic it actually absorbs?
A:
Put CloudFront in front of the origin (S3, ALB, EC2, API Gateway or any HTTP server) so edge locations answer from cache. Origin offload equals the cache hit ratio, set by cache-key design and TTLs: by default the key is only the distribution domain plus URL path, and every header, cookie or query string you add splits the cache, so add only values that change the response. Without Cache-Control, objects stay cached for the 24-hour default TTL. Origin Shield adds a central cache that collapses duplicate misses from many regional edge caches into one origin fetch. Dynamic responses still gain TLS termination near viewers, but CloudFront is HTTP(S) only and cannot fix a slow backend whose every answer is unique.
USAGE:
Before adding a header or cookie to the cache key, ask whether the origin's response actually changes with it; if not, forward it with an origin request policy instead.

## aws-rest-api-on-api-gateway | d2
TOPIC: 2.1 Loosely coupled architectures
Q:
A REST API on API Gateway must validate request bodies before invoking Lambda, expose a service that lives behind an internal ALB, and roll a new version out to 10 percent of callers first. One operation also takes two minutes. How does each requirement map to REST API features, and what happens to the slow operation?
A:
Resources and methods map paths to HTTP verbs; each method has an integration: AWS_PROXY (Lambda proxy, the usual choice), AWS (service actions with mapping templates), HTTP or HTTP_PROXY, and MOCK. Request validation checks bodies and parameters against a model first. A VPC link private integration reaches an internal NLB or ALB. Stage canary settings send a percentage of traffic to the new deployment. The integration timeout defaults to 29 seconds (50 ms minimum); raising it above 29 seconds is possible only for Regional and private APIs and may cost account throttle quota, so a two-minute job should return 202 and finish asynchronously via SQS or Step Functions. Private REST APIs need an interface VPC endpoint and a resource policy.
USAGE:
Any stem that mentions API keys, usage plans, caching, request validation, WAF, canary releases or private endpoints is asking for a REST API, not an HTTP API.

## aws-distributed-design-patterns | d2
TOPIC: 2.2 HA and fault tolerance
Q:
During a brief DynamoDB throttling event, thousands of Lambda workers retried immediately and in lockstep, turning a one-second blip into a ten-minute outage that also stalled an unrelated reporting service sharing the same account limits. Which distributed-system patterns were missing?
A:
Four. Retries need exponential backoff with jitter: the AWS SDKs' standard mode waits random(0,1) times base delay times 2 to the retry count, capped at 20 seconds, and keeps a retry quota that stops retrying when failures are widespread, so synchronized retry storms cannot form. Operations must be idempotent so a retried write does no harm; SQS FIFO deduplicates on a MessageDeduplicationId for 5 minutes. A circuit breaker fails fast when a dependency is unhealthy instead of queueing more work. Bulkheads and cells isolate blast radius: separate accounts, quotas and partitions mean the reporting service is never starved by the checkout workers. Queues level load, and health checks route around bad nodes.
USAGE:
If you ever write your own retry loop, copy the SDK formula: full jitter, exponential growth, a cap and a budget.

## aws-route-tables-ha-angle | d2
TOPIC: 2.2 HA and fault tolerance
Q:
A VPC has private subnets in three Availability Zones that all share one route table whose 0.0.0.0/0 route points at a single NAT gateway in AZ a. When AZ a fails, instances in AZ b and AZ c lose all outbound access even though they are healthy. Why, and how should the route tables be laid out?
A:
A NAT gateway lives in one Availability Zone; AWS documents that other AZs sharing it lose internet access when that AZ goes down. The fix is one NAT gateway and one private route table per AZ, each sending 0.0.0.0/0 to the NAT gateway in the same zone, so a zonal failure black-holes only its own zone. A subnet uses exactly one route table (the main table when none is explicit), the local route for the VPC CIDR is always present, the most specific prefix wins, a route to an internet gateway is what makes a subnet public, and a virtual private gateway can propagate VPN routes automatically. Route tables are therefore a fault-isolation tool, not just a connectivity list.
USAGE:
A regional NAT gateway now expands across AZs automatically and needs no public subnet, which removes this per-AZ bookkeeping for new VPCs.

## aws-dr-backup-and-restore | d1
TOPIC: 2.2 HA and fault tolerance
Q:
A regional payroll application can tolerate several hours of data loss and up to a day of downtime if its AWS Region fails, and finance wants the cheapest possible disaster recovery. What does a backup-and-restore strategy consist of, and which mistake makes it worthless?
A:
Backup and restore is the lowest-cost DR strategy: nothing runs in the recovery Region. Schedule backups with AWS Backup (EBS, EC2, RDS, DynamoDB, EFS, FSx) and add a copy rule that sends recovery points to the DR Region; use S3 Cross-Region Replication for object data and copy AMIs across Regions. Keep infrastructure as CloudFormation or CDK templates so the stack can be rebuilt without hand work. RPO equals the backup interval and RTO is deploy time plus restore time, so AWS rates it "RPO in hours, RTO in 24 hours or less". The trap: backups kept only in the primary Region vanish with it; the cross-Region copy is the whole point. Choose pilot light or warm standby when minutes matter.
USAGE:
Restore into the DR Region on a schedule, not only during a disaster: restore is a control-plane action, and a rehearsed one is the only one you can put a time on.

## aws-batch-service-card | d1
TOPIC: 3.2 Elastic compute
Q:
A genomics team submits thousands of containerized jobs each night; some run for hours, some must wait for others to finish, and the team refuses to run its own scheduler or cluster. Which service fits, and which alternatives are the traps?
A:
AWS Batch. You write job definitions (image, vCPU, memory, IAM role), submit jobs to job queues with priorities, and Batch schedules them onto compute environments it provisions: EC2 On-Demand, Spot, Fargate or EKS, scaling between the minimum and maximum vCPUs you set. An array job launches 2 to 10,000 child jobs from one submission, and dependencies (including SEQUENTIAL and N_TO_N) chain jobs without a workflow engine. Traps: Lambda when a job can exceed 15 minutes, EMR when the work is Spark or Hadoop rather than independent containers, and EventBridge plus Lambda when it is one small script on a cron rather than a queue of jobs.
USAGE:
Pair a Spot compute environment with a job queue that also lists an On-Demand environment so interrupted jobs are retried rather than lost.

## aws-db-instance-types-pattern | d1
TOPIC: 3.3 High-performing databases
Q:
An RDS for PostgreSQL order database on a db.t3 class keeps exhausting CPU credits in production, while a separate reporting workload floods it with read queries. How should the team pick the instance class, and when is the answer to scale up rather than scale out?
A:
Match the class to the bottleneck. db.t burstable classes run at a baseline and burst on CPU credits (db.t3 and db.t4g use Unlimited mode, so sustained bursting costs extra), suiting dev and test; a production database that runs hot belongs on db.m or, when the working set must stay in memory, on db.r or db.x memory-optimised classes. The "g" suffix (db.m6g, db.r6g) marks Graviton. Scaling up is a DB instance class modification that causes downtime; on a Multi-AZ instance RDS modifies the standby first and then fails over, so the outage shrinks to the failover. Scaling out means read replicas: asynchronous, read-only copies for read-heavy traffic. Replicas add no write capacity, and a Multi-AZ DB instance's standby cannot serve reads.
USAGE:
Memory-bound, cache-heavy OLTP goes to db.r; a steady, predictable db.m workload is the one worth covering with a reserved instance.

## aws-lake-formation-service-card | d1
TOPIC: 3.5 Data ingestion and transformation
Q:
A company's S3 data lake is queried by Athena, Redshift Spectrum and EMR from several accounts. Analysts may see only certain columns and rows of a customer table, and the security team wants one place to grant and audit that rather than per-engine IAM policies. Which service provides this, and what does it not do?
A:
AWS Lake Formation. Register the S3 locations, catalog tables in the AWS Glue Data Catalog (crawlers, or blueprints that ingest from RDS and JDBC sources in bulk or incrementally), then grant database, table, column, row and cell-level permissions with a grant/revoke model; data filters enforce row and cell security and LF-Tags scale grants across thousands of tables. Athena, Redshift Spectrum, EMR, Glue and QuickSight enforce those permissions, CloudTrail records access, and cross-account sharing is built in. It is not the query engine (Athena, Redshift) and not the ETL code itself (Glue jobs).
USAGE:
When a stem says "central fine-grained permissions on the data lake" across several analytics engines, answer Lake Formation rather than bucket policies.

## aws-quick-service-card | d1
TOPIC: 3.5 Data ingestion and transformation
Q:
Business analysts want interactive dashboards over data in Athena, Redshift and RDS, shared with 300 readers, with no servers to run and fast response under load. Which AWS service is the fit, and what should it not be used for?
A:
Amazon Quick Sight, the business intelligence part of Amazon Quick, is a serverless BI service: it connects to Athena, Aurora, Redshift, RDS, S3, OpenSearch and more, loads data into SPICE, its in-memory engine, for fast consistent dashboards, and is priced per user (authors and readers) or by session capacity for embedded analytics, with 10 GB of SPICE per author included. It is the answer when business users need visualisations without infrastructure. It is not a query engine for raw data (use Athena), not a log and metrics dashboard (use OpenSearch or CloudWatch), and not an ETL tool (use Glue).
USAGE:
Schedule SPICE refreshes instead of direct queries when many readers open the same dashboard; the source database never sees their load.

## aws-data-ingestion-patterns-frequency | d1
TOPIC: 3.5 Data ingestion and transformation
Q:
Three feeds must reach S3: nightly 2 TB exports from an on-premises file server, clickstream events that may arrive within a minute, and sensor readings that two separate applications must process within a second and replay on demand. Which ingestion service fits each, and what decides?
A:
Frequency and latency decide. Batch, meaning hourly or nightly files, is DataSync, Transfer Family or Glue jobs: the nightly export is a DataSync task. Near-real-time micro-batch is Amazon Data Firehose, which buffers by size (1 to 128 MiB) or time (0 to 900 seconds, default 300) and delivers to S3 with no consumer code; that fits the clickstream. Real-time with sub-second latency, multiple consumers and replay is Kinesis Data Streams or MSK, so the sensor feed needs a stream, from which Firehose can still archive to S3. Pick Firehose when seconds of delay are fine and nobody wants to run consumers; pick Data Streams when your own code must read, fan out or replay.
USAGE:
Ask two questions of any ingestion stem: how late may the data be, and does anyone need to consume it twice?

## aws-secure-ingestion-access-points | d2
TOPIC: 3.5 Data ingestion and transformation
Q:
Producers in private subnets send records to Kinesis Data Streams and Firehose, partners upload files over SFTP, and analysts query the resulting data lake. Security wants no ingestion traffic on the internet, no long-lived keys, encryption at rest, and column-level restrictions on personal data. Which controls meet each requirement?
A:
Create interface VPC endpoints (PrivateLink) for Kinesis Data Streams and Firehose and a gateway endpoint for S3, so producers reach the services on private IPs without a NAT or internet gateway; an endpoint policy plus an IAM condition on aws:sourceVpce pins each stream to its endpoint. Producers assume IAM roles instead of holding access keys. Enable KMS server-side encryption on streams and buckets. Host the Transfer Family server as a VPC endpoint, internal or internet-facing with Elastic IPs, and use security groups to allow only partner addresses. Grant analysts access through Lake Formation, which enforces column, row and cell-level permissions in Athena, Redshift Spectrum, EMR and Glue. A bucket policy alone is not a perimeter.
USAGE:
When a stem says traffic must not traverse the public internet, look for the VPC endpoint answer before anything involving NAT, VPN or IP allow lists.

## aws-d4-cost-features-storage-tags-billing | d1
TOPIC: 4.1 Cost-optimized storage
Q:
Finance wants last quarter's S3, EBS and EFS spend split by team across 12 accounts, and asks why the organization is not getting S3 volume pricing although total storage passes 500 TB. Which billing features answer both, and what is the catch with the tags?
A:
Two features. Cost allocation tags: tag buckets, volumes and file systems with a team key, then activate the key in the management account's Billing console (only the management account can), after which Cost Explorer, Budgets and the Cost and Usage Report group storage spend by team; activation takes up to 24 hours and is not retroactive, though the management account can request a backfill of up to 12 months for tags that already existed on the resources. Consolidated billing: AWS combines usage across all accounts to determine volume pricing tiers, so S3 storage and data transfer tiers are reached by the organization as a whole. Use S3 Storage Lens to see which storage class drives the bill.
USAGE:
Enforce the team tag with a tag policy or SCP at creation time; a backfill cannot invent tags that were never on the resource.

## aws-d4-hybrid-storage-options | d2
TOPIC: 4.1 Cost-optimized storage
Q:
Three hybrid needs arrive in one ticket: an on-premises application must keep using an SMB share while its files live in S3, 80 TB must be copied once into EFS, and outside partners must keep dropping files with their own SFTP clients. Which service fits each, and how does the price shape of each service confirm the choice?
A:
Storage Gateway for the SMB share: S3 File Gateway keeps an NFS or SMB interface with a local cache and S3 behind it, billed at $0.01 per GB written, capped at $125 per gateway per month, which suits ongoing access. DataSync for the one-off copy: an agent moves data from on-premises to S3, EFS or FSx at $0.0125 per GB in Basic mode, with verification, so you pay only for bytes moved. Transfer Family for the partners: a managed SFTP, FTPS or FTP endpoint at $0.30 per hour per enabled protocol plus $0.04 per GB (AS2 bills per message instead), right for an always-on endpoint, wasteful for a one-time migration. Local access, one move, partner drop-off: gateway, DataSync, Transfer Family.
USAGE:
Price per hour means keep it running; price per GB means run it and stop; match the billing unit to how long the need lasts.

## aws-d4-storage-types-object-file-block | d1
TOPIC: 4.1 Cost-optimized storage
Q:
A media pipeline writes finished video files to a 20 TB EBS volume that is 60 percent empty, then serves them by copying to a web tier. The files are never edited in place. Which storage type should hold them, and what in each type's billing model makes the move a saving?
A:
Move them to S3 object storage. Block storage (EBS) attaches to one instance in one AZ, allows random byte-level reads and writes, and is billed for every provisioned GB whether used or not, so 8 empty TB still cost $0.08 per GB-month on gp3. File storage (EFS, FSx) is a shared POSIX or SMB namespace mounted by many instances; EFS bills per GB used, FSx per provisioned GB. Object storage (S3) stores whole objects over HTTP with no in-place edits, at $0.023 per GB-month for S3 Standard, tiered lower with volume, plus per-request fees. When an application only ever writes whole files and reads them back, S3 is the cheapest fit and the copy step disappears.
USAGE:
Any workload described as write once, read many, never modified belongs on S3 unless it needs a mount point or a boot device.

## aws-d4-pat-cost-allocation-tags | d1
TOPIC: 4.1 Cost-optimized storage
Q:
A company tags every EC2 instance, EBS volume and RDS database with CostCenter and Project, yet Cost Explorer offers no CostCenter dimension and finance cannot split last month's bill. What did they miss, and what will and will not show up once it is fixed?
A:
Resource tags become billing dimensions only after they are activated as cost allocation tags in the Billing and Cost Management console, and only the organization's management account can do that. User-defined tags and AWS-generated tags like aws:createdBy are activated separately; the AWS-generated tag is applied only to resources created after activation. Activated tags can take up to 24 hours to appear, and they show as user:CostCenter columns from then on; earlier months stay blank unless the management account requests a backfill (up to twelve months, only for resources that carried the tag then). Untagged spend still appears, just without a value, so pair activation with AWS Organizations tag policies and an SCP that requires the tag at creation.
USAGE:
Activate the tag keys the day you publish the tagging standard: the billing dimension starts at activation, not when the tag was first applied.

## aws-d4-pat-storage-auto-scaling | d1
TOPIC: 4.1 Cost-optimized storage
Q:
A team provisions every RDS instance at 2 TB "so it never runs out of disk" and every EBS volume at double its data. Which AWS storage must be sized by hand, which grows on its own, and how do you reclaim space once you have over-provisioned?
A:
S3, EFS and DynamoDB need no capacity planning: DynamoDB has no practical table-size limit; S3 and EFS grow with the data. RDS has allocated storage, but storage autoscaling grows it: when free space is at or below 10 percent for at least five minutes, RDS adds the larger of 10 GiB, 10 percent or the predicted growth, up to the maximum storage threshold you set (default 1,000 GiB). It never shrinks: allocated storage cannot be reduced, so downsizing means a blue/green deployment or a new smaller instance plus data migration. EBS Elastic Volumes grow, change type and adjust performance online but never decrease, and gp3 provisions IOPS and throughput independently of size (3,000 IOPS and 125 MiB/s baseline).
USAGE:
Start RDS storage small with autoscaling and a ceiling; a 2 TB volume that is 5 percent used is a bill you can never shrink back.

## aws-d4-cost-features-compute-tags-sharing | d2
TOPIC: 4.2 Cost-optimized compute
Q:
A platform team plans to buy Savings Plans and a few zonal Reserved Instances in the management account and wants member accounts' EC2, Fargate and Lambda usage to benefit. A sandbox account must not receive any of the discount. How does sharing work, and what limits it?
A:
In an organization, consolidated billing treats all accounts as one, so Reserved Instance and Savings Plans discounts apply first to the purchasing account and then to any member account; the management account can deactivate sharing per account (do that for the sandbox) or restrict it to groups defined with Cost Categories. Buying centrally therefore covers everyone. A Regional RI matches usage anywhere in its Region, but a zonal RI's discount reaches another account only if that account launches in the same Availability Zone name, and its capacity reservation stays with the purchaser. Sharing never crosses organizations. Cost allocation tags on EC2, Auto Scaling and Lambda show per-team utilization, and the AWS-generated aws:createdBy tag attributes spend that nobody tagged.
USAGE:
Buy Compute Savings Plans in the management account for flexible coverage; buy zonal RIs only in the account that actually needs the capacity guarantee.

## aws-d4-cost-tools-compute-angle | d2
TOPIC: 4.2 Cost-optimized compute
Q:
A CFO asks for three things about EC2 spend: which instances to shrink, how much Savings Plans commitment to buy, and an alert when an existing commitment sits under 80 percent used. Which cost tool answers each, and which one needs a paid support plan?
A:
Cost Explorer hosts Savings Plans and Reserved Instance purchase recommendations, computed from the past 7, 30 or 60 days of On-Demand usage, and EC2 rightsizing recommendations for idle or underutilized instances. AWS Budgets adds RI and Savings Plans utilization and coverage budgets that notify by email or SNS when a daily value drops below your threshold, for example 80 percent. Compute Optimizer supplies the per-resource rightsizing analysis, and Cost Optimization Hub consolidates rightsizing, idle-resource, Savings Plans and RI recommendations across accounts and Regions in one view. The Cost and Usage Report amortizes upfront commitments per hour for showback. Trusted Advisor's full cost-optimization checks require Business Support+ or above; Basic Support gets only core security and quota checks.
USAGE:
Size a commitment from the On-Demand baseline in Cost Explorer, then guard it with a utilization budget so an unused plan is noticed within a day.

## aws-d4-pat-ec2-hibernation | d2
TOPIC: 4.2 Cost-optimized compute
Q:
A rendering farm's EC2 workers take 20 minutes to load models into RAM before they can accept jobs, so the team pays for idle instances overnight to avoid the warm-up. Which EC2 feature removes the idle cost while keeping the loaded state, and what are its constraints?
A:
Hibernate the instances. Hibernation writes RAM to the encrypted EBS root volume and stops the instance: no instance charge while stopped, only EBS storage (and any Elastic IP) is billed, and start reloads memory and resumes processes. Constraints: hibernation must be enabled at launch, the root volume must be encrypted EBS large enough to hold RAM, Linux RAM must be under 150 GiB (Windows 16 GiB), and AWS does not support hibernation beyond 60 days. It works for On-Demand and persistent Spot but not for instances in an Auto Scaling group or ECS (an Auto Scaling warm pool can hibernate its own instances). Use it for standalone workers instead of an always-on fleet when the expensive part is in-memory state.
USAGE:
Instance store contents are lost and the public IPv4 changes on resume, so hibernate only workers whose state lives in RAM and EBS.

## aws-d4-pat-aurora-io-optimized-and-licensing | d2
TOPIC: 4.3 Cost-optimized database
Q:
A company's Aurora MySQL bill shows I/O request charges at 35 percent of total Aurora spend, and another team runs RDS for SQL Server with License Included for an application that could run on PostgreSQL. Which two configuration choices cut database cost without touching capacity?
A:
Switch the Aurora cluster to I/O-Optimized. Aurora Standard bills a per-request rate for I/O ($0.20 per million) on top of instances and storage; I/O-Optimized drops the I/O charge but prices instances about 30 percent higher and storage higher, so it wins once I/O is 25 percent or more of Aurora spend. You can move to I/O-Optimized once every 30 days and back to Standard at any time. License Included bundles the vendor licence into the hourly rate; BYOL helps only if you own licences, Oracle EE or SE2 with support, or SQL Server with License Mobility through Software Assurance (without it, Microsoft licences bought before October 2019 go only onto EC2 Dedicated Hosts). An open-source engine removes the licence line.
USAGE:
Check the Aurora bill's I/O line against the 25 percent mark every quarter; the switch is a cluster modification, not a migration.

## aws-d4-pat-vpn-bandwidth-ecmp-dx-speed | d3
TOPIC: 4.4 Cost-optimized network
Q:
A factory pushes about 3 Gbps of bursty sensor data into a VPC over a single Site-to-Site VPN attached to a virtual private gateway and sees throughput capped far below that. A vendor proposes a 10 Gbps dedicated Direct Connect. What is the cheapest design that actually delivers the bandwidth, and when does Direct Connect become the right answer?
A:
A standard Site-to-Site VPN tunnel tops out at 1.25 Gbps, and every connection on one virtual private gateway shares that cap. Attach the VPNs to a Transit Gateway with BGP instead: ECMP aggregates every tunnel (two per connection), so three connections at $0.05 per connection-hour (about $36 a month each) cover 3 Gbps for a fraction of any Direct Connect port; a 5 Gbps large-bandwidth tunnel ($0.60 an hour, Transit Gateway only) is the simpler, pricier alternative. Direct Connect earns its price for consistent latency, a private path or sustained multi-gigabit throughput: hosted connections run 50 Mbps to 25 Gbps through a partner (cheapest entry, traffic-policed), dedicated ports are 1, 10, 100 or 400 Gbps, and a LAG bundles them.
USAGE:
A 10 Gbps dedicated port for a few hundred megabits of bursty traffic is the classic overspend; size Direct Connect to the sustained rate and let ECMP VPN absorb the bursts.

## aws-amazon-mq-service | d1
TOPIC: D2 services
Q:
A company is lifting an order-processing application into AWS. It talks to an on-premises ActiveMQ broker over JMS and OpenWire, a partner feed arrives over MQTT, and rewriting the messaging code is out of scope. Which AWS messaging service should carry these messages, and how is it deployed for high availability?
A:
Amazon MQ: a managed broker for Apache ActiveMQ Classic and RabbitMQ that speaks the standard protocols (JMS, NMS, AMQP, STOMP, MQTT, OpenWire, WebSocket), so existing clients reconnect without code changes. For HA, an ActiveMQ active/standby broker runs two brokers in two Availability Zones sharing Amazon EFS storage, one active at a time, with clients using the failover transport across both endpoints; RabbitMQ uses a three-node cluster across AZs. The broker lives in your VPC, is sized by broker instance type, and does not scale out automatically the way SQS does. AWS guidance: move existing standards-based applications to Amazon MQ; build new cloud applications on SQS and SNS.
USAGE:
A stem that names JMS, AMQP, MQTT, STOMP or "without rewriting messaging code" is Amazon MQ; a new decoupling design with no protocol constraint is SQS or SNS.

## aws-x-ray-service | d1
TOPIC: D2 services
Q:
An API Gateway request fans out through Lambda, an ECS service and DynamoDB, and p99 latency has doubled. CloudWatch shows every service healthy and CloudTrail shows nothing unusual. Which service pinpoints the slow hop, and how does it keep its own cost under control?
A:
AWS X-Ray. The SDK or auto-instrumentation records a segment per service and subsegments for each downstream call (AWS SDK, HTTP, SQL); a daemon or agent ships them; X-Ray stitches segments sharing a trace ID into a trace and draws a service map with latency, error (4xx), fault (5xx) and throttle (429) rates per node and edge. Sampling caps cost: by default the first request each second plus 5 percent of the rest is traced, adjustable per rule. Annotations are indexed key-value pairs (up to 50 per trace) you can filter on; metadata is stored but not searchable. X-Ray is not a log store (CloudWatch Logs) and not an API audit trail (CloudTrail).
USAGE:
Add an annotation such as tenant or order type to every segment so a slow trace can be found with a filter expression instead of by scrolling.

## aws-client-vpn-service | d1
TOPIC: 1.2 Secure workloads
Q:
A solutions architect must choose between AWS Client VPN, AWS Site-to-Site VPN and Systems Manager Session Manager for letting remote staff reach private VPC resources. What does Client VPN do, how does it authenticate users, and when is one of the other two the right answer?
A:
AWS Client VPN is a managed, OpenVPN-based endpoint for people rather than networks: each user runs a VPN client and authenticates with Active Directory (AWS Managed Microsoft AD or AD Connector), SAML 2.0 federation (IAM Identity Center, Okta, Entra ID) or mutual TLS certificates, optionally combining certificates with a user-based method; MFA is enforced by the directory or the IdP. Authorization rules map AD or IdP groups to network CIDRs, and split-tunnel pushes only the endpoint's route table to the client. Choose Site-to-Site VPN when an office or data center network must reach the VPC through a customer gateway device, and Session Manager when engineers only need a shell on EC2 or on-premises managed nodes without opening inbound ports.
USAGE:
Every Client VPN endpoint needs an ACM server certificate whatever the authentication method, so provision that certificate before anything else.

## aws-firewall-manager-service | d2
TOPIC: 1.2 Secure workloads
Q:
A security team runs an AWS Organization with 80 accounts. Every new Application Load Balancer and CloudFront distribution must carry the corporate WAF web ACL, every account must be enrolled in Shield Advanced, and no security group may allow 0.0.0.0/0 on port 22, including resources created next month. Which service enforces this, what must be in place first, and what does it not do?
A:
AWS Firewall Manager. You write a policy once (WAF web ACL, Shield Advanced subscription, common or audit security-group rules, network ACLs, Network Firewall, Route 53 Resolver DNS Firewall or a third-party firewall), scope it by OU, account, resource type or tag, and Firewall Manager applies it across the organization and automatically protects accounts and resources that appear later. Prerequisites: the organization runs with all features enabled, the management account designates a Firewall Manager administrator (registered as the delegated administrator), and AWS Config records continuously in every member account and Region you protect. It inspects nothing itself, and its charges are the underlying WAF and Config usage. For a single account, plain WAF or a security group is the simpler answer.
USAGE:
When the stem says "all accounts" and "automatically for new resources", reach for Firewall Manager; a WAF web ACL alone protects only what you attach it to.

## aws-network-firewall-service | d2
TOPIC: 1.2 Secure workloads
Q:
A company must let EC2 instances in private subnets reach only an approved list of external domain names, and wants intrusion detection and prevention on all traffic leaving its VPCs. Security groups, network ACLs and AWS WAF have already been rejected. Which service fits, how is it deployed, and why were the others rejected?
A:
AWS Network Firewall, a stateful managed firewall and IDS/IPS for VPCs. It places firewall endpoints in dedicated firewall subnets, one per Availability Zone, and you edit route tables so traffic between protected subnets and the internet gateway, NAT gateway, VPN or Direct Connect passes through them; an endpoint cannot filter its own subnet, so keep that subnet empty. The stateful engine is Suricata: allow-list domain names, apply Suricata-compatible IPS rules, write 5-tuple rules and detect protocols such as HTTPS regardless of port; stateless rules inspect single packets. For many VPCs, centralize in an inspection VPC behind a Transit Gateway, managed org-wide by Firewall Manager. Security groups and network ACLs match only IPs, ports and protocols; WAF sees only HTTP requests.
USAGE:
Egress domain allow-lists for patching and package mirrors are the classic Network Firewall job; a NAT gateway alone cannot say no to a hostname.

## aws-artifact-service | d1
TOPIC: 1.3 Data security controls
Q:
When does an exam scenario point to AWS Artifact rather than Security Hub, AWS Config or Trusted Advisor, and what two things can an account do in Artifact?
A:
Artifact is the self-service portal for AWS's own compliance evidence: on-demand downloads of SOC reports, PCI DSS attestations, ISO certifications and other third-party audit documents, plus review and acceptance of agreements with AWS such as the HIPAA Business Associate Addendum, which a management account can accept once so that every existing and future member account is covered. It is free. Trigger phrases: "the auditor asks for AWS's SOC report" and "sign a BAA before processing PHI". It says nothing about your workload; under the shared responsibility model, Security Hub standards, Config conformance packs and Trusted Advisor checks are what evaluate your resources.
USAGE:
Accept the BAA at the organization level in Artifact before any account stores PHI, then keep Artifact's acceptance record as proof for your own auditors.

## aws-security-hub-service | d1
TOPIC: 1.3 Data security controls
Q:
A CISO wants one place that scores every account in the organization against CIS and PCI DSS benchmarks, shows GuardDuty, Inspector and Macie findings in a single format, and can start automated remediation. Which service is this, what must be enabled first, and what does it not do?
A:
AWS Security Hub CSPM. It runs continuous control checks for standards such as AWS Foundational Security Best Practices, the CIS AWS Foundations Benchmark, PCI DSS and NIST, computes security scores, and ingests findings from GuardDuty, Inspector, Macie, Firewall Manager and partner products normalized into the AWS Security Finding Format (ASFF). With Organizations you appoint a delegated administrator, and cross-Region aggregation collects findings into one aggregation Region. Automation rules modify or suppress findings and EventBridge triggers remediation. It needs AWS Config recording because most controls run as Config rules, it only processes findings generated after it is enabled, and it finds nothing on its own: GuardDuty, Inspector and Macie do the detection.
USAGE:
Enable Security Hub in every Region you use; the CIS benchmark is only fully evaluated when all supported Regions are enabled.

## aws-managed-ai-services-map | d1
TOPIC: 2.2 HA and fault tolerance
Q:
A product team with no data scientists lists six requirements: flag negative support tickets, read totals off scanned invoices, subtitle uploaded videos, voice a news feed, translate the help centre, and screen user photos for nudity. Which AWS service answers each, and when does the answer become SageMaker instead?
A:
Match the input type to a pre-trained API; build no model. Text understanding (sentiment, entities, key phrases, PII, language) is Comprehend; scanned forms and tables are Textract; speech to text is Transcribe; text to speech is Polly; translation is Translate; image and video labels, faces and unsafe content are Rekognition; a voice or chat bot is Lex. All are pay as you go and need no ML expertise. SageMaker AI is the answer only when a model must be trained or hosted on the team's own data, and even then Comprehend custom classifiers and Rekognition Custom Labels cover most "our own categories" needs. Kendra is closed to new customers; AWS points search needs at Bedrock Knowledge Bases.
USAGE:
Read the noun in the requirement: text, document, audio, speech, image or conversation names the service; "train our own model" is the only phrase that names SageMaker.

## aws-auto-scaling-service-card | d1
TOPIC: 3.2 Elastic compute
Q:
An application tagged Environment=prod spans an Auto Scaling group, an ECS service, a DynamoDB table and Aurora read replicas, and the team wants one place to define target tracking for all of them. Which service is that, and why does AWS now steer predictive scaling elsewhere?
A:
AWS Auto Scaling scaling plans. A plan discovers scalable resources by tag or CloudFormation stack and applies target-tracking strategies to five resource types: Auto Scaling groups, ECS services, DynamoDB tables and indexes, Aurora replicas and Spot Fleet. Under the covers it drives EC2 Auto Scaling and Application Auto Scaling, and the feature costs nothing beyond CloudWatch. Predictive scaling is supported for Auto Scaling groups only, and AWS states that a plan used only for predictive scaling should be replaced by predictive scaling policies set directly on the group, which offer more features and avoid the GetMetricData charges a plan incurs. Lambda concurrency and other targets are Application Auto Scaling, never a plan.
USAGE:
Reach for a scaling plan when the question stresses "multiple resource types together"; for a single group, configure the policy on the group.

## aws-d4-distributed-compute-edge | d2
TOPIC: 4.2 Cost-optimized compute
Q:
A retailer keeps an Auto Scaling fleet behind an ALB whose only work is rewriting legacy URLs, adding security headers and checking signed tokens on every request. Its factories also stream terabytes of sensor video to the Region for filtering, after which about 1 percent is kept. Which distributed-compute strategy removes cost in each case, and what rule says when moving work to the edge is the wrong answer?
A:
Run work where the request or data is. Per-request logic that needs nothing from the origin goes to CloudFront: CloudFront Functions at $0.10 per million invocations for headers, redirects and tokens, Lambda@Edge ($0.60 per million plus duration) only when network or body access is needed. Origin fetches from AWS origins are free, so the fleet and ALB vanish. The video is data gravity: filter on Outposts, or a disconnected-site Snow Family device, so only the kept 1 percent crosses the WAN. Rule: edge wins when the work is per-request or per-record and self-contained; if it needs the database or shared state, keep it in the Region. CloudFront Functions have no network access; Lambda@Edge origin events fire only on cache misses.
USAGE:
Before buying a bigger fleet, list which requests never touch the database; those are the ones CloudFront can answer for you.

## aws-d4-cost-features-database-tags | d1
TOPIC: 4.3 Cost-optimized database
Q:
Finance wants the shared RDS and DynamoDB bill split per application and asks why the database line grew when no instance changed. Which billing features give the split, what does a reservation actually discount, and which line is the usual surprise?
A:
Tag DB instances, clusters and DynamoDB tables, activate the key as a cost allocation tag; Cost Explorer splits instance-hours, storage, backup storage and I/O per application. Snapshots inherit cost allocation only from a parent instance still in the same account and Region; orphaned snapshots become one untagged line. Reserved DB instances and DynamoDB reserved capacity are shared across the consolidated bill but discount only instance-hours or provisioned throughput, never storage, backup or I/O. The surprise is backup storage: free up to 100 percent of provisioned storage per Region, then billed per GB-month, where long retention and retained snapshots land. On Aurora, an I/O line ($0.20 per million requests) at 25 percent or more of cluster spend means switch to I/O-Optimized.
USAGE:
Tag every database at creation with copy-tags-to-snapshots on, or the snapshot line will never be attributable to anyone.

## aws-d4-cost-tools-database-angle | d1
TOPIC: 4.3 Cost-optimized database
Q:
A team must cut its RDS and DynamoDB bill without touching the application. Which AWS tool answers each question: what to reserve, which instances to shrink or retire, whether Aurora I/O-Optimized would pay, and whether a DynamoDB table should stay provisioned or move to on-demand?
A:
Cost Explorer reservation recommendations simulate 7, 30 or 60 days of On-Demand usage and propose RDS reserved DB instances and DynamoDB reserved capacity. Compute Optimizer right-sizes RDS MySQL, PostgreSQL and Aurora instance classes, flags idle databases, recommends storage changes such as gp2 to gp3 or lower provisioned IOPS, and reports DBClusterStorageSavingsAvailable when I/O-Optimized beats Aurora Standard. Trusted Advisor's Idle DB Instances check flags no connection in 7 days, but cost checks need a Business-tier (now Business Support+) or Enterprise plan. Budgets alert on usage hours; the Cost and Usage Report shows the Aurora I/O line. For DynamoDB, compare CloudWatch ConsumedReadCapacityUnits (Sum statistic) with provisioned units: steady high utilization favors provisioned plus reserved capacity, spiky traffic favors on-demand.
USAGE:
Run the Compute Optimizer idle finding before buying reservations; reserving an instance nobody connects to locks in the waste for a year.

## aws-d4-cost-features-network-tags | d1
TOPIC: 4.4 Cost-optimized network
Q:
The EC2 data transfer line doubled and nobody can say which team caused it. Which network resources can be tagged for cost allocation, why does tagging alone not explain data transfer, and which usage types expose the hidden lines?
A:
NAT gateways, interface endpoints, load balancers and Transit Gateway attachments accept cost allocation tags, so their hourly and per-GB charges split by team once activated. Data transfer itself is not a taggable object: it is metered on the resource that sent it, and in-Region traffic produces two DataTransfer-Regional-Bytes line items per resource, one in and one out. Filter Cost Explorer by usage type: DataTransfer-Regional-Bytes (traffic between AZs inside a Region), DataTransfer-Out-Bytes (internet egress), AWS-Out-Bytes (inter-Region, charged only on the sending side) and NatGateway-Bytes (NAT processing, $0.045 per GB in US East). Consolidated billing pools every account's egress volume, so the organization reaches cheaper tiers sooner and the discount is allocated back by usage.
USAGE:
When NatGateway-Bytes dwarfs DataTransfer-Out-Bytes, the NAT gateway is carrying S3 or DynamoDB traffic that a free gateway endpoint should take.

## aws-d4-cost-tools-network-angle | d1
TOPIC: 4.4 Cost-optimized network
Q:
Data transfer spend jumped 40 percent in one week. Which tool detects the spike, which pins it to a workload, which warns before the next one, and which finds network resources that bill while doing nothing?
A:
Cost Anomaly Detection runs machine learning over net unblended cost and ranks root causes by service, account, Region and usage type. Cost Explorer grouped by usage type separates NAT processing, cross-AZ bytes and internet egress; grouping by tag names the team. VPC Flow Logs queried with Athena find top-talker interfaces; the az-id versus next-hop-az-id, traffic-path and pkt-dst-aws-service fields show whether a flow crossed an AZ, used a gateway endpoint (path 7) or hit S3 through the NAT gateway. A forecasted usage budget in GB on data transfer out warns early. Trusted Advisor's Idle Load Balancers (under 100 requests a day for 7 days) and Unassociated Elastic IP checks find waste; every public IPv4 bills $0.005 per hour, used or idle.
USAGE:
Set the anomaly monitor per cost allocation tag rather than per service, so the alert already names the owning team.

## aws-appflow-service | d1
TOPIC: D2 services
Q:
A marketing team needs Salesforce opportunity records copied into Amazon Redshift every hour and Zendesk tickets landed in S3 on demand, without writing integration code. Which service does this, and when should a question use EventBridge, DMS or DataSync instead?
A:
Amazon AppFlow, a fully managed integration service that moves data between SaaS applications such as Salesforce, ServiceNow, Slack, Zendesk, SAP and Marketo and AWS services such as S3, Redshift and EventBridge. Flows run on demand, on a schedule or in response to events, apply field mapping and filtering, encrypt data at rest and in transit, can use PrivateLink for supported sources, and can catalog S3 output in the Glue Data Catalog and partition it for query performance; a single flow moves up to 100 GB. It is not the answer for app-to-app event routing (EventBridge), database migration or replication (DMS) or bulk file transfer between file systems and S3 (DataSync).
USAGE:
When the requirement says "SaaS" and "no code", AppFlow beats a Lambda scraper that would have to handle API pagination, auth tokens and retries itself.

## aws-cli-service | d1
TOPIC: D2 services
Q:
A DevOps engineer runs aws commands from a CI runner on EC2 and from a laptop. In what order does the AWS CLI look for credentials, how does a named profile assume a role in another account, and when is the CLI the wrong tool?
A:
The CLI resolves settings in this precedence: command line options, environment variables, assume role (and with web identity), IAM Identity Center, the credentials file, an external credential process, the config file, container credentials, then the EC2 instance profile. An instance or task role is used only when nothing higher is set, so automation on EC2 or ECS needs no static keys. A profile with role_arn plus source_profile (or credential_source = Ec2InstanceMetadata) makes the CLI call sts:AssumeRole and cache the temporary credentials under ~/.aws/cli/cache; mfa_serial adds an MFA prompt, external_id third-party trust. Use --query and --output for filtering, --dry-run to test EC2 permissions, aws s3 sync for incremental copies. The CLI suits scripts and one-off operations; repeatable environments belong in CloudFormation.
CODE: ini
[profile prod-admin]
role_arn = arn:aws:iam::111122223333:role/ProdAdmin
source_profile = default
mfa_serial = arn:aws:iam::123456789012:mfa/engineer
USAGE:
Humans sign in through IAM Identity Center with aws sso login, machines use instance or task roles, and nobody pastes long-lived access keys into a CI variable.

## aws-comprehend-service | d1
TOPIC: D2 services
Q:
A product team wants the entities, key phrases, language, PII and sentiment in customer emails, and later wants to sort emails into its own categories, without an ML team. Which service, what does it offer out of the box versus custom, and which neighbouring services handle speech, translation and scanned documents?
A:
Amazon Comprehend, the NLP service. Its pre-trained models return entities, key phrases, dominant language, sentiment (positive, negative, neutral, mixed), targeted sentiment per entity, syntax and PII, either in real time for small requests or as asynchronous jobs over document sets in S3, with no training data. Comprehend Custom uses AutoML to build custom classifiers and custom entity recognizers from labelled data, and topic modeling clusters a corpus by keywords. Comprehend Medical is the separate service for clinical text that links findings to ICD-10-CM and RxNorm. It takes only text: speech goes through Transcribe first, translation is Amazon Translate, and scanned documents pass through Textract before Comprehend reads the extracted text.
USAGE:
Chain Textract, Comprehend and Translate: extract the text of the scanned form, pull entities and PII from it, then translate the result for regional teams.

## aws-ecr-service | d1
TOPIC: D2 services
Q:
A platform team builds container images for ECS, EKS and Lambda, must find vulnerabilities before deployment, keep the registry from filling with stale tags, and have images ready in a second Region for disaster recovery. Which service and features cover this, and what is ECR not?
A:
Amazon ECR, the managed Docker and OCI image registry. IAM and resource-based repository policies authorize push and pull. Image scanning is basic (OS packages against the CVE database, manual or scan on push) or enhanced (Amazon Inspector, OS and language packages, scan on push plus continuous rescans that emit EventBridge events). Lifecycle policies clean up unused images by rule, replication is a registry setting that copies images cross-Region and cross-account, and pull through cache rules mirror upstream registries such as Docker Hub, ECR Public, Quay and GitHub into your private registry, rechecked at least every 24 hours. ECR Public hosts openly shared images. ECR stores images; it does not build them (CodeBuild does) nor store non-container artifacts.
USAGE:
Turn on scan on push plus a lifecycle rule that keeps only the newest tagged images, so the registry stays cheap and every deployable image has a scan result.

## aws-ecs-anywhere-service | d1
TOPIC: D2 services
Q:
A hospital must keep a batch-processing workload on its own servers for data-residency reasons but wants to schedule and monitor it with the same ECS cluster and task definitions it uses in AWS. Which option does this, what runs on the servers, and what does it not support?
A:
Amazon ECS Anywhere registers on-premises servers or VMs as external instances in an ECS cluster: an install script adds the SSM Agent, which handles registration and rotates IAM credentials every 30 minutes, and the ECS agent, and you run tasks with the EXTERNAL launch type from the same control plane. External instances need an IAM role and outbound reachability to the ECS and SSM endpoints. They suit outbound or data-processing work: Elastic Load Balancing, service discovery, App Mesh, EFS volumes, capacity providers and the awsvpc network mode are not supported, so tasks use bridge, host or none networking. For Kubernetes on your own hardware the sibling product is EKS Anywhere.
USAGE:
If the on-premises task must serve inbound web traffic, keep it out of ECS Anywhere or put your own load balancer in front of it.

## aws-eks-anywhere-service | d1
TOPIC: D2 services
Q:
A manufacturer must run Kubernetes clusters in factories on VMware vSphere and bare metal, some cut off from the internet, but wants the same Kubernetes builds and tooling as Amazon EKS. Which option fits, who operates it, and when is plain EKS or ECS Anywhere the better answer?
A:
Amazon EKS Anywhere: customer-managed Kubernetes for on-premises and edge infrastructure (VMware vSphere, bare metal, Nutanix, Apache CloudStack and AWS Snow) built from Amazon EKS Distro, the same distribution EKS runs in the cloud, so versions, patches and release cadence match. Unlike EKS, you run the control plane and own cluster lifecycle and maintenance; an EKS Anywhere Enterprise Subscription buys AWS support and curated add-ons, and the EKS Connector can register the cluster in the EKS console for visibility. EKS Distro alone is only the patched Kubernetes bits with no lifecycle tooling or support. When AWS should operate the control plane, choose EKS, with Outposts for on-premises latency; for on-premises ECS tasks choose ECS Anywhere.
USAGE:
Pick EKS Anywhere when the site may be fully disconnected; pick EKS on Outposts when a link to the Region is guaranteed and you want AWS running the control plane.

## aws-eks-distro-service | d1
TOPIC: D2 services
Q:
A team already runs Kubernetes on its own hardware with an in-house build and struggles to keep up with security patches. It wants exactly the Kubernetes versions and dependencies that Amazon EKS ships, installed with its own tooling. What fits, and what does it not include?
A:
Amazon EKS Distro, the open-source distribution of Kubernetes and its dependencies (etcd, networking and storage plugins, tested for compatibility) that Amazon EKS itself deploys. You can install it on EC2, on premises or in other clouds with whatever tooling you prefer, and AWS keeps publishing critical security patches for previous versions in line with the EKS version lifecycle, the last four versions plus 60 days, about 14 months. It is only the bits: no managed control plane, no console, no lifecycle automation, and fixes arrive on a best-effort basis rather than under an AWS support plan. EKS Anywhere packages EKS Distro with cluster lifecycle tooling and an optional support subscription; EKS runs the control plane for you.
USAGE:
Standardize on-premises and cloud clusters on EKS Distro so a manifest tested in EKS behaves the same way in the factory.

## aws-health-dashboard-service | d1
TOPIC: D2 services
Q:
An operations team wants to know whether an outage is AWS's problem or theirs, receive advance notice when EC2 will retire one of their instances, and act on such notices automatically. Which service provides this, what are its views, and what is it not?
A:
AWS Health, surfaced as the AWS Health Dashboard at no extra cost. The account health view lists open and recent issues, scheduled changes such as EC2 host retirements and maintenance, and other notifications affecting your resources; the public service health view, which needs no sign-in, shows Region-wide events; and organizational view with a delegated administrator aggregates events across every account in AWS Organizations. Health events are delivered to Amazon EventBridge free of charge, so a rule can invoke Lambda to stop and start an instance before retirement or notify SNS or Slack; the AWS Health API for programmatic polling needs a Business Support+, Enterprise or Unified Operations plan. It reports AWS-side events, not your application's metrics, which is CloudWatch's job.
USAGE:
An EventBridge rule on AWS Health scheduledChange events plus Systems Manager Automation turns a retirement notice into an automatic stop and start onto healthy hardware.

## aws-license-manager-service | d1
TOPIC: D2 services
Q:
An enterprise brings its own Windows Server and SQL Server licences, some counted per core and required to run on Dedicated Hosts, and must prove to auditors that it never exceeds its entitlements across 40 accounts and its on-premises servers. Which service is this and what does it enforce?
A:
AWS License Manager. You define self-managed licences with a counting type of vCPUs, cores, sockets or instances, a licence count, tenancy rules (core and socket counting requires Dedicated Hosts) and licence affinity to a host, associate them with AMIs, and License Manager tracks consumption across Regions and accounts through Organizations and across on-premises servers through Systems Manager inventory. With Enforce license limit selected the limit is hard: a launch that would exceed it is blocked; otherwise a soft limit only notifies. Host resource groups collect Dedicated Hosts so License Manager allocates, releases and recovers hosts automatically as licensed instances launch. It tracks and enforces compliance; it does not lower licence fees, and licence type conversion switches between AWS-provided and BYOL.
USAGE:
When the exam mixes BYOL, Dedicated Hosts and "must not exceed entitlements", License Manager with a host resource group is the phrase to reach for.

## aws-managed-grafana-service | d1
TOPIC: D2 services
Q:
An SRE team already builds Grafana dashboards on premises and now needs one view across CloudWatch metrics, a Managed Prometheus workspace, X-Ray traces and an on-premises InfluxDB, with sign-in through the corporate identity provider. Which AWS service fits, and when are plain CloudWatch dashboards the better answer?
A:
Amazon Managed Grafana: AWS runs logically isolated Grafana workspaces, so nobody provisions, patches or scales Grafana servers. It has built-in AWS data sources (CloudWatch, Managed Service for Prometheus, X-Ray, OpenSearch Service, Timestream, IoT SiteWise) plus open-source and third-party sources, authenticates users through IAM Identity Center or any SAML 2.0 identity provider, and is priced per active user per workspace. Choose it when the team already lives in Grafana or must correlate AWS and non-AWS sources on one pane. When every signal is already in CloudWatch and nobody needs Grafana, CloudWatch dashboards cost less and add no second console to secure.
USAGE:
If the question pairs "Prometheus" or "existing Grafana dashboards" with "single pane of glass", the pane is Managed Grafana, not CloudWatch.

## aws-managed-prometheus-service | d1
TOPIC: D2 services
Q:
A platform team scrapes thousands of Prometheus metrics from EKS pods and keeps losing history when the self-hosted Prometheus server runs out of disk. They want to keep PromQL and their existing alert rules. Which service removes the storage problem, and what does it not do?
A:
Amazon Managed Service for Prometheus: a serverless, Prometheus-compatible store and PromQL query endpoint that scales ingestion, storage and querying automatically and replicates data across three Availability Zones. Metrics arrive by Prometheus remote write from a Prometheus agent or the AWS Distro for OpenTelemetry collector, or through the AWS managed agentless scraper for EKS clusters. Retention is 150 days by default and can be raised to 1095 days; alerting rules and an alert manager run inside the workspace (SNS is the only receiver), and Managed Grafana is the usual front end. It stores metrics only, never logs or traces, and a team with no Prometheus investment should take CloudWatch Container Insights, the simpler AWS-native path.
USAGE:
Keep the scrape configs and rules files you already have; only the remote_write URL changes.

## aws-management-console-service | d1
TOPIC: D2 services
Q:
A new administrator asks which identity to use when opening the AWS Management Console in a browser, whether console clicks leave an audit trail, and why the team's CloudFormation stacks keep reporting drift. Which three facts answer them?
A:
The console is the browser interface to every service and accepts three kinds of identity: the account root user (email and password, complete access, reserved for tasks such as closing a standalone account or activating IAM access to billing), IAM users with MFA, or IAM Identity Center users who sign in through the access portal and receive temporary role sessions, the recommended daily path. CloudTrail is enabled by default and records every console sign-in as a ConsoleLogin event; console actions reach it as the same API calls the CLI makes, so the audit trail is one trail. Console edits to stack-managed resources are what CloudFormation later reports as drift, so anything repeatable belongs in templates or the CLI, not clicks.
USAGE:
Treat the console as read-only for production: look with it, change through code.

## aws-polly-service | d1
TOPIC: D2 services
Q:
A news app needs articles read aloud in natural voices with correct pronunciation of brand names and word-by-word highlighting as the audio plays, plus a nightly batch that renders whole editions to audio files. Which service, which features, and what does it not do?
A:
Amazon Polly, text to speech. It offers standard, neural, long-form and generative voice engines across many languages; plaintext or SSML input controls pronunciation, volume, pitch, rate and pauses; pronunciation lexicons fix brand names (up to 100 per account, 5 per request); speech marks (neural, long-form and standard engines only) return word and sentence timing and visemes for highlighting or lip-sync; output is MP3, Ogg Vorbis or PCM. SynthesizeSpeech is synchronous and accepts up to 3,000 billed characters; StartSpeechSynthesisTask accepts up to 100,000 billed characters, writes the file to your S3 bucket and can notify an SNS topic. You pay per character synthesized and may cache and replay output. Polly does not translate (Translate), transcribe (Transcribe) or hold a conversation (Lex).
USAGE:
Request speech marks alongside the audio so the reader view scrolls in time with playback.

## aws-service-catalog-service | d1
TOPIC: D2 services
Q:
Developers in 40 accounts should launch an approved three-tier stack themselves, but security refuses to grant them CloudFormation, EC2 and RDS permissions, and every stack must carry a cost-centre tag. Which service delivers this, and how does it differ from Control Tower?
A:
AWS Service Catalog. Administrators publish products (CloudFormation or Terraform templates) into portfolios, share the portfolios with accounts or an organization, and attach constraints. A launch constraint names an IAM role that Service Catalog assumes to provision, update and terminate the product, so end users need only Service Catalog permissions instead of rights on every underlying service; template constraints restrict parameter values such as instance type, and TagOptions force the cost-centre tag. Updating a product version propagates to every portfolio that references it. Control Tower governs how accounts are created and guarded; plain CloudFormation offers no catalogue, no approval boundary and no launch role.
USAGE:
"Self-service" plus "without giving users permissions to the underlying services" is the launch-constraint signature.

## aws-amplify-service-card | d1
TOPIC: D3 services
Q:
A three-person front-end team ships a React app from GitHub and needs CDN hosting with a build per branch, pull-request previews, sign-up with social login and a GraphQL data layer, with nobody to run servers. Which service, and which workloads should stay off it?
A:
AWS Amplify. Amplify Hosting connects a Git repository (GitHub, GitLab, Bitbucket, CodeCommit) and runs continuous deployment to the AWS global CDN with feature-branch environments, pull-request previews, custom domains, password-protected branches and atomic deployments for SPA, SSR and static-site frameworks. Backend features are defined in code (Gen 2 TypeScript) and provisioned onto managed services: Cognito for auth, AppSync and DynamoDB for data, S3 for storage, Lambda for functions. It is the shortest path for a front-end team with minimal backend operations; it is not a home for long batch jobs, an existing containerised back end on ECS or EKS, or anything that needs VPC-level control.
USAGE:
"Front-end developers, no ops staff, deploy from Git" is Amplify; "migrate our Docker back end" is not.

## aws-data-exchange-service-card | d1
TOPIC: D3 services
Q:
An analytics team subscribes to a licensed weather feed and wants each new revision to land in their S3 bucket automatically, with the licence tracked in one place. Which service, and why are DataSync and Lake Formation the wrong answers?
A:
AWS Data Exchange. It is the AWS Marketplace channel for third-party data: subscribers find products in the catalogue, accept an offer or a direct data grant, and receive data sets of five types (Files, API, Amazon Redshift, Amazon S3 and, in preview, Lake Formation), with entitlements and subscriptions tracked in one console. File revisions are exported to your own S3 bucket, and Redshift data sets are queried in place without ETL. Providers publish and deliver without building entitlement infrastructure. DataSync moves your own data between storage systems; Lake Formation and RAM share data you already own inside your organization. Neither licenses somebody else's data.
USAGE:
The moment a requirement says "third-party data provider" or "licensed data set", the answer is Data Exchange, whatever the file format.

## aws-device-farm-service-card | d1
TOPIC: D3 services
Q:
A mobile team's app crashes only on certain Android phones and must also pass Selenium tests on several desktop browsers before release. Which AWS service runs those tests on real hardware, and what is it not built for?
A:
AWS Device Farm. It runs automated tests of native and hybrid Android and iOS apps on real, physical phones and tablets hosted by AWS, in parallel across a device pool, returning logs, screenshots, video and a report; remote access sessions let an engineer drive one specific device interactively in the browser or from Appium to reproduce a bug, up to 150 minutes per session. Its desktop browser testing feature runs Selenium suites on AWS-hosted browsers, and test hosts can connect to your VPC to reach private endpoints. The service exists only in us-west-2. It hosts nothing and generates no load: application hosting is Amplify or EC2, and load testing needs a separate tool.
USAGE:
"Test on real devices" is Device Farm; "test under real traffic" is a different problem.

## aws-elastic-transcoder-service-card | d1
TOPIC: D3 services
Q:
An exam scenario describes converting uploaded videos in S3 into phone, tablet and web renditions with pipelines and presets. Which service did that, why is it no longer the answer, and what replaces it?
A:
Amazon Elastic Transcoder: a job was submitted to a pipeline tied to an input and an output S3 bucket, a preset fixed codec and resolution, and SNS reported completion. AWS discontinued the service on November 13, 2025, so it survives only as a legacy name. The replacement is AWS Elemental MediaConvert, a file-based transcoder whose queues are not tied to buckets, whose presets can be overridden per job and whose job templates save whole job configurations, and whose status flows through CloudWatch Events and EventBridge. Neither service does live streaming (MediaLive), camera ingest (Kinesis Video Streams) or image processing.
USAGE:
When "transcode" appears in a design today, write MediaConvert; treat Elastic Transcoder as a migration source.

## aws-kinesis-video-streams-service-card | d1
TOPIC: D3 services
Q:
Thousands of security cameras must stream live video to AWS for real-time face matching, with recordings kept for 30 days and two-way audio to a doorbell app. Which service, and why are Kinesis Data Streams and MediaConvert wrong?
A:
Amazon Kinesis Video Streams. Devices push video (or other time-serialised data such as audio, thermal and radar) through the producer SDK, RTSP or the GStreamer plugin; the service stores and encrypts fragments for a retention you set in hours (default 0, meaning nothing persists beyond a five-minute, 200 MB buffer), time-indexes them by producer and ingestion timestamp, and plays them back live or on demand through HLS and DASH. It integrates with Rekognition Video and SageMaker for frame-by-frame analysis, and its managed WebRTC handles two-way real-time media. Kinesis Data Streams carries records, not media; MediaConvert transcodes stored files rather than ingesting cameras.
USAGE:
"Cameras", "video from devices" or "WebRTC" names Kinesis Video Streams; "clickstream" or "log records" names Kinesis Data Streams.

## aws-lex-service-card | d1
TOPIC: D3 services
Q:
A bank wants a chatbot that understands "move 200 to savings" by voice or text on its website and inside Amazon Connect, and calls a Lambda function to do the transfer. Which service builds it without a data scientist?
A:
Amazon Lex V2. It is powered by the same speech recognition and natural language understanding technology as Alexa: you define intents (TransferFunds), slots (amount, target account) and sample utterances, and Lex manages the dialog, prompts for missing slots and invokes a Lambda function for validation and fulfilment. Bots publish to web and mobile apps, Slack, Teams, Facebook Messenger and Amazon Connect contact centres, and integrate with Comprehend and Kendra. Pricing is per text or speech request. Lex is not a transcription service (Transcribe), a translator (Translate) or a text-to-speech engine (Polly): it turns an utterance into an intent and an action.
USAGE:
"Chatbot", "conversational interface" or "IVR that understands natural language" is Lex; a bot that only needs to say something is Polly.

## aws-msk-service-card | d1
TOPIC: D3 services
Q:
A company migrating a data platform has hundreds of producers and consumers written against the Kafka API, plus Kafka Connect and Debezium connectors. Which AWS streaming service preserves that code, and when would Kinesis Data Streams be the better choice?
A:
Amazon MSK. It runs open-source Apache Kafka (brokers in each Availability Zone, ZooKeeper or KRaft metadata) and provides the control plane, so existing applications, tooling and connectors work with no code changes; MSK detects broker failures and replaces brokers, reusing their storage. MSK Serverless removes capacity management with throughput pricing and IAM-only access control, and MSK Connect runs Kafka Connect connectors such as S3, OpenSearch and Debezium as a managed, auto-scaling fleet. Choose MSK for the Kafka ecosystem, partition control and long retention. Kinesis Data Streams is AWS-native with shards and less to operate: pick it for new pipelines with no Kafka dependency. Neither is a work queue; that is SQS.
USAGE:
The word "Kafka" in the requirement decides; without it, default to Kinesis.

## aws-rekognition-service-card | d1
TOPIC: D3 services
Q:
A marketplace must reject user photos containing nudity or violence, find every listing that shows a bicycle, and verify sellers by matching a selfie to their ID photo. Which service does all three, and which look-alike services does it not replace?
A:
Amazon Rekognition. Its image and video APIs detect objects, scenes and concepts (labels), printed and handwritten text, faces with attributes, celebrities and personal protective equipment; the content moderation API returns hierarchical unsafe-content labels with confidence scores for filtering user-generated content; face comparison and face collections handle identity verification, and Face Liveness rejects spoofed selfies. Custom Labels trains a classifier for your own objects such as logos. Stored video in S3 and streaming video from Kinesis Video Streams are both supported. It reads text in a street scene, but extracting forms and tables from a document is Textract, audio is Transcribe, and sentiment is Comprehend.
USAGE:
"Detect inappropriate images" is the one-phrase trigger for Rekognition's moderation API.

## aws-sagemaker-service-card | d1
TOPIC: D3 services
Q:
A retailer has two years of labelled transaction data and needs a fraud model trained on it, hosted behind a low-latency endpoint, with labelling help for new data. Which service, and why is Rekognition or Comprehend not the answer?
A:
Amazon SageMaker AI, the fully managed service for building, training and deploying custom ML models. Data is labelled with Ground Truth, explored in Studio notebooks, trained on managed instances with built-in algorithms or your own framework code, evaluated, and deployed to hosting endpoints that scale independently of the application; Model Monitor watches for drift. It applies when the requirement is a model on the team's own data. Rekognition, Comprehend, Textract and the other API services are pre-trained for one input type and need no training data, so they win whenever the task is generic (faces, sentiment, forms). Since December 2024 "Amazon SageMaker" also names the unified data and AI platform; the ML service is SageMaker AI.
USAGE:
"Train our own model" or "custom algorithm" is SageMaker; "detect sentiment" with no training data is an API service.

## aws-serverless-app-repository-service-card | d1
TOPIC: D3 services
Q:
A platform team has a SAM application (Lambda functions, an API and a DynamoDB table) that a dozen internal teams should deploy with a few clicks, and a second one they want to share publicly. Which service, and why not ECR or the CloudFormation registry?
A:
The AWS Serverless Application Repository. Publishers upload code plus an AWS SAM template from the console, SAM CLI or SDK; the application starts private, can be shared with specific AWS accounts or an organization, or made public, and consumers find it by keyword in the repository or the Lambda console and deploy it as a CloudFormation stack after acknowledging its capabilities. Public applications are available in every Region because the artifacts are copied; private and privately shared ones stay in their Region. ECR stores container images, and the CloudFormation registry holds resource types and modules, not complete deployable applications.
USAGE:
"Reuse a published serverless app" or "one-click deploy a SAM template" points here.

## aws-textract-service-card | d1
TOPIC: D3 services
Q:
An insurer receives claim forms as scanned PDFs and photos and needs the field values and the line-item tables, not a blob of text. Which service, and where does it stop?
A:
Amazon Textract. Beyond OCR of typed and handwritten text, its AnalyzeDocument API returns forms as key-value pairs and tables as cells, answers natural-language Queries ("What is the policy number?"), AnalyzeExpense parses invoices and receipts, and AnalyzeID reads US passports and driver's licenses. Inputs are JPEG, PNG, PDF and TIFF; synchronous calls handle a single page up to 10 MB, asynchronous jobs take PDFs and TIFFs up to 500 MB and 3,000 pages. No ML expertise or training data is required. Textract does not describe photographs (Rekognition), transcribe audio (Transcribe) or judge sentiment (Comprehend); pair it with Comprehend when the extracted text needs NLP.
USAGE:
"Invoices, forms or tables to structured data" is Textract; "what is in this picture" is Rekognition.

## aws-transcribe-service-card | d1
TOPIC: D3 services
Q:
A call centre must caption live calls, produce searchable transcripts of recorded meetings that label who spoke, and mask credit-card numbers in the output. Which service, and which neighbouring tasks belong to other services?
A:
Amazon Transcribe, the automatic speech recognition service that converts audio to text. It runs in streaming mode for real-time captions and in batch mode on media files in S3; it partitions speech by speaker, analyses multi-channel audio, improves accuracy with custom vocabularies and custom language models, and filters or redacts PII, with automatic PHI identification for HIPAA workloads. Transcribe Medical handles clinical dictation and Call Analytics adds contact-centre insights. Billing is per second of audio with no minimum. It only goes one direction: text to speech is Polly, translating the transcript is Translate, and understanding what it means is Comprehend or Lex.
USAGE:
Chain them: Transcribe for the words, Translate for the language, Polly to speak the result.

## aws-translate-service-card | d1
TOPIC: D3 services
Q:
A support portal must translate incoming tickets in unknown languages in real time and translate a 20,000-page knowledge base stored in S3 overnight, keeping product names untranslated. Which service and which features?
A:
Amazon Translate, the neural machine translation service. Real-time calls translate UTF-8 text or a single .txt, .html or .docx file; asynchronous batch jobs translate collections in S3 (.txt, .html, .docx, .xlsx, .pptx, .xlf) into one or more target languages. Set the source language to auto and Translate calls Comprehend to detect it. Custom terminology pins brand and product names, parallel data adapts tone and style, and profanity masking, formality and do-not-translate tags shape the output. It is text only: speech comes in through Transcribe and goes out through Polly, and sentiment or entity extraction is Comprehend.
USAGE:
"Different languages" plus "text" is Translate; add Transcribe or Polly only when audio is involved.

## aws-vmware-cloud-on-aws-service-card | d1
TOPIC: D3 services
Q:
An enterprise wants its vSphere estate in AWS with vCenter, NSX and vSAN unchanged and no application rewrites. What did VMware Cloud on AWS offer, what changed in 2024, and what does AWS now propose?
A:
VMware Cloud on AWS was the managed service that ran a VMware software-defined data centre on dedicated AWS infrastructure, so teams kept their VMware tooling and simply relocated workloads, the "relocate" migration strategy. As of April 30, 2024, AWS and its partners no longer resell it: existing customers continue through Broadcom, but new subscriptions, add-ons and renewals cannot be bought from AWS. The AWS-native alternative is Amazon Elastic VMware Service (EVS), which deploys VMware Cloud Foundation on EC2 bare-metal instances inside your own VPC, so workloads move without changing IP addresses. Workloads that can simply rehost belong on EC2 via Application Migration Service (MGN); workloads that need AWS-native scaling should be refactored.
USAGE:
"Keep VMware tooling" is now EVS; "just move the servers" is MGN; neither answer is VMware Cloud on AWS for a new design.

## aws-abac-tag-based-access-mcq-05 | d2
TOPIC: 1.1 Secure access
QUALIFIER: LEAST operational overhead
Q:
A company runs several hundred internal projects in one AWS account. Each project's engineers must be able to manage only the EC2, RDS and S3 resources that belong to their own project, and new projects start every week. The security team wants engineers to receive access without a policy being written or edited for each project. Which approach meets these requirements with the LEAST operational overhead?
OPT: a
Create one IAM user group and one customer managed policy per project, listing that project's resource ARNs in the policy, and add each engineer to their project's group.
WHY:
Every new project needs a new group and policy, and every new resource means editing an ARN list; the approach also runs into the 6,144-character managed policy limit as projects grow, so it is exactly the per-project maintenance the team wants to avoid.
OPT: b *
Tag every resource with a project key, tag each engineer's IAM role or Identity Center attribute with the same key, and attach one policy that allows actions only when aws:ResourceTag/project matches aws:PrincipalTag/project.
OPT: c
Create a separate AWS account per project in AWS Organizations and give each team an Identity Center permission set in its own account.
WHY:
Account-per-project is a valid isolation model, but it means provisioning an account, permission sets and baseline controls for every one of hundreds of projects; that is far more overhead than a single tag-matching policy in the existing account.
OPT: d
Attach a permissions boundary per project that lists the project's resources, so each engineer is capped to their own project.
WHY:
A permissions boundary only sets the maximum an identity policy can grant and never grants access itself, so you would still need a per-project permissions policy and would maintain two per-project documents instead of one.
A:
Use attribute-based access control: one policy whose condition requires the resource's project tag to equal the caller's principal tag. Because access is derived from matching tags, a new project needs only a new tag value on its role or Identity Center attribute and on its resources, never a new policy, so the policy set stays small and constant. Make the design safe by also requiring the project tag at resource creation with aws:RequestTag and denying changes to that tag, otherwise an engineer could retag a resource into their project. ABAC is the wrong fit only when a service does not support resource tags in authorization; there an ARN-based policy remains necessary.
USAGE:
When your permission review starts with "which policy do I copy for the new team", change the question to "which tag value do they get".

## aws-cross-account-s3-two-policies-mcq-13 | d2
TOPIC: 1.1 Secure access
QUALIFIER: LEAST amount of change
Q:
An analytics job runs under an IAM role in account B and must read objects from a bucket that account A owns. Both accounts already exist, the bucket keeps its default settings and must stay private, and the role currently has no S3 permissions. Which change lets the role read the objects with the LEAST amount of change?
OPT: a *
Add a bucket policy in account A that allows s3:GetObject for the account B role's ARN, and attach an identity policy to the role in account B that allows s3:GetObject on that bucket.
OPT: b
Attach an identity policy to the role in account B that allows s3:GetObject on the account A bucket ARN; no change is needed in account A.
WHY:
A cross-account request is evaluated in both accounts and allowed only if both return Allow, so the trusting account's bucket policy must name the role; an identity policy alone is enough only inside a single account.
OPT: c
Turn off Block Public Access on the bucket and add a bucket policy that allows s3:GetObject for all principals, so any account can read it.
WHY:
This grants the whole internet rather than one role; it removes the protective default and turns a two-line trust relationship into a public data exposure.
OPT: d
Create an IAM user in account A with read access to the bucket and store its access keys in the job's configuration in account B.
WHY:
Long-lived access keys crossing an account boundary are what roles exist to avoid; they never expire, must be rotated by hand and cannot be scoped to a session, so this is more work and less secure than two policies.
A:
Cross-account access needs both sides: a resource-based bucket policy in the bucket owner's account that names the account B role, and an identity-based policy on that role allowing the same action on the bucket. AWS evaluates the request in each account and grants it only when both evaluations allow it, which is why an identity policy alone works inside one account but fails across accounts. Leave Object Ownership at the default Bucket owner enforced so ACLs stay disabled and, if account B ever writes, account A still owns every object. Public bucket policies and shared IAM user keys solve the problem by removing the boundary rather than crossing it correctly.
USAGE:
When a cross-account S3 call returns AccessDenied, check the bucket policy and the caller's identity policy as a pair; the missing half is almost always on the side you did not write.

## aws-iam-groups-shared-permissions-mcq-04 | d1
TOPIC: 1.1 Secure access
QUALIFIER: LEAST operational overhead
Q:
A startup has 50 developers who all need the same permissions in a single AWS account, and two or three new developers join every month. The administrator wants each person to keep an individual identity for audit purposes while spending as little time as possible granting access. Which approach meets these requirements with the LEAST operational overhead?
OPT: a *
Create one IAM user group, attach a customer managed policy with the shared permissions, and add each developer's IAM user to the group when they join.
OPT: b
Create an inline policy with the shared permissions on each developer's IAM user and copy it to every new user.
WHY:
Fifty copies of the same policy must each be edited when a permission changes, and the inline policies on one user are capped at 2,048 characters in aggregate; this is the maintenance a group removes.
OPT: c
Create a single shared IAM user named developers and distribute its credentials to the team.
WHY:
A shared identity destroys individual accountability in CloudTrail and forces a credential rotation every time someone leaves; it also breaks the requirement that each person has their own identity.
OPT: d
Create a parent group for all staff and a nested developers group inside it, so permissions inherit downward.
WHY:
IAM user groups cannot be nested; a group can contain only users, so this design cannot be built and the inheritance it promises does not exist.
A:
Put the developers in one IAM user group with a managed policy attached: a new hire receives every permission through a single group membership, and a permission change is edited once and applies to all. Remember the group's limits: it is a container for permissions only, cannot hold other groups, and cannot be named as a Principal in a bucket or key policy, so resource policies must name users or roles instead. For a company that will grow into several accounts, the same pattern is an IAM Identity Center group assigned a permission set, which hands out temporary credentials instead of long-lived user keys.
USAGE:
If onboarding is "add to the group and done" you have it right; if it involves copying a policy, stop.

## aws-iam-mfa-for-destructive-api-mcq-02 | d2
TOPIC: 1.1 Secure access
QUALIFIER: MOST secure
Q:
A company's IAM users administer EC2 and S3 from both the console and the CLI. A new control requires that TerminateInstances and DeleteBucket succeed only when the caller has authenticated with MFA, while the Lambda execution roles and CI/CD roles that never carry MFA must keep working unchanged. Which solution is the MOST secure way to meet these requirements?
OPT: a *
Add a statement to the users' identity policies that denies ec2:TerminateInstances and s3:DeleteBucket when BoolIfExists aws:MultiFactorAuthPresent is false, so that requests signed with plain access keys, where the key is absent, are denied as well.
OPT: b
Attach a service control policy to the account that denies all actions when aws:MultiFactorAuthPresent is false.
WHY:
An SCP applies to every role in the member account, and roles assumed by Lambda or a CI pipeline have no MFA context, so the guardrail would break the workloads the requirement says must keep running.
OPT: c
Strengthen the account password policy to require 16 characters, symbols and 90-day rotation.
WHY:
A password policy changes how users sign in to the console; it does nothing to CLI calls made with access keys and does not require a second factor for any specific API action.
OPT: d
Create an EventBridge rule on the CloudTrail TerminateInstances and DeleteBucket events that notifies the security team.
WHY:
Notification after the fact is a detective control; the instance is already gone when the alert arrives, so it does not satisfy "succeed only when" the caller used MFA.
A:
Put the MFA condition where only human identities are affected: in the identity policy or permissions boundary attached to the IAM users, denying the destructive actions when BoolIfExists aws:MultiFactorAuthPresent is false. Use BoolIfExists rather than Bool, because the key is absent from requests made with long-term access keys and a plain Bool test would let those through. Users then call GetSessionToken with their MFA code to obtain credentials that carry the flag. Do not move the same condition into an SCP: it binds every role in the account, and service roles never present MFA, so automation stops. Requiring MFA only at console sign-in leaves CLI and API calls uncovered.
USAGE:
Test a new MFA policy with an access key first: if the deny does not fire for a plain key, you wrote Bool where BoolIfExists was needed.

## aws-root-user-hardening-mcq-01 | d1
TOPIC: 1.1 Secure access
QUALIFIER: MOST secure
Q:
A security audit of a standalone AWS account finds that the root user has an active access key pair that a nightly script uses, and that root has no MFA device. Which remediation is the MOST secure?
OPT: a *
Enable MFA on the root user, delete the root access keys, and move the nightly script to an IAM role with only the permissions it needs.
OPT: b
Attach an IAM policy to the root user that restricts the access keys to the actions the script needs.
WHY:
Requests made with root credentials are always allowed inside the account; IAM identity policies do not limit the root user, so the restriction would have no effect.
OPT: c
Rotate the root access keys and store the new pair in AWS Secrets Manager for the script to use.
WHY:
Rotation keeps a permanent, all-powerful credential in circulation; the best practice is that root access keys should not exist at all, so rotating them fixes the wrong problem.
OPT: d
Create an IAM user with AdministratorAccess and long-lived access keys for the script, and leave the root credentials as they are.
WHY:
It swaps one permanent full-access key for another and leaves root without MFA; the script needs neither administrator rights nor long-term keys.
A:
Delete the root access keys, register MFA on root, which supports up to eight devices, and give the script its own least-privilege IAM role that uses temporary credentials; daily human work belongs in IAM Identity Center or roles, never root. The rule that decides the question is that nothing inside the account limits root: IAM policies do not apply to it, so the only safe root is one with no keys, MFA, and no daily use. Only an SCP can restrict a root user, and only in an Organizations member account. Detective controls such as alerts on root sign-in are worth adding but do not remove the exposure, and rotating or re-homing the long-lived key keeps the underlying risk alive.
USAGE:
Search CloudTrail for userIdentity.type equal to Root over the last 90 days before deleting the keys, so you know which script will break and can move it first.

## aws-scp-restrict-regions-mcq-10 | d2
TOPIC: 1.1 Secure access
QUALIFIER: LEAST operational overhead
Q:
A European company with 40 member accounts in AWS Organizations must prevent anyone, including account administrators, from creating resources outside eu-west-1, while IAM, CloudFront, Route 53 and Organizations must keep working. Which solution meets these requirements with the LEAST operational overhead?
OPT: a *
Attach a service control policy to the organization root that denies all actions when aws:RequestedRegion is not eu-west-1, using NotAction to exempt the global services.
OPT: b
Add an IAM policy in every member account that denies actions outside eu-west-1 and attach it to all users and roles.
WHY:
An administrator in each account can edit or detach the policy, it must be maintained forty times, and it never binds the account's root user; a guardrail that the governed party can remove is not a guardrail.
OPT: c
Deploy an AWS Config rule in each account that flags resources found in Regions other than eu-west-1.
WHY:
Config evaluates resources after they exist and only reports non-compliance; it cannot stop the create call, so the requirement to prevent creation is not met.
OPT: d
Disable every Region except eu-west-1 in each member account from the account settings page.
WHY:
Only opt-in Regions can be disabled; the seventeen default Regions, including us-east-1 and the other EU Regions, cannot be turned off, so creation there would still succeed.
A:
Use an SCP on the organization root or an OU: a Deny with the condition StringNotEquals aws:RequestedRegion eu-west-1, written with NotAction so that global services such as IAM, Organizations, Route 53, CloudFront, STS and Support are exempt. One policy covers every member account, cannot be changed by account administrators, and binds each member account's root user. Control Tower's Region deny control is an SCP of the same shape. Remember that an SCP never grants anything and has no effect on the management account. Per-account IAM policies, Config rules and Region disabling either can be undone locally, only detect, or cannot touch the default Regions.
USAGE:
Add an ArnNotLike exception for a break-glass role before you attach the SCP, and test it on a sandbox OU first.

## aws-third-party-cross-account-role-mcq-07 | d2
TOPIC: 1.1 Secure access
QUALIFIER: MOST secure
Q:
A company subscribes to a SaaS monitoring product that runs in the vendor's own AWS account and needs to read CloudWatch metrics and describe EC2 instances in the company's account. The vendor serves many customers from the same platform. Which approach grants the vendor this access in the MOST secure way?
OPT: a *
Create an IAM role with a read-only permissions policy whose trust policy names the vendor's AWS account as principal and requires the vendor-supplied value in an sts:ExternalId condition, then give the vendor the role ARN.
OPT: b
Create an IAM user with read-only permissions and send the vendor its access key and secret key over an encrypted channel.
WHY:
The keys never expire, live in the vendor's systems indefinitely and cannot be revoked without rotating them; a role hands out temporary credentials and can be cut off by editing the trust policy.
OPT: c
Create an IAM role that trusts the vendor's account with no conditions, since the vendor's account ID is already specific.
WHY:
Without an external ID the vendor's multi-tenant platform could be tricked into using your role while acting for another customer, the confused deputy problem, because nothing ties the AssumeRole call to your tenancy.
OPT: d
Create a workforce user for the vendor in IAM Identity Center with a read-only permission set.
WHY:
Identity Center is for your own people signing in interactively; it still creates a human login with a password for an outside party and offers no way for the vendor's service to assume access programmatically per customer.
A:
Delegate with a cross-account role: the trust policy names the vendor's account and adds a Condition on sts:ExternalId equal to the customer identifier the vendor generated, and the permissions policy grants only the read actions needed. The vendor calls AssumeRole with that external ID and receives temporary credentials, so no long-lived secret leaves your account and access ends when you change the trust policy. The external ID is the discriminating detail: it is not a secret, but it stops a confused or compromised vendor from using your role on behalf of someone else. It is not the only control; least-privilege permissions on the role still matter.
USAGE:
Before saving a vendor's role ARN, confirm the role cannot be assumed without the external ID; if it can, the customer's trust policy is missing the condition.

## aws-block-single-ip-nacl-mcq-18 | d1
TOPIC: 1.2 Secure workloads
QUALIFIER: FASTEST
Q:
A fleet of EC2 instances with public IP addresses serves traffic directly, with no load balancer or CloudFront distribution in front. Logs show one IP address, 203.0.113.9, hammering the instances with malformed requests. What is the FASTEST way to block this address?
OPT: a *
Add an inbound Deny rule with a low rule number for 203.0.113.9/32 to the network ACL of the instances' subnet.
OPT: b
Add an inbound rule to the instances' security group that denies 203.0.113.9/32.
WHY:
Security groups only have allow rules; there is no deny rule to add, so the group cannot single out one address while still admitting everyone else.
OPT: c
Create an AWS WAF IP set containing 203.0.113.9 and a web ACL that blocks it.
WHY:
WAF attaches to CloudFront, an Application Load Balancer, API Gateway and similar services, none of which sits in front of these instances, so there is nothing to associate the web ACL with.
OPT: d
Add a route for 203.0.113.9/32 with a blackhole target to the subnet's route table.
WHY:
Routes are chosen by the destination address of outgoing packets; a route for the attacker's address affects replies, not the inbound traffic that is causing the problem.
A:
Add a Deny rule for the /32 to the subnet's network ACL and give it a number lower than the allow rules: NACL rules are evaluated in ascending order and the first match wins, so the deny takes effect immediately for every instance in the subnet with no redeploy. It is the only VPC control that can express "deny this source": security groups are allow-only, WAF needs a supported resource such as an ALB or CloudFront in front, and route tables act on destinations. Keep the NACL for coarse blocks like this and leave application rules in security groups. Shield Advanced answers volumetric DDoS, not a single noisy address.
USAGE:
Number the deny rule 10 or lower so it cannot sort behind a broad allow, and remember the NACL is stateless, so the reply direction is unaffected.

## aws-db-password-rotation-no-code-mcq-28 | d1
TOPIC: 1.2 Secure workloads
QUALIFIER: LEAST operational overhead
Q:
A company runs an application on EC2 that connects to an Amazon RDS for PostgreSQL database using the database's master user credentials. A new security policy requires that password to be rotated automatically every 30 days, and the team does not want to write or maintain any rotation code. Which solution meets these requirements with the LEAST operational overhead?
OPT: a *
Store the credentials in AWS Secrets Manager with managed rotation for RDS enabled on a 30-day schedule, and have the application retrieve the secret at runtime through its IAM role.
OPT: b
Store the password as a SecureString parameter in AWS Systems Manager Parameter Store and schedule a Lambda function that generates a new password, updates the database, and rewrites the parameter.
WHY:
Parameter Store has no credential rotation of its own, so the Lambda function that changes the password in the database and updates the parameter is custom code the team must write, test and maintain, which is exactly what the requirement rules out.
OPT: c
Store the password in AWS KMS and let the key's automatic rotation replace it.
WHY:
KMS stores and rotates encryption keys, not application secrets; a database password cannot be kept inside a KMS key, and rotating a KMS key changes key material, not any password the database knows about.
OPT: d
Keep the password in an environment variable and have the deployment pipeline inject a new value on every release.
WHY:
A pipeline-injected environment variable rotates only when someone deploys, exposes the value in build logs and process listings, and never updates the password in the database itself, so it neither guarantees the 30-day cadence nor removes manual work.
A:
Use Secrets Manager with managed rotation for RDS: RDS rotates the master user password on the schedule you set (every seven days by default, adjustable with a rate or cron expression, as often as every four hours) without any Lambda function, and the application fetches the current value through its role, so rotation needs no code and no redeploy. Managed rotation covers only the master user; an application-specific database user is rotated by a Lambda function built from an AWS template. Parameter Store cannot rotate credentials, KMS holds keys rather than secrets, and environment variables leave both the schedule and the database update as manual work.
USAGE:
Whenever a stem says "rotate" plus "no custom code", read it as Secrets Manager managed rotation; Parameter Store wins only when the question is about free static configuration.

## aws-nat-gateway-per-az-mcq-20 | d2
TOPIC: 1.2 Secure workloads
QUALIFIER: HIGHEST availability
Q:
An Auto Scaling group runs in private subnets across three Availability Zones. All three private subnets share one route table whose default route points to a single NAT gateway in the first zone. A recent event in that zone left instances in the other two zones unable to reach a payment API. The team must redesign outbound internet access so that it survives the loss of any single zone. Which design provides the HIGHEST availability?
OPT: a *
Create a NAT gateway in a public subnet of each Availability Zone and give each private subnet its own route table whose default route targets the NAT gateway in the same zone.
OPT: b
Create a second NAT gateway in the first zone and point the shared route table at it as a standby.
WHY:
Both gateways sit in the same zone and fail together; a second gateway in one zone adds capacity there rather than resilience across zones, and the shared route table still ties every zone to that one zone.
OPT: c
Replace the NAT gateway with NAT instances in an Auto Scaling group spanning the three zones, with a script that rewrites the shared route on failover.
WHY:
Instances need patching, sizing and a failover script that must run correctly during an outage, and the shared route table still sends two zones' traffic across the zone boundary; that is more operations for less availability than managed zonal gateways.
OPT: d
Add a 0.0.0.0/0 route to the internet gateway in the private subnets' route table so instances no longer depend on the NAT gateway.
WHY:
A default route to an internet gateway turns the subnets public, and instances without public IPs still cannot reach the internet through it; it discards the security posture without restoring egress for the existing instances.
A:
Make the NAT tier zone-independent: one NAT gateway per Availability Zone plus one route table per private subnet whose default route targets the local gateway. A NAT gateway is redundant only inside its own zone, so a shared route table pointing at one zone couples every zone to that zone's health; the per-subnet route table is the detail that actually removes the cross-zone dependency, and it also stops paying cross-zone data transfer for traffic that detours through another zone. More gateways in the same zone, NAT instances with failover scripts, or an internet-gateway route do not achieve that. Interface endpoints reach only AWS services, not an external API.
USAGE:
For a brand-new VPC, a regional NAT gateway expands across zones on its own; for an existing zonal design, the per-zone route table is the fix, not just the extra gateway.

## aws-private-egress-to-s3-dynamodb-mcq-22 | d2
TOPIC: 1.2 Secure workloads
QUALIFIER: MOST cost-effective
Q:
Compliance rules require that EC2 instances in private subnets have no path to the internet at all. The application must read and write objects in an S3 bucket and items in a DynamoDB table in the same Region, and nothing else outside the VPC. Which solution meets these requirements in the MOST cost-effective way?
OPT: a *
Create gateway VPC endpoints for S3 and DynamoDB and associate them with the private subnets' route tables.
OPT: b
Deploy a NAT gateway in a public subnet and route 0.0.0.0/0 from the private subnets to it.
WHY:
A NAT gateway costs about $0.045 per hour plus $0.045 per GB processed in us-east-1 and, worse for this scenario, gives the instances a route to the whole internet, which the compliance rule forbids.
OPT: c
Create interface VPC endpoints for S3 and DynamoDB in each Availability Zone.
WHY:
Interface endpoints keep traffic private but bill about $0.01 per endpoint-hour per Availability Zone plus $0.01 per GB; for in-VPC access to S3 and DynamoDB the gateway endpoint does the same job at no charge.
OPT: d
Attach a transit gateway and route the traffic through a shared egress VPC that has a NAT gateway.
WHY:
This stacks transit gateway attachment and data charges on top of a NAT gateway and still ends in an internet path; it is the heaviest and least private of the options.
A:
Gateway endpoints for S3 and DynamoDB add a prefix-list route to the selected route tables and carry no additional charge, so the instances reach both services over the AWS network with no internet gateway or NAT device in the picture, exactly what the compliance rule demands. They exist only for these two services and only for traffic from inside the VPC in the same Region; an on-premises network, a peered VPC in another Region or a transit gateway path needs an interface endpoint instead. Tighten the design with an endpoint policy or a bucket policy conditioned on aws:sourceVpce. Choose a NAT gateway when instances must reach arbitrary internet hosts, not for two AWS services.
USAGE:
When a "no internet" subnet needs S3 or DynamoDB, the gateway endpoint is both the cheapest and the most private answer; check that the route table shows the pl- prefix list before you blame IAM.

## aws-rds-publicly-accessible-fix-mcq-23 | d1
TOPIC: 1.2 Secure workloads
QUALIFIER: MOST secure
Q:
A security scan reports that an RDS for MySQL instance was launched with Publicly accessible set to Yes in a DB subnet group of public subnets, and that its security group allows port 3306 from 0.0.0.0/0. Only the application servers in the same VPC need to connect. Which change is the MOST secure fix?
OPT: a *
Place the instance in private subnets, set Publicly accessible to No, and replace the security group rule so that port 3306 is allowed only from the application tier's security group.
OPT: b
Keep the current placement and add a network ACL rule that denies 0.0.0.0/0 on port 3306 to the public subnets.
WHY:
The database keeps its public IP and public DNS answer, and a stateless NACL deny on 0.0.0.0/0 blocks the application servers too unless it is carefully ordered; it papers over the exposure instead of removing it.
OPT: c
Enable encryption at rest with a KMS key on the instance.
WHY:
Encryption protects the storage volume and snapshots; it changes nothing about who can open a TCP connection to port 3306 from the internet.
OPT: d
Turn on IAM database authentication and disable password logins.
WHY:
Stronger authentication still leaves the endpoint reachable from anywhere; an exposed listener can be brute-forced, fingerprinted or hit by an engine vulnerability regardless of the login method.
A:
Remove the exposure at the network layer: private subnets, Publicly accessible set to No so the instance has no public IP and its endpoint resolves only to a private address, and a security group that allows 3306 solely from the application tier's security group by reference. RDS documents that access is ultimately controlled by the security group and that public reachability also requires public subnets, so all three settings work together. Encryption, IAM authentication and WAF address other layers, and WAF cannot front RDS at all, so each leaves the listener on the internet. Flipping Publicly accessible applies immediately with no downtime; changing the DB subnet group causes an outage, so schedule that step.
USAGE:
Treat Publicly accessible equal to Yes on a production database as a finding to close today, not a setting to compensate for with firewall rules.

## aws-three-tier-security-group-chain-mcq-19 | d2
TOPIC: 1.2 Secure workloads
QUALIFIER: MOST secure
Q:
A three-tier application has an internet-facing Application Load Balancer, web servers in an Auto Scaling group, and an RDS for MySQL instance. Each tier is in its own subnets and has its own security group. Which security group design is the MOST secure?
OPT: a *
The load balancer group allows 443 from 0.0.0.0/0; the web group allows 80 and 443 only from the load balancer group; the database group allows 3306 only from the web group; every rule references a security group rather than a CIDR.
OPT: b
The load balancer group allows 443 from 0.0.0.0/0; the web group allows 80 and 443 from the load balancer group; the database group allows 3306 from the VPC CIDR 10.0.0.0/16.
WHY:
The VPC CIDR admits every instance in the VPC, including the load balancer subnets and any future workload, so the database accepts connections from far more than the web tier.
OPT: c
One security group shared by all three tiers that allows all traffic from itself and 443 from 0.0.0.0/0.
WHY:
A single self-referencing group means a compromised web server can reach the database on any port; there is no segmentation between tiers, which is the whole point of the design.
OPT: d
The load balancer group allows 443 from 0.0.0.0/0; the web group allows 80 and 443 from the load balancer group; the database group allows 3306 from the web subnets' CIDR ranges.
WHY:
Subnet CIDRs cover everything that happens to live in those subnets and break silently when the web tier moves or a new subnet is added; a group reference follows the instances wherever they launch.
A:
Chain the tiers by security group reference: the load balancer accepts the internet on 443, the web group accepts only the load balancer's group, and the database group accepts 3306 only from the web group. A rule that names a security group matches the private IP addresses of every interface in that group, so scaling and replacements are covered automatically, and each such rule counts as one rule against the default quota of 60. CIDR-based rules, whether the VPC range or subnet ranges, admit everything in the range and drift as the network changes. Network ACLs are stateless and cannot reference groups, so they complement this design rather than replace it.
USAGE:
Any 0.0.0.0/0 or VPC-wide CIDR on a database security group should fail code review; the source must be another group.

## aws-waf-rate-based-http-flood-mcq-26 | d2
TOPIC: 1.2 Secure workloads
QUALIFIER: LEAST operational overhead
Q:
A public web application behind an Application Load Balancer is being hit by an HTTP flood: thousands of source IP addresses each send a few hundred requests per minute to the login page, and the set of addresses changes every few minutes. Legitimate users are timing out. Which mitigation meets the requirement with the LEAST operational overhead?
OPT: a *
Associate an AWS WAF web ACL with the ALB that contains a rate-based rule aggregating on source IP with a scope-down statement for the login path, and add the AWS Managed Rules Bot Control rule group.
OPT: b
Add deny entries to the subnet network ACL for each attacking IP address as it appears.
WHY:
A network ACL holds 20 inbound rules by default and at most 40 after a quota increase, so it cannot list thousands of addresses, and because the attackers rotate every few minutes the deny list is stale the moment it is written; this is manual, unbounded work.
OPT: c
Rely on AWS Shield Standard, which is already enabled on the account.
WHY:
Shield Standard is automatic and free but defends against network and transport layer (layer 3 and 4) floods; an HTTP request flood is a layer 7 attack made of well-formed requests that Shield Standard does not inspect, so it is already on and not helping.
OPT: d
Raise the maximum size of the Auto Scaling group so the fleet can absorb the extra requests.
WHY:
Scaling out serves the attacker's requests at your expense: it adds instance cost, keeps the ALB and database under load, and stops nothing, so it is neither a mitigation nor low-overhead.
A:
Put an AWS WAF web ACL with a rate-based rule on the ALB, optionally with the Bot Control managed rule group: WAF counts requests per source IP over the evaluation window (60, 120, 300 or 600 seconds, 300 by default), blocks addresses that exceed the limit you set (minimum 10), and releases them when the rate drops, with no lists to maintain. Network ACLs are capped at 40 inbound rules and cannot follow rotating IPs, Shield Standard covers only layers 3 and 4, and a bigger fleet absorbs cost without blocking anything.
USAGE:
Start the rate-based rule in Count mode, watch the sampled requests for a day, then switch it to Block once the threshold clears real users.

## aws-acm-cert-region-for-cloudfront-mcq-39 | d1
TOPIC: 1.3 Data security controls
QUALIFIER: MOST quickly
Q:
A team in Sydney requested a public certificate in AWS Certificate Manager in ap-southeast-2 and attached it to their Application Load Balancer. They are now creating a CloudFront distribution for the same domain, but the certificate does not appear in the distribution's custom SSL certificate list. What should the team do to serve HTTPS on the distribution MOST quickly?
OPT: a *
Request a new ACM certificate for the domain in us-east-1, validate it with DNS, and select it on the distribution.
OPT: b
Request the certificate again in the Region where the CloudFront distribution is created.
WHY:
CloudFront is a global service with no Region of its own; it reads ACM certificates only from us-east-1 (N. Virginia), so "the distribution's Region" is not something you can pick, and any other Region leaves the list empty.
OPT: c
Export the existing certificate from ACM and install it on the origin servers.
WHY:
A public ACM certificate can be exported only if it was requested as exportable, and installing a certificate on the origin secures the CloudFront-to-origin hop, not the viewer connection the distribution needs; the viewer certificate must still live in ACM in us-east-1.
OPT: d
Issue the certificate from AWS Private CA and attach it to the distribution.
WHY:
Private CA certificates chain to your own root, which browsers do not trust, so viewers would see certificate warnings; CloudFront expects a viewer certificate from ACM or from a CA on the Mozilla Included CA list, and a private CA is on neither.
A:
Request (or import) the certificate in us-east-1: CloudFront only accepts ACM certificates from the US East (N. Virginia) Region, while an ALB uses one from its own Region, so the Sydney certificate is fine for the ALB but invisible to CloudFront. ACM certificates cannot be copied between Regions, exporting does not move the viewer-facing certificate anywhere useful, and a private CA certificate is not trusted by browsers. DNS validation lets ACM renew the new certificate automatically.
USAGE:
Treat us-east-1 as the home Region for every certificate CloudFront will serve, and keep a second copy in the application Region for the load balancer.

## aws-kms-cross-account-decrypt-mcq-42 | d2
TOPIC: 1.3 Data security controls
QUALIFIER: LEAST amount of change
Q:
Account A stores reports in an S3 bucket encrypted with SSE-KMS using a customer managed key in account A. A Lambda function in account B runs under an IAM role in account B and must read those objects. The bucket policy in account A already grants s3:GetObject to that role, but every read fails with AccessDenied. Which change makes the reads succeed with the LEAST amount of change?
OPT: a *
Add a statement to the key policy in account A that allows account B's role kms:Decrypt and kms:DescribeKey, and attach an IAM policy to the role in account B allowing the same actions on that key's ARN.
OPT: b
Attach an IAM policy to the role in account B that allows kms:Decrypt on the key ARN in account A, without touching account A.
WHY:
For a KMS key, the key policy in the owning account decides who can be granted access at all; an IAM policy in the external account can only delegate what the key policy already allows, so an identity policy alone leaves the Decrypt call denied.
OPT: c
Share the KMS key with account B through AWS Resource Access Manager.
WHY:
KMS keys are not a resource type that AWS RAM can share; cross-account use of a key is granted only through its key policy plus IAM policies in the other account.
OPT: d
Export the key material from account A and import it as a new KMS key in account B.
WHY:
KMS never releases the key material of a KMS key, and a different key in account B could not decrypt data keys that were encrypted under account A's key anyway; the objects must be decrypted by the original key.
A:
Grant the decrypt in both places: a key policy statement in account A naming account B's role (or the account) with kms:Decrypt and kms:DescribeKey, and an IAM policy on that role in account B for the same actions on the key ARN. The S3 grant was never the problem: reading an SSE-KMS object requires kms:Decrypt on the key, and neither the key policy nor the IAM policy alone is sufficient. Keys cannot be shared through RAM, exported or copied. Had the bucket used the AWS managed key aws/s3, no policy change could help, because AWS managed keys cannot be used across accounts.
USAGE:
When cross-account S3 reads fail only for encrypted objects, check the key policy before the bucket policy; the bucket policy passes but KMS denies.

## aws-object-lock-compliance-vs-governance-mcq-47 | d2
TOPIC: 1.3 Data security controls
QUALIFIER: MOST secure
Q:
A brokerage must keep trade confirmation records in Amazon S3 for 7 years, and an auditor requires proof that no one, including account administrators and the root user, can delete or overwrite a record before the period ends. Which configuration is the MOST secure way to meet this requirement?
OPT: a *
Enable S3 Object Lock on a versioned bucket with a default retention period of 7 years in compliance mode.
OPT: b
Enable S3 Object Lock with a default retention period of 7 years in governance mode.
WHY:
Governance mode protects against most users, but any principal granted the S3 governance-retention override permission can shorten the retention or delete the version by setting the matching request header, and administrators can grant themselves that permission, so the auditor's "no one" is not met.
OPT: c
Enable S3 Versioning with MFA delete on the bucket.
WHY:
MFA delete only adds a second factor to permanent version deletes and versioning changes; the root user, who alone can enable it, can disable it again with the same device and then delete, so it slows deletion rather than making it impossible.
OPT: d
Add a bucket policy that denies s3:DeleteObject and s3:DeleteObjectVersion to all principals.
WHY:
A bucket policy is itself editable by anyone with s3:PutBucketPolicy, and the root user can always replace it, so an administrator removes the deny statement first and deletes second; it is a control on principals, not on the data.
A:
Use Object Lock in compliance mode with a 7-year retention period: a compliance-mode version cannot be overwritten or deleted by any user, including the root user, its retention mode cannot be changed and its period cannot be shortened; the only way out is deleting the AWS account. Object Lock requires Versioning. Governance mode can be overridden by anyone holding the governance-retention override permission, MFA delete and bucket policies are reversible by root or administrators, and a lifecycle expiration rule is a deletion schedule, not immutability.
USAGE:
Test retention settings in governance mode on a scratch bucket first, because a compliance-mode lock applied to the wrong prefix cannot be undone for its whole period.

## aws-rds-encrypt-existing-instance-mcq-37 | d2
TOPIC: 1.3 Data security controls
QUALIFIER: LEAST amount of change
Q:
An Amazon RDS for MySQL DB instance was created two years ago without encryption at rest. A new compliance rule requires all database storage to be encrypted with AWS KMS, and the application can tolerate a short maintenance window. Which approach meets the requirement with the LEAST amount of change?
OPT: a *
Take a snapshot of the instance, copy the snapshot with a KMS key selected, restore a new instance from the encrypted copy, then repoint the application and delete the old instance.
OPT: b
Modify the DB instance and enable the encryption option, applying the change in the next maintenance window.
WHY:
Encryption at rest can be chosen only when a DB instance is created; the modify operation has no such setting, so there is nothing to switch on for an existing unencrypted instance.
OPT: c
Create an encrypted read replica of the instance and promote it to a standalone instance.
WHY:
RDS cannot create an encrypted read replica from an unencrypted source (nor the reverse), so the replica would have to be unencrypted, and promoting it changes nothing about the storage.
OPT: d
Enable Amazon EBS encryption by default for the Region so the instance's volumes become encrypted.
WHY:
EBS encryption by default is an EC2 account setting that applies to new EBS volumes you create; it has no effect on existing volumes and does not govern RDS, which encrypts storage only through its own StorageEncrypted setting at creation time.
A:
Snapshot, encrypted copy, restore: RDS lets you encrypt a copy of an unencrypted snapshot, and the instance restored from that copy is fully encrypted, so the application only changes its endpoint at cut-over. Encryption cannot be switched on in place, an encrypted replica cannot be built from an unencrypted source, and EBS default encryption is a separate EC2 setting. For near-zero downtime, replicate changes into the new instance with AWS DMS before switching. Oracle and SQL Server TDE is a separate engine-level option, not KMS storage encryption.
USAGE:
Give the new instance a name the application reaches through a CNAME, so the cut-over is a DNS change rather than a code deploy.

## aws-s3-deny-non-tls-mcq-41 | d2
TOPIC: 1.3 Data security controls
QUALIFIER: LEAST operational overhead
Q:
A company's security standard says that no request to the bucket holding customer exports may travel over plain HTTP, and an auditor wants a control that rejects such requests rather than one that merely detects them. Which solution meets this requirement with the LEAST operational overhead?
OPT: a *
Add a bucket policy statement that denies s3:* on the bucket and its objects when the aws:SecureTransport condition is false.
OPT: b
Enable default encryption with SSE-KMS on the bucket.
WHY:
Server-side encryption protects objects at rest on disk; it says nothing about the transport a client uses, so an HTTP PUT or GET still succeeds against an SSE-KMS bucket.
OPT: c
Turn on S3 Block Public Access for the bucket.
WHY:
Block Public Access limits who can be granted access through public ACLs and policies; an authorised principal in the account can still call the bucket over HTTP, so it controls exposure, not the wire protocol.
OPT: d
Require all access through a gateway VPC endpoint with a bucket policy condition on aws:SourceVpce.
WHY:
A VPC endpoint keeps traffic on the AWS network but does not force TLS: a client inside the VPC can still send HTTP to the endpoint, so the path is private while the encryption-in-transit requirement is unmet, and it also cuts off legitimate access from elsewhere.
A:
A bucket policy that denies every S3 action when aws:SecureTransport is false: the condition is true only for HTTPS requests, so plain HTTP is rejected by S3 itself, with nothing to run or maintain. To also insist on a modern protocol, add a NumericLessThan condition on s3:TlsVersion 1.2. Encryption settings cover data at rest, Block Public Access covers who may be granted access, and a VPC endpoint changes the route, not whether the request is encrypted. A bucket cannot hold an ACM certificate; S3 already terminates TLS with its own.
USAGE:
Pair the deny statement with the s3-bucket-ssl-requests-only AWS Config rule so a future policy edit that drops it shows up as non-compliant.

## aws-s3-sse-kms-audit-revoke-mcq-36 | d2
TOPIC: 1.3 Data security controls
QUALIFIER: MOST secure
Q:
A company keeps three regulated datasets in one S3 bucket, one prefix each. Auditors require a log entry for every object decryption, and the security team must be able to cut off access to a single dataset's encryption key within minutes if that dataset is compromised, without affecting the other two. Which encryption configuration is the MOST secure way to meet both requirements?
OPT: a *
Use SSE-KMS with a separate customer managed KMS key for each dataset's prefix, controlling access through each key's key policy, and leave S3 Bucket Keys disabled on the bucket.
OPT: b
Rely on SSE-S3, the Amazon S3 managed key encryption that S3 applies to every new object by default.
WHY:
SSE-S3 keys are created, rotated and used entirely by S3: there is no key policy to edit and no KMS Decrypt call per object in CloudTrail, so neither the per-object decrypt trail nor a per-dataset revocation is possible.
OPT: c
Use SSE-KMS with the AWS managed key aws/s3 so that every decrypt is logged in CloudTrail.
WHY:
The aws/s3 key does log Decrypt calls, but AWS controls it: you cannot change its key policy, disable it or share it cross-account, so you cannot revoke one dataset's access, and a single shared key covers every prefix anyway.
OPT: d
Use SSE-C, supplying a different customer-provided key for each dataset on every request.
WHY:
With SSE-C the client sends the key on every request and S3 never stores it: no policy change revokes anything, every caller must ship keys around, there is no KMS Decrypt audit entry, and SSE-C has been blocked by default on new buckets since April 2026.
A:
Use SSE-KMS with a separate customer managed key per dataset. You own that key's policy, so removing a principal or disabling the key cuts off one dataset in minutes, and each GET makes S3 call kms:Decrypt, which CloudTrail records with the object ARN as encryption context. SSE-S3 and the AWS managed aws/s3 key give no policy you can edit; SSE-C pushes the key onto every request. Trap: S3 Bucket Keys cut KMS request cost by up to 99 percent, but they log the bucket ARN, skip KMS on repeated requests and stop checking the key policy, so leave them off when the audit must be per object.
USAGE:
Create one customer managed key per data classification rather than per bucket: the key policy then becomes the single switch that revokes a whole dataset without a data migration.

## aws-45-minute-job-not-lambda-mcq-15 | d2
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: LEAST operational overhead
Q:
A nightly batch job packaged as a container takes about 45 minutes to run and executes once a day at 02:00. The team wants to run it on AWS with the LEAST operational overhead. Which solution meets the requirement?
OPT: a *
Run the container as an Amazon ECS task on AWS Fargate, started once a day by an Amazon EventBridge Scheduler cron schedule.
OPT: b
Deploy the job as a standard AWS Lambda function with the timeout raised to its maximum and trigger it from an EventBridge Scheduler schedule.
WHY:
A standard Lambda function's timeout tops out at 900 seconds (15 minutes), so a 45-minute run is killed a third of the way through; only the newer Lambda Managed Instances mode, which runs on EC2 capacity you pay for, stretches asynchronous runs to 90 minutes.
OPT: c
Launch a small EC2 instance, install the container runtime and add a cron entry that starts the job at 02:00.
WHY:
It works, but a host you patch, monitor and pay for 24 hours a day to do 45 minutes of work is the opposite of least operational overhead.
OPT: d
Split the job into 15-minute Lambda stages and orchestrate them with an AWS Step Functions state machine.
WHY:
Chunking a monolithic 45-minute job into stages with checkpoints and a state machine is engineering work the requirement never asked for; it fits the Lambda limit by adding complexity rather than removing it.
A:
Run it as a scheduled ECS task on Fargate: EventBridge Scheduler calls RunTask on the cron expression, Fargate pulls the image, runs the container for as long as it needs, and bills per second with a one-minute minimum until the task exits. There is no instance to patch and no runtime ceiling; AWS Batch on Fargate is the same answer with a job queue in front. A standard Lambda function is the trap: its hard limit is 900 seconds (15 minutes), so any job that cannot finish in that window rules it out before cost is even considered. Cutting the job into Lambda pieces behind Step Functions only fits the limit by adding moving parts.
USAGE:
Anything that runs longer than 15 minutes or needs a full container image goes to a Fargate task on a schedule; keep Lambda for the short, bursty work it was built for.

## aws-asg-predictable-daily-spike-mcq-05 | d2
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: MOST performant
Q:
An internal web application on an Auto Scaling group with a target tracking policy on CPU is slow every weekday between 9:00 and 9:20 AM: staff log in at 9 AM, new instances take about 8 minutes to become healthy, and by the time scaling catches up the peak is over. Traffic is flat for the rest of the day. Which solution is the MOST performant way to handle the morning peak without paying for peak capacity all day?
OPT: a *
Add a recurring scheduled scaling action that raises the group's desired and minimum capacity at 8:45 AM on weekdays and another that lowers them at 10:00 AM, keeping the target tracking policy for the rest of the day.
OPT: b
Lower the target tracking policy's CPU target from 60 percent to 30 percent.
WHY:
A lower target still waits for load to arrive before adding instances, so the first users still hit the 8-minute launch gap; meanwhile the group runs roughly twice as many instances all day, which fails the cost side of the requirement.
OPT: c
Add a warm pool of stopped, pre-initialised instances to the Auto Scaling group.
WHY:
A warm pool shortens the boot time of instances the group draws in, but it still waits for the CPU alarm to fire after users arrive; the reaction is faster, not earlier, so the first minutes of the peak are still under-provisioned.
OPT: d
Set the group's minimum capacity to the number of instances needed at 9 AM.
WHY:
Running peak capacity 24 hours a day meets the performance target but pays for idle instances for the other 23 hours, which is exactly what the stem rules out.
A:
Use scheduled scaling: a recurring scheduled action sets desired, minimum and maximum capacity at a time you choose, so instances launched at 8:45 are healthy by 9:00 and the target tracking policy takes over for the rest of the day, with a second action scaling back after the peak. Predictive scaling would learn the same pattern from at least 24 hours of history, but a fixed 9 AM spike needs no forecast. Lowering the CPU target or keeping peak capacity permanently reacts late or costs all day, and a warm pool speeds up a reaction that still starts too late.
USAGE:
Set the schedule earlier than the peak by at least your instance warm-up time, and put the group's local time zone on the recurrence so daylight saving does not shift it.

## aws-helm-charts-portable-cluster-mcq-13 | d1
TOPIC: 2.1 Loosely coupled architectures
Q:
A platform team is moving a microservices application to AWS. Today it is deployed with Helm charts to an on-premises Kubernetes cluster, and the company's contract requires that the workload can be moved back on-premises at any time without rewriting the deployment artifacts. Which AWS service should host the containers?
OPT: a *
Amazon EKS with managed node groups or Fargate profiles, deploying the existing Helm charts unchanged.
OPT: b
Amazon ECS on AWS Fargate, converting each chart into ECS task definitions and services.
WHY:
ECS is not Kubernetes: its scheduler consumes task definitions and services, so every chart would have to be rewritten as ECS objects, and the result could not be redeployed to the on-premises cluster, which breaks the portability clause.
OPT: c
AWS Lambda functions packaged as container images, one per microservice.
WHY:
Lambda runs a container image only if it implements the Lambda runtime API and finishes within an invocation; there are no Kubernetes objects, Helm releases or long-running pods, so the orchestration model, not just the packaging, is abandoned.
OPT: d
AWS Elastic Beanstalk with the Docker platform branch, uploading the container images.
WHY:
Elastic Beanstalk's Docker platform branches deploy containers to EC2 instances directly or through Amazon ECS; neither exposes a Kubernetes API, so Helm charts cannot be applied and nothing produced there moves back on-premises.
A:
Amazon EKS: it is certified Kubernetes-conformant, so the Helm charts and manifests apply unchanged and the same artifacts still deploy to the on-premises cluster. The signal is the word Kubernetes (or Helm, kubectl, manifests, portability); without it, ECS is the simpler AWS-native orchestrator and the better default. EKS adds a per-cluster charge and a Kubernetes version upgrade cadence, so do not pick it when the requirement is only "run containers". Managed node groups or Fargate profiles are a capacity choice underneath EKS, not the deciding factor.
USAGE:
Ask whether the deployment artifacts are Kubernetes objects; if yes, only EKS keeps them, whatever compute runs underneath.

## aws-order-queue-between-tiers-mcq-01 | d2
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: LEAST operational overhead
Q:
An e-commerce web tier calls an order-processing service synchronously over HTTP. During flash sales the processing tier falls behind, the web tier's requests time out, and orders are lost. The company requires that no accepted order is ever lost, even if processing takes several minutes to catch up. Which redesign meets this requirement with the LEAST operational overhead?
OPT: a *
Have the web tier write each order to an Amazon SQS standard queue and run the processing service in an Auto Scaling group whose target tracking policy scales on the queue backlog per instance.
OPT: b
Have the web tier publish each order to an Amazon SNS topic that the processing service subscribes to over HTTPS.
WHY:
SNS pushes to the endpoint immediately and has no consumer-side buffer; when the processing tier is slow or down, SNS retries on its delivery policy and then discards the message unless a dead-letter queue is attached, so orders can still be lost during the backlog.
OPT: c
Have the web tier put each order into an Amazon Kinesis Data Streams stream that the processing service reads with a consumer library.
WHY:
Kinesis does buffer, but it makes you size shards (1 MB/s in, 2 MB/s out each), manage checkpoints and handle ordering per partition key, none of which the scenario asks for; that is more to operate than a queue for a simple work backlog.
OPT: d
Move the processing service to a much larger instance type.
WHY:
A bigger instance keeps the synchronous coupling and merely raises the ceiling; the next larger sale still times out, and the orders in flight during any restart are still lost.
A:
Put an SQS standard queue between the tiers: the web tier's write succeeds in milliseconds, the message is kept for up to 14 days (4 by default) until a worker deletes it, and a worker that crashes mid-order simply lets the visibility timeout expire so another worker retries. Scale the workers on backlog per instance rather than raw queue length. SNS has no buffer and eventually discards undeliverable messages, Kinesis adds shard and checkpoint management the case never asked for, and a larger instance keeps the coupling.
USAGE:
Set the queue's visibility timeout a little above the slowest order and attach a dead-letter queue, so poison orders park for inspection instead of retrying forever.

## aws-rds-reporting-read-replica-mcq-07 | d2
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: LEAST amount of change
Q:
A production Amazon RDS for PostgreSQL DB instance in a Multi-AZ DB instance deployment (one primary, one standby) serves an order system. Each morning the finance team runs heavy reporting queries against it, and order latency doubles for an hour. Reports may lag production data by a few seconds. Which solution isolates the reporting load with the LEAST amount of change?
OPT: a *
Create a read replica of the instance and point the reporting tool's connection string at the replica's endpoint.
OPT: b
Point the reporting tool at the Multi-AZ standby instance.
WHY:
The Multi-AZ standby is a synchronous copy kept for failover only; it cannot serve read traffic and is not reachable by applications, so there is nothing to point the reports at.
OPT: c
Add an Amazon ElastiCache cluster in front of the database and cache the report results.
WHY:
A cache only helps if the application is changed to check it, fall back to the database on a miss and write results back; that is new code in the order system and the reporting tool, and long-running analytical queries are poor cache candidates anyway.
OPT: d
Scale the instance to a larger DB instance class.
WHY:
Changing the instance class causes downtime while the instance is modified, does not separate the two workloads, and the reports still compete with orders for the same CPU and I/O, only on a bigger box.
A:
Create a read replica and change one connection string: RDS builds a read-only copy from a snapshot and replicates changes asynchronously, so the reports run on their own instance with seconds of lag, which the team accepts, and the writer never sees them. The Multi-AZ standby cannot serve reads, ElastiCache needs application code, and a bigger instance class needs downtime and still shares the box. Reports that must be exactly current would need the writer, not a replica.
USAGE:
Give the replica its own parameter group with a longer statement timeout, so analytical queries are tuned separately from the OLTP writer.

## aws-s3-upload-fanout-processing-mcq-02 | d2
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: MOST resilient
Q:
Users upload video files to an S3 bucket. Each upload must be handled by three separate processors: a transcoder, a content moderation check, and a search-index updater. Each processor fails and retries on its own schedule, none may block or lose work because another is down, and the company expects to add a fourth processor next quarter without touching the upload path. Which design is the MOST resilient?
OPT: a *
Configure the bucket's event notification to publish to an SNS topic; subscribe one SQS queue per processor, each with its own dead-letter queue, and have each processor consume from its own queue.
OPT: b
Configure the bucket's event notification to invoke a single Lambda function that transcodes, moderates and indexes the file in sequence.
WHY:
One function doing all three steps couples them: a moderation API outage fails the whole invocation, so the transcode is redone and the index never updates, and adding a fourth step means redeploying the function that owns the other three.
OPT: c
Configure the bucket's event notification to send to one SQS queue and have all three processors poll that queue.
WHY:
A message in an SQS queue is delivered to one consumer and deleted when that consumer finishes; three services polling the same queue compete for each upload, so each file reaches only one of them instead of all three.
OPT: d
Run a scheduled job every minute that lists the bucket, compares it with a database of processed keys, and calls each processor.
WHY:
Listing adds up to a minute of latency, grows in cost with the number of objects, and relies on the tracking database and the job itself never failing; a missed run or a partial list silently drops files, which is the opposite of resilient.
A:
Fan out with SNS to one SQS queue per processor: S3 publishes the event once, SNS copies it to every subscribed queue, and each processor then has its own buffer, its own retry via visibility timeout and its own dead-letter queue, so a failing moderation service only backs up its own queue. A fourth processor is one more subscription and queue, with no change upstream. EventBridge with one rule per target is the equivalent answer. A single Lambda couples the steps, a single queue splits the messages among consumers, and polling the bucket trades events for latency and a fragile tracker.
USAGE:
Enable raw message delivery on the SQS subscriptions so consumers receive the S3 event JSON directly rather than wrapped in an SNS envelope.

## aws-scale-to-zero-low-traffic-api-mcq-16 | d1
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: MOST cost-effective
Q:
A startup is launching an internal REST API that receives a few thousand requests on weekday mornings and nothing at all for many hours overnight and at weekends. The team wants to pay nothing while the API is idle. Which architecture is the MOST cost-effective?
OPT: a *
Amazon API Gateway HTTP API invoking AWS Lambda functions that read and write an Amazon DynamoDB table in on-demand capacity mode.
OPT: b
An Application Load Balancer in front of an EC2 Auto Scaling group with a minimum size of one, storing data in DynamoDB on-demand.
WHY:
An Application Load Balancer is billed for every hour or partial hour it exists (0.0225 USD per hour in US East before LCU charges), and an Auto Scaling group with minimum size one keeps an instance running through every idle hour, so the floor is never zero.
OPT: c
An Amazon ECS service on AWS Fargate behind an Application Load Balancer, with service auto scaling between one and ten tasks.
WHY:
An ECS service keeps its desired count of tasks running so the API stays reachable, and Fargate bills per vCPU and per GB for as long as a task runs; one idle task plus the hourly load balancer charge is a steady bill, not zero.
OPT: d
API Gateway and Lambda with a provisioned Amazon Aurora PostgreSQL DB instance for storage.
WHY:
A provisioned Aurora instance is billed for every hour it runs whether or not it receives a query; only Aurora Serverless v2 with a minimum of 0 ACUs pauses, after at least 5 idle minutes and with a resume of about 15 seconds, and even then storage is still charged.
A:
Use API Gateway HTTP API, Lambda and DynamoDB on-demand: each layer bills per request (HTTP API from 1.00 USD per million calls, Lambda 0.20 USD per million requests plus GB-seconds, DynamoDB per read or write request unit) and none has an hourly or minimum charge, so an idle hour costs nothing beyond the data stored. Load balancers, minimum-size Auto Scaling groups, always-on ECS tasks and provisioned databases all carry a floor that runs while nobody calls the API. The trade-off is cold-start latency and per-request pricing that stops being cheap at sustained high volume.
USAGE:
For a workload that is idle most of the day, list every component with an hourly charge before comparing per-request prices; the hourly items decide the bill.

## aws-single-az-three-tier-to-ha-mcq-04 | d3
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: MOST cost-effective
Q:
A three-tier web application runs in a single Availability Zone: an Auto Scaling group of two EC2 web servers whose only subnet is in that zone, behind an Application Load Balancer, and an RDS for MySQL instance in a Single-AZ deployment. The company requires that the application keep serving traffic, with automatic failover, if that Availability Zone fails. Which combination of changes is the MOST cost-effective way to meet the requirement? (Choose two.)
OPT: a *
Add a subnet in a second Availability Zone to the Auto Scaling group and make sure that zone is enabled on the Application Load Balancer.
OPT: b
Create an RDS read replica of the database in the same Availability Zone and direct reporting queries to it.
WHY:
Right service, wrong feature: a read replica replicates asynchronously, is promoted by hand and, placed in the same zone, goes down with the primary; it scales reads and does nothing for zone failover.
OPT: c *
Modify the RDS instance to a Multi-AZ DB instance deployment.
OPT: d
Replicate the whole stack to a second Region and use Route 53 failover routing to switch traffic.
WHY:
A second Region is disaster recovery for a Regional outage: it means paying for a second copy of every tier plus its own data replication and failover runbook, while the requirement is to survive one zone, which Multi-AZ resources do inside the Region for far less.
OPT: e
Move the web servers and the database to larger instance types so each can absorb the full load.
WHY:
Vertical scaling changes capacity, not placement: bigger instances in the same zone go down with that zone, so the single point of failure is untouched.
A:
Spread the application tier across two Availability Zones by adding a second-zone subnet to the Auto Scaling group and enabling that zone on the load balancer, and convert the database to Multi-AZ. The load balancer keeps a node in each enabled zone and routes only to healthy targets, Auto Scaling launches replacements in the surviving zone, and RDS keeps a synchronous standby in another zone and repoints the DNS endpoint automatically, typically within 60 to 120 seconds. A read replica needs manual promotion, larger instances stay in one zone, and a second Region answers a bigger question than was asked. Do not add a Region until a Regional outage is actually in scope.
USAGE:
Before buying disaster recovery in another Region, make every tier in the current Region span two zones: subnets on the Auto Scaling group and load balancer, Multi-AZ on the database.

## aws-spiky-container-api-no-hosts-mcq-12 | d1
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: LEAST operational overhead
Q:
A three-person team runs a containerised REST API whose traffic jumps tenfold during marketing campaigns and falls back within hours. Nobody on the team has time to build AMIs, patch operating systems or right-size a server fleet. Which deployment handles the traffic pattern with the LEAST operational overhead?
OPT: a *
Run the API as an Amazon ECS service on AWS Fargate behind an Application Load Balancer, with a target tracking scaling policy on ALBRequestCountPerTarget.
OPT: b
Run the API as an Amazon ECS service using the EC2 launch type on an Auto Scaling group of container instances.
WHY:
With the EC2 launch type you manage the container instances yourself: choosing instance types, maintaining the ECS-optimised AMI, patching the operating system and scaling the instance fleet as well as the tasks, which is exactly the work the team wants to avoid.
OPT: c
Create an Amazon EKS cluster with self-managed nodes and deploy the API as a Kubernetes Deployment with a Horizontal Pod Autoscaler.
WHY:
Self-managed EKS nodes are EC2 instances the team must patch, upgrade and scale, and the cluster adds a Kubernetes version upgrade cadence; nothing in the requirement asks for Kubernetes, so this adds operations rather than removing them.
OPT: d
Deploy the container with AWS Elastic Beanstalk using the Docker platform branch on Amazon Linux 2023.
WHY:
Elastic Beanstalk's Docker platform deploys the containers onto EC2 instances in your account; Beanstalk automates the environment, but the instances, their platform updates and their scaling settings remain resources you own and tune.
A:
ECS on Fargate behind an ALB with service auto scaling: each Fargate task runs in its own isolation boundary on infrastructure AWS provisions and patches, you pay per vCPU and GB only while tasks run, and a target tracking policy on ALBRequestCountPerTarget adds or removes tasks as request volume moves. The EC2 launch type, self-managed EKS nodes and Elastic Beanstalk all leave EC2 hosts in your account to patch and size. Choose EC2-backed capacity instead only for GPUs, custom AMIs, privileged containers or capacity reservations.
USAGE:
When the question says "nobody to patch hosts" or "spiky", Fargate is the launch type; when it says GPU, custom kernel or reserved capacity, the EC2 launch type is.

## aws-sqs-fifo-per-product-order-mcq-08 | d2
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: LEAST operational overhead
Q:
A retailer's inventory service receives stock adjustments from a warehouse system that retries on network errors, so the same adjustment can arrive twice. Adjustments for a given product must be applied in the order they were sent, while adjustments for different products should still be processed in parallel. Peak volume is about 200 messages per second. Which solution meets these requirements with the LEAST operational overhead?
OPT: a *
Send the adjustments to an Amazon SQS FIFO queue with the product ID as the MessageGroupId and content-based deduplication enabled.
OPT: b
Send the adjustments to an Amazon SQS standard queue and make the consumer idempotent by recording processed adjustment IDs in DynamoDB.
WHY:
An idempotent consumer removes the duplicates but not the reordering: a standard queue offers only best-effort ordering, so the consumer would also have to buffer and re-sequence adjustments per product, which is the queue's job done again in your code.
OPT: c
Publish the adjustments to an Amazon SNS FIFO topic and subscribe the inventory service's endpoint to it, with no queue in between.
WHY:
An SNS FIFO topic can deliver only to SQS queues (standard or FIFO); subscribing an HTTP(S) endpoint, email, SMS or mobile app to a FIFO topic fails with an error, so this design cannot be built, and the moment you add the required SQS FIFO queue the topic is an extra hop with nothing to fan out to.
OPT: d
Write the adjustments to an Amazon Kinesis Data Streams stream with the product ID as the partition key.
WHY:
Kinesis orders records per shard, so same-product ordering works, but the team must size shards, run a consumer with checkpointing, and deduplicate producer retries themselves because Kinesis has no deduplication; that is more to operate than a queue for a queueing job.
A:
Use an SQS FIFO queue with the product ID as the message group ID and content-based deduplication: messages within a group are delivered in order, different groups are processed in parallel, and a retried SendMessage whose SHA-256 body hash matches one seen inside the 5-minute deduplication interval is dropped, so the consumer stays simple. The trade-off is throughput: 300 API calls per second per action, 3,000 messages per second with batching, more only in high throughput mode; 200 per second fits. A standard queue plus idempotent consumer handles duplicates but not order, an SNS FIFO topic can only deliver to SQS queues so it cannot push to the service directly, and Kinesis adds shards and checkpoints.
USAGE:
Put a warehouse-generated adjustment ID in the body and keep retries byte-identical; a fresh timestamp on each retry defeats content-based deduplication.

## aws-central-backups-cross-region-mcq-34 | d1
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: LEAST operational overhead
Q:
An audit found that a company backs up its EBS volumes with a cron script, its RDS databases with manual snapshots, and its DynamoDB tables and EFS file systems not at all. The new policy requires a daily backup of every resource tagged Backup=daily, retained for 35 days, copied to a second Region, with a report that proves compliance. Which approach meets the policy with the LEAST operational overhead?
OPT: a *
Create an AWS Backup plan with a daily rule, 35-day retention and a cross-Region copy action, assign resources by the Backup=daily tag, and enable AWS Backup Audit Manager controls and reports.
OPT: b
Create Amazon Data Lifecycle Manager policies with 35-day retention and cross-Region copy for all resources carrying the tag.
WHY:
Data Lifecycle Manager automates only EBS snapshots and EBS-backed AMIs; it cannot take or copy RDS, DynamoDB or EFS backups, so three of the four resource types stay unprotected.
OPT: c
Keep the existing scripts, add Lambda functions on EventBridge schedules for DynamoDB and EFS, copy each snapshot type to the second Region with the service API, and write a monthly script that lists backups for the auditors.
WHY:
Four separate mechanisms with hand-written copy and reporting logic must be maintained, monitored and re-audited by the team; it can work, but it is the maximum of operational overhead, and a missed script run stays invisible until the next audit.
OPT: d
Enable S3 Cross-Region Replication with a 35-day lifecycle expiration on a bucket and point every backup job at it.
WHY:
Cross-Region Replication copies S3 objects between buckets; it does not create EBS, RDS, DynamoDB or EFS backups, and the resources would still need some other mechanism to produce anything to replicate.
A:
One AWS Backup plan: a daily rule with 35-day retention, a copy action to a vault in the second Region, resource assignment by the Backup=daily tag so new resources join automatically, and Backup Audit Manager controls that generate daily compliance reports. AWS Backup covers EBS, EC2, RDS, Aurora, DynamoDB, EFS, FSx, S3 and more from one console; add Vault Lock if the copies must be immutable. Data Lifecycle Manager stops at EBS snapshots and AMIs, scripts must be maintained and audited by hand, and S3 replication moves objects, not resource backups. AWS Backup does not govern backups taken outside it.
USAGE:
Tag resources at creation time, enforced by CloudFormation defaults or a policy, so the backup plan picks them up without anyone editing the plan.

## aws-dr-rto-1h-rpo-minutes-mcq-37 | d2
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: MOST cost-effective
Q:
A company's order system runs on EC2 behind an ALB with an Amazon RDS for PostgreSQL database in one Region. The business requires that after a Regional outage the system is serving again within 1 hour and loses no more than a few minutes of orders, and it wants to spend as little as possible on standby capacity. Which disaster recovery design is the MOST cost-effective way to meet these objectives?
OPT: a *
Pilot light: create a cross-Region read replica of the database, copy the AMIs, keep launch templates and an Auto Scaling group with zero desired capacity in the DR Region, and on failover promote the replica and scale the group up.
OPT: b
Backup and restore: take RDS snapshots and AMIs every 12 hours, copy them to the DR Region with AWS Backup, and restore them when the primary Region fails.
WHY:
A backup taken every 12 hours gives a recovery point of up to 12 hours, far beyond a few minutes; backup and restore is the strategy for an RPO measured in hours and an RTO of up to a day.
OPT: c
Warm standby: run a scaled-down copy of the application tier at all times in the DR Region alongside the replicated database, and scale it up on failover.
WHY:
Warm standby keeps application servers running around the clock, which buys an RTO of minutes the business did not ask for; the always-on compute makes it dearer than a pilot light that already meets the 1-hour target.
OPT: d
Multi-site active/active: run the full stack in both Regions with Route 53 latency routing and bidirectional data replication.
WHY:
Active/active doubles the compute bill and requires the application to handle write conflicts across Regions; it is the most expensive and most complex strategy, justified only when the RTO must approach zero.
A:
Pilot light. The database, the only component that must stay current, replicates continuously to a cross-Region read replica, giving an RPO in minutes; the application tier exists only as AMIs, launch templates and an Auto Scaling group at zero capacity, so no compute is billed until failover. Recovery means promoting the replica, which takes a few minutes and includes a reboot for RDS, and scaling the group up, well inside an hour: Well-Architected guidance puts pilot light at an RPO in minutes and an RTO in tens of minutes. Backup and restore misses the RPO; warm standby and active/active pay for compute the objectives do not need.
USAGE:
Decide by the tightest objective first: an RPO in minutes forces the data tier to replicate live, and only the RTO then decides whether compute can stay switched off.

## aws-dr-rto-minutes-rpo-seconds-mcq-38 | d2
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: HIGHEST availability
Q:
A payment gateway runs on EC2 with an Aurora MySQL cluster in one Region. Management has set an RTO of a few minutes and an RPO of seconds for a Regional outage and has approved a modest standby budget, but not a second full production stack. Which disaster recovery design gives the HIGHEST availability within that budget?
OPT: a *
Warm standby: run a scaled-down but fully working copy of the application in a second Region on an Aurora global database secondary cluster, front both Regions with Route 53 failover records and health checks, and scale the DR Auto Scaling group up on failover.
OPT: b
Pilot light: keep only the Aurora global database secondary cluster in the DR Region with AMIs and a zero-capacity Auto Scaling group, and launch the application tier when the primary Region fails.
WHY:
Pilot light cannot serve requests until servers are launched, configured and scaled, which Well-Architected guidance places at an RTO in tens of minutes; a target of a few minutes needs compute that is already running.
OPT: c
Backup and restore: use AWS Backup to copy nightly Aurora snapshots and AMIs to the DR Region and restore them after an outage.
WHY:
Nightly snapshots give a recovery point of up to a day, and rebuilding the stack from backups takes hours; neither seconds of RPO nor minutes of RTO is reachable without continuous replication and running infrastructure.
OPT: d
Multi-site active/active: run full production capacity in both Regions with latency-based routing and write forwarding to the Aurora primary.
WHY:
Running two full stacks meets the objectives but costs roughly double, which the approved budget explicitly excludes; the question asks for the best availability within the budget, not the best possible.
A:
Warm standby: a scaled-down but fully functional copy runs continuously in the DR Region, so it can take traffic immediately at reduced capacity while Auto Scaling grows it, giving an RTO in minutes; the Aurora global database secondary replicates with typical lag under a second and can be promoted in less than a minute, giving an RPO in seconds; Route 53 failover routing with health checks moves traffic. Pilot light needs tens of minutes to bring compute up, backup and restore misses both objectives, and active/active overspends. The distinction to remember: pilot light cannot serve requests without action first; warm standby can.
USAGE:
Size the warm standby to absorb the first surge of failover traffic on its own; relying on Auto Scaling to grow from one instance turns a minutes RTO into a control-plane gamble.

## aws-route53-failover-to-static-page-mcq-27 | d2
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: HIGHEST availability
Q:
A retailer's web application runs behind an Application Load Balancer in one Region. When the application is down, customers see browser errors. The company wants www.example.com to automatically serve a static "we will be back shortly" page hosted in Amazon S3 whenever the application is unhealthy, and to return to the application as soon as it recovers. Which Route 53 configuration gives the site name the HIGHEST availability?
OPT: a *
Create two failover alias records for www.example.com: a primary pointing to the ALB with Evaluate Target Health enabled, and a secondary pointing to the S3 static website endpoint of a bucket named www.example.com.
OPT: b
Create two weighted records for www.example.com, giving the ALB a weight of 90 and the S3 website endpoint a weight of 10.
WHY:
Weighted routing splits traffic in the proportions given all the time, so one customer in ten sees the maintenance page while the application is perfectly healthy; weights describe share of traffic, not failure handling.
OPT: c
Create two latency records for www.example.com, one for the ALB's Region and one for the S3 bucket's Region.
WHY:
Latency routing answers with the record whose Region gives the lowest latency for the resolver; without health checks it has no notion of failure and keeps answering with the closest endpoint, which here is the failed application.
OPT: d
Create geolocation records that send customers on the ALB's continent to the ALB and everyone else to the S3 bucket.
WHY:
Geolocation routing decides by where the DNS query originates, so customers near the application get errors when it fails and distant customers get the maintenance page even when it is healthy; location is not health.
A:
Failover routing: Route 53 answers with the primary alias (the ALB) while it is healthy and with the secondary alias (the S3 website endpoint) when the primary is unhealthy, then returns to the ALB when it recovers. For an ALB alias, set Evaluate Target Health to yes instead of creating a separate health check. The bucket must be named exactly www.example.com and configured for static website hosting, and website endpoints do not support TLS, so put CloudFront in front if the sorry page must be served over HTTPS. Weighted, latency and geolocation policies distribute traffic; only failover expresses "primary unless broken".
USAGE:
You cannot set a TTL on an alias record; Route 53 uses the target's own TTL (60 seconds for a load balancer), so rehearse the switch by draining the ALB's targets and timing how long browsers take to land on the sorry page.

## aws-s3-survive-delete-and-region-loss-mcq-35 | d3
TOPIC: 2.2 HA and fault tolerance
Q:
A media company stores master video files in one S3 bucket in a single Region. Last year an operator deleted a folder by mistake, and a risk review also flagged that a Regional outage would make the files unavailable. The company wants deleted files to be recoverable and a copy of every file to exist in a second Region, without a deletion in the primary bucket removing the copy. Which combination of actions meets these requirements? (Choose two.)
OPT: a *
Enable S3 Versioning on the bucket so that a delete request stores a delete marker instead of removing the object.
OPT: b
Change the storage class of the objects to S3 One Zone-IA to reduce the cost of keeping extra copies.
WHY:
One Zone-IA stores data in a single Availability Zone and can lose it if that zone is destroyed, and it changes nothing about deletes or Regions; it lowers resilience, the opposite of the goal.
OPT: c *
Configure Cross-Region Replication to a versioned bucket in a second Region, leaving delete marker replication disabled.
OPT: d
Add a lifecycle rule that transitions objects to S3 Glacier Deep Archive after 30 days.
WHY:
A lifecycle transition changes the storage class and price of an object; the object stays in the same bucket and Region, is still removed by a delete, and still disappears with the Region.
OPT: e
Enable S3 Intelligent-Tiering on the bucket.
WHY:
Intelligent-Tiering moves objects between access tiers by access pattern to cut storage cost; it does not keep a second copy anywhere, and a deleted object is gone from every tier.
A:
Enable Versioning and configure Cross-Region Replication. Versioning turns a delete into a delete marker, so the previous version can be restored, and it is a prerequisite: replication requires versioning on both source and destination buckets. CRR copies new objects asynchronously to a bucket in another Region; by default delete markers are not replicated, so a delete in the primary bucket leaves the replica intact, and deleting a specific version ID is never replicated. Run S3 Batch Replication to copy the objects that existed before the rule. One Zone-IA, lifecycle transitions and Intelligent-Tiering change cost tiers, not where or how many copies exist.
USAGE:
Pair Versioning with a lifecycle rule that expires noncurrent versions after your recovery window, or every overwrite and delete keeps billing for a full object forever.

## aws-single-az-asg-make-regional-ha-mcq-26 | d1
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: MOST cost-effective
Q:
A stateless web tier runs in an EC2 Auto Scaling group whose network configuration lists a single private subnet in Availability Zone a, behind an Application Load Balancer. During a recent zone event every instance was lost and the site went down. An engineer proposes deploying a copy in a second Region with Route 53 failover. What is the MOST cost-effective change that keeps the site running through the loss of one Availability Zone?
OPT: a *
Add private subnets in two more Availability Zones to the Auto Scaling group's network settings and enable the same zones on the load balancer.
OPT: b
Deploy a duplicate of the stack in a second Region and add Route 53 failover records with health checks.
WHY:
A second Region doubles the fleet and adds cross-Region data and DNS failover work to survive an event that Availability Zones inside one Region already isolate; it is the answer to a Regional outage, not to the loss of one zone.
OPT: c
Replace the instances with a larger instance type and raise the group's minimum size so more capacity survives.
WHY:
However many or large the instances are, they all sit in the same subnet in the same zone, so an Availability Zone failure still takes every one of them; capacity is not the problem, placement is.
OPT: d
Attach a Route 53 health check to the load balancer's record so DNS stops sending traffic when the zone fails.
WHY:
A health check only reports that the single target set is unhealthy; with no healthy alternative record there is nothing to fail over to, so users still get no site, just faster.
A:
Add subnets in additional Availability Zones to the Auto Scaling group and enable those zones on the load balancer. Auto Scaling then redistributes instances across the zones and, when a zone becomes unavailable, launches replacements in the healthy ones; the load balancer runs a node in every enabled zone and routes only to targets in zones it has enabled. This costs nothing beyond the instances already required, and an Application Load Balancer already needs at least two zones enabled. A second Region, larger instances or a lone health check either overspend or leave every instance in the same failure domain.
USAGE:
Check the Auto Scaling group's subnet list, not just the load balancer's: an ALB spanning two zones in front of a single-subnet group is still a single-zone deployment.

## aws-single-nat-gateway-spof-mcq-31 | d2
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: MOST resilient
Q:
A VPC has private subnets in Availability Zones a and b. Application servers in both zones reach third-party HTTPS APIs through one NAT gateway in a public subnet in zone a, and both private route tables send 0.0.0.0/0 to it. During a zone a disruption the servers in zone b stayed up but every outbound call from them failed. Which change makes outbound internet access the MOST resilient?
OPT: a *
Create a second NAT gateway in a public subnet in zone b and give zone b's private subnets their own route table whose 0.0.0.0/0 route points at the local NAT gateway.
OPT: b
Replace the NAT gateway with a pair of NAT instances and a script that moves the route to the surviving instance.
WHY:
NAT instances are EC2 instances you patch, size and monitor, and the failover script is a control-plane step you own; a managed NAT gateway is already redundant inside its zone, so this trades a zone dependency for an older, hand-run single point of failure.
OPT: c
Create a second NAT gateway in another public subnet in zone a and add it to the same route tables.
WHY:
Both gateways then live in the zone whose disruption caused the outage, so they fail together; a route table also holds one 0.0.0.0/0 route, so the second gateway would not even receive traffic while the first is up.
OPT: d
Replace the NAT gateway with gateway and interface VPC endpoints for the services the servers call.
WHY:
VPC endpoints connect a VPC privately to AWS services and PrivateLink-hosted services, not to the public internet; the third-party HTTPS APIs are unreachable through an endpoint, so outbound access would stop entirely rather than become resilient.
A:
One NAT gateway per Availability Zone, each with its own private route table sending 0.0.0.0/0 to the gateway in the same zone. A NAT gateway is redundant within its zone but exists in exactly one zone, and the VPC guide is explicit: when zones share one NAT gateway and its zone goes down, resources in the other zones lose internet access. Zone-local routing also keeps outbound traffic inside its own zone. NAT instances revert to self-managed failover, a second gateway in the same zone shares its fate, and VPC endpoints reach AWS services only.
USAGE:
Name route tables after their zone (private-rt-a, private-rt-b) so nobody later "simplifies" them back into one table with one NAT route.

## aws-single-rds-instance-az-failure-mcq-32 | d1
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: LEAST amount of change
Q:
An internal HR application connects to a single Amazon RDS for MySQL DB instance by its endpoint name, which is hard-coded in dozens of deployed clients. After an Availability Zone event left the database unavailable for several hours, the company wants the database to survive the loss of its zone automatically. Which solution meets the requirement with the LEAST amount of change to the application?
OPT: a *
Modify the DB instance to a Multi-AZ deployment so RDS maintains a synchronous standby in another Availability Zone.
OPT: b
Create a read replica of the DB instance in another Availability Zone and promote it if the primary's zone fails.
WHY:
A read replica is asynchronous and must be promoted by hand, and traffic must then be redirected to the promoted instance, so every hard-coded client needs updating during the outage; it scales reads and offers manual disaster recovery, not automatic failover.
OPT: c
Increase the automated backup retention and take manual snapshots every hour so the database can be restored quickly in another zone.
WHY:
Restoring a snapshot or a point-in-time copy creates a new instance with a new endpoint after an outage that is already under way, and every write after the last restorable time is lost; backups shorten recovery, they do not prevent the outage.
OPT: d
Create a cross-Region read replica and point the clients at it during a zone failure.
WHY:
A cross-Region replica changes the architecture and the endpoint, adds replication lag and cross-Region charges, and still needs manual promotion; it answers a Regional disaster, not an Availability Zone failure inside the Region.
A:
Convert the instance to Multi-AZ with a modify operation. RDS provisions a synchronous standby replica in a different Availability Zone and, if the primary host, its storage or its zone fails, changes the instance's DNS record to point at the standby, typically within 60 to 120 seconds; the endpoint name never changes, so clients only reconnect. The standby serves no reads. A read replica, a snapshot restore or a cross-Region replica each produce a new endpoint and need manual promotion, which is exactly the change the hard-coded clients cannot absorb.
USAGE:
Set client DNS caching, for example the JVM networkaddress.cache.ttl, to 60 seconds or less, otherwise the application keeps resolving the old primary long after the failover completes.

## aws-two-region-active-writes-mcq-25 | d2
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: MOST resilient
Q:
A collaboration app has users in Frankfurt and Sydney who each write session state to a key-value store hundreds of times per minute. The product team requires that each user's writes are served from the nearest Region with low latency and that both user groups keep reading and writing if either Region becomes unavailable. Which design is the MOST resilient way to meet these requirements?
OPT: a *
Store the session state in a DynamoDB global table with replicas in eu-central-1 and ap-southeast-2, and route users with Route 53 latency records that carry health checks on each Regional endpoint.
OPT: b
Use an Aurora global database with the primary cluster in Frankfurt and a secondary cluster in Sydney, with write forwarding enabled on the secondary.
WHY:
An Aurora global database has exactly one primary Region that performs writes; write forwarding sends Sydney's writes to Frankfurt, so Sydney users pay the round trip on every write and cannot write at all while Frankfurt is down until a secondary is promoted.
OPT: c
Run an RDS for MySQL instance in Frankfurt with a cross-Region read replica in Sydney, and promote the replica if Frankfurt fails.
WHY:
The replica is read-only until promoted, so Sydney users can never write locally, and promotion is a manual step that yields a new endpoint; this is a disaster recovery pattern, not a multi-active one.
OPT: d
Store session state as objects in an S3 bucket in each Region with two-way Cross-Region Replication between the buckets.
WHY:
S3 replication copies whole objects asynchronously with no cross-Region conflict handling: concurrent updates to the same key in both Regions simply overwrite each other as the replicas arrive, and a bucket is object storage, not a transactional key-value table with item-level writes.
A:
A DynamoDB global table: it is multi-active, so every replica accepts reads and writes locally, replication between Regions is asynchronous, and if one Region is impaired the fix is to route traffic to the other replica, which Route 53 latency records with health checks do automatically. The cost is last-writer-wins reconciliation for concurrent updates to the same item, so design keys so a user's writes land in one Region at a time. Aurora global databases and RDS cross-Region replicas have a single writer Region; S3 replication moves objects, not a transactional table.
USAGE:
Give each user a home Region in the session record and switch it only during a failover; that keeps last-writer-wins from silently dropping edits in normal operation.

## aws-shared-posix-across-azs-mcq-18 | d1
TOPIC: 3.1 High-performing storage
QUALIFIER: MOST highly available
Q:
A video rendering farm runs Linux instances in an Auto Scaling group across three Availability Zones. Every node must read and write the same directory tree with standard POSIX permissions and file locks, the working set swings between gigabytes and tens of terabytes, and rendering must continue if one Availability Zone fails. Which shared storage design is the MOST highly available?
OPT: a *
Create an Amazon EFS Regional file system with Elastic throughput and one mount target per Availability Zone, and mount it by its DNS name on every instance.
OPT: b
Create an io2 EBS volume with Multi-Attach enabled and attach it to every instance in the fleet.
WHY:
Multi-Attach works only for io1 and io2 volumes on up to 16 Nitro instances in the same Availability Zone, and even then XFS or ext4 is unsafe without a cluster-aware file system, so it fails both the three-zone requirement and the plain POSIX requirement.
OPT: c
Store the frames in an S3 bucket and have each node read and write objects with the AWS CLI.
WHY:
S3 is object storage: it has no POSIX permissions, file locks or in-place partial writes, so a renderer that expects a mounted directory would have to be rewritten, and object storage is not a shared file system however durable it is.
OPT: d
Deploy Amazon FSx for Windows File Server in Multi-AZ mode and mount it on every instance.
WHY:
FSx for Windows serves SMB shares with Windows ACLs; Linux nodes can reach SMB, but the POSIX permission and locking semantics the renderer expects are not what an SMB share provides, so it is the wrong file system family for a Linux fleet.
A:
Use an EFS Regional file system: it stores data across multiple Availability Zones, exposes NFSv4 with POSIX semantics, grows and shrinks on its own, and Elastic throughput scales with the spiky load. A mount target in each Availability Zone matters because the file system's DNS name resolves to the mount target in the client's own zone, so losing one zone leaves the other zones mounted. EBS Multi-Attach is single-zone block storage, S3 is not a file system, and FSx for Windows is SMB. EFS One Zone would be cheaper but lives in one Availability Zone, so it fails the availability requirement.
USAGE:
Create a mount target in every Availability Zone the Auto Scaling group can launch into, or a scale-out instance in a zone without one has nothing to mount.

## aws-tcp-static-ip-load-balancer-mcq-19 | d1
TOPIC: 3.4 Scalable network
QUALIFIER: MOST performant
Q:
Industrial gateways at thousands of factories stream telemetry to AWS over a proprietary binary protocol on TCP port 9000. Each gateway keeps a long-lived connection open, the fleet will reach millions of concurrent connections, and factory firewalls allow outbound traffic only to a short list of fixed IP addresses that the company must publish in advance. Which entry point is the MOST performant way to distribute this traffic across the ingest instances?
OPT: a *
Create an internet-facing Network Load Balancer with a TCP listener on port 9000, associate one Elastic IP address with each of its subnets, and publish those addresses.
OPT: b
Create an Application Load Balancer with a listener on port 9000 and publish the IP addresses that its DNS name currently resolves to.
WHY:
An ALB works at layer 7 and its listeners accept only HTTP and HTTPS, so it cannot terminate a proprietary TCP protocol, and it has no static IP: its node addresses change as it scales, so the published allow-list breaks the first time it does.
OPT: c
Put an Amazon CloudFront distribution in front of the ingest instances and publish the CloudFront IP ranges.
WHY:
CloudFront is an HTTP and HTTPS content delivery network for web content; it does not proxy arbitrary TCP connections, and its edge IP ranges are large shared lists rather than a few fixed addresses a factory firewall can pin.
OPT: d
Create an Application Load Balancer and place AWS Global Accelerator in front of it to obtain two static anycast IP addresses.
WHY:
Global Accelerator does provide two static anycast addresses, but the endpoint behind it is still an ALB whose listeners speak only HTTP and HTTPS, so the binary TCP protocol has nowhere to land.
A:
A Network Load Balancer is the fit: it operates at layer 4, forwards TCP and UDP flows without inspecting the application payload (TLS termination is optional), handles millions of requests per second and volatile bursts, and gives one static IP per enabled subnet that you can replace with an Elastic IP of your choosing, which is exactly what a firewall allow-list needs. ALB and CloudFront speak only HTTP and HTTPS and have changing addresses; Global Accelerator adds static anycast IPs but cannot make an ALB carry a non-HTTP protocol. If global clients also need the shortest path onto the AWS backbone, put Global Accelerator in front of the NLB, not the ALB.
USAGE:
Give clients the Elastic IPs only when they truly cannot resolve names; an NLB keeps the same addresses for its lifetime, an ALB never promises that.

## aws-d4-s3-lifecycle-management-mcq-05 | d2
TOPIC: 4.1 Cost-optimized storage
QUALIFIER: MOST cost-effective
Q:
An application writes about 2 TB of log objects a day to S3. Engineers query the logs heavily for 30 days; for roughly three months after that, on-call engineers still open a few of them each week and expect millisecond access; beyond that the logs are read only during audits that come with 48 hours' notice, and regulators require them to be kept for 7 years and then deleted. Which lifecycle configuration is the MOST cost-effective?
OPT: a *
One rule: transition to S3 Standard-IA at day 30, transition to S3 Glacier Deep Archive at day 120, expire at 7 years.
OPT: b
One rule: transition to S3 Standard-IA at day 30, transition to S3 Glacier Deep Archive at day 45, expire at 7 years.
WHY:
A single lifecycle rule cannot schedule the next transition before the current class's minimum storage duration has elapsed; Standard-IA carries a 30-day minimum, so the Deep Archive step must be day 60 or later and S3 rejects this configuration outright.
OPT: c
One rule: transition to S3 Standard-IA at day 30, transition to S3 Glacier Flexible Retrieval at day 120, expire at 7 years.
WHY:
Glacier Flexible Retrieval is valid but stores at $0.0036 per GB-month against $0.00099 for Deep Archive; its 3 to 5 hour standard restore buys nothing when audits give 48 hours, so it is roughly 3.6 times the archive cost for almost 7 years.
OPT: d
Store every object in S3 Intelligent-Tiering with the Archive Access and Deep Archive Access tiers enabled, and expire at 7 years.
WHY:
Intelligent-Tiering charges a monitoring and automation fee of $0.0025 per 1,000 objects every month and waits 90 and 180 consecutive days without access before archiving; the access pattern here is known in advance, so explicit transitions reach the cheap tier sooner and without the per-object fee.
A:
Move the logs to Standard-IA at day 30, where the occasional on-call read still gets millisecond access, to Glacier Deep Archive at day 120 once nobody needs them online, and expire them at 7 years. Deep Archive is the cheapest class at $0.00099 per GB-month and its standard restore completes within 12 hours, inside the 48-hour audit notice. The chained-minimum rule is the trap: Standard-IA has a 30-day minimum and a single rule cannot transition out before it, so a day-45 Deep Archive step is rejected while day 60 or later is accepted. Glacier Flexible Retrieval pays for a restore speed nobody needs, and Intelligent-Tiering adds a per-object fee to rediscover a pattern you already know.
USAGE:
Remember the default size floor: objects under 128 KB are not transitioned unless you add an object-size filter, so tiny log files stay in the earlier class if you never look.

## aws-d4-storage-service-cheapest-mcq-01 | d2
TOPIC: 4.1 Cost-optimized storage
QUALIFIER: MOST cost-effective
Q:
A photo-sharing startup stores about 300 TB of user images and short videos. Files are uploaded once as whole objects, never edited in place, and served to browsers and mobile apps over HTTPS; roughly 80 percent of reads hit files uploaded in the last 60 days. Which storage service is the MOST cost-effective home for this library?
OPT: a *
Amazon S3 in the S3 Standard class, with a lifecycle rule that moves objects to S3 Standard-IA after 60 days and CloudFront in front for delivery.
OPT: b
An Amazon EFS Regional file system mounted by the web servers, which serve the files from the mount.
WHY:
EFS works functionally, but EFS Standard storage lists at $0.30 per GB-month in US East against $0.023 for S3 Standard, about 13 times more, and it also bills throughput; paying for a POSIX file system the application never exercises is the cost error.
OPT: c
A large gp3 EBS volume attached to the web server, with snapshots for durability.
WHY:
An EBS volume attaches to instances in one Availability Zone, is billed for its provisioned size at $0.08 per GB-month whether used or not, and cannot be shared by a fleet, so it is the wrong service for a multi-server web library; snapshots are not a serving path.
OPT: d
Amazon S3 in the S3 Glacier Instant Retrieval class from the first day, since it is the cheapest class with millisecond access.
WHY:
Glacier Instant Retrieval stores at $0.004 per GB-month but charges $0.03 per GB retrieved and has a 90-day minimum; a library whose recent files are read constantly would pay the retrieval fee on every view, which wipes out the storage saving.
A:
S3 Standard is the cheapest durable store for write-once, read-over-HTTP files: unlimited objects, 11 nines durability, $0.023 per GB-month, plus request and egress charges that CloudFront reduces. Add a lifecycle rule to Standard-IA for older media so the cold majority costs $0.0125 per GB-month. EFS and EBS charge for file or block semantics this workload never uses, EBS is single-instance and provisioned, and Glacier Instant Retrieval's per-GB retrieval fee punishes frequently viewed objects. Pick S3 whenever the application only PUTs and GETs whole files.
USAGE:
If the web tier ever needs to open, append or lock a file rather than fetch it whole, that is the signal to revisit EFS; until then it would pay 13 times the S3 rate for nothing.

## aws-d4-storage-tier-selection-mcq-03 | d2
TOPIC: 4.1 Cost-optimized storage
QUALIFIER: MOST cost-effective
Q:
A finance team stores monthly close reports as 5 MB PDF objects in S3. Each report is opened at most once a month by analysts who expect it to load instantly, the reports cannot be regenerated if lost, and they are kept for 3 years. Which storage class is the MOST cost-effective for these objects?
OPT: a *
S3 Standard-IA
OPT: b
S3 Standard
WHY:
S3 Standard has no retrieval fee but charges $0.023 per GB-month in US East; at one full read a month Standard-IA's $0.0125 storage plus $0.01 per GB retrieval still comes in below it, and in the months a report is never opened the gap widens.
OPT: c
S3 Glacier Instant Retrieval
WHY:
Glacier Instant Retrieval stores at $0.004 per GB-month but charges $0.03 per GB retrieved and is designed for data accessed about once a quarter with a 90-day minimum; one read a month makes it $0.034 per GB, more than Standard-IA's $0.0225.
OPT: d
S3 One Zone-IA
WHY:
One Zone-IA is 20 percent cheaper than Standard-IA but keeps the data in a single Availability Zone and is not resilient to that zone's physical loss; AWS recommends it only for data you can re-create, and these reports cannot be regenerated.
A:
Choose S3 Standard-IA: millisecond access, storage across at least three Availability Zones, $0.0125 per GB-month plus $0.01 per GB retrieved, with a 30-day minimum and a 128 KB minimum billable size that 5 MB monthly reports clear easily. S3 Standard costs more for data read this rarely, One Zone-IA trades away the resilience irreplaceable reports need, and the trap is Glacier Instant Retrieval: its low storage price hides a $0.03 per GB retrieval fee sized for quarterly access, so monthly reads make it the most expensive of the three. Match the class to the access frequency AWS's own comparison table names.
USAGE:
Run the arithmetic with the retrieval fee included: the moment a Standard-IA object is read more than about once a month, S3 Standard is cheaper again.

## aws-d4-compute-mixed-workload-choose-two-mcq-14 | d3
TOPIC: 4.2 Cost-optimized compute
QUALIFIER: MOST cost-effective
Q:
A company runs a web tier of m6i instances behind a load balancer whose load is flat around the clock all year, and it plans to move that tier to Graviton instances within the year. A separate nightly batch job processes files for about three hours, checkpoints its progress every minute, and can be restarted or delayed without business impact. Which combination of purchasing options is the MOST cost-effective for these two workloads? (Choose two.)
OPT: a *
Buy a Compute Savings Plan sized to the web tier's steady hourly spend.
OPT: b *
Run the nightly batch job on Spot Instances launched by an Auto Scaling group that allows several instance types.
OPT: c
Run the web tier on Spot Instances to get the largest discount.
WHY:
Spot capacity can be reclaimed with a two-minute interruption notice whenever EC2 needs it back; a customer-facing tier that must stay up all day cannot tolerate that, so the discount is not available to it.
OPT: d
Run the nightly batch job On-Demand so it is never interrupted.
WHY:
On-Demand carries no discount at all; a job that checkpoints every minute and can be delayed is the textbook Spot workload, so paying full price for interruption protection it does not need is the cost error.
OPT: e
Place the web tier on Dedicated Hosts for the lowest per-instance price.
WHY:
Dedicated Hosts exist to bring existing per-socket, per-core or per-VM software licences and to meet compliance rules; you pay for the whole physical host, so with no licensing requirement they cost more, not less.
OPT: f
Buy a 3-year EC2 Instance Savings Plan for the m6i family to cover both the web tier and the batch job.
WHY:
An EC2 Instance Savings Plan locks the discount to one instance family in one Region, so the planned move to Graviton would strand it, and Spot usage is not covered by any Savings Plan, so it would buy nothing for the batch job.
A:
Cover the steady web tier with a Compute Savings Plan and run the interruptible batch on Spot. A Compute Savings Plan discounts up to 66 percent and follows the workload across instance family, size, OS, tenancy and Region, so the Graviton migration keeps the discount; an EC2 Instance Savings Plan pays more, up to 72 percent, but is tied to one family in one Region. Spot offers up to 90 percent off for work that survives a two-minute reclaim, which a checkpointing batch does and a web tier does not. On-Demand for the batch wastes the discount and Dedicated Hosts are a licensing tool, not a cost lever.
USAGE:
Size the Savings Plan commitment to the trough of the steady tier, not its peak: uncovered hours bill On-Demand, but an over-committed hour is paid whether or not anything runs.

## aws-d4-compute-service-choice-mcq-13 | d2
TOPIC: 4.2 Cost-optimized compute
QUALIFIER: MOST cost-effective
Q:
A photo-sharing startup resizes each uploaded image with a short script: about 2,000 uploads a day, each resize takes roughly 3 seconds and 1 GB of memory, and uploads arrive unevenly through the day. Which compute option is the MOST cost-effective way to run this workload?
OPT: a *
Run the resize script as an AWS Lambda function triggered by the S3 upload event.
OPT: b
Run the script on a t3.small On-Demand EC2 instance that polls the bucket for new uploads.
WHY:
The instance is billed for all 24 hours, yet 2,000 three-second jobs add up to about 100 minutes of work a day; more than 90 percent of what you pay for is idle time, and you patch the host as well.
OPT: c
Deploy the script as an Amazon ECS service on AWS Fargate with one task running continuously.
WHY:
A Fargate service keeps its task running whether or not uploads arrive, so you pay per second for a container that is idle almost all day; Fargate charges for the task's lifetime, not for work done.
OPT: d
Launch a Spot Instance to process the uploads at a discount to the On-Demand price.
WHY:
Spot is cheaper per hour but the instance still idles around the clock, and the two-minute interruption notice means the pipeline needs retry and relaunch logic that Lambda provides for nothing.
A:
Use Lambda: you pay per request and per millisecond of duration, and nothing while no image is being resized. Two thousand runs a day at 3 seconds and 1 GB is about 180,000 GB-seconds and 60,000 requests a month, inside the free tier of 400,000 GB-seconds and 1 million requests, and beyond it priced at $0.0000166667 per GB-second plus $0.20 per million requests. An always-on instance or Fargate service is billed for the idle 90-plus percent of the day, and Spot only discounts that idle time. Lambda stops being the cheap answer when the work is steady and continuous or a single run exceeds 15 minutes; then a right-sized instance or Fargate task wins.
USAGE:
Put sporadic, sub-15-minute event work on Lambda and move it to an instance or a Fargate service only once its invocations add up to hours of steady CPU every day.

## aws-d4-dynamodb-vs-rds-cost-mcq-24 | d2
TOPIC: 4.3 Cost-optimized database
QUALIFIER: MOST cost-effective
Q:
An internal feature-flag service looks up small configuration items by key. It receives a few hundred requests during a two-hour deployment window each weekday and almost none the rest of the time, but the data must be durable and available at any moment without a warm-up delay. Which database choice is the MOST cost-effective?
OPT: a *
An Amazon DynamoDB table in on-demand capacity mode.
OPT: b
An Amazon RDS for PostgreSQL db.t3.micro instance, one of the smallest classes available.
WHY:
An RDS instance bills DB instance hours the whole time it is running, and the only way to stop that meter is to stop the instance, which RDS restarts on its own after 7 consecutive days; a small class shrinks the idle bill but never removes it.
OPT: c
An Amazon Aurora Serverless v2 cluster with a minimum capacity of 0.5 ACU.
WHY:
With a nonzero minimum the cluster keeps consuming about 0.5 ACU per instance every hour it is idle, so the meter runs 24 hours a day; only a minimum of 0 ACU pauses billing, and that adds a resume delay of roughly 15 seconds on the first connection, which the no-warm-up requirement rules out.
OPT: d
An Amazon DynamoDB table in provisioned capacity mode with 5 read and 5 write capacity units.
WHY:
Provisioned capacity is billed for the units you reserve whether or not any request arrives, so the 22 quiet hours a day are paid for; on-demand bills per request instead and charges nothing for throughput while traffic is zero.
A:
DynamoDB on-demand is the only option whose compute bill is zero while the service is idle: you pay per read and write request unit actually consumed plus storage, and the table still answers with single-digit millisecond latency the instant a request arrives, with no capacity planning. An RDS instance and an Aurora Serverless v2 instance at 0.5 ACU both bill every hour they exist, Aurora's auto-pause at 0 ACU stops the meter but makes the first connection wait about 15 seconds, and provisioned DynamoDB reserves capacity nobody uses. Use on-demand for spiky or near-zero traffic; switch to provisioned only when a steady high load makes reserved units cheaper.
USAGE:
An ElastiCache node would answer even faster, but it is an in-memory cache billed per node-hour, not a durable primary store; it belongs in front of a database, not instead of one.

## aws-d4-nat-single-vs-per-az-mcq-28 | d2
TOPIC: 4.4 Cost-optimized network
QUALIFIER: MOST cost-effective
Q:
A production application runs in private subnets across three Availability Zones. All outbound traffic, about 20 TB a month, leaves through one NAT gateway in the first zone; two thirds of it is writes to S3 and DynamoDB in the same Region, the rest goes to third-party SaaS APIs. Finance wants the NAT bill cut and operations wants the single point of failure removed. Which change is the MOST cost-effective way to meet both goals?
OPT: a *
Add gateway VPC endpoints for S3 and DynamoDB to every private route table, deploy one NAT gateway per Availability Zone, and give each zone's subnets a route table that points 0.0.0.0/0 at its own NAT gateway.
OPT: b
Keep the single NAT gateway and add gateway endpoints for S3 and DynamoDB.
WHY:
The endpoints remove the S3 and DynamoDB share of the $0.045 per GB processing fee, but the remaining SaaS traffic from the other two zones still crosses zones at $0.01 per GB each way, and an outage of the first zone still cuts all three zones off from the internet.
OPT: c
Replace the NAT gateway with three NAT instances, one per Availability Zone, and add gateway endpoints for S3 and DynamoDB.
WHY:
NAT instances avoid the managed per-GB fee, but you patch, size, monitor and fail over each one yourself and bandwidth is capped by the instance type; at 20 TB a month the operational cost and outage risk outweigh the saving.
OPT: d
Deploy an interface VPC endpoint for S3 and one for DynamoDB in each Availability Zone and leave the single NAT gateway in place.
WHY:
Interface endpoints bill $0.01 per hour per endpoint per Availability Zone plus $0.01 per GB processed, whereas gateway endpoints for S3 and DynamoDB have no hourly or data charge at all, and this option leaves the NAT single point of failure untouched.
A:
Route S3 and DynamoDB traffic through free gateway endpoints so two thirds of the volume never touches a NAT gateway: at $0.045 per GB processed that saves roughly $600 a month. Then give every Availability Zone its own NAT gateway with a zone-local route table. A NAT gateway lives in one zone: sharing one means other zones pay $0.01 per GB each way to reach it and lose internet access if that zone fails, exactly what AWS guidance warns about. Two extra gateways cost about $66 a month, close to the cross-zone charge they remove, and buy the zone isolation. Interface endpoints and NAT instances cost more or shift work onto the team without fixing the failure domain.
USAGE:
Check the route tables, not just the gateway count: a NAT gateway in every zone still funnels everything through one of them if all subnets keep sharing the original route table.

## aws-d4-transfer-cost-routes-mcq-30 | d2
TOPIC: 4.4 Cost-optimized network
QUALIFIER: MOST cost-effective
Q:
EC2 instances in private subnets download about 50 TB a month from an S3 bucket in the same Region through a NAT gateway. The same instances call a partner team's API that runs in another VPC in the same Region and Availability Zone; the two VPCs are already peered, but the client is configured with the API's public Elastic IP, so those calls also leave through the NAT gateway. Which change is the MOST cost-effective way to cut the data transfer bill?
OPT: a *
Add a gateway VPC endpoint for S3 to the private route tables, and reconfigure the client to call the partner API by its private IP address across the VPC peering connection.
OPT: b
Create an interface VPC endpoint for S3 in each Availability Zone and keep calling the partner API by its public Elastic IP.
WHY:
An interface endpoint still bills $0.01 per GB processed plus $0.01 per hour per zone, so 50 TB costs about $500 a month where a gateway endpoint costs nothing, and the public-IP calls keep paying NAT processing plus the $0.01 per GB public IPv4 transfer charge.
OPT: c
Deploy a NAT gateway in every Availability Zone so the traffic no longer crosses zones.
WHY:
Per-zone NAT gateways remove cross-zone charges and the single point of failure, but every gigabyte of S3 and partner traffic is still processed by a NAT gateway at $0.045 per GB, which is the charge the bill is made of.
OPT: d
Attach both VPCs to an AWS Transit Gateway and route the S3 and partner traffic through it.
WHY:
A transit gateway adds $0.05 per hour per VPC attachment and $0.02 per GB processed, and it creates no direct path to S3; a gateway endpoint and the existing peering connection already give both paths without a per-GB meter.
A:
Two routes fix two charges. A gateway endpoint for S3 inserts a prefix-list route that beats the 0.0.0.0/0 route to the NAT gateway, so the 50 TB stops paying $0.045 per GB processing and rides a path with no hourly or data charge. Calling the partner API by private IP over the existing peering connection keeps the traffic inside the AWS network: transfer between resources in the same Availability Zone is free, whereas traffic to a public or Elastic IPv4 address is billed $0.01 per GB in each direction on top of the NAT fee. Interface endpoints, extra NAT gateways and a transit gateway all keep a per-GB meter running.
USAGE:
Search application configs for public IPs and names that resolve to public addresses; every one of them inside the same Region is a cross-VPC transfer you are paying for twice.

## aws-control-tower-new-landing-zone-mcq-11 | d1
TOPIC: 1.1 Secure access
QUALIFIER: LEAST operational overhead
Q:
A company new to AWS expects to grow to about 20 accounts within a year. Security wants preventive and detective guardrails on every account from day one, CloudTrail and Config logs centralized in a dedicated account, and a way for team leads to request a new pre-configured account without opening a ticket with the platform team. Which approach meets these requirements with the LEAST operational overhead?
OPT: a *
Set up AWS Control Tower: launch a landing zone with the log archive and audit accounts, enable the mandatory and strongly recommended controls, and let team leads provision accounts through Account Factory.
OPT: b
Create an AWS Organizations organization, write the SCPs and Config rules by hand, and deploy the logging and security baseline to each new account with CloudFormation StackSets.
WHY:
This builds the same landing zone the hard way: every guardrail, the log archive bucket, the audit account and the account-vending workflow must be authored, tested and kept in sync by the platform team, which is exactly the ongoing effort the question is trying to avoid.
OPT: c
Use AWS Service Catalog on its own to publish an account template that team leads can launch on demand.
WHY:
Service Catalog provisions approved products; by itself it does not create the organization structure, the centralized log and audit accounts, or the preventive and detective guardrails that must apply to every account.
OPT: d
Enable an AWS Config aggregator and AWS Security Hub in a security account to watch all 20 accounts for violations.
WHY:
A Config aggregator and Security Hub are detective: they report findings after the fact. They cannot prevent an action the way a guardrail does, and they have no way to vend a new pre-configured account.
A:
Use AWS Control Tower. Its landing zone sets up (or enrolls) the shared log archive and audit accounts for CloudTrail and Config, applies preventive, detective and proactive controls across the organization, and Account Factory lets teams provision accounts that arrive already enrolled and governed. Control Tower orchestrates Organizations, Service Catalog and IAM Identity Center for you; a plain Organizations build reaches the same outcome only after the platform team hand-writes and maintains every piece. Control Tower is not the answer for a single account, or when you only need detection rather than governance.
USAGE:
Reach for Control Tower whenever "many accounts plus guardrails plus self-service account creation" appear together; reach for Organizations alone only when you truly need a custom structure.

## aws-identity-account-hub-roles-mcq-09 | d2
TOPIC: 1.1 Secure access
QUALIFIER: LEAST operational overhead
Q:
A company keeps all human IAM identities in a central identity account. Engineers must switch into the dev and prod accounts to do their work, and the security team wants no long-term credentials anywhere except in the identity account. Which configuration provides that access with the LEAST operational overhead?
OPT: a *
In each target account create an IAM role whose trust policy names the identity account (or specific principals in it), and attach an identity-based policy in the identity account that allows sts:AssumeRole on those role ARNs.
OPT: b
Create matching IAM users in the dev and prod accounts and give each engineer a second set of access keys per account.
WHY:
Duplicating users puts long-term credentials in every account and doubles the identities to rotate and offboard, which breaks the single-identity requirement instead of implementing it.
OPT: c
Attach a service control policy to the dev and prod accounts that grants the identity account's engineers access to the resources they need.
WHY:
SCPs never grant permissions; they only set the maximum permissions available to principals in member accounts. No SCP can create a path from the identity account into another account.
OPT: d
Enable IAM Identity Center in the management account and create the engineers as users in its identity store, without creating permission sets or account assignments.
WHY:
Identity Center is a valid workforce path, but until permission sets are assigned to users or groups for each account nobody can sign in anywhere, and it replaces the identity account model instead of connecting the existing IAM users to dev and prod; the configuration is incomplete rather than a fix.
A:
Cross-account access is two halves: a role in each target account whose trust policy trusts the identity account, and a permissions policy in the identity account that allows sts:AssumeRole on those roles. For the session the engineer's own permissions are replaced by the role's, and no long-term credentials exist outside the identity account. SCPs and resource policies cannot substitute for either half. A trust policy cannot use a wildcard inside a principal ARN, so name the account or the specific principals.
USAGE:
When "switch role" fails, check both halves: the trust policy in the target account and the AssumeRole allow on the caller's side.

## aws-identity-center-with-ad-connector-mcq-16 | d2
TOPIC: 1.1 Secure access
QUALIFIER: LEAST amount of change
Q:
A company runs on-premises Active Directory and has 15 AWS accounts in one organization. Employees must sign in to the AWS access portal with their existing AD user names and passwords, and the security team forbids running domain controllers or storing password hashes in AWS. A Site-to-Site VPN to the management account's VPC already exists. Which design meets the requirements with the LEAST amount of change?
OPT: a *
Deploy AD Connector in the management account's VPC pointing at the on-premises domain, set it as the IAM Identity Center identity source, and assign permission sets to AD groups across the accounts.
OPT: b
Deploy AWS Managed Microsoft AD with a two-way trust to the on-premises forest and use it as the Identity Center identity source.
WHY:
Managed Microsoft AD runs domain controllers inside AWS that hold their own directory and password data; the trust makes sign-in work, but it violates the rule that no domain controllers or password hashes may live in AWS.
OPT: c
Deploy Simple AD and write a script that copies users and password hashes from the on-premises directory every night.
WHY:
Simple AD is not supported as an Identity Center identity source, does not support trusts, and is no longer open to new customers; copying password hashes into AWS is exactly what the security team forbids.
OPT: d
Create an Amazon Cognito user pool with SAML federation to the on-premises directory and have employees sign in through it.
WHY:
Cognito user pools provide customer identity for your own applications; they do not act as the identity source for the AWS access portal or assign permission sets to AWS accounts.
A:
Use AD Connector as the IAM Identity Center identity source. AD Connector is a directory gateway that redirects authentication to on-premises AD over the existing VPN without caching directory information in the cloud, so no domain controller or password hash is hosted in AWS. Identity Center syncs user and group names but never passwords, and permission sets grant access per account. Managed Microsoft AD with a trust also works but hosts a directory in AWS; Simple AD cannot trust and is not a supported source; Cognito is for customer-facing apps.
USAGE:
Choose AD Connector when the directory must stay on-premises; choose Managed Microsoft AD when AWS-hosted applications need a real domain in the cloud.

## aws-managed-vs-inline-policy-choice-mcq-06 | d2
TOPIC: 1.1 Secure access
QUALIFIER: LEAST amount of change
Q:
A platform team maintains a permission set that 40 IAM roles in the account share, and it changes every few weeks. One of those roles also needs a narrow permission that must never be attached to any other identity and must disappear when that role is deleted. Which policy choice meets both needs with the LEAST amount of change each time the shared permissions are updated?
OPT: a *
Put the shared permission set in a customer managed policy attached to all 40 roles, and put the one-off permission in an inline policy embedded in the single role.
OPT: b
Edit the AWS managed policy that most closely matches the shared permission set so that all roles receive each update automatically.
WHY:
AWS managed policies are created and administered by AWS; you cannot change the permissions they define, so there is nothing to edit and no way to express the team's custom set.
OPT: c
Paste the shared permission set as an inline policy into each of the 40 roles.
WHY:
Each inline copy is a separate document; every update must be repeated in all 40 roles individually, which is the maximum amount of change per edit instead of the minimum.
OPT: d
Express the shared permission set as a resource-based policy on each service the roles use, and add a permissions boundary to the one special role.
WHY:
Resource-based policies live on resources and not every service supports them, and a permissions boundary caps what a role may do rather than granting the extra permission the role needs.
A:
A customer managed policy is the reusable, centrally updated form: one edit propagates to every attached role, IAM keeps up to five versions so you can roll back, and the policy has its own ARN. An inline policy keeps a strict one-to-one relationship with its identity and is deleted with it, which is exactly the isolation the one-off permission needs. AWS managed policies cannot be edited, and copying inline policies removes central change management. Use inline only when the policy must never be attached elsewhere.
USAGE:
Default to customer managed policies; write an inline policy only when "this permission must die with this role" is a stated requirement.

## aws-protect-cloudtrail-org-wide-mcq-12 | d3
TOPIC: 1.1 Secure access
Q:
A company with 60 member accounts must guarantee that no principal in a member account, including the account's root user, can stop CloudTrail logging, delete or alter trails, or remove the account from the organization. Audit logs must land in one central bucket owned by the security team. Which combination of actions meets these requirements? (Choose two.)
OPT: a *
Attach a service control policy at the organization root that denies cloudtrail:StopLogging, cloudtrail:DeleteTrail, cloudtrail:UpdateTrail and organizations:LeaveOrganization.
OPT: b *
Create an organization trail from the management account (or the CloudTrail delegated administrator) that writes every account's events to the central S3 bucket.
OPT: c
Attach an IAM policy with an explicit deny on CloudTrail write actions to the root user in each member account.
WHY:
The root user is not bound by IAM identity policies and you cannot attach a policy to it; only an SCP from the organization can restrict a member account's root user.
OPT: d
Attach the deny SCP to the management account only, so that it flows down to every member account.
WHY:
SCPs do not affect the management account at all, and they are inherited downward from the root or OU they are attached to; a policy attached to the management account restricts nothing.
OPT: e
Deploy the cloudtrail-enabled AWS Config managed rule with automatic remediation in every member account.
WHY:
Config is detective: it notices that a trail is off after the fact and turns it back on, leaving a window with no logging and nothing stopping the next StopLogging call. The requirement is prevention.
A:
Pair a root-level SCP that denies the CloudTrail write actions and organizations:LeaveOrganization with an organization trail owned by the management account. The SCP applies to every user and role in member accounts, including root, and is the only mechanism that can restrict root. The organization trail is created centrally, copied into each member account, delivers to one bucket, and member accounts can see it but cannot stop, change or delete it. IAM policies cannot bind root, SCPs never touch the management account, and Config rules or log file validation only detect or verify.
USAGE:
Prevention lives in SCPs and organization-owned resources; Config, GuardDuty and log file validation only tell you that something already happened.

## aws-role-chaining-one-hour-limit-mcq-08 | d3
TOPIC: 1.1 Secure access
QUALIFIER: FASTEST
Q:
A nightly data job takes about ten hours. Its compute role first assumes an intermediate role, which then assumes a data-access role in another account whose MaxSessionDuration is set to 12 hours. The job fails after exactly one hour with an expired-token error. Which change is the FASTEST way to make the job complete?
OPT: a *
Have the job re-assume the data-access role and refresh its credentials before each session expires, for example through the SDK's assume-role credential provider, instead of holding one session for the whole run.
OPT: b
Raise MaxSessionDuration on both the intermediate role and the data-access role to 12 hours.
WHY:
The one-hour ceiling for role chaining applies regardless of the maximum session duration configured on the individual roles, so raising the setting changes nothing for a chained session.
OPT: c
Have the job call GetSessionToken at startup to obtain a longer-lived token.
WHY:
GetSessionToken returns temporary credentials for an existing IAM user's own identity; it cannot be called with assumed-role credentials and does not extend a role session obtained through AssumeRole.
OPT: d
Keep the chain but pass DurationSeconds=43200 in the second AssumeRole call.
WHY:
When a role is assumed through role chaining, a DurationSeconds value greater than one hour makes the AssumeRole call fail; the request is rejected instead of granting a longer session.
A:
Role chaining, using one role's temporary credentials to assume another role, caps the session at one hour no matter what MaxSessionDuration says, and a DurationSeconds above 3600 in a chained call fails outright. The fastest fix needs no IAM change: refresh the chained credentials by re-assuming the role before each hour ends, which SDK credential providers do automatically. Longer term, shorten the credential path, because only sessions that are not chained can use the role's MaxSessionDuration, which can be set up to 12 hours (43200 seconds).
USAGE:
Whenever a job dies at exactly 60 minutes, look for a role-to-role hop in its credential path before touching session duration settings.

## aws-service-principal-resource-policy-mcq-15 | d2
TOPIC: 1.1 Secure access
QUALIFIER: LEAST amount of change
Q:
An S3 bucket in account A must send object-created event notifications to an SNS topic owned by account B. When the team saves the bucket's notification configuration, S3 sends a test message to the topic, the test fails, and S3 rejects the configuration. Which change makes the cross-account delivery work with the LEAST amount of change?
OPT: a *
Add a statement to the SNS topic's access policy in account B that allows the s3.amazonaws.com service principal to call SNS:Publish, with conditions that aws:SourceArn matches the bucket ARN and aws:SourceAccount matches account A.
OPT: b
Attach an identity-based IAM policy to the S3 service in account A that grants sns:Publish on the topic.
WHY:
An AWS service is not an IAM identity in your account; there is no user or role called "S3" to attach a policy to. Services are authorized as service principals in resource-based policies on the destination.
OPT: c
Create a role in account B that trusts S3 and configure the notification to assume it before publishing.
WHY:
S3 event notifications do not assume a role to publish; S3 acts as the s3.amazonaws.com service principal and the destination's resource policy must grant it. The notification configuration has no field for a role.
OPT: d
Attach a service control policy to account B that allows cross-account SNS access from account A.
WHY:
SCPs never grant permissions; they only cap what principals in member accounts may do. Nothing in an SCP can authorize S3 in another account to publish to the topic.
A:
Grant on the destination, not the source. S3 publishes as the s3.amazonaws.com service principal, so the SNS topic policy (or the SQS queue policy, or a Lambda resource-based policy) in the target account must allow that principal, and the aws:SourceArn and aws:SourceAccount conditions stop any other bucket from using the grant. S3 checks this at configuration time: it sends a test notification and refuses the whole PUT if the destination rejects it. Identity policies cannot be attached to a service, S3 does not assume roles for notifications, and SCPs cannot grant. If the topic uses a customer managed KMS key, its key policy must also allow the S3 service principal kms:GenerateDataKey and kms:Decrypt.
USAGE:
For "service X in account A must call resource Y in account B", write the allow on Y's resource policy for X's service principal and pin it with SourceArn and SourceAccount.

## aws-web-identity-federation-mobile-mcq-17 | d2
TOPIC: 1.1 Secure access
QUALIFIER: LEAST operational overhead
Q:
A consumer mobile app lets people sign in with their Google account. After sign-in each user must be able to upload and read files only under their own prefix in a shared S3 bucket, and the app must never contain long-term AWS credentials. Which federation design meets this with the LEAST operational overhead?
OPT: a *
Configure an Amazon Cognito identity pool with Google as a provider; the app exchanges the Google token for temporary credentials of an authenticated role whose policy scopes s3:PutObject and s3:GetObject to the bucket path ${cognito-identity.amazonaws.com:sub}/*.
OPT: b
Create the customers as users in IAM Identity Center and assign a permission set that grants S3 access.
WHY:
IAM Identity Center is the workforce identity service for employees' access to AWS accounts and applications; it is not a customer identity system and does not federate consumer Google logins for a mobile app.
OPT: c
Set up SAML 2.0 federation between Google and IAM and have the app call AssumeRoleWithSAML.
WHY:
SAML-to-IAM federation is built for an enterprise identity provider issuing SAML assertions for workforce users; consumer Google sign-in yields an OIDC token, not a SAML assertion, so AssumeRoleWithSAML has nothing to consume, and the app would have to broker tokens and refresh credentials itself.
OPT: d
Create one IAM user per customer at sign-up and store that user's access keys in the app's local storage.
WHY:
This ships long-term credentials to untrusted devices, breaks the stated rule, and creates thousands of IAM users to rotate and clean up.
A:
Use a Cognito identity pool. It brokers the Google token through AssumeRoleWithWebIdentity and returns temporary credentials for the authenticated role, whose trust policy is pinned to the pool with the cognito-identity.amazonaws.com:aud condition. In the role's access policy the variable ${cognito-identity.amazonaws.com:sub} expands to the user's identity ID, so each user reaches only their own prefix. Identity Center and SAML-to-IAM are workforce federation, and IAM users per customer put keys on devices. Do not use this pattern for employees; that is what Identity Center is for.
USAGE:
Consumer app plus social login plus per-user AWS resource access equals a Cognito identity pool with a sub-scoped role policy.

## aws-alb-only-public-tier-mcq-25 | d2
TOPIC: 1.2 Secure workloads
QUALIFIER: MOST secure
Q:
A web application runs on EC2 instances that were launched with public IP addresses in a public subnet behind an internet-facing Application Load Balancer. A security review requires that users reach the application only through the load balancer and never the instances directly, while the instances must still download OS patches from the internet. Which design is the MOST secure way to meet both requirements?
OPT: a *
Move the instances to private subnets without public IP addresses, keep the ALB in the public subnets, and route the private subnets' 0.0.0.0/0 traffic to a NAT gateway for outbound patch downloads.
OPT: b
Keep the public IP addresses and tighten the instance security group so inbound traffic is allowed only from the ALB's security group.
WHY:
The security group blocks direct connections, but each instance still holds an internet-routable address; one rule mistake or an extra security group re-exposes it, so "never reachable directly" is met by configuration rather than by design.
OPT: c
Move the instances to private subnets and add a 0.0.0.0/0 route to the internet gateway in those subnets' route table so patches can download.
WHY:
A subnet whose route table sends 0.0.0.0/0 to an internet gateway is by definition public, so the move changes nothing; and an internet gateway only carries traffic for instances that have a public IP address, so the instances either get public addresses and become directly reachable again, or keep none and still cannot download patches.
OPT: d
Move the instances to isolated subnets with no NAT gateway and no internet route so they cannot be reached from outside.
WHY:
With no outbound path the instances cannot download patches, which fails the second requirement; isolation alone is not the answer when the workload needs egress.
A:
The reference layout puts the internet-facing load balancer nodes in public subnets and the servers in private subnets with no public IP, accepting requests only from the load balancer's security group. A NAT gateway in each public subnet gives the private subnets outbound-only internet access for updates, while the internet can never initiate a connection to them. Tightening a security group on a public instance narrows exposure but keeps the instance addressable; an internet gateway route makes a subnet public again; no egress at all breaks patching.
USAGE:
"Only through the load balancer" means private subnets plus a NAT gateway (or VPC endpoints), never a public IP with a stricter security group.

## aws-encrypt-direct-connect-traffic-mcq-31 | d2
TOPIC: 1.2 Secure workloads
QUALIFIER: MOST secure
Q:
A financial company connects its data center to AWS over a 1 Gbps hosted Direct Connect connection with a private virtual interface. A regulator now requires that every packet crossing the link be encrypted in transit, regardless of protocol. Which change is the MOST secure way to satisfy the regulator?
OPT: a *
Establish an IPsec Site-to-Site VPN whose tunnels run over the Direct Connect connection (a public virtual interface, or private IP VPN over a transit virtual interface) and route all on-premises-to-AWS traffic through the VPN.
OPT: b
Keep the private virtual interface; Direct Connect is a dedicated private path, so the traffic is already protected.
WHY:
Direct Connect does not encrypt traffic in transit by default; a private virtual interface isolates the path and uses private IP addresses but sends packets in the clear.
OPT: c
Require TLS in every application that communicates across the link.
WHY:
Application TLS covers only the flows the teams remember to configure; database replication, file transfers and legacy protocols on the same link stay unencrypted, so "every packet" is not met.
OPT: d
Deploy an AWS Client VPN endpoint and have the data center connect through it.
WHY:
Client VPN is a managed client-based service for individual user devices running an OpenVPN client; it does not terminate a site-to-site network link and cannot carry the data center's traffic over Direct Connect.
A:
Run an IPsec Site-to-Site VPN over the Direct Connect link. The classic form uses a public virtual interface because the VPN endpoints have public IP addresses; private IP VPN over a transit virtual interface avoids public IPs entirely. Either way every packet is encrypted regardless of application. MACsec is the alternative on dedicated 10, 100 or 400 Gbps connections, but it is layer 2 encryption between your router and the Direct Connect location and is not offered on hosted connections. A private virtual interface alone is private, not encrypted.
USAGE:
"Direct Connect" plus "must be encrypted" is VPN over Direct Connect unless the port is a dedicated 10 Gbps or faster connection, where MACsec is the cleaner answer.

## aws-firewall-manager-enforce-waf-org-mcq-30 | d2
TOPIC: 1.2 Secure workloads
QUALIFIER: LEAST operational overhead
Q:
A company with 40 AWS accounts in one organization must ensure that every Application Load Balancer in every account, including ALBs created next month, is protected by the same AWS WAF web ACL with the security team's rule groups. Which approach achieves this with the LEAST operational overhead?
OPT: a *
From the Firewall Manager administrator account, create a Firewall Manager AWS WAF policy scoped to the organization that defines the rule groups and automatically associates the web ACL with in-scope ALBs as they appear.
OPT: b
Deploy the web ACL to every account with a CloudFormation StackSet and ask teams to associate it with each ALB they create.
WHY:
StackSets can create the web ACL in each account, but the association with an ALB is a per-resource action; every future ALB depends on a person remembering to attach it, and nothing detects the ones that were missed.
OPT: c
Attach a service control policy that requires all ALBs to have a web ACL association.
WHY:
SCPs limit which API actions principals may call; they cannot express "this resource must have an association" and cannot create or attach a web ACL on your behalf.
OPT: d
Enable an AWS Security Hub control that reports ALBs without a web ACL and have each account fix its own findings.
WHY:
Security Hub is detective: it produces a finding per unprotected ALB and leaves remediation to 40 separate teams, which is the opposite of centrally enforcing one web ACL.
A:
AWS Firewall Manager is the organization-wide enforcement layer for AWS WAF, Shield Advanced, security groups, Network Firewall and Route 53 DNS Firewall. Its prerequisites are an organization with all features enabled, a designated Firewall Manager administrator account and AWS Config enabled in the accounts. A WAF policy you define once is applied automatically to matching resources and to new accounts and resources as they are added, which is exactly the "including future ALBs" requirement. StackSets provision but do not associate, SCPs cannot enforce associations, and Security Hub only reports.
USAGE:
"Same firewall rule on every account, automatically, forever" is Firewall Manager; a single account with a handful of ALBs can attach the web ACL by hand.

## aws-isolation-account-vs-vpc-vs-subnet-mcq-24 | d2
TOPIC: 1.2 Secure workloads
QUALIFIER: MOST secure
Q:
A company's production and development workloads share one AWS account and one VPC, separated only by subnets. Leadership now requires that a compromise or misconfiguration in development cannot affect production, that each environment has its own bill, and that stricter guardrails apply to production only. Which boundary is the MOST secure way to meet all three requirements?
OPT: a *
Create separate AWS accounts for production and development under AWS Organizations, each with its own VPC, and attach stricter service control policies to the production organizational unit.
OPT: b
Keep one account and place production and development in separate subnets with distinct network ACLs.
WHY:
Subnets and network ACLs segment network traffic only; IAM permissions, service quotas and the bill stay shared, so a bad IAM policy or a runaway resource in development still reaches production.
OPT: c
Keep one account and one VPC and separate the environments with dedicated security groups.
WHY:
Security groups are instance-level firewalls; they say nothing about who may call which API, do not split costs and cannot carry environment-specific guardrails.
OPT: d
Keep one account and run production in a different Region from development.
WHY:
A Region separates infrastructure, not identities or billing: the same IAM principals and the same SCP scope apply in both Regions and both land on one bill, so the blast radius, the guardrails and the cost line are unchanged.
A:
The AWS account is the fundamental security, access and billing boundary. Separate accounts under Organizations contain the impact of an incident, give each environment its own cost line, and let you attach different SCPs to the production OU. VPCs, subnets and security groups only segment the network inside an account; a Region only changes where resources run. Tag-based ABAC in one account can scope permissions but still shares quotas and the account boundary. Do not split accounts merely for network isolation when nothing about identity or billing must differ.
USAGE:
If the question mentions blast radius, separate bills or different guardrails, the answer is separate accounts, not separate subnets.

## aws-nacl-ephemeral-ports-timeout-mcq-21 | d3
TOPIC: 1.2 Secure workloads
QUALIFIER: LEAST amount of change
Q:
A team replaced the default network ACL on a public subnet with a custom one that allows inbound TCP 443 from 0.0.0.0/0 and denies everything else in both directions. The instances' security group allows inbound 443 from anywhere. Clients now time out on HTTPS, although the route table still sends 0.0.0.0/0 to the internet gateway. Which fix restores HTTPS with the LEAST amount of change?
OPT: a *
Add an outbound allow rule to the network ACL for TCP ports 1024-65535 to 0.0.0.0/0 so the servers' responses can return to the clients' ephemeral ports.
OPT: b
Add an outbound rule to the instances' security group allowing TCP 443 to 0.0.0.0/0.
WHY:
Security groups are stateful; the return traffic for an allowed inbound connection is permitted automatically, so the security group is not what is dropping the responses.
OPT: c
Add an inbound allow rule for TCP port 80 to the network ACL.
WHY:
Port 80 is HTTP, a different service; the failing flows are HTTPS on 443, which the inbound rule already allows. The drop is on the outbound leg, not the inbound one.
OPT: d
Lower the rule number of the inbound 443 rule so it is evaluated first.
WHY:
Rule order only matters when an earlier rule matches the same traffic; the inbound 443 allow is already the only allow rule and it is matching. Reordering does not create the missing outbound permission.
A:
Network ACLs are stateless: responses to allowed inbound traffic are subject to the outbound rules, so the server's replies to the client's high-numbered source port are dropped until an outbound allow for the ephemeral range exists. AWS suggests opening 1024-65535 because the client picks the range: many Linux kernels use 32768-61000, Windows Server 2008 and later use 49152-65535, and Elastic Load Balancing, NAT gateways and Lambda use 1024-65535. The security group already handles return traffic statefully, the route table is fine, and rule order is irrelevant here. The same logic applies in reverse: outbound-initiated connections need an inbound ephemeral allow.
USAGE:
Any "custom NACL, right port allowed, still times out" story is the missing ephemeral-port rule in the other direction.

## aws-s3-lock-to-vpc-endpoint-mcq-14 | d3
TOPIC: 1.2 Secure workloads
QUALIFIER: MOST secure
Q:
EC2 instances in private subnets with no NAT gateway reach Amazon S3 through a gateway VPC endpoint. Security requires two controls: the instances may access only the company's buckets, and those buckets must reject any request that does not arrive through that VPC endpoint. Which configuration is the MOST secure way to implement both controls?
OPT: a *
Attach an endpoint policy to the gateway endpoint that limits Resource to the company bucket ARNs, and add a bucket policy Deny for all principals with a StringNotEquals condition on aws:sourceVpce for the endpoint ID.
OPT: b
Associate a security group with the gateway endpoint that allows only the instances, and add a bucket policy that denies requests from outside it.
WHY:
Gateway endpoints are route-table targets that do not use PrivateLink or network interfaces, so there is no security group to attach; security groups apply to the instances, not to a gateway endpoint.
OPT: c
Add a bucket policy that allows only requests whose aws:SourceIp is the NAT gateway's public address.
WHY:
There is no NAT gateway in this design, and aws:SourceIp cannot be used in a bucket policy for requests that traverse a VPC endpoint; such requests carry private VPC addresses, not a public one.
OPT: d
Restrict the instance role's IAM policy to the company buckets and rely on it for both controls.
WHY:
The role's policy limits what those instances can do, but it does nothing to stop other principals or other networks from reaching the buckets, so the "reject requests not from the endpoint" control is missing.
A:
Two policies, one per direction. The gateway endpoint policy governs what the VPC can reach through the endpoint, so restricting its Resource to the company buckets blocks every other bucket. The bucket policy governs who may reach the bucket, so a Deny for every principal when aws:sourceVpce is not the endpoint ID blocks all other paths, including the console. Gateway endpoints have no security groups, aws:SourceIp does not work for endpoint traffic (use aws:VpcSourceIp if you need addresses), and an IAM policy only constrains the caller it is attached to.
USAGE:
Endpoint policy answers "what can my VPC reach"; bucket policy with aws:sourceVpce answers "who can reach my bucket"; you usually need both.

## aws-shield-advanced-justification-mcq-27 | d2
TOPIC: 1.2 Secure workloads
QUALIFIER: MOST secure
Q:
A public web application on CloudFront and an Application Load Balancer has suffered two application-layer DDoS events. Management wants three things: 24/7 access to AWS DDoS specialists during an attack, protection against the bill spike caused by scaling during an attack, and visibility into layer 7 attack traffic. Which option is the MOST secure way to obtain all three?
OPT: a *
Subscribe to AWS Shield Advanced and add the CloudFront distribution and the ALB as protected resources.
OPT: b
Rely on AWS Shield Standard, which is enabled automatically for every AWS account.
WHY:
Shield Standard is the free, always-on layer 3 and 4 protection; it includes no response team access, no cost protection credits and no layer 7 event visibility.
OPT: c
Attach an AWS WAF web ACL with rate-based rules to the ALB and the CloudFront distribution.
WHY:
WAF gives you the layer 7 rules you write, but on its own it has no DDoS response team and no service credits for attack-driven scaling costs.
OPT: d
Enable Amazon GuardDuty in the account to detect and stop the attacks.
WHY:
GuardDuty is a threat detection service that analyzes logs and produces findings; it does not mitigate traffic, provide a response team or refund attack costs.
A:
Only Shield Advanced bundles all three: the Shield Response Team can be contacted at any time during an attack (a Business or Enterprise Support plan is required), cost protection in the form of service credits covers scaling spikes on protected resources, and enhanced real-time metrics plus automatic application-layer mitigation cover layer 7. The subscription also covers standard AWS WAF charges for protected resources. It is a 1-year commitment at 3,000 USD per month, so it is not the answer for a small site with no attack history. Firewall Manager can roll Shield Advanced out across an organization but does not replace the subscription.
USAGE:
When a question lists a response team, cost credits or layer 7 attack visibility, the answer is Shield Advanced; when it says "free" and "layer 3 and 4", it is Shield Standard.

## aws-vpn-customer-gateway-redundancy-mcq-32 | d2
TOPIC: 1.2 Secure workloads
QUALIFIER: HIGHEST availability
Q:
A company's single Site-to-Site VPN connection between its data center and a VPC went down for six hours when the on-premises customer gateway device failed, even though both VPN tunnels were configured. The company wants the site to survive the loss of one device. Which design provides the HIGHEST availability for the site?
OPT: a *
Install a second customer gateway device with its own public IP address, create a second Site-to-Site VPN connection to the same virtual private gateway, and advertise the same prefixes over BGP from both devices.
OPT: b
Add a third tunnel to the existing VPN connection.
WHY:
A Site-to-Site VPN connection always has exactly two tunnels, and both terminate on the same customer gateway device; more tunnels on one device cannot survive that device failing.
OPT: c
Attach a second virtual private gateway to the VPC and connect the existing device to it.
WHY:
Only one virtual private gateway can be attached to a VPC at a time, and the failure was on the customer side anyway; a second AWS-side gateway does not help a dead on-premises router.
OPT: d
Convert the connection to an Accelerated Site-to-Site VPN.
WHY:
Acceleration routes the tunnels through AWS Global Accelerator edge locations for better performance, and it is only supported on transit gateway attachments, not virtual private gateways; either way the connection still terminates on the single customer gateway device that failed.
A:
The redundancy AWS builds into every connection, two tunnels to two AWS endpoints, protects against failure on the AWS side. To protect against the customer side you need a second customer gateway device and a second VPN connection to the same virtual private gateway; with BGP both devices advertise the same routes and the virtual private gateway shifts traffic to the surviving device. A VPC allows one virtual private gateway, a connection has two tunnels, and acceleration changes the path rather than the device count. Direct Connect with a VPN backup is the next step up when bandwidth or consistency also matter.
USAGE:
Two tunnels cover AWS failures; two customer gateways cover your failures; count which side broke before designing the fix.

## aws-waf-cannot-attach-nlb-mcq-29 | d2
TOPIC: 1.2 Secure workloads
QUALIFIER: LEAST amount of change
Q:
A REST API runs on EC2 instances behind an internet-facing Network Load Balancer with a TLS listener. Logs show SQL injection attempts in request bodies, and the security team wants AWS WAF managed rules blocking them. Which change enables WAF for this API with the LEAST amount of change?
OPT: a *
Put an Amazon CloudFront distribution in front of the Network Load Balancer as its origin and associate the web ACL with the distribution (or replace the NLB with an Application Load Balancer and attach the web ACL there).
OPT: b
Associate the web ACL directly with the Network Load Balancer.
WHY:
Web ACLs can be associated with CloudFront, Application Load Balancers, API Gateway REST APIs, AppSync, Cognito user pools, App Runner, Verified Access and Amplify; a Network Load Balancer is a layer 4 device and is not an associable resource.
OPT: c
Subscribe to Shield Advanced and add the NLB as a protected resource.
WHY:
Shield Advanced protects the NLB against DDoS floods and adds response-team support; it does not inspect request bodies for SQL injection patterns.
OPT: d
Tighten the security group to allow inbound traffic on port 443 only.
WHY:
A security group filters on IP address, protocol and port; a SQL injection payload arrives on the permitted port 443 inside a valid HTTPS request, so it passes untouched.
A:
AWS WAF inspects HTTP(S) requests, so it only attaches to resources that terminate HTTP: CloudFront, Application Load Balancers, API Gateway REST APIs, AppSync, Cognito user pools, App Runner, Verified Access and Amplify. A Network Load Balancer forwards TCP and is not on the list. The smallest change is to front the existing NLB with CloudFront and attach the web ACL there; swapping the NLB for an ALB also works but changes the load balancer type and target configuration. Shield Advanced handles DDoS, not injection, and security groups cannot see inside a request.
USAGE:
"WAF" and "NLB" in the same sentence means insert CloudFront or an ALB; WAF never attaches at layer 4.

## aws-acm-certificate-not-renewing-mcq-51 | d2
TOPIC: 1.3 Data security controls
QUALIFIER: LEAST operational overhead
Q:
A company's public website runs behind an Application Load Balancer that uses a certificate stored in AWS Certificate Manager (ACM). The certificate was obtained from a third-party CA and imported into ACM last year. The operations team notices that the certificate expires in 30 days and that ACM has not renewed it, and they want renewals to stop being a manual chore. Which action fixes the situation with the LEAST operational overhead?
OPT: a *
Request a new DNS-validated public certificate from ACM, add the CNAME record that ACM provides to the hosted zone, and associate the new certificate with the ALB listener.
OPT: b
Wait: ACM renews imported certificates automatically as long as they are associated with a load balancer.
WHY:
ACM never provides managed renewal for imported certificates; only certificates that ACM issued renew, so waiting ends with an expired certificate and an outage.
OPT: c
Redeploy the Application Load Balancer so that ACM detects the certificate is in use and triggers the renewal.
WHY:
Being in use is one renewal criterion for ACM-issued, DNS-validated certificates, but it never applies to imported ones, so redeploying the ALB changes nothing.
OPT: d
Buy a new certificate from the third-party CA every year and re-import it into ACM before the old one expires.
WHY:
Re-importing works and keeps the ARN, but it repeats the manual purchase-and-import cycle every year, which is exactly the operational burden the team wants to remove.
A:
Replace the imported certificate with an ACM-issued, DNS-validated certificate. ACM's managed renewal covers only certificates it issued: for DNS validation it checks 45 days before expiry that the certificate is in use by an AWS service and that the validation CNAME records still resolve in public DNS, then renews with no human action. Imported certificates are explicitly excluded; their owner must obtain a new certificate and re-import it (which preserves the ARN and its association). If the DNS zone cannot be edited, email validation still works, but someone must answer the renewal email each cycle.
USAGE:
Before importing anything into ACM, ask whether you control the domain's DNS; if you do, an ACM-issued certificate is the one you never touch again.

## aws-backup-vault-lock-ransomware-mcq-45 | d2
TOPIC: 1.3 Data security controls
QUALIFIER: MOST secure
Q:
A financial services company runs EBS-backed EC2 instances, RDS databases, DynamoDB tables and EFS file systems across several accounts. After a ransomware tabletop exercise, the security team requires nightly backups of all of these resources that nobody, including an account administrator or the root user, can delete before a 90-day retention period ends, with a copy held in a second Region. Which solution meets these requirements in the MOST secure way?
OPT: a *
Create an AWS Backup plan that selects resources by tag, store recovery points in a backup vault with AWS Backup Vault Lock enabled in compliance mode, and add a copy rule that sends recovery points to a locked vault in a second Region.
OPT: b
Turn on S3 Object Lock in compliance mode on a bucket and direct all backups of the EBS, RDS, DynamoDB and EFS resources into it.
WHY:
Object Lock protects only objects stored in that S3 bucket; EBS, RDS, DynamoDB and EFS backups are snapshots or recovery points, not objects you write to S3, so the lock never applies to them.
OPT: c
Create Amazon Data Lifecycle Manager policies with 90-day retention and cross-Region copy for every resource.
WHY:
Data Lifecycle Manager automates only EBS snapshots and EBS-backed AMIs, leaving RDS, DynamoDB and EFS uncovered, and the snapshots it creates can still be deleted by any principal allowed to call ec2:DeleteSnapshot.
OPT: d
Schedule Lambda functions that take snapshots of each resource and enable MFA delete so that the snapshots cannot be removed without a hardware token.
WHY:
MFA delete exists only for S3 object versions; EBS, RDS, DynamoDB and EFS snapshots have no such setting, and an administrator can delete the snapshots or the scheduling function itself.
A:
Use AWS Backup with a compliance-mode Vault Lock plus a cross-Region copy. AWS Backup covers all four resource types under one tag-based plan, and once the compliance-mode lock passes its grace period (at least 3 days) neither any user, including root, nor AWS can delete recovery points or shorten the lock before their retention ends; the vault becomes write-once-read-many. Governance mode is the weaker variant: users with sufficient IAM permissions can still remove that lock. Object Lock, Data Lifecycle Manager and MFA delete each protect a single storage type, and scripted snapshots remain deletable.
USAGE:
Rehearse a restore from a governance-mode vault first and only then create the compliance-mode lock, because after its grace period there is no undo, not even by AWS.

## aws-continuous-compliance-org-mcq-35 | d2
TOPIC: 1.3 Data security controls
QUALIFIER: LEAST operational overhead
Q:
A company must continuously evaluate all 50 accounts in its organization against the CIS AWS Foundations Benchmark and give auditors one dashboard with a per-account and organization-wide score. Findings should keep flowing as accounts are added. Which solution meets this with the LEAST operational overhead?
OPT: a *
Designate a Security Hub delegated administrator account, enable Security Hub for the organization with the CIS AWS Foundations Benchmark standard, and ensure AWS Config recording is on in every account.
OPT: b
Deploy an AWS Config conformance pack for CIS in each account individually and have each account owner export the results monthly.
WHY:
Per-account conformance packs evaluate the rules but leave you 50 separate compliance views with no organization-wide score, and every new account is another manual deployment.
OPT: c
Enable Amazon Inspector across the organization and use its findings as the benchmark report.
WHY:
Inspector scans EC2 instances, container images and Lambda functions for software vulnerabilities and network exposure; it does not evaluate account configuration controls such as CloudTrail, IAM password policy or S3 public access.
OPT: d
Download the CIS compliance report from AWS Artifact for each account.
WHY:
AWS Artifact holds AWS's own audit reports about the AWS platform; it says nothing about how your accounts are configured.
A:
Security Hub is the organization-wide posture dashboard. With a delegated administrator and central configuration the CIS standard (v5.0.0, 3.0.0, 1.4.0 or 1.2.0) is enabled across accounts, new accounts inherit it, and the security score is computed per account and aggregated. Under the hood most controls run as service-linked AWS Config rules, which is why Config must be enabled and recording in each account and Region. Conformance packs are the same rules without the cross-account scoring; Inspector, Macie and Artifact answer different questions.
USAGE:
"Benchmark plus many accounts plus one score" is Security Hub with a delegated admin; a single account that just needs rules evaluated can use a conformance pack.

## aws-end-to-end-tls-alb-targets-mcq-40 | d2
TOPIC: 1.3 Data security controls
QUALIFIER: MOST secure
Q:
A healthcare application runs on EC2 instances in private subnets behind an internet-facing Application Load Balancer. The ALB has an HTTPS listener with an ACM certificate. A compliance audit requires that patient data is encrypted in transit on every network hop, including between the load balancer and the instances. Which configuration meets this requirement in the MOST secure way?
OPT: a *
Keep the HTTPS listener with the ACM certificate, install a certificate on each instance (a self-signed one is acceptable), and register the instances in a target group whose protocol is HTTPS.
OPT: b
Keep the HTTPS listener with an HTTP target group; because the instances are in private subnets the traffic never leaves the VPC and is considered encrypted.
WHY:
A private subnet controls routing, not encryption; the ALB decrypts at the listener and an HTTP target group forwards plaintext over the VPC network, which is exactly the hop the audit flags.
OPT: c
Export the certificate that the ALB uses from ACM and install it on every instance so that both hops use the same public certificate.
WHY:
Only public certificates requested as exportable can leave ACM at all (a paid option that exists only for certificates issued on or after June 17, 2025), and because the ALB never validates target certificates, copying a publicly trusted private key onto every instance adds cost and exposure without adding security.
OPT: d
Create an AWS Site-to-Site VPN between the ALB and the instances so that the second hop runs inside an IPsec tunnel.
WHY:
Site-to-Site VPN connects a VPC to a remote network gateway over the internet; it has no concept of tunnelling between a load balancer and targets inside the same VPC.
A:
Terminate TLS at the ALB with the ACM certificate and re-encrypt to the instances by using an HTTPS target group with a certificate installed on each target. The ALB does not validate target certificates, so self-signed or even expired ones work; the requirement is only that the second hop is TLS. If the auditor demands that the load balancer never sees plaintext, use a Network Load Balancer with a TCP listener on port 443 instead, which passes encrypted traffic straight through to the targets. Private subnets and security groups restrict who can connect but encrypt nothing.
USAGE:
Bake a self-signed certificate into the AMI and point the health check at HTTPS too, so the encrypted hop is the one the load balancer actually tests.

## aws-kms-admin-vs-user-separation-mcq-43 | d3
TOPIC: 1.3 Data security controls
QUALIFIER: MOST secure
Q:
A company stores regulated documents in S3 with SSE-KMS under a customer managed key. Policy requires separation of duties: the security team must be able to manage the key (rotate, disable, change its policy, schedule deletion) but must never be able to decrypt documents, while the application role must encrypt and decrypt but must never be able to alter the key. Which key policy design is the MOST secure way to enforce this?
OPT: a *
Write a key policy with one statement that grants the security team's role the administrative actions (kms:Create*, kms:Describe*, kms:Enable*, kms:Put*, kms:Update*, kms:Revoke*, kms:Disable*, kms:Get*, kms:List*, kms:ScheduleKeyDeletion, kms:CancelKeyDeletion) and a second statement that grants the application role only kms:Encrypt, kms:Decrypt, kms:ReEncrypt*, kms:GenerateDataKey* and kms:DescribeKey; scope or remove the account-root "Enable IAM User Permissions" statement.
OPT: b
Write a single key policy statement that grants both roles kms:* on the key and rely on team process to keep each side within its remit.
WHY:
kms:* hands the security team Decrypt and the application ScheduleKeyDeletion; a statement that permits everything enforces no separation at all.
OPT: c
Keep the default key policy that delegates to the account root and express the split entirely in the two roles' IAM identity policies.
WHY:
The root delegation statement lets any principal with IAM administration rights grant themselves kms:Decrypt through an IAM policy, so the key policy no longer guarantees who can read the data.
OPT: d
Give the security team KMS grants on the key instead of policy statements, since grants are the mechanism intended for administrators.
WHY:
Grants delegate use of a key for cryptographic operations such as Encrypt, Decrypt and GenerateDataKey; they cannot confer administrative actions such as PutKeyPolicy or ScheduleKeyDeletion.
A:
Split the key policy into an administrators statement and a key-users statement, as the KMS console's default policy does, and be deliberate about the account-root statement. Administrators receive the management verbs but none of the cryptographic ones; key users receive Encrypt, Decrypt, ReEncrypt*, GenerateDataKey* and DescribeKey and nothing that changes the key. The trap is "Enable IAM User Permissions": it lets IAM policies in the account grant any KMS action, so an IAM administrator could give themselves Decrypt. Remove it or scope it narrowly, remembering that a key with no account principal becomes unmanageable if the listed roles are deleted. AWS managed keys have no editable policy and cannot express this split.
USAGE:
Alert on PutKeyPolicy and CreateGrant calls in CloudTrail: the admin statement's kms:Put* and kms:Create* let an administrator widen their own access, and those two events are the tripwire.

## aws-kms-rotation-key-types-mcq-50 | d2
TOPIC: 1.3 Data security controls
QUALIFIER: LEAST operational overhead
Q:
A company's security standard requires that every KMS key protecting production data receives new key material at least once a year. The estate includes symmetric keys generated by KMS, a symmetric key whose material was imported from an on-premises HSM, and an RSA asymmetric key used to sign software releases. Automatic rotation is already enabled wherever KMS allows it. Which approach keeps the imported-material key and the asymmetric key compliant with the LEAST operational overhead?
OPT: a *
For the asymmetric key, create a new KMS key each year and repoint the alias to it while keeping the old key enabled; for the imported-material key, import fresh material and perform an on-demand rotation, or replace it and move the alias in the same way.
OPT: b
Enable automatic key rotation on the imported-material key and on the asymmetric key so that KMS rotates them yearly like the others.
WHY:
Automatic rotation is supported only on symmetric encryption keys whose material KMS generated; enabling it on imported-material or asymmetric keys is not possible.
OPT: c
Create new keys each year and re-encrypt every existing object and re-sign every release with the new key before disabling the old one.
WHY:
KMS keeps the old key and its material, so ciphertext encrypted under it stays decryptable and signatures stay verifiable; mass re-encryption is expensive work that rotation never requires.
OPT: d
Schedule deletion of the old keys as soon as the alias points at the new ones so that only the current key remains.
WHY:
Deleting the old key destroys the only material that can decrypt data or verify signatures produced under it; KMS cannot decrypt a ciphertext with a different key.
A:
Rotate by replacement: create a new key, move the alias, and keep the previous key enabled. Automatic rotation exists only for symmetric encryption keys with KMS-generated material (default period 365 days); asymmetric, HMAC and custom-key-store keys can only be rotated manually, and imported-material symmetric keys can alternatively take an on-demand rotation after new material is imported. Either way, existing ciphertext needs no re-encryption because KMS remembers which material encrypted it, and the old key must stay alive as long as anything it protected exists. Decrypt and Verify on asymmetric keys require the exact KeyId, so applications must record which key signed what.
USAGE:
Let applications reference alias/prod-signing rather than a key ID, so the yearly swap is one UpdateAlias call and zero deployments.

## aws-kms-viaservice-condition-mcq-44 | d3
TOPIC: 1.3 Data security controls
QUALIFIER: MOST secure
Q:
A company keeps customer records in an S3 bucket in eu-west-1 encrypted with a customer managed KMS key. Several IAM roles legitimately read the objects through S3. The security team discovers that a developer used one of those roles to call kms:Decrypt directly from the CLI on a ciphertext copied out of the bucket. The team wants the key to be usable only when S3 in eu-west-1 makes the request on a principal's behalf. Which change enforces this in the MOST secure way?
OPT: a *
In the key policy, add a Condition to the key-users statement that requires kms:ViaService to equal s3.eu-west-1.amazonaws.com and kms:CallerAccount to equal the company's account ID.
OPT: b
Add an aws:SourceIp condition to the key policy that allows only the corporate office CIDR ranges.
WHY:
The developer sat in the office; a source-IP condition still permits direct kms:Decrypt calls from those ranges and would also block S3's own requests, which do not originate from the office.
OPT: c
Create a separate KMS key for each AWS service that uses one, so that the S3 key is never shared with other workloads.
WHY:
A dedicated key limits the blast radius, but nothing in it stops a principal listed as a key user from calling Decrypt directly with that key.
OPT: d
Create a KMS grant for the S3 service principal so that only S3, not the roles, holds permission to use the key.
WHY:
A grant can only add permission for a grantee; it cannot subtract from what the key policy already allows the listed roles, and S3 makes SSE-KMS requests with the caller's own credentials rather than through a grant of its own.
A:
Constrain the key-users statement with kms:ViaService. With s3.eu-west-1.amazonaws.com as the value, that statement matches only requests S3 in that Region makes on the principal's behalf, so a direct kms:Decrypt from the CLI no longer matches it; pairing it with kms:CallerAccount keeps another account's S3 from qualifying. The condition narrows only the statement it sits in: if the account-root "Enable IAM User Permissions" statement is present, an IAM policy that allows the key can still authorise direct calls, so scope that statement or apply the same condition there. The principal still needs S3 permissions, because ViaService grants nothing on S3 itself. Source-IP conditions, per-service keys and grants all leave a listed key user able to call Decrypt themselves.
USAGE:
The AWS managed aws/ebs key policy is the reference example: Principal "*" plus kms:CallerAccount and kms:ViaService is how AWS itself scopes a key to one service.

## aws-macie-find-pii-buckets-mcq-48 | d1
TOPIC: 1.3 Data security controls
QUALIFIER: LEAST operational overhead
Q:
A company has about 300 S3 buckets across its accounts. Before an audit it must find out which buckets contain personally identifiable information such as passport numbers and credit card numbers, and it wants an alert whenever a bucket that holds such data becomes publicly accessible. Which solution meets these requirements with the LEAST operational overhead?
OPT: a *
Enable Amazon Macie with automated sensitive data discovery across the organization, and route Macie sensitive-data findings and policy findings through Amazon EventBridge to the security team.
OPT: b
Enable Amazon GuardDuty S3 Protection in every account and alert on its findings.
WHY:
GuardDuty S3 Protection analyzes CloudTrail S3 data events for suspicious activity such as unusual access patterns; it never opens objects, so it cannot say which buckets contain PII.
OPT: c
Deploy Amazon Inspector and schedule it to assess the buckets for sensitive content.
WHY:
Inspector scans EC2 instances, container images and Lambda functions for software vulnerabilities and unintended network exposure; it does not scan S3 object contents.
OPT: d
Write Athena queries with regular expressions over every bucket and schedule them, plus the AWS Config rule s3-bucket-public-read-prohibited for exposure.
WHY:
Config catches public buckets but says nothing about content, and hand-written regex queries over 300 buckets must be built, tuned and rerun by the team, which is the overhead the question rules out.
A:
Amazon Macie is the purpose-built service: it uses machine learning and pattern matching (managed data identifiers for PII, financial and credential data) to discover sensitive data inside S3 objects, and it separately keeps a bucket inventory that raises policy findings when a bucket becomes publicly accessible or loses encryption. Automated sensitive data discovery samples objects continuously across the organization with no jobs to schedule, and findings publish to EventBridge and Security Hub. GuardDuty watches access behaviour, Inspector looks for vulnerabilities, and Config checks configuration; none of them reads what is inside an object.
USAGE:
Designate a Macie administrator account in Organizations first; otherwise every member account has to enable Macie and forward its findings separately.

## aws-s3-replicate-existing-objects-mcq-46 | d3
TOPIC: 1.3 Data security controls
QUALIFIER: LEAST operational overhead
Q:
A company must keep a compliance copy of a 40 TB S3 bucket in a second Region. The copy must include the objects that already exist, every object uploaded from now on, and it must reflect deletions made through the application so that the two buckets match. Objects are encrypted with a customer managed KMS key. Which combination of steps meets these requirements with the LEAST operational overhead? (Choose two.)
OPT: a *
Enable versioning on both buckets and create a Cross-Region Replication rule with delete marker replication enabled, opting in to SSE-KMS objects and granting the replication role kms:Decrypt on the source key and kms:Encrypt on the destination key.
OPT: b *
Run an S3 Batch Replication job for the objects that existed before the rule was created.
OPT: c
Enable Cross-Region Replication on the bucket and rely on it to copy the existing objects as part of its initial sync.
WHY:
Live replication copies only objects created after the configuration was added; there is no initial sync, so the 40 TB already in the bucket would never reach the second Region.
OPT: d
Turn on S3 Transfer Acceleration so that the existing objects are copied to the second Region faster.
WHY:
Transfer Acceleration speeds up uploads from clients to a bucket through edge locations; it does not copy anything between buckets.
OPT: e
Add a lifecycle rule that transitions objects older than one day to a bucket in the second Region.
WHY:
Lifecycle rules change an object's storage class or expire it within the same bucket; they cannot move objects to another bucket or Region.
A:
Pair a versioned CRR rule that replicates delete markers and KMS-encrypted objects with a one-time Batch Replication job for the backlog. Live replication only ever sees new writes, and by default a filter-based rule replicates neither delete markers nor SSE-KMS objects, so both must be switched on and the replication role given key permissions. Batch Replication is the on-demand path for pre-existing objects. Deleting a specific version ID is never replicated, which protects the copy from malicious purges. DataSync could copy the backlog too, but it adds a second tool to operate.
USAGE:
After enabling CRR, watch the ReplicationLatency metric and filter objects by replication status FAILED; a Batch Replication job can re-drive exactly those.

## aws-share-encrypted-ami-cross-account-mcq-38 | d3
TOPIC: 1.3 Data security controls
QUALIFIER: LEAST amount of change
Q:
A platform team in account A built a hardened AMI whose root volume snapshot is encrypted with the default aws/ebs AWS managed key. Account B must be able to launch instances from it, and company policy forbids any unencrypted snapshot. Which approach lets account B use the AMI with the LEAST amount of change?
OPT: a *
Copy the AMI in account A, re-encrypting it with a customer managed KMS key whose key policy grants account B kms:DescribeKey, kms:GenerateDataKey*, kms:ReEncrypt*, kms:CreateGrant and kms:Decrypt, then share the new AMI with account B.
OPT: b
Share the existing AMI with account B as it is.
WHY:
AMIs backed by snapshots encrypted with the default AWS managed key cannot be shared; the aws/ebs key belongs to account A alone and no key policy can grant another account use of it.
OPT: c
Make the AMI public so that account B can find and launch it.
WHY:
Encrypted snapshots cannot be shared publicly at all, and making a hardened image public would also defeat the intent of a private share.
OPT: d
Copy the AMI without encryption, share the unencrypted copy, and let account B re-encrypt after launch.
WHY:
This creates and shares an unencrypted snapshot, which the policy explicitly forbids, even if only temporarily.
A:
Cross-account sharing of an encrypted AMI has two conditions: the backing snapshots must be encrypted with a customer managed KMS key, never the default aws/ebs key, and that key's policy must let the other account use it (DescribeKey, GenerateDataKey, ReEncrypt, CreateGrant, Decrypt; scope CreateGrant with kms:GrantIsForAWSResource). Sharing the AMI does not require sharing its snapshots separately, but it does require sharing the key. Encrypted snapshots can never be public. The receiving account typically copies the AMI under its own key so it no longer depends on account A's key.
USAGE:
Any "share an encrypted snapshot or AMI" story fails first on the AWS managed key; the answer always starts with "copy under a customer managed key".

## aws-stale-credentials-audit-mcq-03 | d2
TOPIC: 1.3 Data security controls
QUALIFIER: LEAST operational overhead
Q:
A security team must know, on an ongoing basis, which IAM users across 30 member accounts lack MFA or still use access keys older than 90 days, and see the result in one place. Which approach delivers this with the LEAST operational overhead?
OPT: a *
Deploy the AWS Config managed rules iam-user-mfa-enabled and access-keys-rotated as organization Config rules from the management or delegated administrator account, and view compliance through an organization-wide Config aggregator or Security Hub.
OPT: b
Have an administrator download the IAM credential report from each of the 30 accounts every month and merge the CSV files.
WHY:
The credential report is per account, generated on request no more than once every four hours, and downloaded manually; 30 monthly downloads is a recurring chore that is neither continuous nor centralized.
OPT: c
Enable CloudTrail Insights in every account to surface the non-compliant users.
WHY:
CloudTrail Insights detects unusual API call rates and error spikes; it has no notion of whether a user has MFA or how old an access key is.
OPT: d
Enable Amazon Inspector across the organization to find the affected users.
WHY:
Inspector assesses software vulnerabilities and network reachability on EC2, container images and Lambda; IAM credential hygiene is outside its scope.
A:
Config managed rules answer both questions continuously: iam-user-mfa-enabled flags any user without MFA, and access-keys-rotated (maxAccessKeyAge default 90 days) flags stale keys; both are periodic rules on the AWS::IAM::User resource type. Deploying them as organization rules pushes them to every account, including new ones, and an aggregator with an Organizations source gives one read-only view of compliance. Security Hub's CIS standard runs the same checks (IAM.3 and IAM.5) with a score. The credential report is a good one-account snapshot; Insights, Inspector and GuardDuty look for different things.
USAGE:
Posture questions ("who lacks MFA, which keys are old") are Config rules; behavior questions ("who is doing something unusual") are GuardDuty or CloudTrail Insights.

## aws-amazon-mq-jms-no-code-change-mcq-11 | d1
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: LEAST amount of change
Q:
A logistics company is moving a warehouse application to AWS. The application's components exchange messages through a self-managed Apache ActiveMQ broker using JMS over the OpenWire protocol, and the vendor will not change the application code. The company wants the broker to survive an Availability Zone failure. Which solution meets these requirements with the LEAST amount of change?
OPT: a *
Create an Amazon MQ for ActiveMQ broker in an active/standby deployment across two Availability Zones and update the application's connection configuration to the new endpoints.
OPT: b
Replace the broker with Amazon SQS queues and have the components send and receive messages through the SQS API.
WHY:
SQS speaks its own HTTPS API, not JMS or OpenWire, so every producer and consumer would need its messaging code rewritten, which the vendor has ruled out.
OPT: c
Replace the broker with Amazon SNS topics and subscribe each component to the topics it needs.
WHY:
SNS is a push-based pub/sub service with no JMS client or broker semantics such as queues and durable consumers; adopting it is a rewrite, not a migration.
OPT: d
Publish the messages to an Amazon Kinesis Data Streams stream and have the components consume from its shards.
WHY:
Kinesis is a streaming service with a shard-based consumer API and no support for JMS or OpenWire, so it also forces code changes and a different consumption model.
A:
Amazon MQ is the managed broker for Apache ActiveMQ and RabbitMQ, built so that existing brokers migrate without rewriting messaging code because it supports the same industry-standard protocols (OpenWire, AMQP, STOMP, MQTT, WebSocket). An active/standby deployment places two brokers in two Availability Zones on shared Amazon EFS storage, and a reboot-triggered failover takes only a few seconds; only the endpoint list in the application's failover transport changes. SQS, SNS and Kinesis are AWS-native APIs and the right choice for new cloud-native designs, not for a codebase that must stay untouched.
USAGE:
Ask whether the application speaks JMS, AMQP, MQTT or STOMP today; a yes means Amazon MQ, a no means SQS or SNS.

## aws-asg-scale-workers-on-queue-mcq-06 | d2
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: MOST performant
Q:
An Auto Scaling group of EC2 workers processes document-conversion jobs from an SQS queue. Each job spends most of its time waiting on a third-party API, so instance CPU rarely exceeds 15 percent. Partners upload batches at unpredictable times, and during a batch the queue backlog grows for 20 minutes before the fleet catches up. The company wants the fleet to follow demand so that jobs wait no more than 5 minutes. Which scaling configuration is the MOST performant?
OPT: a *
Create a target tracking policy on a backlog-per-instance metric computed with metric math (ApproximateNumberOfMessagesVisible divided by the group's InService instances), with the target set to the acceptable latency divided by the average processing time per message.
OPT: b
Create a target tracking policy on average CPUUtilization with a 50 percent target.
WHY:
These workers are I/O-bound and sit near 15 percent CPU even when the queue is thousands deep, so a CPU target never triggers a scale-out while jobs pile up.
OPT: c
Create scheduled scaling actions that raise the desired capacity during the hours when partners usually upload.
WHY:
Scheduled scaling only helps when demand follows a known clock; the uploads here arrive at unpredictable times, so the fleet would be either idle or already behind.
OPT: d
Create a step scaling policy on the NetworkIn metric that adds instances when bytes received per instance exceed a threshold.
WHY:
NetworkIn measures traffic already reaching the instances, not work waiting in the queue; it rises after the fleet is busy and says nothing about backlog.
A:
Scale on backlog per instance. Queue depth alone does not tell you how many instances are needed, so divide ApproximateNumberOfMessagesVisible by the number of InService instances (metric math avoids publishing a custom metric) and target-track it. The target is the acceptable backlog per instance: with a 5-minute latency goal and 3 seconds per message it is 100 messages, so 1,500 queued messages across 10 instances (150 each) scale the group out by five. CPU, schedules and NetworkIn are proxies that ignore what is waiting; the queue is the demand signal.
USAGE:
Pair the policy with a default instance warmup so that a newly launched worker does not drag the per-instance average down before it is actually pulling messages.

## aws-eventbridge-content-routing-saas-mcq-03 | d2
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: LEAST operational overhead
Q:
An e-commerce company emits an order-placed event for every checkout. Five internal microservices each need a subset of these events with different filters: the fraud service wants orders above a value threshold, the shipping service only physical goods, and so on. A SaaS logistics partner must also receive matching events at its HTTPS API, which requires an OAuth client-credentials token. The producer team must not know about or change anything when a consumer is added. Which design meets these requirements with the LEAST operational overhead?
OPT: a *
Publish the events to an Amazon EventBridge custom event bus; create one rule per consumer with an event pattern that filters on the event body, and target the partner with an EventBridge API destination whose connection holds the OAuth credentials.
OPT: b
Publish to an Amazon SNS topic, attach a filter policy to each subscription, and subscribe the partner's HTTPS endpoint directly.
WHY:
SNS can filter subscriptions, but its HTTPS delivery needs the partner to confirm the subscription and its only built-in authentication is basic or digest credentials embedded in the endpoint URL, so the OAuth requirement forces a proxy the team must build and run.
OPT: c
Have the producer write each event to a dedicated SQS queue per consumer, choosing the queues based on the order attributes.
WHY:
The producer would hold every consumer's filter logic and a queue list that changes with each new consumer, which is exactly the coupling the requirement forbids.
OPT: d
Write the events to an Amazon Kinesis Data Streams stream and have each consumer read the stream and discard the events it does not need.
WHY:
Every consumer would need a shard-aware application that reads and filters the full stream, and the team would manage shard capacity for a low-volume routing job.
A:
EventBridge does the routing: producers call PutEvents once, and each consumer is a rule with a content-based event pattern on the custom bus, added without touching the producer. The SaaS partner is an API destination; its connection stores the OAuth credentials in Secrets Manager, EventBridge performs the token exchange, retries failed deliveries for up to 24 hours or 185 attempts by default, and parks the rest in a dead-letter queue. SNS filter policies are fine for AWS targets, but the authenticated external endpoint and per-consumer filtering are what tip this design to EventBridge.
USAGE:
Test each rule's event pattern against a real sample event in the EventBridge sandbox before deploying; a pattern that never matches fails silently.

## aws-java-monolith-to-containers-mcq-14 | d3
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: LEAST amount of change
Q:
A company runs a Java web application as a single WAR on Tomcat on three on-premises VMs behind a hardware load balancer. User sessions are held in the JVM's memory, so the load balancer pins each user to one VM. The company wants to move the application into containers on AWS and let it scale in and out, with the LEAST amount of change to the application. Which combination of steps meets these requirements? (Choose two.)
OPT: a *
Package the existing WAR and its runtime into a container image without modifying the code, push the image to Amazon ECR, and run it as an Amazon ECS service on AWS Fargate behind an Application Load Balancer.
OPT: b *
Move the session store out of the JVM into Amazon ElastiCache so that any task can serve any user, enabling ALB sticky sessions only as a bridge while that change ships.
OPT: c
Rewrite the application as a set of AWS Lambda functions fronted by Amazon API Gateway.
WHY:
Decomposing a monolith into functions is a refactor of the code, not a containerisation, and violates the requirement to change the application as little as possible.
OPT: d
Rehost the three VMs on Amazon EC2 with AWS Application Migration Service and recreate the hardware load balancer's configuration on an ALB.
WHY:
Application Migration Service replicates servers as EC2 instances; the application would still run on virtual machines, not in containers, so the goal is missed.
OPT: e
Install Amazon EKS Anywhere on the existing on-premises hardware and deploy the container there.
WHY:
EKS Anywhere runs Kubernetes on customer-managed infrastructure; it keeps the workload on the hardware the company is trying to leave.
A:
Containerise the unchanged deployable and externalise the one thing that blocks scaling, the in-memory session. The image runs on ECS with Fargate so there are no hosts to patch, and the ALB replaces the hardware balancer. Sessions in ElastiCache (Redis OSS or Valkey) make every task interchangeable, so scale-in no longer logs users out; ALB stickiness is an acceptable interim but still loses sessions when a task stops. AWS App2Container automated the image and task-definition generation for Java and .NET applications, but it closed to new customers in November 2025, so expect the exam to name it while new projects write the Dockerfile themselves.
USAGE:
Start with the session move; it is the only application change and it unblocks both autoscaling and zero-downtime deploys.

## aws-lambda-critical-function-throttled-mcq-17 | d2
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: HIGHEST availability
Q:
An account runs a payment-authorisation Lambda function and, in the same Region, a nightly batch function that fans out thousands of concurrent invocations. During the batch window the payment function returns throttling errors even though its own traffic is unchanged. The company needs the payment function to keep the HIGHEST availability regardless of what other functions in the account do. Which change achieves this?
OPT: a *
Configure reserved concurrency on the payment function sized for its peak, and optionally set reserved concurrency on the batch function to cap it.
OPT: b
Configure provisioned concurrency on the payment function so that pre-initialised environments are always available.
WHY:
Provisioned concurrency pre-initialises a fixed number of environments to remove cold starts and is billed while idle; requests above that number spill into the account's shared pool, so without reserved concurrency the batch job can still throttle the payment function's peaks.
OPT: c
Increase the payment function's timeout so that invocations wait for capacity instead of failing.
WHY:
Timeout limits how long a running invocation may execute; it has no effect on whether Lambda can start an invocation when the account's concurrency is exhausted.
OPT: d
Deploy the payment function in a second Region and route traffic there during the batch window.
WHY:
Moving the function changes the architecture and latency for a problem that is a per-Region account quota, and it leaves the function exposed to any other noisy function in the new Region.
A:
Reserved concurrency carves a guaranteed slice out of the account's per-Region concurrency limit (1,000 by default) that no other function can consume, and it costs nothing. It is also a ceiling, so size it for the payment function's real peak. Capping the batch function's reserved concurrency protects everything else in the account the same way. Provisioned concurrency solves a different problem, cold-start latency, and is billed: its pre-initialised environments are dedicated, but anything above that number competes in the shared pool, so only reserved concurrency fences off capacity at no cost. Timeouts and extra Regions do not touch the concurrency pool at all.
USAGE:
Keep at least 100 units unreserved: Lambda always holds back 100 for functions without a reservation, and those functions still need somewhere to run.

## aws-order-workflow-with-human-wait-mcq-21 | d2
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: LEAST operational overhead
Q:
A company processes purchase orders in five steps: validate, reserve stock, charge the card, request a manager's approval for orders above a threshold, and ship. Each automated step calls a Lambda function that may fail transiently and must be retried with backoff. The approval step can take up to two business days. Which solution implements this workflow with the LEAST operational overhead?
OPT: a *
Build an AWS Step Functions Standard workflow with Retry and Catch on each task state, and implement the approval step with the .waitForTaskToken callback pattern that resumes when the manager's action returns the token.
OPT: b
Chain the Lambda functions so that each one invokes the next and re-invokes itself on failure.
WHY:
Every function would carry its own retry, backoff and state-passing code, and a two-day pause has no place in a function limited to a 15-minute run; the team would be rebuilding an orchestrator by hand.
OPT: c
Place an SQS queue between each step and have the approval step's consumer hold the message until the manager responds.
WHY:
A received message stays invisible for at most 12 hours, so a consumer holding an approval for two days needs its own bookkeeping to re-extend or re-queue it, plus custom code to correlate the manager's reply with the order.
OPT: d
Build an AWS Step Functions Express workflow so that the orders are processed at high throughput.
WHY:
Express workflows run for at most five minutes and do not support the .waitForTaskToken callback pattern, so the approval step cannot be modelled at all.
A:
A Standard workflow fits: executions can run for up to one year, state persists between steps with exactly-once semantics, and Retry with IntervalSeconds and BackoffRate per state removes retry code from the functions. The approval task uses .waitForTaskToken: the execution pauses, the token travels to the approver (for example in an SNS email link), and SendTaskSuccess or SendTaskFailure resumes it; add HeartbeatSeconds or a timeout so an ignored approval does not hang for a year. Express workflows are for short, high-volume, idempotent work and cannot wait on a callback.
USAGE:
Put the task token in the approval link's query string and have a tiny API route call SendTaskSuccess; no polling loop or scheduler is needed.

## aws-session-store-behind-alb-mcq-20 | d2
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: MOST performant
Q:
A web application runs on an Auto Scaling group behind an Application Load Balancer and stores logged-in user sessions in each instance's memory. When the group scales in or an instance fails, the affected users are logged out. The company wants sessions to survive instance loss and scaling events without enabling sticky sessions, and it wants the MOST performant option. Which solution meets these requirements?
OPT: a *
Store sessions in Amazon ElastiCache (Redis OSS or Valkey) with a read replica in another Availability Zone and Multi-AZ automatic failover enabled, and have every instance read and write sessions there.
OPT: b
Enable duration-based sticky sessions on the target group so that each user keeps returning to the same instance.
WHY:
Stickiness pins a user to one target and helps while it lives, but when that instance is terminated by scale-in or fails, its in-memory sessions are gone and the user is logged out anyway; the question also rules it out.
OPT: c
Store sessions in an Amazon RDS for MySQL Multi-AZ instance, keyed by session ID.
WHY:
RDS survives node loss, but every request then pays a relational round trip measured in milliseconds for a simple key-value lookup, and the database becomes the bottleneck under load.
OPT: d
Mount an Amazon EFS file system on every instance and write each session to a file.
WHY:
EFS is a shared network file system built for file workloads; per-request file reads and writes with NFS latency and locking make it a slow and awkward session store.
A:
Externalise the session to an in-memory store that all instances share. ElastiCache with Redis OSS or Valkey answers key lookups in sub-millisecond time, and with a replica plus Multi-AZ automatic failover a failed primary is replaced by the promoted replica, usually within a few seconds, while the primary endpoint's DNS name follows, so the application needs no change. DynamoDB with a TTL attribute is the serverless alternative when single-digit-millisecond latency is acceptable and you would rather not manage nodes. Stickiness only hides the problem, and RDS or EFS add far more latency per request.
USAGE:
Set a TTL on every session key so that abandoned sessions expire and the cache never fills with dead logins.

## aws-sqs-poison-message-blocking-mcq-09 | d3
TOPIC: 2.1 Loosely coupled architectures
QUALIFIER: LEAST operational overhead
Q:
A fleet of consumers reads from a standard SQS queue, and each message takes up to 4 minutes to process. A malformed message causes the consumer that receives it to crash; the message becomes visible again after the default visibility timeout, another consumer crashes, and healthy messages are also being redelivered and processed twice before they are deleted. Which combination of changes stops the crash loop and the duplicate processing with the LEAST operational overhead? (Choose two.)
OPT: a *
Attach a redrive policy to the queue that moves a message to a dead-letter queue after a chosen maxReceiveCount.
OPT: b *
Raise the queue's visibility timeout above the maximum processing time, for example to 5 minutes, or extend it per message with ChangeMessageVisibility.
OPT: c
Increase the queue's message retention period to the 14-day maximum.
WHY:
Retention controls how long an undelivered message may live in the queue; it keeps the poison message around longer and does nothing about redelivery or crashes.
OPT: d
Convert the queue to a FIFO queue so that messages are processed in order.
WHY:
FIFO adds ordering and deduplication of sends; a crashing consumer still returns the message to its group and blocks everything behind it, so isolation gets worse, not better.
OPT: e
Enable long polling with a 20-second wait time on the queue.
WHY:
Long polling reduces empty ReceiveMessage responses and cost; it has no relationship to how often a failed message is redelivered.
A:
Two settings fix two different faults. The redrive policy's maxReceiveCount is the circuit breaker: after that many receives without a delete, SQS moves the message to the dead-letter queue, where it can be inspected and later redriven, and the consumers stop crashing on it. The visibility timeout (default 30 seconds, maximum 12 hours) must exceed the real processing time, otherwise healthy messages reappear mid-processing and are handled twice. Give the dead-letter queue a retention period longer than the source queue's, because a moved message keeps its original enqueue timestamp on a standard queue.
USAGE:
Alarm on ApproximateNumberOfMessagesVisible of the dead-letter queue: one message there is a bug report, a burst is a deploy to roll back.

## aws-alarm-on-healthy-host-count-mcq-29 | d1
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: HIGHEST availability
Q:
A company runs a web tier of six EC2 instances in a target group behind an Application Load Balancer. The operations team must be paged as soon as fewer than two targets are passing the load balancer's health checks, so that someone intervenes before the tier can no longer serve traffic. Which monitoring configuration supports the HIGHEST availability for this tier?
OPT: a *
Create a CloudWatch alarm on the AWS/ApplicationELB HealthyHostCount metric for the target group, Minimum statistic, threshold less than 2, with an SNS topic as the alarm action.
OPT: b
Create a CloudWatch alarm on the instances' average CPUUtilization with an SNS action.
WHY:
CPU says nothing about whether a target answers health checks; an instance can fail its checks with idle CPU or pass them at 95 percent.
OPT: c
Create a Route 53 health check on the load balancer's DNS name and notify the team when it fails.
WHY:
A Route 53 health check probes the endpoint from outside and reports only whether the whole load balancer answers; it cannot count how many targets behind it are healthy, so it fires only after the last one is gone.
OPT: d
Create an EventBridge rule on EC2 instance state-change notifications for stopped or terminated instances.
WHY:
Instance state events fire when an instance stops or terminates; an instance that is running but failing HTTP health checks never emits one.
A:
The load balancer already measures the business condition: HealthyHostCount in the AWS/ApplicationELB namespace, dimensioned by TargetGroup and LoadBalancer, is the number of targets currently considered healthy. An alarm with a threshold below 2 on the Minimum statistic (the worst view across load balancer nodes) and an SNS action pages the team exactly when the second-to-last target drops out. CPU, external endpoint probes and instance lifecycle events are proxies that either miss health-check failures or fire too late.
USAGE:
Add a companion alarm on UnHealthyHostCount Minimum greater than 0 for more than one data point; that is the AWS-recommended early warning before the healthy count falls.

## aws-baseline-stacks-many-accounts-mcq-23 | d1
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: LEAST operational overhead
Q:
A company uses AWS Organizations with 40 member accounts and operates in three Regions. A platform team must deploy an identical security baseline (CloudTrail, an AWS Config recorder, GuardDuty and a set of IAM roles) to every account and Region, apply it automatically to accounts created later, and find out when someone changes a baseline resource by hand. Which solution meets these requirements with the LEAST operational overhead?
OPT: a *
Create a CloudFormation StackSet with service-managed permissions from the management account or a delegated administrator, target the organizational units with automatic deployment enabled, and run StackSet drift detection on a schedule.
OPT: b
Write a CLI script that assumes a role into each account and runs the template in each Region, and rerun it whenever new accounts appear.
WHY:
The script must be maintained, sequenced and re-run by hand for 120 account-Region pairs, and it has no notion of drift, so out-of-band changes go unnoticed.
OPT: c
Use AWS Elastic Beanstalk to create an environment per account that contains the baseline.
WHY:
Elastic Beanstalk provisions and manages application environments (web servers, load balancers, scaling); it is not a mechanism for account-level governance resources.
OPT: d
Publish the baseline as an AWS Service Catalog product and ask each account owner to launch it.
WHY:
Service Catalog is a self-service catalog: it waits for someone in each account to launch the product, so nothing is enforced and new accounts start without the baseline.
A:
StackSets deploys one template to many accounts and Regions in a single operation. With service-managed permissions CloudFormation creates the cross-account roles itself, targets whole organizational units, and its automatic deployment option adds stacks to accounts that join an OU later. Drift detection on the StackSet runs drift detection on every stack instance and reports which ones have resources changed outside CloudFormation; it detects but does not repair, so pair it with an alarm or an AWS Config rule for remediation. Scripts, Beanstalk and Service Catalog each leave either the enforcement half or the drift half undone.
USAGE:
Register a delegated administrator account for StackSets so that the platform team never needs to log in to the management account.

## aws-dr-24h-objectives-lowest-cost-mcq-39 | d1
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: MOST cost-effective
Q:
An internal reporting application runs in one AWS Region on EC2 instances behind a load balancer with an RDS for PostgreSQL database. The business has agreed that after a Regional outage the application may take up to 24 hours to return and may lose up to 24 hours of data, but it must be recoverable in a second Region. Which disaster recovery approach meets these objectives in the MOST cost-effective way?
OPT: a *
Use AWS Backup plans to take daily backups of the database and EBS volumes, copy each recovery point to the second Region, and keep the application's infrastructure in CloudFormation templates so it can be rebuilt there after a failover.
OPT: b
Run a cross-Region read replica of the database in the second Region and keep the application tier defined but scaled to zero until a failover.
WHY:
This is pilot light: a live replica keeps the recovery point at minutes, but the replica instance is billed every hour of the year to meet an objective that allows a whole day of data loss.
OPT: c
Deploy a smaller copy of the full stack in the second Region with continuous database replication and Route 53 failover routing.
WHY:
A warm standby runs compute and a database around the clock in the second Region; it buys a recovery time of minutes that the 24-hour objective does not require.
OPT: d
Take daily automated RDS snapshots and EBS snapshots and retain them in the primary Region for 30 days.
WHY:
Snapshots that stay in the primary Region are lost with it, so nothing can be restored elsewhere; the plan fails the Regional recovery requirement regardless of cost.
A:
Back up daily with AWS Backup, copy the recovery points to the second Region, and keep the stack in CloudFormation so it can be redeployed on demand. With RPO and RTO of 24 hours the backup-and-restore strategy fits: the AWS DR whitepaper puts its recovery point and time in hours, and nothing runs in the DR Region between events, so the only ongoing cost is backup storage. Pilot light and warm standby keep replicas or servers running to hit tighter objectives the business never set, and backups kept only in the primary Region do not survive a Regional loss.
USAGE:
Write the RPO and RTO at the top of every DR design; when both are a day, a cross-Region backup copy plus an infrastructure template is the whole answer, and a running replica is money spent on an objective nobody asked for.

## aws-find-slow-microservice-hop-mcq-30 | d1
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: FASTEST
Q:
A request to an online store's checkout API passes through 12 microservices running on ECS and Lambda before it returns. Customers report that checkout has slowed from 400 ms to 3 seconds, but every service's own dashboard looks normal. The team must identify which downstream call adds the latency. Which approach identifies the slow hop FASTEST?
OPT: a *
Instrument the services with AWS X-Ray, then use the trace map and individual trace timelines to compare the time spent in each downstream segment.
OPT: b
Run CloudWatch Logs Insights queries across all 12 services' log groups for slow requests.
WHY:
Logs Insights searches each log group's lines, but nothing ties one customer's request together across 12 services, so the team would be correlating timestamps by hand.
OPT: c
Search AWS CloudTrail for API calls made during the slow period.
WHY:
CloudTrail records management and control-plane API calls such as who created a resource; it does not record application requests between services or their latency.
OPT: d
Enable VPC Flow Logs on the services' subnets and look for the slow connections.
WHY:
Flow logs capture accepted and rejected IP traffic metadata at the network interface; they do not measure how long an application call took.
A:
Distributed tracing is built for exactly this question. X-Ray assigns a trace ID to the incoming request, and each instrumented service adds segments and subsegments for its own work and its downstream calls, so the trace timeline shows per-hop duration for one request and the trace map aggregates latency and error rates per service. ECS tasks need the X-Ray daemon or the CloudWatch agent; Lambda needs only active tracing switched on. Logs, CloudTrail and flow logs each describe a different layer and cannot follow one request across service boundaries.
USAGE:
Propagate the X-Amzn-Trace-Id header through any custom HTTP client, or the trace breaks at that hop and the timeline stops there.

## aws-golden-ami-instance-refresh-mcq-24 | d2
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: MOST secure
Q:
A company runs an Auto Scaling group of web servers. Operators have been logging in to patch and tweak instances in place, so no two instances are identical, and a security review found packages that were never tested. The company wants every running instance to match an image that passed automated tests, and it wants configuration drift to be impossible rather than merely reported. Which solution is the MOST secure?
OPT: a *
Build the AMI with an EC2 Image Builder pipeline that runs test components, reference the new AMI in a new launch template version, and start an Auto Scaling instance refresh to replace the fleet; remove interactive access to the instances.
OPT: b
Use AWS Systems Manager Patch Manager to install patches on the running instances during a maintenance window.
WHY:
Patch Manager changes instances in place: each one still accumulates its own history, untested packages can still land, and there is no image to roll back to if a patch breaks the application.
OPT: c
Create an AWS Config rule that checks each instance's AMI ID and reports instances that differ from the approved image.
WHY:
Config only evaluates and reports; a non-compliant instance keeps serving traffic until someone acts, which is the merely-reported outcome the requirement rules out.
OPT: d
Move the application to AWS Elastic Beanstalk and use rolling deployments to update the servers.
WHY:
Beanstalk's rolling deployments apply to environments that Beanstalk manages; they do not govern this Auto Scaling group, and re-platforming an application is not how you stop operators editing servers.
A:
Make the fleet immutable. Image Builder builds the AMI from a recipe, runs test components, and distributes the image only if every test passes; a new launch template version points at that AMI, and instance refresh terminates and replaces instances in batches while keeping at least the minimum healthy percentage (90 percent by default) in service, so nothing is modified in place and a bad image is undone by refreshing to the previous version. With SSH and Session Manager access removed, drift has no path in. Patch Manager mutates, Config observes, and Beanstalk manages a different kind of environment.
USAGE:
Let the Image Builder distribution step update the launch template version and trigger the refresh from EventBridge, so that a passed pipeline is a deployed fleet.

## aws-legacy-app-too-many-connections-mcq-40 | d2
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: LEAST amount of change
Q:
A legacy Java application on a fleet of EC2 instances opens a new connection to an RDS for MySQL Multi-AZ instance for every request and closes it afterwards. During traffic peaks the database returns too-many-connections errors, and during a Multi-AZ failover the application keeps failing for several minutes because its hosts cache the old DNS answer. The source code can no longer be modified. Which solution improves reliability with the LEAST amount of change to the application?
OPT: a *
Create an Amazon RDS Proxy for the DB instance and point the application's connection string at the proxy endpoint.
OPT: b
Move the database to a larger instance class so that max_connections is higher.
WHY:
A bigger instance raises the connection ceiling, but every request still pays for a fresh connection and the multi-minute failover blackout caused by cached DNS is untouched.
OPT: c
Add a read replica and send the application's read traffic to it.
WHY:
A replica offloads reads, but the pain here is connection churn and failover behaviour on the writer; a second endpoint would also need code changes to split the traffic.
OPT: d
Migrate the database to Aurora Serverless v2 so that capacity scales with the connection load.
WHY:
This is a platform migration with new endpoints, testing and a cutover; it does not remove the per-request connection overhead and is far more than the least change asked for.
A:
Put RDS Proxy in front and change nothing but the endpoint. The proxy keeps a pool of long-lived database connections and shares them across the application's short-lived ones, so churn stops reaching MySQL and surplus requests queue instead of failing. On a Multi-AZ failover it connects to the new writer while preserving client connections and does not rely on client DNS caches, which AWS says cuts failover time by up to 66 percent. Most applications need no code change; the proxy must sit in the same VPC as the database and is never public. Resizing, replicas and a migration each leave the churn or the failover problem in place.
USAGE:
Whenever a stem says the code cannot change and the symptoms are connection errors or slow failover, the answer is an endpoint swap to RDS Proxy, not a bigger instance.

## aws-windows-smb-shared-storage-ha-mcq-43 | d1
TOPIC: 3.1 High-performing storage
QUALIFIER: MOST highly available
Q:
A Windows-based document management application runs on EC2 instances in two Availability Zones. It needs a shared SMB file share whose permissions come from the company's Active Directory, and the share must keep serving files if one Availability Zone fails. Which storage solution is the MOST highly available way to meet these requirements?
OPT: a *
Create an Amazon FSx for Windows File Server file system with the Multi-AZ deployment type, joined to the Active Directory, and map the share on every instance.
OPT: b
Create an Amazon FSx for Windows File Server file system with the Single-AZ deployment type and schedule daily backups.
WHY:
Single-AZ keeps one file server in one zone: a server or zone failure means about 30 minutes of downtime during recovery and, in rare cases, a restore from backup, so the share does not survive an Availability Zone outage.
OPT: c
Create an Amazon EFS Regional file system and mount it on the instances in both Availability Zones.
WHY:
EFS spans zones but speaks NFS only and is not supported from Windows instances, so it cannot provide an SMB share with Active Directory permissions.
OPT: d
Deploy an Amazon S3 File Gateway on an EC2 instance and expose an SMB file share backed by an S3 bucket.
WHY:
A File Gateway is a single caching appliance in one zone that presents S3 objects as files; it adds a self-managed instance without Multi-AZ failover, so it is less available than a managed Multi-AZ file system.
A:
Choose FSx for Windows File Server in Multi-AZ mode. It is a native Windows file server with SMB shares, Windows ACLs and Active Directory authentication, plus a standby file server in a second zone kept current by synchronous replication. When the preferred server or its zone fails it fails over automatically, typically in under 30 seconds, and the DNS name stays the same so Windows clients simply resume. Single-AZ is the cheaper tier for test workloads or applications with their own replication. EFS is NFS for Linux, and a File Gateway is one cached appliance in front of S3.
USAGE:
When a stem says SMB or Active Directory, start from FSx for Windows and let the availability requirement decide Single-AZ versus Multi-AZ; EFS is never the answer for Windows.

## aws-queue-backlog-per-instance-mcq-08 | d3
TOPIC: 3.2 Elastic compute
QUALIFIER: MOST effectively
Q:
A fleet of EC2 workers in an Auto Scaling group pulls jobs from an SQS queue; each job calls a slow third-party API and waits for the reply, so instances sit at about 15 percent CPU. The group scales on average CPU utilization. During bursts the queue grows to thousands of messages while the group adds nothing, and when it finally does, the new instances take three minutes to load configuration before they work. Which scaling configuration will process the backlog MOST effectively?
OPT: a *
Create a target tracking policy on a metric math expression that divides ApproximateNumberOfMessagesVisible by the group's InService instance count, set the target to the acceptable backlog per instance, and configure a default instance warmup that covers the three-minute startup.
OPT: b
Lower the target value of the existing CPU utilization target tracking policy to 10 percent.
WHY:
The workers are I/O-bound: CPU barely moves whether the queue holds ten messages or ten thousand, so no CPU target follows the real demand and the group still scales late or not at all.
OPT: c
Create a step scaling policy on the ApproximateAgeOfOldestMessage metric so the group adds instances once the oldest message is more than two minutes old.
WHY:
Message age only rises after work is already late, and it says nothing about how many instances are needed; it is a lagging alarm that fires after the backlog has formed instead of scaling in proportion to it.
OPT: d
Increase the queue's visibility timeout so that messages are not redelivered while workers are busy.
WHY:
A longer visibility timeout changes how long a received message stays hidden; it adds no processing capacity, so the queue keeps growing.
A:
Scale on backlog per instance: visible messages divided by InService instances, with the target set to the latency you accept divided by the time one instance needs per message. Target tracking then adds instances in proportion to the queue, which CPU cannot do for I/O-bound workers, and metric math builds the metric without publishing a custom one. The default instance warmup keeps the three-minute startup from feeding misleading metrics and from triggering a second scale-out before the first has finished. Oldest-message age reacts late, and a visibility timeout adds no capacity.
USAGE:
Measure how long one worker needs per message and how long users will wait; the target value is one number divided by the other, and the warmup should match the real startup time.

## aws-vpc-cidr-growth-mcq-25 | d2
TOPIC: 3.4 Scalable network
QUALIFIER: LEAST amount of change
Q:
A production VPC was created with a 10.10.0.0/22 CIDR block split into four /24 subnets. An EKS cluster in the VPC now fails to start pods because every subnet has run out of IPv4 addresses, and the cluster, its load balancers and an RDS instance must keep running. Which approach provides more IP addresses with the LEAST amount of change?
OPT: a *
Associate a secondary IPv4 CIDR block with the VPC, create new subnets from it, and configure the cluster to place pods in the new subnets.
OPT: b
Modify each existing subnet to change its CIDR block from /24 to /22.
WHY:
The IP range of an existing subnet or VPC cannot be changed after creation; you can only add CIDR blocks to the VPC and create new subnets from them.
OPT: c
Create a new VPC with a /16 CIDR block and migrate the cluster, load balancers and database into it.
WHY:
It works, but rebuilding every resource in a new VPC is a migration with downtime for the database and cluster, the opposite of the least change when a secondary CIDR solves the shortage in place.
OPT: d
Route pod traffic through a NAT gateway so that pods share the NAT gateway's IP address instead of needing their own.
WHY:
NAT only rewrites the source of outbound traffic; every pod still needs a private IP from a subnet to exist, so NAT does nothing for address exhaustion.
A:
Add a secondary CIDR block to the VPC and carve new subnets from it; the VPC keeps running and a local route for the new range is added automatically. Subnet and VPC ranges are fixed at creation, and every subnet reserves five addresses, which is why a /24 yields 251. Adding the new subnets to the EKS cluster, or using VPC CNI custom networking, lets pods take addresses from the new range, and 100.64.0.0/10 is a permitted secondary block when private space is crowded. Plan future allocations with VPC IPAM so the next VPC starts with room.
USAGE:
Size production VPCs at /16 from the start; a container platform burns an address per pod, and a secondary CIDR is the fix you reach for when someone did not.

## aws-bi-dashboard-choice-mcq-36 | d1
TOPIC: 3.5 Data ingestion and transformation
Q:
A retail company stores sales data in Amazon Redshift and clickstream data in S3 queried through Athena. Business analysts want interactive dashboards with filters and drill-downs that respond quickly, embedded in an internal portal, without the company running any dashboard servers. Which AWS service should the company use?
OPT: a *
Amazon Quick Sight with the datasets imported into SPICE.
OPT: b
OpenSearch Dashboards on an Amazon OpenSearch Service domain.
WHY:
OpenSearch Dashboards visualizes data indexed in a single OpenSearch domain, which suits log and search analytics; it does not query Redshift or Athena and would need a domain to run and load.
OPT: c
Amazon Managed Grafana with dashboards built on the sales and clickstream data.
WHY:
Managed Grafana is built for operational metrics, logs and traces from sources such as CloudWatch and Prometheus; it can reach Redshift and Athena through plugins, but it has no in-memory dataset engine, so every filter change re-runs the warehouse query, and it is aimed at operations teams rather than business analysts.
OPT: d
The Athena query editor with saved queries shared with the analysts.
WHY:
Athena runs SQL and returns result sets; it has no dashboards, filters or embedding, so analysts would still need a visualization layer.
A:
Use Amazon Quick Sight, the business intelligence feature of Amazon Quick and the successor of QuickSight. It connects to Redshift, Athena, S3 and RDS, and importing a dataset into SPICE, its in-memory calculation engine, makes analytical queries faster and avoids paying Athena for every dashboard refresh. It is fully managed, billed per user, and dashboards can be embedded in applications. OpenSearch Dashboards is for data indexed in OpenSearch, Managed Grafana is for observability data, and Athena has no dashboard layer at all.
USAGE:
A stem that says dashboards for business users points to Quick Sight; one that says logs points to OpenSearch, and one that says metrics points to Grafana.

## aws-data-lake-permissions-mcq-31 | d2
TOPIC: 3.5 Data ingestion and transformation
QUALIFIER: MOST secure
Q:
A company keeps a data lake in a single S3 bucket registered as AWS Glue Data Catalog tables and queried through Athena. Three teams query the same customer table. Only the compliance team may see the national ID and date-of-birth columns; the other teams must be able to query every other column of the same table. Which solution enforces this in the MOST secure way?
OPT: a *
Register the S3 location with AWS Lake Formation and grant each team SELECT on the table with a data filter that includes or excludes the sensitive columns.
OPT: b
Write S3 bucket policies that allow each team's IAM role to read only its own prefix in the bucket.
WHY:
A bucket policy decides who can read an object; it cannot hide two columns inside a Parquet file, so a team allowed to read the table's objects can read every column in them.
OPT: c
Attach IAM policies to each team's role that restrict which Athena workgroups and Data Catalog tables the team can query.
WHY:
IAM can limit access to a whole table or workgroup, but it has no notion of columns, so it either exposes the sensitive fields or blocks the table entirely for the other teams.
OPT: d
Run a nightly Glue job that writes a copy of the table without the sensitive columns to a second bucket for the other teams.
WHY:
Duplicating data creates a second copy to secure, keep consistent and pay for, and the original objects still need column-level protection from anyone who can reach them.
A:
Use Lake Formation data filters: granting SELECT on the Data Catalog table with specific columns included or excluded gives column-level security, and adding a row filter expression gives row- or cell-level security. Athena, Redshift Spectrum and EMR enforce the filter at query time, so one copy of the data serves every team. Bucket policies and IAM stop at the object and table boundary, which is why they cannot express every column but two. Filters apply only to reads, so only SELECT can carry one. Macie finds sensitive data; it never authorizes access.
USAGE:
Whenever the requirement is some columns or some rows of a shared table, the answer is Lake Formation, not a cleverer bucket policy.

## aws-partner-sftp-into-s3-mcq-22 | d1
TOPIC: 3.5 Data ingestion and transformation
QUALIFIER: LEAST operational overhead
Q:
A logistics company is closing the data centre that hosts its SFTP server. Two hundred partners upload shipment files to it with scripted SFTP clients that authenticate with usernames and passwords held in the company's Active Directory, and the files must land in an S3 bucket for a downstream pipeline. Partners cannot be asked to change their clients or credentials. Which solution meets these requirements with the LEAST operational overhead?
OPT: a *
Create an AWS Transfer Family SFTP server backed by the S3 bucket, use AWS Directory Service for Microsoft Active Directory as its identity provider, and point the existing hostname at the server endpoint.
OPT: b
Launch an EC2 instance running an SFTP server in an Auto Scaling group and run a cron job that syncs its disk to the S3 bucket.
WHY:
Now the company owns patching, host keys, user management and the sync script, plus a highly available design for a single instance; it is a rebuild of the server it wanted to retire.
OPT: c
Install an AWS DataSync agent at each partner and schedule tasks that copy their files into the S3 bucket.
WHY:
DataSync moves data from sources you control on a schedule; it is not a server partners can connect to, and deploying agents at two hundred partners is the largest possible change on their side.
OPT: d
Give each partner an S3 presigned URL and ask them to upload with HTTPS PUT requests.
WHY:
Presigned URLs require every partner to replace its SFTP scripts with HTTP uploads, which breaks the constraint that clients and credentials stay as they are.
A:
Use Transfer Family: a fully managed SFTP endpoint that stores files straight into S3 or EFS with no server infrastructure to run, backed by an auto scaling, redundant fleet across up to three Availability Zones. Its identity provider can be service-managed users, AWS Managed Microsoft AD, or a custom Lambda or API Gateway provider, so existing Active Directory credentials keep working, and a custom hostname keeps the partners' configuration unchanged. Files arriving in S3 can trigger the pipeline. An EC2 server is the burden being removed, DataSync is a transfer engine for your own sources, and presigned URLs change the partners' clients.
USAGE:
If the people uploading are outside your organization, they need an endpoint that speaks their protocol; Transfer Family waits to receive, DataSync pushes what you own.

## aws-d4-backup-archival-selection-mcq-07 | d2
TOPIC: 4.1 Cost-optimized storage
QUALIFIER: MOST cost-effective
Q:
A brokerage must keep 40 TB of trade confirmation files for seven years. Regulators require that no one, including administrators, can delete or alter a file during that period. Files are retrieved perhaps twice a year for audits, and a retrieval that takes up to 24 hours is acceptable. Which solution is the MOST cost-effective way to meet these requirements?
OPT: a *
Store the files in S3 Glacier Deep Archive in a bucket with S3 Object Lock enabled, applying a seven-year retention period in compliance mode.
OPT: b
Store the files in S3 Glacier Flexible Retrieval with Object Lock in compliance mode and use standard retrievals.
WHY:
It satisfies immutability, but Flexible Retrieval costs about 3.6 times more per GB than Deep Archive to deliver restores in hours when the requirement allows a full day.
OPT: c
Use AWS Backup with a backup plan that moves recovery points to cold storage in a vault protected by Vault Lock.
WHY:
AWS Backup can protect an S3 bucket, but its S3 backups cannot transition to the cold storage tier, and a vault holds a second copy on top of the bucket the files still live in; Vault Lock makes the backups immutable, not the working files.
OPT: d
Store the files in S3 Standard-IA and add a bucket policy that denies s3:DeleteObject to every principal.
WHY:
A bucket policy can be edited by an administrator, and Standard-IA costs more than twelve times Deep Archive per GB, so it fails both the immutability requirement and the cost qualifier.
A:
Put the files in S3 Glacier Deep Archive with Object Lock in compliance mode. Deep Archive is the lowest-cost S3 class, about $0.00099 per GB-month in US East against $0.0036 for Glacier Flexible Retrieval, and its standard restore completes within 12 hours, inside the 24-hour allowance; its 180-day minimum is irrelevant for a seven-year hold. Compliance mode means no user, including the root user, can delete or overwrite a version or shorten its retention until the date passes, whereas governance mode can be lifted by users with a special permission. Object Lock requires Versioning on the bucket.
USAGE:
Test retention with governance mode first; a compliance-mode lock on the wrong prefix keeps billing for the full retention period, and only deleting the account removes it early.

## aws-d4-batch-vs-individual-uploads-mcq-10 | d2
TOPIC: 4.1 Cost-optimized storage
QUALIFIER: MOST cost-effective
Q:
Sensors send about 5 million readings per hour, each a 2 KB JSON document, to a collector application. The readings must be stored durably in Amazon S3 for later batch analysis and are rarely read individually. The first design calls PutObject once per reading, and the S3 bill is dominated by request charges. Which change is the MOST cost-effective way to store the data?
OPT: a *
Send the readings to an Amazon Data Firehose stream with an S3 destination and let it buffer them into objects of tens of megabytes before writing.
OPT: b
Keep one PutObject per reading but store the objects in S3 Intelligent-Tiering.
WHY:
The request charge is unchanged, and objects smaller than 128 KB are never moved out of the Frequent Access tier, so Intelligent-Tiering saves nothing on 2 KB objects.
OPT: c
Write each reading as an item in a DynamoDB table with on-demand capacity.
WHY:
DynamoDB charges per write request and per GB stored at far higher rates than S3, and the analysis needs files in S3, not items to be exported later.
OPT: d
Enable S3 Transfer Acceleration on the bucket and keep writing one object per reading.
WHY:
Transfer Acceleration speeds uploads over long distances for an extra per-GB fee; it does not reduce the number of PUT requests, which is what the bill is made of.
A:
Batch before you write. S3 charges per request: at $0.005 per 1,000 PUTs, five million PUTs an hour is about $25 an hour before a byte is stored, and 2 KB objects also fall below the 128 KB minimum that the infrequent-access classes bill. Firehose concatenates incoming records and delivers one object when its buffer size (1 to 128 MiB) or interval (0 to 900 seconds) is reached, turning millions of requests into a few hundred, with optional compression and Parquet conversion. Aggregating in the producer works the same way. Intelligent-Tiering, DynamoDB and Transfer Acceleration all leave the request count untouched.
USAGE:
Whenever objects are tiny and numerous, count requests before counting gigabytes; the fix is a buffer in front of S3, not a cheaper storage class.

## aws-d4-data-migration-service-mcq-08 | d2
TOPIC: 4.1 Cost-optimized storage
QUALIFIER: FASTEST
Q:
A media company must move a 500 TB archive from an on-premises NFS array into Amazon S3 within three weeks, before its data centre lease ends. The site has a single 1 Gbps internet connection that production traffic also uses. Which approach gets the archive into S3 the FASTEST?
OPT: a *
Order AWS Snowball Edge Storage Optimized devices, copy the archive onto them locally and ship them back to AWS.
OPT: b
Deploy an AWS DataSync agent on premises and run a transfer task from the NFS array to the bucket.
WHY:
The link is the bottleneck: 500 TB over 1 Gbps takes about 46 days at full rate and about 58 days at 80 percent utilization, so DataSync cannot finish inside three weeks however well it parallelizes.
OPT: c
Enable S3 Transfer Acceleration on the bucket and upload with the AWS CLI using multipart uploads.
WHY:
Acceleration routes uploads to the nearest edge location to cut latency; the bytes still leave the site over the same 1 Gbps link, so the 46-day floor does not move.
OPT: d
Deploy an Amazon S3 File Gateway on premises and copy the archive into its file share.
WHY:
A File Gateway is a cache that uploads through the same internet link; it exists to give applications ongoing file access to S3, not to move half a petabyte faster than the network allows.
A:
Ship it. Do the arithmetic first: 500 TB is 4,000,000 gigabits, which is 46 days at a perfect 1 Gbps and about 58 days at the 80 percent utilization a shared link realistically delivers, so every online option misses the deadline. Snowball Edge Storage Optimized holds 210 TB usable, so three devices carry the archive, and the timeline is device provisioning, the local copy and return shipping, so order on day one. Note that Snowball Edge is no longer offered to new customers, who are pointed to DataSync, AWS Data Transfer Terminal or partners, yet the exam still tests the rule. DataSync is the right tool for the nightly deltas afterwards.
USAGE:
Divide the data size in bits by the usable share of the link before choosing; if the answer is longer than the deadline, no online service changes it.

## aws-d4-db-type-timeseries-columnar-mcq-26 | d2
TOPIC: 4.1 Cost-optimized storage
QUALIFIER: MOST cost-effective
Q:
A company keeps 50 TB of application logs as gzip-compressed JSON files in S3, growing by about 2 TB a month. Once a month an analyst runs a set of aggregation queries over the previous month's data to produce a report; nobody queries the data at other times. Which solution produces the report in the MOST cost-effective way?
OPT: a *
Run an AWS Glue job that converts the logs to Parquet partitioned by date, catalog the table in the Glue Data Catalog, and run the monthly queries with Amazon Athena.
OPT: b
Load the logs into an Amazon Redshift provisioned cluster and run the monthly queries there.
WHY:
A provisioned cluster bills per node-hour as long as it is running, so it idles about 29 days a month to serve one day of queries unless someone remembers to pause it, and loading 50 TB that could be queried in place is avoidable work.
OPT: c
Point Amazon Athena at the existing JSON files and run the monthly queries directly.
WHY:
Athena bills $5 per TB scanned, and row-oriented JSON forces every query to read whole files; without partitions a monthly query can scan most of the 50 TB instead of the 2 TB it needs.
OPT: d
Import the logs into Amazon Timestream and run the queries with its time series SQL.
WHY:
Timestream is a purpose-built database for live time series such as IoT telemetry and metrics that keeps recent data in memory; ingesting 50 TB of archived logs into it and paying for that storage all month to answer one report is far more than scanning the files in place.
A:
Convert once, query rarely. Parquet is columnar and compressed by column, so Athena reads only the columns and, with date partitions, only the month the report needs; AWS's own pricing example shows a 12-fold drop in scanned data against text. After the Glue job the recurring cost is the scan for one report, with no cluster to keep alive. Redshift provisioned charges every hour it runs and would sit idle most of the month, raw JSON scans far more than necessary, and Timestream is an ingest-time database, not a query layer over historic S3 logs.
USAGE:
For anything queried monthly over S3, spend once on conversion and partitioning and let Athena's per-TB bill stay small; a warehouse only pays off when the queries never stop.

## aws-d4-lowest-cost-transfer-into-aws-mcq-09 | d2
TOPIC: 4.1 Cost-optimized storage
QUALIFIER: MOST cost-effective
Q:
Every night a data centre must copy about 2 TB of newly generated files from an NFS share into an S3 bucket. The data centre has a 1 Gbps internet connection that is lightly used at night and no existing AWS Direct Connect. Which solution transfers the nightly data in the MOST cost-effective way?
OPT: a *
Deploy an AWS DataSync agent in the data centre and schedule a nightly task that copies the share to the bucket over the internet.
OPT: b
Order a 1 Gbps AWS Direct Connect dedicated connection and run the nightly copy over it.
WHY:
A dedicated 1 Gbps port bills about $0.30 an hour, roughly $216 a month, plus circuit and cross-connect fees and weeks of lead time, to carry a volume the existing link handles in a few hours a night.
OPT: c
Use AWS Snowball Edge devices shipped back and forth on a weekly cycle.
WHY:
Devices carry per-job and per-day fees and days of shipping; they make sense when the network cannot carry the volume in time, and 2 TB over 1 Gbps takes under five hours.
OPT: d
Create an AWS Transfer Family SFTP server backed by the bucket and push the files to it each night.
WHY:
The endpoint bills $0.30 an hour whether or not files flow, about $216 a month, plus $0.04 per GB uploaded, before you write the client-side script that DataSync replaces.
A:
DataSync over the existing internet link is the cheapest path. Data transfer into AWS from the internet is free, so the only recurring cost is DataSync's flat per-GB fee, about $0.0125 per GB in Basic mode, roughly $25 a night for 2 TB, and the agent handles scheduling, encryption, verification and bandwidth limits. At 1 Gbps the copy needs about 4.5 hours, comfortably inside a night. Direct Connect and Transfer Family both add fixed hourly port or endpoint charges, and Snowball adds device and shipping fees, none of which pay back at this volume; an existing Direct Connect would simply be reused.
USAGE:
Before proposing new connectivity, price the fixed hourly charge of the endpoint against the per-GB charge of the transfer; for a few terabytes a night the per-GB option wins.

## aws-d4-s3-lifecycle-versioning-cleanup-mcq-06 | d3
TOPIC: 4.1 Cost-optimized storage
Q:
A versioning-enabled S3 bucket holds build artifacts that are overwritten many times a day, and large files are uploaded with multipart upload from CI runners that are often killed mid-upload. Storage costs have tripled although the number of current objects has not changed. Current object versions must remain fully recoverable for 30 days after being replaced. Which combination of lifecycle actions removes the data that is causing the growth? (Choose two.)
OPT: a *
Add a NoncurrentVersionExpiration action that permanently deletes noncurrent versions 30 days after they become noncurrent.
OPT: b *
Add an AbortIncompleteMultipartUpload action with DaysAfterInitiation set to a few days.
OPT: c
Suspend versioning on the bucket.
WHY:
Suspending stops new versions from accumulating but leaves every existing noncurrent version in place and billed, and it removes the 30-day recoverability the requirement demands.
OPT: d
Add a transition action that moves all objects to S3 Intelligent-Tiering.
WHY:
Intelligent-Tiering changes the per-GB price of objects that stay; it never deletes the stale versions or the orphaned upload parts that caused the growth.
OPT: e
Run an S3 Batch Operations job that deletes every object older than 30 days.
WHY:
Deleting current objects by age destroys artifacts that are still in use; the requirement is to remove superseded versions and abandoned parts, not live data.
OPT: f
Enable Requester Pays on the bucket.
WHY:
Requester Pays shifts request and transfer charges to whoever downloads; it does not touch storage, which is the cost that tripled.
A:
Two actions target the two hidden costs. Every version is billed as a full object, so NoncurrentVersionExpiration with NoncurrentDays of 30 removes superseded versions once the recovery window has passed, optionally keeping a number of NewerNoncurrentVersions. Parts of multipart uploads that never complete are stored and billed invisibly until AbortIncompleteMultipartUpload removes them a set number of days after initiation. Once noncurrent versions are gone, delete markers with nothing beneath them can be cleaned with ExpiredObjectDeleteMarker. Suspending versioning, tiering, bulk deletes and Requester Pays either leave the waste in place or break recoverability.
USAGE:
Put an abort-incomplete-multipart rule on every bucket that receives large uploads; the parts are invisible in the console and show up only on the bill.

## aws-d4-storage-auto-scaling-need-mcq-11 | d1
TOPIC: 4.1 Cost-optimized storage
QUALIFIER: LEAST operational overhead
Q:
An RDS for PostgreSQL instance backs an application whose data growth depends on customer sign-ups and cannot be forecast. Twice in the last quarter the instance ran out of allocated storage and stopped accepting writes until an engineer resized it. Which solution prevents this with the LEAST operational overhead?
OPT: a *
Enable RDS storage autoscaling on the instance and set a maximum storage threshold.
OPT: b
Increase the allocated storage now to five times the current data size.
WHY:
Over-provisioning pays for storage that may sit empty for years and still ends in a manual resize on the day growth beats the guess.
OPT: c
Create a CloudWatch alarm on FreeStorageSpace that pages an engineer to modify the instance.
WHY:
The alarm improves warning time, but a human still performs every resize, so the operational burden the question wants removed stays in place.
OPT: d
Migrate the database to Amazon Aurora PostgreSQL, whose cluster volume grows automatically.
WHY:
Aurora storage does grow on its own, but a migration with testing and a cutover is a much larger change than switching on a feature the existing instance already supports.
A:
Turn on storage autoscaling and give it a ceiling. RDS then adds storage when free space is at or below 10 percent of the allocated amount for at least five minutes, in increments of at least 10 GiB or 10 percent of the current size, with no downtime and no reboot; the maximum storage threshold caps the bill. Storage never shrinks afterwards, so do not use it to absorb a one-time load, and at most four modifications happen in any 24 hours, so a huge bulk load can still fill the disk. Over-provisioning wastes money, an alarm still needs a human, and Aurora is more change than the problem needs.
USAGE:
Enable autoscaling with a threshold on every RDS instance whose growth you cannot forecast, and set the threshold at least 26 percent above the current allocation to avoid the approaching-limit event.

## aws-d4-storage-service-cheapest-mcq-02 | d3
TOPIC: 4.1 Cost-optimized storage
QUALIFIER: MOST cost-effective
Q:
A rendering platform runs Linux EC2 instances in three Availability Zones. They share an Amazon EFS Regional file system holding 60 TB of project files, most of which are never opened again after their first month, plus a 10 TB cache of intermediate frames that is regenerated nightly from S3 and used only by instances in one Availability Zone. The applications require POSIX file access and cannot be changed. Which combination of changes is the MOST cost-effective? (Choose two.)
OPT: a *
Add a lifecycle policy to the shared file system that moves files to EFS Infrequent Access after 30 days without access and to EFS Archive after 90 days.
OPT: b *
Move the regenerated cache to an EFS One Zone file system in the Availability Zone where it is used.
OPT: c
Move both datasets to an io2 EBS volume with Multi-Attach enabled and attach it to every instance.
WHY:
Multi-Attach works only for io1 and io2 volumes, on up to 16 Nitro instances in the same Availability Zone, and needs a cluster-aware file system, so it cannot serve instances in three zones.
OPT: d
Replace the shared file system with Amazon FSx for Lustre linked to an S3 bucket.
WHY:
FSx for Lustre is a high-performance file system for HPC and machine learning; replacing a working 60 TB file system with it means a full data migration and a new file system to pay for, when a lifecycle policy cuts the cost of the existing one in place.
OPT: e
Store the project files in S3 Standard-IA and rewrite the applications to use the S3 API.
WHY:
The applications need POSIX file semantics and cannot be changed; S3 is object storage, so this breaks the constraint before its price is even considered.
OPT: f
Present the project files through an Amazon S3 File Gateway running on an EC2 instance.
WHY:
A File Gateway is a single caching appliance whose cache must be sized and managed; it adds a self-run instance in front of S3 when a native EFS lifecycle policy already cuts the cost in place.
A:
Two separate levers. For the cold project files, an EFS lifecycle policy tiers untouched files to Infrequent Access and then Archive, which in US East cost about $0.016 and $0.008 per GB-month against $0.30 for Standard, with a per-GB charge on the rare read and a 128 KiB minimum per file. For the cache that is rebuilt nightly and used in one zone, a One Zone file system costs about $0.16 per GB-month, roughly half of Regional, because it stores data in a single Availability Zone; losing that zone loses the data, which is fine for re-creatable data. Multi-Attach, Lustre, S3 and a gateway each break a constraint or add cost.
USAGE:
Check the EFS bill by storage class after a month; if most bytes still sit in Standard, the files are read more often than assumed and the IA access charges are eating the saving.

## aws-d4-storage-size-rightsizing-mcq-12 | d2
TOPIC: 4.1 Cost-optimized storage
QUALIFIER: MOST cost-effective
Q:
A transactional database on an EC2 instance needs 200 GiB of block storage that sustains 6,000 IOPS with single-digit millisecond latency. The data must survive an instance stop or failure. Which EBS configuration meets these requirements in the MOST cost-effective way?
OPT: a *
A 200 GiB gp3 volume with 6,000 provisioned IOPS.
OPT: b
A 2,000 GiB gp2 volume.
WHY:
gp2 earns 3 IOPS per GiB, so reaching 6,000 IOPS means buying 2,000 GiB, about $200 a month, of which 1,800 GiB is never used; sizing capacity to get performance is the classic gp2 trap.
OPT: c
A 200 GiB io2 Block Express volume with 6,000 provisioned IOPS.
WHY:
io2 delivers the IOPS, but at about $0.125 per GB plus $0.065 per provisioned IOPS-month it costs around $415 a month; that price buys 99.999 percent durability and sub-millisecond latency the requirement did not ask for.
OPT: d
A 500 GiB st1 volume.
WHY:
st1 is throughput-oriented HDD that tops out at 500 IOPS per volume and cannot boot an instance; it is built for large sequential streams, not a transactional database.
A:
Pick gp3 and provision the IOPS you need. gp3 includes 3,000 IOPS and 125 MiB/s in the storage price and lets you add IOPS independently of size, up to 80,000 at 500 IOPS per GiB, so 200 GiB with 6,000 IOPS costs about $16 for storage plus $15 for the 3,000 extra IOPS, around $31 a month in US East. gp2 ties IOPS to size and would need 2,000 GiB; io2 charges far more per IOPS for durability the case does not require; st1 is HDD with a 500 IOPS ceiling. Instance store would be fast but is lost on stop.
USAGE:
Modify existing gp2 volumes to gp3 online, then dial in IOPS and throughput separately; almost every database volume gets cheaper and more predictable.

## aws-d4-storage-tier-unknown-pattern-mcq-04 | d1
TOPIC: 4.1 Cost-optimized storage
QUALIFIER: LEAST operational overhead
Q:
A SaaS company stores customer-uploaded documents, typically 1 to 20 MB each, in S3 Standard. Some customers open their documents daily for years while others never return after upload, and the company cannot predict which is which. It wants to reduce storage cost without retrieval surprises or ongoing work. Which storage choice meets these requirements with the LEAST operational overhead?
OPT: a *
Move the documents to S3 Intelligent-Tiering.
OPT: b
Move the documents to S3 Standard-IA.
WHY:
Standard-IA charges $0.01 per GB on every read and bills a 30-day minimum, so the customers who open documents daily would turn the saving into a retrieval bill.
OPT: c
Add a lifecycle rule that transitions documents to S3 Glacier Flexible Retrieval 90 days after upload.
WHY:
A lifecycle rule assumes a known age pattern; here a document that is still read daily would be archived on day 90 and every open would become a restore that takes minutes to hours.
OPT: d
Leave the documents in S3 Standard and review access logs quarterly to move cold objects by hand.
WHY:
Standard has no retrieval fees but costs the most per GB, and a quarterly manual review is exactly the ongoing work the question rules out.
A:
Intelligent-Tiering is the one class that adapts on its own: an object not accessed for 30 consecutive days moves to the Infrequent Access tier and after 90 days to Archive Instant Access, and it returns to Frequent Access on the next read, all with no retrieval charges. The price is a monitoring fee of $0.0025 per 1,000 objects, negligible for megabyte-sized documents but significant for millions of tiny ones; objects under 128 KB are not monitored and always pay the Frequent Access rate. Standard-IA and lifecycle rules only win when the access pattern is known.
USAGE:
Reach for Intelligent-Tiering when the stem says unknown or changing access; when it gives ages and the objects are large, a lifecycle rule to IA or Glacier is cheaper.

## aws-d4-availability-by-workload-class-mcq-18 | d2
TOPIC: 4.2 Cost-optimized compute
QUALIFIER: MOST cost-effective
Q:
A company runs a development and test environment on AWS: an Auto Scaling group of EC2 instances behind an ALB and an RDS for PostgreSQL instance. Developers use it only from 09:00 to 18:00 on weekdays and accept short outages. Production is a separate Multi-AZ deployment that must stay untouched. Which design is the MOST cost-effective for the dev/test environment?
OPT: a *
Run it Single-AZ on On-Demand instances and use Instance Scheduler on AWS (tag-driven schedules run by Lambda) to scale the Auto Scaling group to zero and stop the RDS instance outside working hours, restoring both each weekday morning.
OPT: b
Keep it running 24x7 but buy 3-year All Upfront Reserved Instances for the EC2 instances and a reserved DB instance to lower the hourly rate.
WHY:
A 45-hour working week is 27 percent of the 168-hour week; a reservation lowers the rate but is paid for every hour of the term, including the 73 percent nobody uses, and locks that waste in for three years.
OPT: c
Deploy dev/test as Multi-AZ, with a standby RDS instance and instances in two Availability Zones, so failures are handled the same way as production.
WHY:
Multi-AZ pays for a synchronous standby that can serve no reads and for redundancy across zones; developers accept short outages, so this buys availability the workload class does not need.
OPT: d
Leave dev/test as it is and move the production tier to Spot Instances to fund the dev/test cost.
WHY:
Spot Instances can be interrupted with a two-minute warning whenever EC2 needs the capacity, which suits flexible dev work, not a production tier that must stay untouched and available.
A:
Stop what is not being used: outside 09:00 to 18:00 on weekdays, scale the Auto Scaling group to zero and stop the RDS instance with Instance Scheduler on AWS or an EventBridge rule and Lambda. A group at zero terminates its instances, so nothing is billed for them; a stopped RDS instance bills only storage and backups; cutting weekly runtime from 168 hours to about 45 saves roughly 70 percent. Keep it Single-AZ: short outages are acceptable. Reservations still pay for every hour; Multi-AZ buys availability this workload class does not need; Spot belongs on interruptible work, never on the production tier. Trap: RDS restarts a stopped instance automatically after 7 consecutive days, which a weekday schedule never reaches.
USAGE:
Classify each environment by the availability it truly needs before buying anything; the cheapest hour is the one you do not run.

## aws-d4-graviton-or-burstable-choice-mcq-21 | d2
TOPIC: 4.2 Cost-optimized compute
QUALIFIER: MOST cost-effective
Q:
A company hosts a dozen internal Linux web applications on EC2. Each server idles at 2 to 5 percent CPU most of the day and bursts to full CPU for a few minutes when a report is generated. The applications run on Arm and x86 alike, and no licensing requires dedicated hardware. Which instance choice is the MOST cost-effective?
OPT: a *
T4g (Graviton) burstable instances, sized so the daily average CPU stays under the baseline, with the credit specification left at its default.
OPT: b
M7g general purpose instances, because fixed-performance Graviton instances give the lowest price per vCPU-hour.
WHY:
A fixed-performance instance bills the whole vCPU whether or not it is used; for servers idling at 2 to 5 percent, the T family's lower hourly price wins because its baseline covers the idle load and earned credits cover the short bursts.
OPT: c
T3 instances in unlimited mode, sized as small as possible so they run above baseline and burst all day.
WHY:
Unlimited mode is free only while average CPU over 24 hours stays at or below the baseline; a T3 that runs above baseline all day pays $0.05 per vCPU-hour in surplus credit charges, and at 100 percent CPU costs about 1.5 times an equivalent M5.
OPT: d
C7g compute optimized Dedicated Instances so each application gets predictable CPU and hardware isolation.
WHY:
The C family's high vCPU-to-memory ratio is priced for sustained compute, not idle web servers, and Dedicated Instances add a $2 per hour fee per Region plus a tenancy premium that nothing in the scenario, which has no licensing constraint, justifies.
A:
Use T4g burstable instances. A T instance earns CPU credits while it runs below its baseline and spends them to burst to full CPU for minutes at a time, so a fleet sitting at 2 to 5 percent CPU pays the low burstable rate and still absorbs the report spike. T4g runs on Graviton2, which AWS prices below comparable x86 instances, and the applications already run on Arm. T4g launches in unlimited mode by default; that costs nothing while the 24-hour average stays under baseline, and surplus credits are billed ($0.04 per vCPU-hour on T4g) only when it does not. If a server's average climbed above baseline, the break-even flips and M7g becomes cheaper, but that is not this workload.
USAGE:
Watch CPUSurplusCreditsCharged in CloudWatch; a burstable instance that keeps paying surplus charges should move to a fixed-performance family.

## aws-d4-instance-family-selection-mcq-19 | d1
TOPIC: 4.2 Cost-optimized compute
QUALIFIER: MOST cost-effective
Q:
An in-memory analytics engine must hold a 450 GiB working set in RAM on a single EC2 instance. CPU demand is modest but continuous, and the job runs 24 hours a day. Which instance family is the MOST cost-effective fit?
OPT: a *
A memory optimized R family instance, such as r7i.16xlarge with 512 GiB of memory.
OPT: b
A general purpose M family instance large enough to reach 512 GiB of memory.
WHY:
Reaching 512 GiB on the M family means m7i.32xlarge with 128 vCPUs, twice the CPUs of the R instance with the same memory; you pay for CPUs the workload does not need, so the cost per GiB of RAM is higher.
OPT: c
A compute optimized C family instance, choosing the largest size available.
WHY:
The C family's ratio is 2 GiB per vCPU; even the largest c7i.48xlarge tops out at 384 GiB, so it cannot hold the working set at all, and its price is loaded toward CPU the job barely uses.
OPT: d
A burstable T family instance, because CPU demand is modest.
WHY:
Modest but continuous CPU still drains a T instance's credit balance, and the largest T4g size has 32 GiB of memory, nowhere near the working set.
A:
Pick the memory optimized R family: r7i.16xlarge or r7g.16xlarge pairs 512 GiB of memory with 64 vCPUs (8 GiB per vCPU), so most of the price buys the RAM the workload actually needs. M instances reach 512 GiB only with twice the vCPUs, C instances cannot reach it at all, and T instances are both too small and wrong for sustained load. Beyond R, the X family (x2iedn.4xlarge: 16 vCPUs, 512 GiB) pushes the ratio to 32 GiB per vCPU for the lowest cost per GiB when CPU barely matters, and U instances run from 3 to 32 TiB for SAP HANA-class databases. The I family is the trap for "memory": it means local NVMe storage, not RAM.
USAGE:
Compute GiB per vCPU from the requirement first; the family whose ratio matches wastes the least money.

## aws-d4-instance-size-rightsizing-mcq-20 | d2
TOPIC: 4.2 Cost-optimized compute
QUALIFIER: MOST cost-effective
Q:
A finance team wants to commit to a 3-year Savings Plan for a fleet of 200 m5.2xlarge instances that has run steadily for a year. CloudWatch shows the fleet averaging 8 percent CPU, and no memory metrics are collected. Which approach is the MOST cost-effective?
OPT: a *
Opt in to AWS Compute Optimizer, install the CloudWatch agent so memory is analysed, apply its rightsizing (and Graviton) recommendations, run on the new sizes for a few weeks, then size the Savings Plan commitment to the reduced usage.
OPT: b
Purchase the 3-year Savings Plan immediately at the current usage level so the discount starts accruing, and rightsize afterwards.
WHY:
A Savings Plan is an hourly spend commitment billed for the full term whether or not the usage exists; buying it at the oversized level locks in three years of paying for capacity that sits at 8 percent CPU, and shrinking the fleet later only leaves commitment unused.
OPT: c
Use the Trusted Advisor Low Utilization Amazon EC2 Instances check and stop every instance it flags before buying the plan.
WHY:
That legacy check flags instances at 10 percent or less daily CPU and 5 MB or less network I/O on at least 4 of 14 days and suggests stopping or terminating them; it names no smaller instance type, so it cannot drive a resize of a fleet that is busy but oversized.
OPT: d
Move the fleet to Spot Instances of the same size to cut the hourly rate.
WHY:
Spot lowers the price of the same oversized instance and can interrupt a steady production fleet with two minutes' notice; it changes the purchasing model, not the 92 percent of CPU that is bought and never used.
A:
Rightsize before you commit. Compute Optimizer analyses 14 days of CloudWatch metrics (93 with the paid enhanced metrics), classifies each instance as over-provisioned, under-provisioned or optimized, and recommends specific target instance types with estimated savings and a performance risk score, including Graviton alternatives when you select that CPU architecture preference. Apply the new sizes, confirm the baseline, then buy the Savings Plan against the reduced hourly spend. Buying first locks oversized capacity in for three years; the Trusted Advisor legacy check only flags idle instances without a target size; Spot reprices the wrong instance and risks interruption; consolidating onto larger instances contradicts the evidence that the fleet is already too big.
USAGE:
Make "rightsize, then reserve" a standing rule; a commitment is cheap only when it covers capacity you will actually use.

## aws-d4-load-balancing-strategy-cost-mcq-15 | d2
TOPIC: 4.2 Cost-optimized compute
QUALIFIER: MOST cost-effective
Q:
A company runs twelve HTTP microservices on ECS, each in its own target group, all served under a single domain such as api.example.com with paths like /orders and /billing. Each service needs health checks and TLS termination. Which load balancing design meets these requirements in the MOST cost-effective way?
OPT: a *
One Application Load Balancer with an HTTPS listener whose rules use path-pattern conditions to forward each path to the matching target group.
OPT: b
One Network Load Balancer with a TCP listener on port 443 forwarding to a single target group containing all services.
WHY:
An NLB works at layer 4 and cannot read a path or host header, so it cannot tell /orders from /billing, and a TCP listener passes TLS through instead of terminating it.
OPT: c
Twelve Application Load Balancers, one per microservice, each with its own certificate.
WHY:
Every ALB bills about $0.0225 an hour before any traffic, so twelve of them cost twelve times the fixed charge to do what one listener with twelve rules does.
OPT: d
One Gateway Load Balancer with the twelve services registered as targets.
WHY:
A Gateway Load Balancer is a layer 3 entry point for inline virtual appliances such as firewalls, exchanging packets over GENEVE; it does not route HTTP requests to application targets.
A:
Use a single ALB. Its listener rules evaluate conditions such as host-header and path-pattern in priority order and forward each match to a different target group, so twelve services share one load balancer, one certificate and one set of health checks, with a default rule catching everything else. The fixed charge is about $0.0225 per hour plus capacity units, so consolidating is where the saving comes from. An NLB cannot see layer 7 fields, twelve ALBs multiply the hourly fee, and a Gateway Load Balancer is for security appliances, not application routing.
USAGE:
Whenever several HTTP services live under one domain, count the load balancers on the design; it should be one ALB with rules, and an NLB appears only when a fixed IP or a non-HTTP protocol is required.

## aws-d4-scaling-method-hibernation-mcq-16 | d2
TOPIC: 4.2 Cost-optimized compute
QUALIFIER: MOST cost-effective
Q:
A financial modelling service runs on a single memory-optimized EC2 instance with 96 GiB of RAM. At startup it spends 40 minutes loading and indexing reference data into memory before it can answer requests. It is used only during business hours on weekdays, must be serving requests within a few minutes of being started each morning, and paying for idle nights and weekends is not acceptable. Which approach is the MOST cost-effective way to run it?
OPT: a *
Launch the instance with hibernation enabled on an encrypted EBS root volume, hibernate it each evening and start it each morning.
OPT: b
Stop the instance each evening and start it each morning.
WHY:
A plain stop discards the memory contents, so every morning starts with the 40-minute load and misses the few-minute requirement.
OPT: c
Keep the instance running 24 hours a day so the data is always in memory.
WHY:
It meets the latency target but pays for roughly 128 idle hours a week; the cost saving the question asks for is exactly those hours.
OPT: d
Put the instance in an Auto Scaling group with a warm pool that keeps a pre-initialized instance in the Running state.
WHY:
A running warm pool instance is billed as a running instance, so it saves nothing, and a single-instance service does not need horizontal scaling to solve a per-instance warm-up problem.
A:
Hibernate. Hibernation writes the RAM contents to the encrypted EBS root volume and stops the instance; while stopped you pay for EBS storage but not instance usage, and on start the operating system reloads the memory and resumes the processes, so the 40-minute warm-up shrinks to the minutes needed to read the RAM image back. Prerequisites: hibernation is enabled at launch, the root volume is encrypted and large enough to hold the RAM, Linux RAM must be under 150 GiB, and an instance may not stay hibernated for more than 60 days. A stopped instance loses its RAM, a running one pays all night, and a warm pool solves scale-out rather than an idle window.
USAGE:
For long-warm-up services with an idle window, schedule hibernate and start with EventBridge Scheduler; for fleets that need extra capacity fast, use a warm pool of hibernated instances instead.

## aws-d4-scheduled-vs-predictive-scaling-mcq-17 | d2
TOPIC: 4.2 Cost-optimized compute
QUALIFIER: MOST cost-effective
Q:
A customer-facing web tier on an Auto Scaling group with a target tracking policy on CPU is slow every weekday at 09:00. New instances take about 10 minutes to warm up, and the size of the spike differs by weekday and grows month over month, so the operations team keeps raising the minimum capacity and now runs near peak all day. Which approach is the MOST cost-effective way to be ready for the 09:00 load?
OPT: a *
Add a predictive scaling policy in forecast-and-scale mode with instances pre-launched ahead of the forecast, keep the target tracking policy, and lower the minimum capacity back to the overnight level.
OPT: b
Keep target tracking only and lower its CPU target so the group reacts sooner.
WHY:
Target tracking reacts to load that has already arrived; with a 10-minute warm-up the first users of the day still wait no matter how low the target, and a lower target means running more instances at every hour of the day.
OPT: c
Keep the minimum capacity at the peak level so the 09:00 users never wait.
WHY:
That is the current state and the problem: peak capacity is billed for 24 hours to serve a spike that lasts part of the morning.
OPT: d
Replace the group with fewer, larger instances so each one has headroom for the spike.
WHY:
Vertical sizing pays for the headroom permanently and removes the elasticity that sheds cost overnight; it changes nothing about when capacity is added.
A:
Use predictive scaling. It learns daily and weekly patterns from up to 14 days of history (24 hours minimum), forecasts hourly capacity 48 hours ahead, refreshes every 6 hours, and can launch instances before the forecast hour so a slow warm-up finishes before the load lands. Because it forecasts each day's spike size, it beats a fixed scheduled action when Monday differs from Wednesday and volumes trend upward; start in forecast-only mode to check accuracy. Predictive scaling only scales out, so keep target tracking to scale in and absorb surprises; step scaling on CPU is just another reactive policy. Reacting sooner, holding peak all day, or buying bigger instances each pays for time or headroom the pattern does not need.
USAGE:
When the spike is the same every day, a scheduled action is enough; when its size varies or trends, let predictive scaling do the arithmetic.

## aws-d4-db-backup-retention-cost-mcq-22 | d2
TOPIC: 4.3 Cost-optimized database
QUALIFIER: MOST cost-effective
Q:
An RDS for MySQL instance with 500 GiB of storage supports an order system. The recovery point objective is 5 minutes, and any point in the last 30 days must be restorable. Which backup configuration is the MOST cost-effective?
OPT: a *
Set the automated backup retention period to 30 days and rely on point-in-time recovery.
OPT: b
Set retention to 1 day and take a manual snapshot every hour, deleting snapshots older than 30 days with a Lambda function.
WHY:
Hourly snapshots give a 60-minute recovery point, which misses the 5-minute RPO, and every manual snapshot counts against the backup storage allowance and persists until you delete it, so this costs more and protects less than point-in-time recovery.
OPT: c
Use AWS Backup with an hourly backup rule and 30-day retention instead of RDS automated backups.
WHY:
AWS Backup can manage RDS backups, but an hourly snapshot rule creates recovery points at most once an hour, so replacing automated backups with it turns a 5-minute RPO into a 60-minute one; you would have to turn its continuous backups (the same 5-minute log uploads) back on anyway, leaving the extra hourly snapshots as pure added storage.
OPT: d
Set the automated backup retention period to 35 days to leave a margin beyond the requirement.
WHY:
35 is the maximum, but every day past 30 stores incremental backups and transaction logs the requirement never asked for, so it is strictly more expensive than 30.
A:
Set automated backup retention to 30 days. RDS takes a daily snapshot and uploads transaction logs to S3 every 5 minutes, so you can restore to any second within the retention window up to the latest restorable time, typically within the last 5 minutes: exactly the 5-minute RPO, at any point in 30 days. Backup storage is free up to 100 percent of the provisioned database storage in the Region, so a 500 GiB database with modest change usually pays nothing extra. Hourly manual snapshots cost more and cannot reach a 5-minute RPO; hourly AWS Backup adds recovery points without improving the RPO; 35 days exceeds the requirement; a Multi-AZ standby is availability, not backup.
USAGE:
Set retention to the requirement, not the maximum; PITR granularity comes from the 5-minute log uploads, not from snapshot frequency.

## aws-d4-db-engine-license-cost-mcq-23 | d2
TOPIC: 4.3 Cost-optimized database
QUALIFIER: MOST cost-effective
Q:
A company's on-premises Oracle Database Enterprise Edition licence renews in nine months at a price the CFO refuses to pay again. The application relies on PL/SQL stored procedures and packages. Which migration path is the MOST cost-effective while keeping application changes small?
OPT: a *
Convert the schema and PL/SQL with the AWS Schema Conversion Tool, migrate the data with AWS DMS, and run on Amazon Aurora PostgreSQL-Compatible Edition.
OPT: b
Move to Amazon RDS for Oracle with the License Included model so AWS supplies the licence.
WHY:
License Included is available only for Standard Edition 2, and it folds an Oracle licence into every instance hour: you never stop paying for Oracle, you pay through AWS instead, so the cost is deferred rather than removed.
OPT: c
Move to Amazon RDS for Oracle with Bring Your Own License to keep the environment identical.
WHY:
BYOL requires the very Oracle licence with active support that the company is about to drop, so after the renewal date the deployment would have no valid licence.
OPT: d
Rewrite the data layer for Amazon DynamoDB to remove licence cost entirely.
WHY:
DynamoDB carries no licence, but a relational schema and PL/SQL logic would have to be redesigned as NoSQL access patterns and rewritten in application code, the opposite of small application changes.
A:
Migrate to Aurora PostgreSQL with SCT plus DMS. SCT converts tables, views, functions and procedures from Oracle to PostgreSQL and reports what needs manual work; AWS's migration playbook calls PL/pgSQL the ideal target for PL/SQL because most syntax carries over, and the SCT extension pack emulates Oracle features with no direct equivalent (packages become functions). DMS then does a full load and change data capture so the source stays live until cutover, and Aurora carries no licence fee. License Included only moves the licence into the hourly rate (and only for SE2); BYOL needs the licence being dropped; Aurora MySQL is also an SCT target, but not the one the playbook calls ideal for PL/SQL; DynamoDB is a rewrite.
USAGE:
"Licence renewal" plus "minimal change" almost always means Aurora PostgreSQL via SCT and DMS; "identical environment" means RDS for Oracle BYOL.

## aws-d4-db-migration-schema-data-mcq-27 | d2
TOPIC: 4.3 Cost-optimized database
QUALIFIER: LEAST downtime
Q:
A company must move a 2 TB Microsoft SQL Server database from its data center to Amazon Aurora MySQL-Compatible Edition. The database backs a 24x7 order system, so the cutover window is a few minutes at most, and the schema contains hundreds of stored procedures. Which migration approach requires the LEAST downtime?
OPT: a *
Convert the schema and stored procedures with the AWS Schema Conversion Tool and apply them to Aurora MySQL, then run an AWS DMS task that performs a full load followed by ongoing change data capture, and cut the application over once replication lag reaches zero.
OPT: b
Take a native SQL Server full backup, upload the .bak file to Amazon S3, and restore it into the target with the RDS native backup and restore procedure.
WHY:
Native backup and restore only restores .bak files into RDS for SQL Server, not into Aurora MySQL, and AWS recommends it only when the database can be offline while the backup is created, copied and restored, which a 24x7 order system cannot be.
OPT: c
Let AWS DMS create the target tables and run a single full-load task during a maintenance window.
WHY:
A DMS replication task creates only tables and primary keys on the target; converting stored procedures, views, triggers and secondary indexes from T-SQL to MySQL is the job of SCT or DMS Schema Conversion, and a full-load-only task with no change capture needs the source frozen for the whole load.
OPT: d
Use AWS Application Migration Service (MGN) to replicate the database server as-is into EC2, then point the application at Aurora.
WHY:
MGN rehosts a whole server block for block, which yields SQL Server on EC2; it converts nothing and cannot land data in Aurora MySQL, so the engine change never happens.
A:
Use SCT for the schema and DMS full load plus CDC for the data. SCT converts tables, procedures and functions from SQL Server to MySQL and flags whatever needs manual work; DMS then copies the existing rows and reads the SQL Server transaction log to stream ongoing changes, so the source stays live throughout and the cutover is the minute it takes to repoint the application once lag is zero. Native backup and restore targets RDS for SQL Server only and assumes downtime; DMS alone leaves the code objects unconverted; MGN rehosts a server rather than migrating a database; Snowball is offline bulk transfer with no change capture, so it cannot support a near-zero cutover.
USAGE:
A heterogeneous migration is always two tools: SCT for schema and code, DMS for data with CDC running until cutover.

## aws-d4-db-service-choose-two-mcq-25 | d3
TOPIC: 4.3 Cost-optimized database
QUALIFIER: MOST cost-effective
Q:
A company runs a production Aurora PostgreSQL cluster with a steady, predictable load 24 hours a day, plus six developer copies of the database that are used a few hours a day and sit idle at night and on weekends. Both must stay relational and PostgreSQL-compatible. Which combination of choices is the MOST cost-effective? (Choose two.)
OPT: a *
Keep production on provisioned Aurora instances and buy 1-year or 3-year reserved DB instances for the writer and readers.
OPT: b *
Run each developer copy as an Aurora Serverless v2 instance with a minimum capacity of 0 ACUs so it pauses automatically when idle.
OPT: c
Convert the production cluster to Aurora Serverless v2 so its capacity scales with load.
WHY:
Serverless v2 bills per ACU-hour for exactly the capacity in use, which wins on spiky or intermittent load; a steady 24x7 load has nothing to scale down, while reserved provisioned instances cut its rate by up to 45 percent (1-year) or 66 percent (3-year), a discount tied to provisioned instance classes rather than serverless capacity.
OPT: d
Buy reserved DB instances for the six developer copies to lower their hourly price.
WHY:
A reservation bills its discounted rate for every hour of the term regardless of usage; databases that idle at night and on weekends pay for far more hours than they use, so the discount never overcomes the waste.
OPT: e
Deploy each developer copy as a Multi-AZ cluster with a reader in a second Availability Zone.
WHY:
A second instance doubles the compute charge of each copy to buy availability that a developer sandbox does not need.
A:
Match the purchasing model to the usage shape: reserved provisioned instances for the steady production cluster and Aurora Serverless v2 with a 0 ACU minimum for the intermittent developer copies. The reservation turns predictable 24x7 usage into a discounted rate (up to 45 percent for one year, up to 66 percent for three); Serverless v2 scales in 0.5 ACU steps and, with minimum capacity 0, pauses after 5 minutes to 24 hours of inactivity with no instance charge until a connection resumes it in about 15 seconds. Putting Serverless on the steady tier or reservations on the idle tier inverts both economics; Multi-AZ for dev pays for redundancy; DynamoDB fails the relational requirement.
USAGE:
"Steady" means commit; "intermittent" means serverless or a stop schedule; never the other way round.

## aws-d4-bandwidth-vpn-vs-dx-speed-mcq-34 | d3
TOPIC: 4.4 Cost-optimized network
QUALIFIER: MOST cost-effective
Q:
A company must move about 4 Gbps of sustained traffic between its data center and several VPCs, starting within two weeks, for a project that ends in four months. It already has a Transit Gateway and BGP-capable routers. Which connectivity design meets the bandwidth and the timeline in the MOST cost-effective way?
OPT: a *
Create several Site-to-Site VPN connections from the data center to the Transit Gateway with dynamic (BGP) routing and VPN ECMP support enabled, so traffic is spread across all the tunnels.
OPT: b
Create one Site-to-Site VPN connection to the Transit Gateway and rely on its two tunnels for 4 Gbps.
WHY:
A standard tunnel carries up to 1.25 Gbps, and traffic from AWS toward on-premises prefers one tunnel of the pair, so a single connection cannot come close to 4 Gbps without ECMP across multiple connections.
OPT: c
Create four Site-to-Site VPN connections to a virtual private gateway attached to the largest VPC.
WHY:
Multiple VPN connections to the same virtual private gateway share an aggregate limit of 1.25 Gbps from AWS to on-premises; ECMP aggregation is a Transit Gateway feature, so extra connections on a virtual private gateway add redundancy, not bandwidth.
OPT: d
Order a 10 Gbps dedicated AWS Direct Connect connection and attach it to the Transit Gateway through a Direct Connect gateway.
WHY:
A dedicated port can take up to 72 business hours just to be provisioned before the LOA-CFA is issued, and the cross connect and any partner circuit come after that, so a two-week start is not something to count on; it then bills $2.25 per port-hour for a four-month project, while a 500 Mbps hosted connection would be quicker but fails the bandwidth requirement.
A:
Aggregate VPN tunnels on the Transit Gateway. Each standard Site-to-Site VPN tunnel carries up to 1.25 Gbps; with BGP routing and VPN ECMP support enabled, a Transit Gateway spreads flows across the tunnels of multiple connections, so four connections (eight tunnels) exceed the 4 Gbps target, provision in minutes, and cost only the per-connection hourly rate plus data transfer. A single VPN cannot exceed one tunnel's rate, a virtual private gateway cannot ECMP-aggregate, and Direct Connect (dedicated 1, 10, 100 or 400 Gbps; hosted 50 Mbps to 25 Gbps) suits a permanent high-volume link, not a two-week, four-month one. Newer Large Bandwidth Tunnels (up to 5 Gbps per tunnel, Transit Gateway only) reach the target with fewer connections.
USAGE:
VPN bandwidth math is tunnels times 1.25 Gbps, but only a Transit Gateway with ECMP lets you add them up.

## aws-d4-cdn-edge-caching-need-mcq-32 | d1
TOPIC: 4.4 Cost-optimized network
QUALIFIER: MOST cost-effective
Q:
A marketing site of static HTML, images and video clips is served directly from an S3 bucket in us-east-1 to viewers worldwide. The monthly S3 data transfer out and GET request charges keep rising, and viewers far from Virginia complain about slow loads. What is the MOST cost-effective change?
OPT: a *
Put an Amazon CloudFront distribution in front of the bucket, restrict the bucket to the distribution with origin access control, and choose a price class that matches where the viewers are.
OPT: b
Enable S3 Transfer Acceleration on the bucket so viewers are served through edge locations.
WHY:
Transfer Acceleration speeds up transfers into S3 over long distances, such as uploads from around the world, and adds its own per-GB charge; it caches nothing for downloads, so every view still hits the bucket.
OPT: c
Create an AWS Global Accelerator accelerator with the bucket as its endpoint.
WHY:
Global Accelerator proxies TCP and UDP traffic over the AWS backbone behind static IPs and charges $0.025 per accelerator-hour plus a premium per GB on top of standard transfer; it has no cache, and its endpoints are load balancers, EC2 instances and Elastic IPs, not S3 buckets.
OPT: d
Replicate the bucket to a Region on each continent with Cross-Region Replication and give each audience a regional URL.
WHY:
Replication pays to store every object several times and to transfer it between Regions, and each regional bucket still bills internet data transfer out and GET requests per view, so the bill grows rather than shrinks.
A:
Use CloudFront with an S3 origin. Data transfer from AWS origins such as S3 to CloudFront is free, and edge caches serve repeat views without touching the bucket, so S3 GET requests and S3 egress fall away and CloudFront's per-GB rates (with 1 TB a month free) replace them, while viewers get content from a nearby edge. Origin access control locks the bucket so only the distribution can read it, and a price class (100, 200 or All) limits which edge locations serve content when the most expensive ones are not worth paying for. Transfer Acceleration is for uploads, Global Accelerator has no cache and a higher price, and replication multiplies storage and egress.
USAGE:
Rising S3 egress from a public bucket is the textbook cue to add CloudFront; the origin fetch is free and the cache does the rest.

## aws-d4-network-connection-choice-mcq-29 | d2
TOPIC: 4.4 Cost-optimized network
QUALIFIER: MOST cost-effective
Q:
A company in us-east-1 replicates about 100 TB per month from AWS to its on-premises data center, every day, and expects to do so for at least three years. The path must be private, and the current Site-to-Site VPN over the internet is saturating. Which connection is the MOST cost-effective over the three years?
OPT: a *
A 1 Gbps hosted AWS Direct Connect connection through a Direct Connect Partner, keeping the existing Site-to-Site VPN as a backup path.
OPT: b
Keep the Site-to-Site VPN and add a second VPN connection to double the capacity.
WHY:
VPN traffic leaves AWS as internet data transfer out at the standard tiered rate ($0.09 per GB for the first 10 TB a month, $0.085 for the next 40 TB), so 100 TB a month costs thousands of dollars in egress alone, and each standard tunnel is still capped at 1.25 Gbps.
OPT: c
Send the data over the public internet with TLS from EC2 instead of through the VPN.
WHY:
Dropping the VPN removes tunnel overhead and nothing else: the bytes are still internet data transfer out at the same per-GB rate, and the requirement for a private path is broken.
OPT: d
Order a 10 Gbps dedicated Direct Connect connection for headroom.
WHY:
100 TB a month averages roughly 300 Mbps, so a 10 Gbps dedicated port at $2.25 per hour (about $1,640 a month) buys thirty times the needed capacity; a 1 Gbps hosted connection carries the load for a fraction of the port cost with the same $0.02 per GB egress.
A:
Direct Connect wins on egress. Traffic leaving AWS over Direct Connect to a US location is billed at $0.02 per GB, against internet egress from us-east-1 at $0.09 per GB for the first 10 TB a month and $0.085 for the next 40 TB; at 100 TB a month that gap dwarfs the port-hour fee of a 1 Gbps hosted connection (about $0.33 per hour). Transfer in is free on both paths; the saving is all in the outbound direction. 100 TB a month is roughly 300 Mbps sustained, so 1 Gbps leaves headroom; keep the VPN as backup. A 10 Gbps dedicated port buys capacity the flow never uses; Snowball suits one-off bulk moves, not a monthly pipeline.
USAGE:
When a stem gives a steady monthly egress volume and a multi-year horizon, price the per-GB difference before the port fee; at tens of terabytes Direct Connect pays for itself within the first month.

## aws-d4-network-review-optimizations-mcq-31 | d3
TOPIC: 4.4 Cost-optimized network
QUALIFIER: MOST cost-effective
Q:
A monthly cost review of a VPC shows two large line items: NatGateway-Bytes, which VPC Flow Logs attribute almost entirely to EC2 instances in private subnets writing to Amazon S3 in the same Region, and a public IPv4 address charge driven by dozens of Elastic IP addresses allocated for past projects and no longer associated with anything. Which two actions are the MOST cost-effective way to cut both charges? (Choose two.)
OPT: a *
Create a gateway VPC endpoint for Amazon S3 and associate it with the private subnet route tables so S3 traffic no longer passes through the NAT gateway.
OPT: b *
Release the unassociated Elastic IP addresses and keep only the public IPv4 addresses that resources actually use.
OPT: c
Add a second NAT gateway in the same Availability Zone to share the load.
WHY:
A second NAT gateway in the same zone adds another $0.045 per hour and processes the same bytes at $0.045 per GB; the charge is per byte through any NAT gateway, so splitting the flow changes nothing and the hourly cost doubles.
OPT: d
Enable cross-zone load balancing on the Application Load Balancer in front of the instances.
WHY:
Cross-zone load balancing governs how an ALB spreads inbound requests across zones; it has no bearing on outbound traffic from private instances to S3 or on idle Elastic IPs.
OPT: e
Put Amazon CloudFront in front of the S3 bucket so the instances fetch through the edge.
WHY:
CloudFront caches downloads for viewers on the internet; these instances are uploading from private subnets, and their route to any public endpoint still passes through the NAT gateway, so the NatGateway-Bytes charge is untouched.
A:
Fix each charge at its source. A NAT gateway bills $0.045 per hour plus $0.045 per GB processed; a gateway endpoint for S3 (or DynamoDB) costs nothing, keeps the traffic on the AWS network, and takes it off the NAT gateway entirely through a prefix-list route in the private subnets. Every public IPv4 address, in use or idle, bills $0.005 per hour (about $3.65 a month each), so unassociated Elastic IPs are pure waste: release them. A second NAT gateway doubles hourly cost without reducing bytes, cross-zone load balancing concerns inbound requests, and CloudFront serves downloads to viewers, not uploads from private compute. Interface endpoints for other services carry their own hourly and per-GB fees, so check volume first.
USAGE:
Run Flow Logs against NAT gateway traffic before buying anything; the biggest NAT bills usually turn out to be S3 or DynamoDB traffic that a free gateway endpoint removes.

## aws-d4-throttling-strategy-mcq-33 | d2
TOPIC: 4.4 Cost-optimized network
QUALIFIER: MOST cost-effective
Q:
A SaaS company exposes a REST API on Amazon API Gateway backed by AWS Lambda. Free-tier customers generate most of the Lambda invocations and the bill keeps climbing, while paying customers on Silver and Gold plans must never be throttled because of free-tier traffic. Which approach is the MOST cost-effective way to contain the free tier?
OPT: a *
Create a usage plan per tier with per-key rate, burst and daily or monthly quotas, issue API keys, and require a key on the API's methods.
OPT: b
Set reserved concurrency on the Lambda function to cap the number of concurrent invocations.
WHY:
Reserved concurrency limits the function as a whole; once free-tier traffic fills it, requests from Gold and Silver customers are throttled too, which breaks the one constraint the scenario set.
OPT: c
Attach an AWS WAF web ACL with a rate-based rule to the API stage.
WHY:
A rate-based rule counts requests over a window of one to ten minutes and acts above one threshold per aggregation key, source IP by default; it has no notion of a daily or monthly quota per customer key, so it can slow abusive bursts but cannot cap how much of the Lambda bill a free-tier plan may consume.
OPT: d
Put an Amazon SQS queue between API Gateway and Lambda so spikes are smoothed out.
WHY:
A queue changes when the function runs, not how often: every free-tier request is still processed and billed, and now you also pay for the queue requests.
A:
Use API Gateway usage plans with API keys. A usage plan states who may call which stages and how fast: a throttling rate and burst per key plus a quota per day, week or month, so free keys get a small quota and paid keys a large one, and a free customer who exhausts a quota is throttled instead of consuming Lambda. Usage plans exist for REST APIs, not HTTP APIs, and keys meter rather than authenticate; pair them with a Lambda authorizer or Cognito. Reserved concurrency throttles everyone, WAF rate rules cannot tell tiers apart, an SQS buffer still bills every invocation, and more Lambda memory changes nothing. Trap: usage plan limits are best-effort, so add AWS Budgets alerts.
USAGE:
Model each pricing tier as a usage plan from day one; retrofitting quotas onto anonymous callers is far harder than issuing keys.

## aws-client-vpn-remote-workforce-mcq-33 | d1
TOPIC: 1.2 Secure workloads
QUALIFIER: LEAST operational overhead
Q:
A company has moved its internal web applications into private subnets of a VPC. About 300 employees working from home need to reach those applications from their laptops. Security requires that each user signs in with existing Active Directory credentials, completes MFA, and that only members of the finance group can reach the finance subnet. Which solution meets these requirements with the LEAST operational overhead?
OPT: a *
Create an AWS Client VPN endpoint that authenticates users against the company's Active Directory through AWS Directory Service with MFA enabled, associate it with the private subnets, and add authorization rules that grant the finance AD group access to the finance subnet CIDR.
OPT: b
Provision an AWS Site-to-Site VPN connection from each employee's home router to a virtual private gateway and authenticate the tunnels with pre-shared keys.
WHY:
Site-to-Site VPN joins networks rather than people: it needs a customer gateway device at every home, has no concept of AD users, groups or MFA, and hundreds of IPsec connections would be a large operational burden.
OPT: c
Launch a bastion host with a public IP address in a public subnet, distribute SSH keys to employees, and have them tunnel to the applications through it.
WHY:
A public bastion with distributed SSH keys opens an inbound port, cannot enforce AD group authorization or MFA on its own, and key distribution and rotation become ongoing manual work.
OPT: d
Register the application servers as managed nodes and give employees AWS Systems Manager Session Manager permissions so they can connect without a VPN.
WHY:
Session Manager provides a shell or port forward to individual managed nodes for operators; it is not a network path that lets a browser reach a fleet of private web applications, and it does not consume AD group membership.
A:
Use AWS Client VPN with Active Directory authentication, MFA and group-based authorization rules. Client VPN is the managed, OpenVPN-based endpoint for individual users: it authenticates against AWS Managed Microsoft AD or AD Connector, prompts for an MFA code once MFA is enabled on the directory, and its authorization rules grant a network CIDR only to a named AD or IdP group, with no access until a rule exists. Site-to-Site VPN connects an office network, not a person; a bastion reintroduces SSH keys and open ports; Session Manager gives shell access to managed nodes, not browser access to web applications.
USAGE:
Enable split-tunnel on the endpoint so only VPC-bound traffic crosses the VPN and employees' home browsing never lands on your data transfer bill.

## aws-artifact-audit-evidence-mcq-34 | d1
TOPIC: 1.3 Data security controls
QUALIFIER: FASTEST
Q:
An external auditor reviewing a company's payment platform asks for evidence that the AWS infrastructure it runs on has been independently assessed: specifically the current SOC 2 Type II report and the PCI DSS attestation of compliance for AWS itself. Which is the FASTEST way for the solutions architect to obtain these documents?
OPT: a *
Sign in to AWS Artifact, download the SOC 2 and PCI DSS reports from the reports section, and hand them to the auditor.
OPT: b
Enable the PCI DSS standard in AWS Security Hub and export the compliance summary for the auditor.
WHY:
Security Hub controls evaluate the company's own resources against PCI requirements; the output describes the customer's posture, not an independent audit of AWS infrastructure.
OPT: c
Deploy the Operational Best Practices for PCI DSS conformance pack in AWS Config and export its compliance report.
WHY:
A conformance pack is a bundle of Config rules that judges the customer's resources; it cannot produce AWS's own SOC or PCI attestation.
OPT: d
Open an AWS Support case asking AWS to send the SOC 2 and PCI DSS reports.
WHY:
Support would point back to AWS Artifact, where the reports are already available on demand, so a case only adds waiting time.
A:
Download the reports from AWS Artifact. Artifact is the self-service portal for AWS's own security and compliance documents, including SOC reports, PCI DSS attestations and ISO certifications, available at no charge to any signed-in account, and for accepting agreements such as the HIPAA BAA. The shared responsibility model is the trap: Security Hub standards, Config conformance packs and Trusted Advisor checks evaluate the customer's resources, and only Artifact carries the evidence about AWS.
USAGE:
Artifact documents are audit artifacts about AWS; bundle them with your own control evidence, because AWS's report says nothing about how you configured your workloads.

## aws-s3-access-points-multi-app-mcq-49 | d3
TOPIC: 1.3 Data security controls
QUALIFIER: LEAST operational overhead
Q:
A data platform team keeps a company-wide data lake in a single S3 bucket. More than 300 applications in different accounts each need read or write access to their own prefix, and some may only connect from inside their VPC. The bucket policy has grown past the 20 KB limit, and every new application requires a risky edit of that shared policy. Which solution scales access management with the LEAST operational overhead?
OPT: a *
Create one S3 Access Point per application with its own access point policy scoped to the application's prefix, set a VPC network origin where required, and replace the bucket policy with a statement that delegates access to access points owned by the account through the s3:DataAccessPointAccount condition key.
OPT: b
Split the data lake into one bucket per application and give each application a small bucket policy of its own.
WHY:
Hundreds of buckets fragment the single data lake, break cross-dataset queries and shared lifecycle rules, and trade one large policy for hundreds of buckets to govern.
OPT: c
Re-enable ACLs on the bucket and grant each application's account permissions on its objects with object ACLs.
WHY:
ACLs are the legacy mechanism, disabled by default under bucket-owner-enforced ownership; they apply per object, cannot express prefix or VPC conditions, and would have to be set on every new object.
OPT: d
Build a central service that generates presigned URLs for each application whenever an object is needed.
WHY:
Presigned URLs are temporary, per-object credentials minted by code, not an access-control model; the central service becomes a bottleneck and still needs its own permissions to every prefix.
A:
Use S3 Access Points, one per application, each carrying its own policy and network controls, with the bucket policy delegating to them. Access points are named network endpoints attached to a bucket; an access point policy applies only to requests made through that access point, can be restricted to a VPC origin, is limited to 20 KB like a bucket policy, and an account may create 10,000 access points per Region. Both the access point policy and the bucket must permit a request, which is why the recommended bucket policy allows all access points owned by the account and lets the per-application policies do the work. More buckets, ACLs and presigned URLs each move the problem instead of solving it.
USAGE:
Add an SCP that denies s3:CreateAccessPoint unless the network origin is VPC when the data lake must never be reachable from the internet.

## aws-review-sentiment-no-ml-team-mcq-44 | d1
TOPIC: 2.2 HA and fault tolerance
QUALIFIER: LEAST operational overhead
Q:
A retail company receives thousands of support tickets a day as free text. The support manager wants each ticket tagged as positive, negative, neutral or mixed and routed to a queue accordingly. The company has no data scientists and does not want to train or host any model. Which approach meets this requirement with the LEAST operational overhead?
OPT: a *
Call the Amazon Comprehend DetectSentiment API from the ticket ingestion pipeline and route each ticket on the returned sentiment.
OPT: b
Train a text classification model in Amazon SageMaker AI, deploy it to a real-time endpoint, and invoke the endpoint for each ticket.
WHY:
SageMaker AI means building, training and hosting a model that the company must then maintain, which is exactly the ML expertise and operational burden the stem rules out.
OPT: c
Send each ticket to Amazon Transcribe and use the transcript confidence scores to infer the customer's mood.
WHY:
Transcribe converts speech audio to text; the tickets are already text, and confidence scores measure recognition accuracy, not sentiment.
OPT: d
Run each ticket through Amazon Textract and classify the extracted key-value pairs.
WHY:
Textract extracts text, forms and tables from scanned documents and images; it does not classify sentiment, and the input here is already text rather than a document image.
A:
Use Amazon Comprehend's pre-trained sentiment detection. Comprehend is the NLP API that returns positive, negative, neutral or mixed sentiment, along with entities, key phrases, language and PII, with no training data required; if the company later wants its own categories it can train a custom classifier from labelled tickets without ML skills. The modality trap: Transcribe is speech to text, Textract is document extraction, Polly is text to speech, and SageMaker AI is for teams that build models themselves.
USAGE:
Push the nightly backlog through an asynchronous Comprehend job and keep the real-time API for tickets arriving during business hours.

## aws-streaming-kafka-compat-mcq-33 | d2
TOPIC: 3.5 Data ingestion and transformation
QUALIFIER: LEAST amount of change
Q:
A company runs Apache Kafka on premises with dozens of producer and consumer applications written against the Kafka client libraries. It is moving to AWS, cannot afford to modify those applications, and its throughput swings from a few MB/s at night to about 150 MB/s during campaigns, so nobody wants to size brokers. Which solution requires the LEAST amount of change?
OPT: a *
Create an Amazon MSK Serverless cluster, point the existing producers and consumers at its bootstrap servers, and let it scale throughput and partitions automatically.
OPT: b
Replace the Kafka topics with Amazon Kinesis Data Streams and have the applications read and write through the Kinesis Client Library and Kinesis Producer Library.
WHY:
Kinesis Data Streams uses its own API, KPL and KCL rather than the Kafka protocol, so every producer and consumer must be rewritten, which violates the no-modification requirement.
OPT: c
Send the data to Amazon Data Firehose and configure delivery to Amazon S3 for the consuming applications to read.
WHY:
Firehose is a delivery service to destinations such as S3, Redshift or OpenSearch; it is not a broker, has no consumer groups, and the applications would still need new code to write to it and to read from S3.
OPT: d
Migrate the brokers to Amazon MQ so the applications keep using a managed message broker.
WHY:
Amazon MQ manages ActiveMQ and RabbitMQ over protocols such as JMS, AMQP, MQTT, STOMP and WebSocket; it does not speak the Kafka protocol, so the Kafka clients cannot connect unchanged.
A:
Use Amazon MSK Serverless. It is fully compatible with Apache Kafka, so existing clients connect unchanged, and it provisions and scales capacity and partitions automatically with throughput-based pricing, which removes broker sizing. Its per-cluster quotas of 200 MBps ingress and 400 MBps egress (5 MBps in and 10 MBps out per partition) are the check against the stated peak, and it requires IAM access control instead of Kafka ACLs, the one client configuration change to plan for. Kinesis, Firehose and Amazon MQ all replace the protocol and force rewrites, and self-managed Kafka on EC2 keeps the operational burden of sizing and patching brokers.
USAGE:
When the stem says "Kafka clients" and "no code change", answer MSK; add "serverless" when it also says unpredictable throughput.
