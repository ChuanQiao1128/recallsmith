# deck: aws-saa-c03
## aws-iam-roles-vs-users | d1
TOPIC: 1.1 Secure access
Q:
An EC2 application needs to read from S3. A reviewer asks whether it should use an IAM user's access keys or a role, and what the rest of the account's IAM setup should look like. What do you answer?
A:
Attach a role to the instance profile. IAM is global and free; its objects are users (long-term passwords or keys, avoid wherever a role can work), groups (attach policies to many users at once), roles (assumed by services, federated people or other accounts, always temporary credentials) and policies (identity-based, resource-based, permissions boundaries, SCPs, session policies). Every request starts as an implicit deny, an explicit deny beats any allow, and tag conditions such as aws:PrincipalTag give you ABAC. The rest of the checklist: MFA and no access keys on the root user, humans through Identity Center, least privilege with conditions, rotate any long-term keys left, CloudTrail on everywhere. Any option that puts long-lived access keys on a server is wrong.
USAGE:
Give every function or task its own role scoped to the tables and buckets it touches; a shared role is the first thing an auditor flags.
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
## aws-iam-policy-evaluation-explicit-deny | d2
TOPIC: 1.1 Secure access
Q:
A developer's role has AdministratorAccess, but an SCP on the account denies s3:DeleteBucket. Can the developer delete a bucket, which policy types took part in the decision, and which of them can actually grant anything?
A:
No. Six types matter: identity-based (what can this principal do), resource-based (who can touch this resource; cross-account access without a role, and in the same account sufficient on its own), permissions boundary (cap on one user or role), SCP (cap on a whole member account), session policy (cap on one AssumeRole session) and ACLs (legacy S3 cross-account grants). Only the first two grant; boundaries, SCPs and session policies only shrink. Evaluation starts as implicit deny, any explicit deny in any layer ends the request as denied, then an allow must exist in every cap that applies and in an identity or resource policy. The trap is believing AdministratorAccess cancels a Deny; nothing overrides an explicit Deny.
USAGE:
When debugging an unexpected AccessDenied, search every policy layer for a matching Deny before adding Allow statements, because extra permissions can never fix an explicit deny.
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
## aws-guardduty-inspector-macie-detective | d1
TOPIC: 1.2 Secure workloads
Q:
Which service do you pick to find a leaked access key being used from an unusual country, an unpatched CVE in a container image, credit card numbers in a bucket, and the root cause after an alert?
A:
Match the verb. GuardDuty detects threats with no agents: it ingests CloudTrail management events, VPC Flow Logs and DNS logs, adds optional protection plans (S3, EKS, RDS login, Lambda, malware, runtime), is enabled organization-wide from a delegated administrator, and sends findings to EventBridge, so the leaked key is GuardDuty. Inspector manages vulnerabilities: it continuously rescans EC2 through the SSM Agent, ECR images and Lambda functions for CVEs and network reachability, so the CVE is Inspector. Macie is S3 only: it inventories buckets, flags public or unencrypted ones, and runs discovery jobs with managed and custom data identifiers, so the card numbers are Macie. Detective investigates after the alert, building a behavior graph from CloudTrail, flow logs and GuardDuty findings.
USAGE:
Route GuardDuty and Inspector findings through EventBridge to a ticket queue or chat channel, because findings nobody reads are the same as no detection.
## aws-direct-connect-encryption | d2
TOPIC: 1.2 Secure workloads
Q:
A regulated workload must encrypt everything crossing its Direct Connect link and reach VPCs in two Regions. What does Direct Connect give you on its own, and what do you add?
A:
A private physical link, not an encrypted one: dedicated ports of 1, 10, 100 or 400 Gbps from AWS, or hosted connections of 50 Mbps to 25 Gbps from a partner, provisioned over weeks. A private VIF reaches one VPC or, through a Direct Connect gateway, VPCs in many Regions and accounts; a transit VIF reaches transit gateways; a public VIF reaches public endpoints such as S3. To encrypt, run a Site-to-Site VPN over the link, or use MACsec, which only dedicated 10, 100 and 400 Gbps ports at selected locations support, never hosted connections, and only to the Direct Connect location. Resilience needs a second connection elsewhere or a VPN backup; a lone private VIF is the distractor.
USAGE:
Assume the DX circuit is a shared-carrier link: run a VPN over it from day one, or budget for MACsec ports, rather than retrofitting when the auditor asks.
## aws-waf-vs-shield | d1
TOPIC: 1.2 Secure workloads
Q:
An Application Load Balancer fronting a public API receives SQL injection payloads while a SYN flood hits the network layer, and finance asks what each protection costs. Which service handles each, and when is Shield Advanced worth it?
A:
WAF is layer 7: a web ACL of AWS managed rule groups (SQLi, XSS, bot control), custom geo, header and IP-set rules, and rate-based rules, attached to CloudFront, ALB, API Gateway REST, AppSync, Cognito user pools, App Runner and Amplify, never to an NLB or EC2, billed $5 per web ACL, $1 per rule and $0.60 per million requests. Shield Standard is free and always on for layer 3 and 4 floods. Shield Advanced costs $3,000 a month with a one-year commitment: Shield Response Team, DDoS cost protection credits, WAF at no extra charge on protected resources, health-based detection; pick it only when the stem names those. The trap: WAF for a volumetric flood, Shield for an injection payload.
USAGE:
Deploy a new WAF rule with the Count action first so you can confirm what it would match before switching it to Block.
## aws-secrets-manager-vs-parameter-store | d2
TOPIC: 1.2 Secure workloads
Q:
An RDS master password must rotate on a schedule with no custom code, the free Parameter Store SecureString is proposed, and a reviewer finds an access key in EC2 user data. Which store fits, and how should the app hold credentials at all?
A:
Secrets Manager whenever rotation is required: managed rotation for RDS, Aurora, DocumentDB and Redshift, Lambda rotation for anything else, cross-account access through a resource policy, about $0.40 per secret per month plus $0.05 per 10,000 calls. Parameter Store SecureString is KMS-encrypted and free in the standard tier, so it wins for plain configuration, but has no rotation. Neither store is where AWS credentials belong: compute gets a role, delivered by IMDSv2 on EC2 (session token from a PUT, hop limit 1), a task role on ECS and an execution role on Lambda, and the SDK picks them up. Keys in user data, an AMI, a repo or an env file are the anti-pattern; fetch third-party secrets at runtime.
USAGE:
When sharing a secret across accounts, encrypt it with a customer managed KMS key and grant the other account in the key policy, because the AWS managed key aws/secretsmanager cannot be used for cross-account access.
## aws-alb-authentication-cognito-oidc | d2
TOPIC: 1.2 Secure workloads
Q:
A web app behind an Application Load Balancer must require single sign-on before requests reach the EC2 targets, admins want shell access, and reports must be downloadable without a public bucket. What do you configure at each access surface?
A:
Users: an authenticate-cognito or authenticate-oidc action on the HTTPS listener rule; the ALB redirects to the IdP, exchanges the code, sets a session cookie and forwards claims in the signed x-amzn-oidc-data header, which targets must verify (an internal ALB needs a NAT gateway to reach the IdP). Admins: Session Manager instead of SSH keys and bastions. Objects: S3 presigned URLs or CloudFront signed URLs with OAC on a private bucket, never a public bucket. Service to service: IAM roles plus VPC endpoints rather than public endpoints. Classify the scenario first (user, admin, object, service), then pick the service. The distractor is a Lambda or Cognito authorizer, which belongs to API Gateway; on an ALB, authentication lives on the listener rule.
USAGE:
Check that the signer field in the x-amzn-oidc-data JWT matches your ALB ARN before trusting any claim, and restrict the target security group to the ALB so nobody can inject those headers directly.
## aws-vpc-security-group-vs-nacl | d2
TOPIC: 1.2 Secure workloads
Q:
A team attaches a custom network ACL allowing inbound HTTPS to a subnet and its instances stop responding; they also need to block one abusive IP address for the whole subnet. What went wrong, and how do NACLs differ from security groups?
A:
A security group sits on the network interface, is stateful, has allow rules only, and the reply to allowed traffic returns automatically. A network ACL sits on the subnet, is stateless, and evaluates numbered allow and deny rules from the lowest number, first match wins, with an implicit deny at the asterisk rule; the default NACL allows everything, a custom one denies everything until you add rules. The team's NACL lets requests in but has no outbound rule for the ephemeral ports 1024-65535 that replies use, so responses die: return traffic must be allowed both ways. Blocking one IP is the NACL's real job: a low-numbered deny rule a security group cannot express. Security groups stay the primary control.
USAGE:
Reach for a NACL deny only to block a known bad CIDR; every other rule belongs in a security group referencing another group.
## aws-vpc-private-subnet-nat | d1
TOPIC: 1.2 Secure workloads
Q:
An application in a private subnet must call a third-party HTTPS API, and a colleague wants to move the RDS instance into the public subnet to make it reachable. Why has the app no internet path, what do you add, and where does each tier belong?
A:
A subnet is public only because its route table sends 0.0.0.0/0 to an internet gateway and its instances carry public IPs; the app's private subnet has neither, so outbound traffic has nowhere to go. Add a NAT gateway in a public subnet and a 0.0.0.0/0 route to it from the private subnet: outbound connections work, inbound stays blocked. The third tier is isolated: no internet route at all. The standard layout puts load balancers, NAT gateways and bastions in public subnets, application servers in private subnets, databases in isolated subnets, each tier repeated per Availability Zone. RDS and Lambda never need a public subnet; a database reachable from the internet is the trap, not a feature.
USAGE:
Databases and workers live in private subnets; only the load balancer and NAT need a public subnet.
## aws-vpc-peering-vs-transit-gateway | d2
TOPIC: 1.2 Secure workloads
Q:
You peer VPC A with B and B with C, then discover A cannot reach C; a second team cannot reach on-premises hosts at all. Why, which route table rules explain both, and when do you replace peering with a Transit Gateway?
A:
Every subnet uses one route table (the main table unless you associate another); the local route cannot be removed; the most specific prefix wins; static routes beat propagated ones with the same destination. A 0.0.0.0/0 route to an internet gateway makes the subnet public, to a NAT gateway private with egress; a virtual private gateway or transit gateway route reaches on-premises, and virtual private gateway routes can propagate, so unreachable usually means a missing route. Peering is one-to-one and never transitive: A reaches only directly peered VPCs, CIDRs must not overlap, and each side needs routes. A Transit Gateway is a Regional hub with its own route tables; move to it once the mesh outgrows a few VPCs.
USAGE:
Plan non-overlapping CIDR ranges across accounts from day one, because peering refuses overlapping VPCs and a transit gateway cannot route sensibly between them.
## aws-cloudtrail-vs-config-vs-cloudwatch | d1
TOPIC: 1.3 Data security controls
Q:
A security group changed last week; the auditor asks who changed it, what its rules were each day since, whether any group now allows 0.0.0.0/0 on port 22, and wants a tamper-evident record across 40 accounts. Which service answers each?
A:
CloudTrail answers who: management events are recorded automatically and kept 90 days in Event history at no charge; a trail delivers them to S3 (one copy free), log file validation signs digest files so tampering is detectable, and an organization trail from the management account covers every account in one locked-down bucket. Data events (S3 object reads, Lambda invokes) and Insights cost extra and are off by default; CloudTrail Lake keeps queryable events for up to ten years. AWS Config answers what it looked like: configuration items over time and rules that flag the open port 22. CloudWatch answers how it performs: metrics, logs, alarms. The distractor is expecting CloudTrail to show configuration history or Config to name the caller.
USAGE:
Send the trail to CloudWatch Logs and put a metric filter on root account use or security group changes; that one pipeline joins the audit trail to real-time alerting.
## aws-kms-key-rotation-and-multi-region | d2
TOPIC: 1.3 Data security controls
Q:
Compliance demands yearly rotation, the DR plan decrypts backups in a second Region, and a new team asks which KMS key type to create, who controls access to it and what it costs. What do you tell them?
A:
KMS is Regional. Three ownership types: AWS owned (free, invisible, no policy), AWS managed aws/service (no monthly fee, rotated yearly, policy not editable, not shareable across accounts) and customer managed ($1 per key per month plus $0.03 per 10,000 requests, your key policy, optional rotation, cross-account use). Keys are symmetric by default or asymmetric/HMAC; Encrypt takes 4,096 bytes at most, so larger data needs envelope encryption. The key policy comes first and must delegate to IAM before IAM policies can allow; grants give services temporary access. Customer managed rotation defaults to 365 days and keeps old material, never re-encrypting. Deletion waits 7 to 30 days. Multi-Region keys share material so ciphertext decrypts in the replica Region; single-Region keys cannot convert.
USAGE:
Rotation never re-encrypts existing data or data keys, so a leaked data key is not fixed by rotating the KMS key; re-encrypt the data instead.
## aws-iam-access-analyzer-credential-report | d2
TOPIC: 1.3 Data security controls
Q:
An auditor asks which buckets, keys or roles outsiders can reach, which IAM users lack MFA or hold stale keys, and how you prove who read a confidential object and that only the right classification could. Which tools answer each?
A:
Access Analyzer answers the first: an external access analyzer takes the account or organization as its zone of trust and raises a finding for every resource a principal outside it can reach. The credential report answers the second: a CSV with password_enabled, mfa_active and access_key_1_last_rotated per user. Governance is prevent, detect, prove: S3 Block Public Access (all four settings, ideally at account or organization level) prevents exposure, Access Analyzer detects it, CloudTrail data events log object-level reads for the proof, ABAC policies on classification tags such as aws:ResourceTag scope who may touch which class, Macie discovers where sensitive data sits, and Lake Formation centralizes table and column grants for analytics. None of them replaces CloudTrail for what actually happened.
USAGE:
External access findings are per Region, so create an external access analyzer in every Region where you hold resources.
## aws-backup-service | d2
TOPIC: 1.3 Data security controls
Q:
A team scripts EBS, RDS and DynamoDB backups separately and cannot prove retention; the same team lost a table to an accidental delete last month. Which service replaces the scripts, and how do you match each recovery need to a mechanism?
A:
AWS Backup: a plan sets schedule and retention, resources join by tag, recovery points sit in vaults, copyable to another Region or account, and Organizations pushes one policy everywhere. Match need to mechanism: accidental overwrite or delete is S3 Versioning or point-in-time recovery, which RDS and DynamoDB keep for at most 35 days; an image of one moment is a snapshot; loss of a Region is a cross-Region copy; "even an administrator cannot delete" means Backup Vault Lock in compliance mode, immutable once its grace time of at least 72 hours ends, or compliance-mode S3 Object Lock, which root cannot undo at all. Backup frequency sets your RPO; AWS Backup does not govern snapshots taken elsewhere.
USAGE:
Check every recovery point's retention before locking a vault in compliance mode, because anything retained indefinitely becomes permanent and billed forever.
## aws-s3-object-lock-worm | d2
TOPIC: 1.3 Data security controls
Q:
Financial records must be undeletable for seven years, even by root, application logs must vanish after 90 days, and PII must be findable and locked down separately. Which Object Lock mode do you choose, and what sets the other two controls?
A:
Enable Object Lock on the bucket (it turns on Versioning) and apply a retention period in compliance mode: nobody, root included, can delete or shorten it before the retain-until date, and the only exit is closing the account. Governance mode is the distractor: a principal with the governance override permission can lift it, and a legal hold is a separate no-expiry lock. Retention floors come from Object Lock or Glacier Vault Lock; retention ceilings come from lifecycle expiration rules and CloudWatch Logs retention, which defaults to never expire and runs from 1 to 3,653 days. Classification is tags plus Macie discovery, then ABAC policies and a separate KMS key per class so PII has its own audit trail and revocation.
USAGE:
Trial the retention settings in governance mode on a test bucket first, because a compliance-mode retention period applied to the wrong prefix cannot be undone.
## aws-kms-envelope-encryption | d2
TOPIC: 1.3 Data security controls
Q:
An app must encrypt 50 MB uploads under a key the security team can audit and revoke; a regulator asks how data is protected in transit and whether a dedicated HSM is needed. How does KMS handle the object, and what do you pick for each half?
A:
Envelope encryption: GenerateDataKey returns a data key in plaintext and encrypted under the KMS key; the app encrypts the object locally, stores the wrapped key beside it, discards the plaintext copy, and later sends the wrapped key to Decrypt. KMS never sees the data, the 4,096-byte Encrypt limit does not apply, and S3 SSE-KMS does exactly this. Key type decides control: AWS owned is free and invisible, AWS managed rotates yearly with no editable policy, customer managed gives your own key policy, rotation and cross-account use, so audit and revoke means customer managed; CloudHSM is for single-tenant FIPS 140-3 Level 3 custody. In transit: ACM certificates on ALB, CloudFront and API Gateway, TLS to RDS, VPN or MACsec on links.
USAGE:
Use the AWS Encryption SDK or S3 SSE-KMS and you get envelope encryption for free; only code that calls kms:Encrypt on payloads over 4 KB is doing it wrong.
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
## aws-api-gateway-caching-and-throttling | d2
TOPIC: 2.1 Loosely coupled architectures
Q:
A REST API backed by Lambda returns the same catalogue to thousands of clients, a few clients hammer it, the team wants v2 on 5 percent of traffic under api.example.com, and someone asks whether an ALB would do. Where does each feature live?
A:
Caching is per stage on REST APIs: repeated GETs are served for the TTL, 300 seconds default, 3,600 maximum. Per-client limits need a usage plan tying an API key to a stage with rate, burst and quota; a key alone throttles nothing, and the account default is 10,000 requests per second with a 5,000 burst per Region. Stages map to environments and carry stage variables; a canary release on the stage sends a chosen percentage to the new deployment until promoted. A custom domain needs an ACM certificate in the API's Region, or in us-east-1 when edge-optimized. Integration timeout defaults to 29 seconds. An ALB or Lambda function URL suffices when you need no metering, caching or auth transformation.
USAGE:
Never use API keys as your authentication mechanism; pair a usage plan with IAM, Cognito or a Lambda authorizer, and treat plan quotas as best effort targets rather than hard cost controls.
## aws-global-accelerator-vs-cloudfront | d2
TOPIC: 2.1 Loosely coupled architectures
Q:
A game uses a custom UDP protocol and partners must allow-list fixed IPs; the company's web shop wants its origin fleet to stop scaling for reads; a third team hopes an edge service will fix slow checkout writes. Which accelerator fits each?
A:
The game is Global Accelerator: two static anycast IPv4 addresses for the accelerator's lifetime, TCP and UDP listeners, traffic on the AWS backbone to the nearest healthy ALB, NLB, EC2 or Elastic IP, instant failover, no cache. CloudFront cannot carry UDP. The shop is CloudFront: it caches HTTP(S) responses at more than 750 points of presence and terminates TCP and TLS near the viewer, so cache hits never reach the origin, the fleet scales for misses only, and data-transfer cost drops; even uncached dynamic pages gain from the shorter handshake. The checkout is neither: a write path bottlenecked on the database is not accelerated by any edge service, and a fixed-IP or non-HTTP need is not solved by a CDN.
USAGE:
Deleting an accelerator releases its static IPs permanently, so restrict delete permissions with IAM and disable rather than delete when pausing a service.
## aws-sqs-sns-eventbridge-choice | d2
TOPIC: 2.1 Loosely coupled architectures
Q:
An order service publishes events that a billing worker, a fraud checker and an analytics pipeline each consume, and last week a duplicate event double-charged a customer. When do you pick SQS, SNS or EventBridge, and what must every consumer do?
A:
Sources emit events: S3 notifications, DynamoDB Streams, AWS services and SaaS through EventBridge, or an application calling PutEvents. A router fans them out: SQS is a queue one consumer group drains with buffering and retries; SNS pushes one message to many subscribers with no buffer; EventBridge is a bus whose rules route by event content, with schema registry and archive/replay. Consumers (Lambda, SQS, Step Functions) must be idempotent, because delivery is at least once and ordering is not guaranteed, which double-charged the customer. Producers never wait for consumers, so spikes are absorbed. EventBridge retries a target up to 24 hours and 185 attempts, then drops the event unless a dead-letter queue exists; archive replay recovers a bad deploy.
USAGE:
Put one SQS job between an API that must answer in under a second and a worker that takes minutes; SNS when several teams need the same event; EventBridge when routing depends on the event body.
