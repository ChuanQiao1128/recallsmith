# deck: aws-saa-c03

## aws-s3-storage-classes | d1
Q:
An application writes logs to S3 that are read often for 30 days and almost never afterwards, but must be kept for 7 years. Which storage classes and mechanism fit?
A:
Keep the first 30 days in S3 Standard, then use a lifecycle rule to transition objects to S3 Glacier Flexible Retrieval or Deep Archive for the retention period, and expire them after 7 years. Lifecycle rules run automatically; you do not write code or move objects yourself. Use Intelligent-Tiering instead only when the access pattern is unknown.
USAGE:
DeveloperCards keeps immutable content builds in S3 for a year; a lifecycle rule is the cheap way to age them out.

## aws-s3-cloudfront-oac | d2
Q:
You serve a static site from S3 through CloudFront. Why keep the bucket private and use Origin Access Control instead of making the bucket public?
A:
With Origin Access Control the bucket policy grants read access only to the CloudFront distribution's service principal, so every request must come through CloudFront: the edge cache, HTTPS, WAF and logging all apply, and nobody can bypass them with a direct S3 URL. A public bucket leaks the origin and lets clients skip the CDN. OAC replaced the older Origin Access Identity and supports SSE-KMS objects.
USAGE:
The DeveloperCards React console is deployed exactly this way: private S3 bucket, CloudFront with OAC, SPA fallback of 403 and 404 to index.html.

## aws-iam-roles-vs-users | d1
Q:
An EC2 application needs to read from S3. Should it use an IAM user's access keys or an IAM role, and why?
A:
Attach an IAM role to the instance profile. The instance receives short-lived credentials from the metadata service that rotate automatically, nothing is stored on disk, and the permissions live in a policy you can scope to the one bucket. Long-lived access keys on an instance are the most common credential leak on AWS.
USAGE:
Every Lambda in DeveloperCards runs under its own execution role scoped to the tables and buckets it touches.

## aws-lambda-cold-start-init | d2
Q:
What happens during a Lambda cold start, and what work belongs in the INIT phase to shorten it?
A:
A cold start creates a new execution environment: the code is downloaded, the runtime starts, static initialisers run, then the handler is invoked. Anything outside the handler runs once per environment and is reused by warm invocations, so expensive setup such as opening a database connection belongs there. Provisioned Concurrency removes cold starts entirely at a cost; SnapStart does it for Java by snapshotting the initialised environment.
CODE: csharp
// Created once per environment, reused by every warm invocation
private static readonly NpgsqlDataSource Db = NpgsqlDataSource.Create(ConnString);
USAGE:
Moving the PostgreSQL connect into INIT cut the DeveloperCards ingest Lambda cold start from 9.2 s to 3.7 s.

## aws-sqs-visibility-timeout-dlq | d3
Q:
A consumer reads a message from SQS, crashes halfway, and the same message is processed again by another worker. What controls this, and how do you stop a poison message looping forever?
A:
SQS hides a received message for the visibility timeout; if the consumer does not delete it before the timeout, it becomes visible again and is redelivered, so consumers must be idempotent. A redrive policy with maxReceiveCount moves a message that has been received too many times to a dead-letter queue, where it can be inspected and replayed instead of blocking the queue. Set the visibility timeout longer than the worst-case processing time, or extend it from the consumer.
USAGE:
At Dovetale the video pipeline used a DLQ with reprocessing so failed uploads were caught early instead of triggering costly downstream ML jobs.

## aws-sqs-sns-eventbridge-choice | d2
Q:
When do you pick SQS, SNS, or EventBridge to connect services?
A:
SQS is a queue: one consumer group pulls each message, work is buffered and retried, order is best-effort unless you use a FIFO queue. SNS is push fan-out: one publish delivers to many subscribers such as queues, Lambdas, email or HTTP, with no buffering for the subscriber. EventBridge is an event bus with content-based routing rules, schema registry and integrations with SaaS and AWS service events; choose it when many producers and consumers need routing by event content.
USAGE:
The DeveloperCards publish pipeline puts one job on SQS so the API responds in under a second and a Lambda worker builds the content package behind the queue.

## aws-rds-multi-az-vs-read-replica | d2
Q:
What is the difference between RDS Multi-AZ and a read replica, and which one improves availability?
A:
Multi-AZ keeps a synchronous standby copy in another Availability Zone and fails over to it automatically on instance or AZ failure; it is for availability and durability, and the standby serves no reads. A read replica is an asynchronous copy you can query, in the same Region or another, and it exists to scale reads or to serve a distant Region; promoting it is a manual disaster-recovery step. Multi-AZ answers "keep running", read replicas answer "handle more reads".
USAGE:
DeveloperCards runs one PostgreSQL instance in a VPC; Multi-AZ is the first switch to flip if uptime ever matters more than cost.

## aws-vpc-private-subnet-nat | d2
Q:
An application in a private subnet must call a third-party HTTPS API. Why can it not reach the internet, and what do you add?
A:
A private subnet's route table has no route to an Internet Gateway and its instances have no public IP, so outbound traffic has nowhere to go. Add a NAT Gateway in a public subnet and a route 0.0.0.0/0 to it from the private subnet; NAT allows outbound connections while still blocking inbound ones. For AWS services such as S3 or DynamoDB, use a VPC endpoint instead so traffic never leaves the AWS network and you avoid NAT data charges.
USAGE:
The DeveloperCards backend keeps PostgreSQL in a private subnet; Lambda reaches it through VPC networking, not through the internet.

## aws-vpc-security-group-vs-nacl | d1
Q:
What is the difference between a security group and a network ACL?
A:
A security group is attached to a network interface, is stateful, and only has allow rules: if inbound traffic is allowed, the reply is allowed automatically. A network ACL is attached to a subnet, is stateless, evaluates numbered allow and deny rules in order, and needs explicit rules in both directions including ephemeral ports. Use security groups for almost everything and network ACLs for coarse subnet-level blocking.

## aws-ec2-purchase-options | d2
Q:
A web tier runs steadily all year, and a nightly batch job can be interrupted and restarted. Which purchase options minimise cost?
A:
Cover the steady baseline with a Savings Plan or Reserved Instances, which discount committed usage over one or three years, and run the interruptible batch on Spot Instances, which are spare capacity at a large discount that AWS can reclaim with a two-minute warning. On-Demand is for unpredictable or short workloads. Never put a stateful single instance on Spot without a way to resume.

## aws-ebs-vs-efs-vs-instance-store | d1
Q:
When do you choose EBS, EFS, or instance store for EC2 storage?
A:
EBS is a network-attached block volume for one instance at a time in one Availability Zone, persistent and snapshot-able, the default for boot and database volumes. EFS is a managed NFS file system that many instances across AZs can mount at once, for shared files. Instance store is disk physically attached to the host, the fastest option, but its data is lost when the instance stops or fails, so it suits caches and scratch space only.

## aws-alb-vs-nlb | d1
Q:
When do you use an Application Load Balancer versus a Network Load Balancer?
A:
An ALB works at layer 7: it routes HTTP and HTTPS by host, path or header, terminates TLS, and integrates with WAF and Cognito, so it fronts web applications and microservices. An NLB works at layer 4: it forwards TCP and UDP at very high throughput with a static IP per AZ and ultra-low latency, so it fronts non-HTTP protocols, gaming, or anything that needs a fixed IP for allow-listing.

## aws-dynamodb-capacity-and-keys | d2
Q:
A new table has unpredictable traffic. Which DynamoDB capacity mode do you start with, and what makes a good partition key?
A:
Start with on-demand capacity: you pay per request and never throttle on a spike, then switch to provisioned capacity with auto scaling once the traffic pattern is known and steady, because provisioned is cheaper at sustained load. A good partition key has many distinct values with evenly spread access, such as a user id, so no single partition becomes hot; a date or status column is a bad partition key because most writes land in one partition.

## aws-kms-envelope-encryption | d3
Q:
How does envelope encryption work with KMS, and why not encrypt the data directly with the KMS key?
A:
KMS generates a data key, returns it in plaintext and encrypted under the customer managed key; the service encrypts the object locally with the plaintext data key, stores the encrypted data key alongside the object, and discards the plaintext copy. To decrypt, it sends the encrypted data key to KMS, gets the plaintext key back, and decrypts locally. KMS never sees the data and never exports the master key, and encrypting large objects locally avoids the KMS request size limit and per-request cost. SSE-KMS on S3 does exactly this per object.

## aws-cloudwatch-alarm-vs-eventbridge-rule | d2
Q:
You want to be paged when a Lambda's error rate exceeds 5%, and separately to run a job when an EC2 instance changes state. Which service handles each?
A:
The error rate is a metric threshold, so use a CloudWatch alarm on the Errors and Invocations metrics with a math expression, and send the alarm to an SNS topic that pages you. The instance state change is an event, so use an EventBridge rule matching the EC2 instance state-change event and target a Lambda or Step Functions workflow. Alarms watch metrics over time; EventBridge rules react to discrete events.
USAGE:
DeveloperCards emits CloudWatch EMF metrics from the ingest Lambda; the next step is an alarm on the error metric wired to SNS.

## aws-iam-policy-evaluation-explicit-deny | d2
Q:
A developer's role has AdministratorAccess, but an SCP on the account denies s3:DeleteBucket. Can the developer delete a bucket, and what order does AWS follow to decide any request?
A:
No. Every request starts as an implicit deny, with only the root user exempt, and AWS first scans every applicable policy for an explicit Deny; one match ends the evaluation as Deny. It then looks for an Allow in order: Organizations RCPs, SCPs, the resource-based policy, the identity-based policy, the permissions boundary and any session policy. No Allow in RCPs, SCPs, the identity policy, the boundary or the session policy means Deny, but the resource-based stage has no such exit: for some principals an Allow there decides the request by itself, so within one account either policy type alone is normally enough. The trap is believing AdministratorAccess cancels a Deny; no Allow overrides an explicit Deny.
USAGE:
When debugging an unexpected AccessDenied, search every policy layer for a matching Deny before adding Allow statements, because extra permissions can never fix an explicit deny.

## aws-iam-permissions-boundary | d3
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
Q:
A SaaS vendor needs read access to CloudWatch metrics in your account. Why do you create a role instead of an IAM user with access keys, and what does the external ID add?
A:
Create a role whose trust policy names the vendor's AWS account as Principal, attach a least-privilege permissions policy, and hand over only the role ARN. The vendor calls sts:AssumeRole and receives temporary credentials that expire, so no long-lived secret leaves your account and you can withdraw access by changing the trust policy. Sharing an IAM user's access keys is the distractor: they never expire on their own. The external ID, a value generated by the vendor and checked by an sts:ExternalId condition in the trust policy, prevents the confused deputy problem where the vendor is tricked into using your role for another customer. AWS does not treat it as a secret.
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
Q:
An SCP on a member account's OU allows only ec2:* and s3:*, and a user in that account has no IAM policies attached. What can the user do, and would the same SCP restrict the management account?
A:
Nothing. An SCP never grants permissions; it is a guardrail that sets the maximum permissions available to IAM users and roles in member accounts, and effective permissions are the intersection of the SCP with the identity-based and resource-based policies, so someone still has to attach an IAM policy that allows the action. The SCP does bind the member account's root user, which is why it is the answer when a question asks how to stop even administrators from using a service or Region. It does not apply to the management account, to service-linked roles, or to principals outside the organisation who are granted access by a resource-based policy. The distractor is any option that treats an SCP as granting access.
USAGE:
Test a new SCP on an OU holding a single sandbox account before attaching it near the root, since one typo can lock every member account out of a service at once.

## aws-iam-identity-center | d1
Q:
A company with dozens of AWS accounts in one organisation wants staff to sign in once with their corporate Okta credentials and get role-based access in each account. Which service do you choose, and why not IAM users?
A:
AWS IAM Identity Center. You deploy an organisation instance in the management account, connect Okta or another external identity provider over SAML 2.0 with SCIM provisioning (or use the built-in directory or Active Directory), and define permission sets. A permission set is a template of IAM policies; when you assign it to a user or group for an account, Identity Center creates a matching IAM role in that account, and users assume it from the AWS access portal with short-lived credentials. IAM users are the distractor: they are per account, carry long-term passwords and access keys, and would have to be duplicated everywhere. AWS best practice is federation with temporary credentials for human users.
USAGE:
Assign a least-privilege permission set alongside the administrative one and choose the smaller role in the access portal for day-to-day work.

## aws-s3-bucket-policy-vs-iam-policy | d2
Q:
A Lambda role in account B must read objects from a bucket owned by account A. Which policy must account A write, and is an identity policy on the role still needed?
A:
Account A must attach a bucket policy, a resource-based policy, naming the role's ARN as Principal and allowing s3:GetObject on the objects, because an identity-based policy in account A cannot grant to a principal it does not own. The role in account B also needs an identity policy allowing s3:GetObject on the object ARN, arn:aws:s3:::bucket/*, not the bucket ARN, because s3:GetObject is an object operation and a cross-account request must be allowed in both accounts. Within one account either policy type alone is enough. Keep Object Ownership on bucket owner enforced so ACLs are disabled and account A owns every object. The distractor is an object ACL, or an IAM policy in account A naming account B's role.
USAGE:
If a cross-account read still fails after the bucket policy looks right, check whether the objects use SSE-KMS, because the key policy must also allow the other account and the AWS managed key cannot be shared.

## aws-s3-block-public-access | d1
Q:
A team adds a bucket policy with Principal "*" to serve images publicly, but S3 rejects the PutBucketPolicy call. What is blocking it, and how do account-level and bucket-level settings interact?
A:
S3 Block Public Access. Every new bucket has all four settings on, and BlockPublicPolicy rejects any bucket policy that S3 classifies as public, while BlockPublicAcls and IgnorePublicAcls neutralise public ACLs and RestrictPublicBuckets cuts off cross-account access to a bucket whose policy is public. The settings exist at account level and bucket level, and S3 applies the most restrictive combination, so turning them off on one bucket achieves nothing while the account-level block stays on. The feature overrides policies and ACLs without editing them, so switching it off makes an existing public policy live again. The distractor is rewriting the policy when the block is the real cause; for public content prefer CloudFront in front of a private bucket.
USAGE:
When a static website served straight from S3 returns 403 on every object, check Block Public Access at both the bucket and the account before touching the policy.

## aws-s3-object-lock-worm | d2
Q:
Financial records must be impossible to delete for seven years, even by an administrator or the root user. Which Object Lock configuration do you choose, and what does governance mode permit instead?
A:
Enable Object Lock on the bucket, which requires and turns on S3 Versioning, then apply a retention period in compliance mode. A compliance-mode version cannot be overwritten or deleted by anyone, including root, and its retention period cannot be shortened or its mode changed before the retain-until date; the only way out is deleting the AWS account. Governance mode is the distractor: it blocks most users, but a principal with s3:BypassGovernanceRetention who sends the bypass header can delete the object or loosen the lock, which suits testing rather than regulation. A legal hold is a separate lock with no expiry that anyone holding s3:PutObjectLegalHold can add or remove, independent of any retention period. Locks apply per object version.
USAGE:
Trial the retention settings in governance mode on a test bucket first, because a compliance-mode retention period applied to the wrong prefix cannot be undone.

## aws-s3-encryption-options-sse | d2
Q:
Auditors require proof of which principal decrypted each object and the ability to revoke a key for one dataset. Which S3 server-side encryption option satisfies this, and what cost issue follows?
A:
SSE-KMS with a customer managed key. SSE-S3 is the default and encrypts every new object with keys S3 manages, but it gives no key policy, no key lifecycle control and no CloudTrail record of key use, so it fails the audit. With SSE-KMS every upload and download calls KMS for GenerateDataKey or Decrypt, which is billed and counts against the KMS request quota; enable an S3 Bucket Key so S3 derives data keys from a bucket-level key and reduces KMS traffic. DSSE-KMS adds a second encryption layer for regulations demanding it and cannot use Bucket Keys. SSE-C means you send your own key on every request and S3 never stores it, so losing the key loses the object.
USAGE:
Keep buckets that receive S3 server access logs on SSE-S3, because switching the destination to SSE-KMS can produce log objects encrypted with a key you cannot read.

## aws-s3-presigned-urls | d1
Q:
A mobile app must let users upload photos to a private S3 bucket without AWS credentials on the device. Why is a presigned URL the answer rather than opening the bucket?
A:
A presigned URL is a signed request that carries the permissions of the IAM principal who generated it, valid only until the expiry you set, so the bucket stays private and no credentials leave your backend. It works for downloads with GET and for uploads with PUT, and the client makes a plain HTTPS request. The trap is expiry: the URL dies when the signing credentials do, so one generated from an EC2 instance role or an STS session expires with that session even if you asked for longer, and only long-lived IAM user credentials reach the seven-day maximum. The exam distractor is making the bucket public, which exposes every object instead of one for a short time.
USAGE:
Sign URLs with a credential that outlives the URL, and remember an upload URL overwrites any existing object with the same key.

## aws-kms-key-rotation-and-multi-region | d2
Q:
Your compliance team demands yearly rotation of KMS keys and your DR plan decrypts backups in a second Region. Which key types rotate automatically, and how do you decrypt across Regions without re-encrypting?
A:
Automatic rotation is optional on customer managed symmetric keys whose material KMS generated; the default period is 365 days and you can set a custom period. AWS managed keys rotate yearly and you cannot change that. Keys with imported material never rotate automatically, only on demand after you import fresh material, and asymmetric, HMAC and custom key store keys must be rotated manually. Rotation keeps every old version, so ciphertext still decrypts; it does not re-encrypt data. For cross-Region decryption use a multi-Region key: a primary and its replicas share the same key ID and material, so ciphertext from one Region decrypts in another. The distractor is converting a single-Region key, which KMS cannot do.
USAGE:
Rotation never re-encrypts existing data or data keys, so a leaked data key is not fixed by rotating the KMS key; re-encrypt the data instead.

## aws-acm-certificates-and-cloudfront-region | d2
Q:
A team requests one ACM certificate in ap-southeast-2 and attaches it to an ALB, then cannot select it for their CloudFront distribution. What went wrong, and when can an ACM certificate be exported?
A:
ACM certificates are Regional resources and cannot be copied between Regions. An ALB uses a certificate from its own Region, but CloudFront accepts only certificates in us-east-1, so request a second one there. Public certificates used with integrated services cost nothing extra and ACM renews them automatically when DNS validation is in place; imported certificates are never renewed. For export, an ordinary public certificate cannot be exported, and only one requested with export enabled, which carries a charge, or one issued by AWS Private CA gives you the private key for EC2 or on-premises servers. The distractor is exporting the existing certificate or attaching it directly to EC2, which ACM allows only through Nitro Enclaves.
USAGE:
Prefer DNS validation over email so renewals need no human action, and treat us-east-1 as the home for anything CloudFront will serve.

## aws-cognito-user-pool-vs-identity-pool | d2
Q:
A mobile app needs sign-in with MFA and social login, and afterwards must upload files straight to S3. Which Cognito component does each job?
A:
A user pool is the user directory and authentication server: it handles sign-up, sign-in, MFA and federation with Google, Apple, SAML or OIDC providers, and issues OIDC JSON web tokens (ID, access and refresh) that your app or API can verify directly. It never hands out AWS credentials. An identity pool is a credentials broker: it takes a token from a user pool or another trusted provider and exchanges it through STS for temporary AWS credentials tied to an IAM role, so the app can call S3 or DynamoDB itself. It also supports unauthenticated guest identities with a limited role. The distractor is a user pool alone for S3 access, or IAM users for end customers.
USAGE:
Configure the IAM role trust policy so only your identity pool can assume it, and give the unauthenticated role the narrowest permissions you can.

## aws-guardduty-inspector-macie-detective | d2
Q:
Which service do you pick to find a leaked access key being used from an unusual country, an unpatched CVE in a container image, credit card numbers in a bucket, and the root cause after an alert?
A:
Match the verb. GuardDuty is threat detection: it automatically ingests CloudTrail management events, VPC Flow Logs and DNS logs and applies threat intelligence and machine learning to raise findings such as compromised credentials or cryptomining, so the leaked key is GuardDuty. Inspector is vulnerability management: it continuously scans EC2, ECR images and Lambda functions for known CVEs and unintended network exposure. Macie finds sensitive data in S3, such as PII, financial data and credentials, using machine learning and pattern matching, and flags publicly accessible buckets. Detective builds a behaviour graph from CloudTrail, flow logs and GuardDuty findings so you can trace root cause. The distractor is GuardDuty for CVEs or Macie for credential misuse.
USAGE:
Route GuardDuty and Inspector findings through EventBridge to a ticket queue or chat channel, because findings nobody reads are the same as no detection.

## aws-vpc-endpoints-gateway-vs-interface | d2
Q:
Instances in a private subnet need S3 without a NAT gateway, and later an on-premises data centre must reach the same bucket privately. Gateway or interface endpoint, and why?
A:
A gateway endpoint exists only for S3 and DynamoDB, works as a prefix-list route in the subnet route table, and has no additional charge, so it is the cost-optimal answer for in-VPC traffic. It cannot be used from on premises, a peered VPC or another Region. For the data centre add an interface endpoint: a PrivateLink elastic network interface with a private IP in your subnet, guarded by a security group, reachable over VPN or Direct Connect, and billed hourly plus data processing. Both accept an endpoint policy that narrows which principals and buckets are reachable without replacing IAM or bucket policies. The distractor is paying for an interface endpoint when a free gateway endpoint covers the VPC.
USAGE:
Add an S3 bucket policy condition on aws:sourceVpce once the endpoint exists, but test it first because a wrong endpoint ID locks everyone out, including the console.

## aws-vpc-peering-vs-transit-gateway | d2
Q:
You peer VPC A with B and B with C, then discover A cannot reach C. Why, and at what point should you replace peering with a Transit Gateway?
A:
VPC peering is a one-to-one link with no transitive routing: A reaches only VPCs it is directly peered with, and B cannot forward traffic or lend A its internet gateway, NAT, VPN or gateway endpoint. Each peering needs routes on both sides and the CIDR blocks must not overlap. A Transit Gateway is a Regional virtual router: VPCs, VPNs, Direct Connect gateways and other transit gateways attach to it, its route tables let every attachment reach every other or isolate groups, and peering links hubs across Regions. It costs hourly per attachment plus data processing, so peering stays cheaper for a few VPCs; a growing mesh signals the move to a hub. The distractor is assuming peering is transitive.
USAGE:
Plan non-overlapping CIDR ranges across accounts from day one, because peering refuses overlapping VPCs and a transit gateway cannot route sensibly between them.

## aws-vpc-flow-logs | d1
Q:
Connections to an EC2 instance are timing out and you suspect a security group is dropping them. What do VPC Flow Logs show you, and what do they not show?
A:
Flow logs record metadata about IP traffic to and from network interfaces: source and destination address and port, protocol, packet and byte counts, and an ACCEPT or REJECT action. You enable them at VPC, subnet or network interface level and publish to CloudWatch Logs, S3 or Data Firehose. A REJECT record on the inbound flow proves the packets never reached the instance, which points at the security group or network ACL rather than the application. They do not capture packet payloads, they are not real time, and they skip some traffic such as Amazon DNS, instance metadata and DHCP. The distractor is Traffic Mirroring or a packet capture when the question only asks which layer blocked the connection.
USAGE:
If you see ACCEPT for the request and REJECT for the reply, look at the stateless network ACL, because a stateful security group would have let the response through.

## aws-ssm-session-manager-vs-bastion | d2
Q:
Auditors require that no EC2 instance accepts inbound SSH and that every administrative shell session is logged. Do you build a bastion host, or something else?
A:
Use Systems Manager Session Manager. The SSM Agent on the instance opens an outbound HTTPS connection to the Systems Manager endpoints, so the instance needs no inbound port 22, no key pair and no public IP; a bastion still leaves SSH open somewhere and keys to rotate. Who may connect, and to which nodes, is decided by IAM policies, and session activity can be sent to CloudWatch Logs or S3 while CloudTrail records the API calls. The prerequisites the exam probes: SSM Agent installed, an instance profile with the AmazonSSMManagedInstanceCore permissions, and outbound reach to the ssm, ssmmessages and ec2messages endpoints, which in a private subnet means a NAT gateway or interface VPC endpoints. The bastion host is the distractor.
USAGE:
When Session Manager cannot connect, the cause is almost always a missing instance profile or no route to the SSM endpoints, not a security group.

## aws-site-to-site-vpn-vs-direct-connect | d2
Q:
A company needs its data centre connected to a VPC within days, and later wants predictable throughput for large nightly transfers. When is Site-to-Site VPN the answer and when is Direct Connect?
A:
Site-to-Site VPN runs IPsec tunnels over the public internet, so it is encrypted and quick to stand up, but throughput is capped per tunnel (the standard tunnel is 1.25 Gbps) and latency varies with the internet. Direct Connect is a dedicated fibre link into an AWS location: consistent latency, ports from 1 Gbps to 400 Gbps and cheaper data transfer, but it needs a physical cross connect, AWS can take up to 72 business hours just to provision the port, and it is not encrypted. Pair them, Direct Connect primary and VPN backup: AWS prefers Direct Connect BGP routes over VPN routes for the same prefix, so failover is automatic. The trap is picking Direct Connect for an urgent deadline.
USAGE:
Test the VPN backup path before you need it; a backup that has never carried traffic tends to have a stale route or a misconfigured customer gateway.

## aws-direct-connect-encryption | d3
Q:
A regulated workload must encrypt everything crossing its Direct Connect link and reach VPCs in two Regions. What does Direct Connect give you on its own, and what do you add?
A:
Direct Connect does not encrypt traffic in transit; private does not mean encrypted. To encrypt at the network layer, run a Site-to-Site VPN over the link: the classic method uses a public virtual interface so the VPN endpoint public IPs are reachable, and private IP VPN runs over a transit VIF through a Direct Connect gateway and transit gateway. MACsec encrypts at layer 2, but only on dedicated 10, 100 and 400 Gbps connections at selected locations, never on hosted connections, and only between your router and the Direct Connect location. For several Regions, attach one private or transit VIF to a Direct Connect gateway, a global resource. A lone private VIF, reaching one VPC, is the distractor.

## aws-cloudhsm-vs-kms | d2
Q:
A bank must keep its encryption keys in a single-tenant HSM that its own staff administer, yet still use those keys with RDS and EBS. KMS, CloudHSM, or both?
A:
KMS is a managed, multi-tenant service: AWS runs a shared fleet of FIPS 140-3 Level 3 validated HSMs, integrates with most AWS services, and you govern use through key policies. CloudHSM gives you a dedicated, single-tenant cluster in your VPC where you create the users and keys, AWS cannot see the key material, and applications use PKCS#11, JCE or CNG libraries; in return you own availability, backups and scaling. When the requirement is both single-tenant hardware and native AWS service integration, use a KMS custom key store backed by your CloudHSM cluster, symmetric encryption keys only. Exam questions use FIPS 140-2 Level 3 as the CloudHSM hint, but the real discriminator is single tenancy and customer-run key management.
USAGE:
Reach for CloudHSM only when a regulation names a dedicated HSM; the docs say custom key stores are not more secure than the standard key store, only more work.

## aws-ec2-imdsv2 | d3
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
Q:
An unencrypted RDS MySQL instance must now be encrypted at rest and reachable from an EC2 application without a stored password. What are the steps, and what cannot be done in place?
A:
Encryption at rest is chosen only when an RDS instance is created; you cannot switch it on for a running one, nor take an encrypted snapshot of an unencrypted instance. The path is: snapshot the instance, copy the snapshot with encryption and a KMS key, restore a new instance from the encrypted copy, then repoint the application. The setting then flows into backups, snapshots and read replicas, and can never be removed. For access, enable IAM database authentication (MariaDB, MySQL and PostgreSQL): the application uses its instance profile credentials to request a token valid for 15 minutes and presents it instead of a password over SSL or TLS. The distractor is a modify-instance encryption option, which does not exist.
USAGE:
Because IAM tokens expire after 15 minutes, generate a fresh one for each new connection rather than caching it in a connection pool's configuration.

## aws-ebs-encryption-default | d2
Q:
A compliance rule says every new EBS volume in the account must be encrypted, and some existing unencrypted volumes must be fixed. How do you handle each?
A:
Turn on EBS encryption by default; it is a per-Region setting, so enable it in every Region you use. From then on new volumes and snapshot copies are encrypted with the default key, the AWS managed aws/ebs key unless you nominate a customer managed key, and individual volumes cannot opt out. It does nothing to existing volumes or snapshots. To fix those, snapshot the volume and either create a new encrypted volume from that snapshot or copy the snapshot with encryption enabled and restore from the copy; there is no in-place encrypt. Encryption is inherited and permanent: snapshots of encrypted volumes and volumes restored from them are encrypted for good. The trap is assuming the switch retrofits old volumes.
USAGE:
Copying a snapshot to a different KMS key produces a full rather than incremental copy, so budget for the extra snapshot storage.

## aws-security-group-referencing | d2
Q:
Web servers behind an ALB scale in and out, and the database must accept connections only from those web servers. How do you write the rule without maintaining IP lists?
A:
Set the source of the inbound rule to a security group ID rather than a CIDR. A rule that references the web tier's group allows traffic from the private IP of every network interface associated with that group, so newly launched instances are covered the moment they attach it. Chain the tiers: the load balancer group allows 0.0.0.0/0 on 443, the web group allows only the load balancer group, and the database group allows only the web group on the database port. Referencing works within a VPC, across peering and, inbound, across a transit gateway; it copies no rules from the referenced group and fails through a middlebox appliance. The subnet CIDR, which admits everything there, is the distractor.
USAGE:
A rule that references a security group counts as one rule regardless of how many instances sit behind it, which keeps you well under the per-group rule quota.

## aws-alb-authentication-cognito-oidc | d2
Q:
A web application behind an Application Load Balancer must require corporate single sign-on before any request reaches the EC2 targets, and the team does not want to write login code. What do you configure?
A:
Add an authenticate-cognito or authenticate-oidc action to the HTTPS listener rule. The ALB redirects an unauthenticated user to the identity provider, exchanges the authorisation code for tokens, sets a session cookie and forwards the request with the user claims in the x-amzn-oidc-data header, a JWT signed by the load balancer. The action is supported only on HTTPS listeners, and the load balancer itself must reach the IdP token and user info endpoints, so an internal ALB needs a NAT gateway. The distractor is a Lambda or Cognito authoriser, which belongs to API Gateway; for an ALB the authentication lives on the listener rule, and targets should verify the signed header rather than trust the unsigned legacy ones.
USAGE:
Check that the signer field in the x-amzn-oidc-data JWT matches your ALB ARN before trusting any claim, and restrict the target security group to the ALB so nobody can inject those headers directly.

## aws-api-gateway-auth-options | d2
Q:
A REST API on API Gateway must accept calls from mobile app users, from internal AWS services, and from partners who send a custom bearer token. Which authoriser fits each caller, and where do API keys belong?
A:
Match the authoriser to the caller. IAM authorisation, set as AWS_IAM on the method, suits AWS principals that can sign requests with Signature Version 4 and hold execute-api:Invoke. A Cognito user pool authoriser suits app users who sign in and present a user pool token. A Lambda authoriser suits anything custom: it receives the bearer token or request parameters, returns an IAM policy and a principal, and its decision can be cached. Resource policies then restrict where calls may come from, such as source IP ranges, VPC endpoints or other accounts. The trap is API keys: they identify a client for usage plan throttling and quotas, and AWS states that they must not be used for authentication or authorisation.
USAGE:
Pair an API key with a real authoriser; a key on its own lets any holder call every API in that usage plan.

## aws-lambda-vpc-access | d2
Q:
A Lambda function must query an RDS instance in a private subnet, and after you attach the function to the VPC its calls to a public third-party API start timing out. Why, and what fixes both needs?
A:
Attaching a function to a VPC gives it a Hyperplane network interface in the subnets and security group you pick, so it can reach RDS or ElastiCache over private IPs; the execution role needs the AWSLambdaVPCAccessExecutionRole permissions to create that interface. The cost is that the function now reaches only what the VPC can reach, and the default internet access is gone. Fix it by choosing private subnets whose route table sends 0.0.0.0/0 to a NAT gateway in a public subnet. The trap is selecting a public subnet, which does not help because the function never gets a public IP. For S3, DynamoDB and other AWS APIs, add VPC endpoints so traffic stays on the AWS network without NAT.
USAGE:
Reuse the same subnet and security group combination across functions so Lambda shares one network interface instead of creating more.

## aws-privatelink-expose-service | d2
Q:
A team runs an internal API in its VPC and must expose it to dozens of consumer VPCs in other accounts, several of which use the same 10.0.0.0/16 range. Peering is rejected; what do you build instead?
A:
Use AWS PrivateLink. The provider puts a Network Load Balancer in front of the service, creates a VPC endpoint service and grants permission to the consumer principals. Each consumer creates an interface endpoint in its own subnets, which places an endpoint network interface with a private IP inside the consumer VPC, and the provider accepts the connection. Traffic stays on the AWS network and only the consumer initiates it, so the provider never routes into the consumer network. Because the consumer reaches the service through DNS and a local interface rather than through routes into the provider VPC, overlapping CIDR blocks are fine, whereas VPC peering refuses matching or overlapping ranges and exposes networks rather than one service.
USAGE:
Make the NLB available in at least two Availability Zones, because consumers can only create endpoints in zones where the endpoint service is available.

## aws-iam-access-analyzer-credential-report | d1
Q:
An auditor asks two things: which S3 buckets, KMS keys or IAM roles are reachable from outside the organisation, and which IAM users lack MFA or hold access keys that have not been rotated in a year. Which tool answers each?
A:
IAM Access Analyzer answers the first. An external access analyser takes your account or organisation as its zone of trust, reasons over resource-based policies and raises a finding for every supported resource that a principal outside that zone can reach; unused access analysers separately flag unused roles, access keys and passwords. The credential report answers the second. It is a CSV listing every IAM user in the account with columns such as password_enabled, mfa_active and access_key_1_last_rotated, and IAM generates a fresh one at most once every four hours. The trap is mixing them up: Access Analyzer reasons about policies and sharing, the credential report lists per-user credential state, and neither replaces CloudTrail for what actually happened.
USAGE:
External access findings are per Region, so create an external access analyser in every Region where you hold resources.

## aws-route53-routing-policies | d2
Q:
Three requirements land on one day: shift 5 percent of traffic to a new release, send European users to the Region that responds fastest, and serve a licensed video only inside one country. Which Route 53 routing policy fits each?
A:
Weighted routing for the release: each record carries a weight, traffic splits in proportion to weight over total weight, and weight 0 drains a version, the blue green pattern. Latency routing for the second: Route 53 answers with the Region that gives the best latency, which is not the same as geography. Geolocation routing for the third: it picks records by where the query originates, by continent, country or US state, so it can enforce distribution rights; add a default record or unmapped locations get no answer. The trap is geoproximity, which keys on where your resources sit and optionally shifts traffic between locations, not on user compliance. Multivalue answer returns up to eight healthy records at random.
USAGE:
Always add a default geolocation record; without one, queries from unmapped IP addresses get no answer at all.

## aws-route53-health-checks-failover | d2
Q:
A failover record set points to a primary web tier in a private subnet with no public IPs, and the endpoint health check stays unhealthy even though the site works. What is wrong and how do you fix it?
A:
Route 53 health checkers sit outside your VPC, so an endpoint health check can only test a resource with a public IP or public DNS name. For private resources, create a CloudWatch alarm, such as one on EC2 StatusCheckFailed, and a health check that monitors that alarm; Route 53 evaluates the alarm's data stream against its criteria rather than waiting for the ALARM state. Calculated health checks aggregate child checks and go unhealthy only when healthy children drop below a threshold. Failover routing is active passive: Route 53 answers with the primary while healthy and switches to the secondary once every primary resource is unhealthy. The trap is giving private servers public IPs to satisfy the checker.
USAGE:
For an alias record pointing at an ALB or another AWS resource, set Evaluate Target Health to yes rather than attaching a separate health check.

## aws-route53-alias-vs-cname | d1
Q:
You need example.com, the bare domain, to resolve to an Application Load Balancer. Why does a CNAME fail here and what do you use instead?
A:
DNS does not permit a CNAME at the zone apex, the top node of a hosted zone, so Route 53 refuses to create one for example.com. An alias record is a Route 53 extension that answers as an A or AAAA record but points at an AWS resource such as an ALB, CloudFront distribution, S3 static website or another record in the same hosted zone. Route 53 resolves it to the IP addresses, so it follows the load balancer when its addresses change, and queries to alias records for AWS resources are free, while CNAME queries are charged. The trap is picking CNAME because it works for www.example.com; a CNAME can target any DNS name, but never at the apex.
USAGE:
An alias to an AWS resource has no TTL of its own; Route 53 uses the resource's default, so plan cutovers with that in mind.

## aws-asg-scaling-policies | d2
Q:
An Auto Scaling group must hold average CPU near 50 percent, add a burst of capacity when CPU spikes past 90 percent, and be ready before the 9 am login rush every weekday. Which policy types cover this, and which one should you avoid?
A:
Target tracking is the default: pick a metric that moves inversely with capacity, such as ASGAverageCPUUtilization or ALBRequestCountPerTarget, set a target, and Auto Scaling creates and manages the CloudWatch alarms, scaling out promptly and in more gradually. Step scaling adds alarm driven adjustments that grow with the breach size and keeps responding to new alarms during a scaling activity, so it suits the burst. Scheduled scaling changes desired capacity at a fixed time or cron recurrence, and predictive scaling forecasts daily or weekly patterns from history and adds capacity before the load arrives. Avoid simple scaling: it makes one adjustment and ignores alarms until its cooldown ends, and AWS recommends step scaling even for a single adjustment.
USAGE:
If several dynamic policies fire at the same moment, Auto Scaling applies the one that yields the largest capacity, for scale in as well as scale out.

## aws-asg-lifecycle-hooks-and-warm-pools | d3
Q:
An Auto Scaling group must copy logs off each instance before it is terminated, and scale-out is slow because the AMI takes several minutes to bootstrap. Which two features solve these problems, and why do they need each other?
A:
A lifecycle hook pauses an instance in Pending:Wait at launch or Terminating:Wait before termination, holding it for one hour by default (extendable with a heartbeat) while a script or Lambda function installs software or copies logs off; you then complete the action with CONTINUE or ABANDON. A warm pool is different: it keeps pre-initialised instances beside the group, normally Stopped so you pay only for volumes and Elastic IPs, and a scale-out draws from the pool instead of cold booting. The distractor is a warm pool without a launch hook, which fails because Auto Scaling stops or hibernates the instance without waiting for user data to finish, leaving pooled instances half built. Combine both when boot time is the problem.
USAGE:
Have the user data script call complete-lifecycle-action as its last line, so the launch hook holds the instance until bootstrap really finishes and a warm pool never stops a half-built one.

## aws-asg-health-checks-elb-vs-ec2 | d2
Q:
An instance behind an Application Load Balancer returns HTTP 500 on every request and the target group marks it unhealthy, yet the Auto Scaling group never replaces it. Why, and what do you change?
A:
By default an Auto Scaling group uses only the Amazon EC2 status checks, which detect a stopped or terminated instance or impaired hardware; a web server answering with errors still passes them, so the group considers the instance healthy. Elastic Load Balancing health checks are ignored until you turn them on. Once enabled, an instance the target group reports as unhealthy is marked Unhealthy on the next periodic check, drained, then terminated and replaced. Set a health check grace period so a new instance is not killed before it finishes starting; the console default is 300 seconds, the CLI default is 0. The distractor is changing the target group health check interval, which alters nothing on the group side.
USAGE:
After enabling ELB health checks, watch the group for a few minutes: a health check path that needs authentication or returns a redirect will get every instance replaced in a loop.

## aws-elb-cross-zone-and-sticky-sessions | d2
Q:
A Network Load Balancer has two targets in one Availability Zone and eight in another, and the two are overloaded. What is happening, and why would adding sticky sessions make it worse?
A:
With cross-zone load balancing off, each load balancer node sends traffic only to targets in its own Availability Zone, so each zone gets half the requests and the two targets take 25 percent each. Cross-zone balancing is always on at the load balancer level for an Application Load Balancer but off by default for Network and Gateway Load Balancers, and enabling it on a Network Load Balancer incurs EC2 data transfer charges. Network Load Balancer stickiness uses no cookie: it pins traffic by client source IP, so clients behind one NAT device land on the same target, making distribution more uneven, not less. Enable cross-zone balancing instead; the distractor is the AWSALB cookie, an Application Load Balancer feature.
USAGE:
Prefer stateless targets with session state in ElastiCache or DynamoDB; if you must use source IP stickiness, expect corporate NAT ranges to pile onto one target and expect sessions to reset when targets are registered, deregistered or change health.

## aws-elb-deregistration-delay | d1
Q:
When an Auto Scaling group scales in, users with long downloads in progress receive 5xx errors. Which target group setting prevents that, and what is its default?
A:
Deregistration delay, also called connection draining, keeps a deregistering target in the draining state so in-flight requests can finish while no new requests are sent to it. The default is 300 seconds; a target with no in-flight requests completes immediately, and a target that closes connections before the delay ends causes a 500-level error for the client. Auto Scaling waits for draining before terminating the instance. Set the value just above your longest normal request, because the full delay must elapse before termination, otherwise scale-in and deployments look slow. The distractor is the health check grace period, which protects new instances at launch, not existing ones on the way out.
USAGE:
A five-minute default on an API with 200 millisecond responses makes every deploy and scale-in painfully slow, so tune it down to a few seconds above your slowest legitimate request.

## aws-aurora-vs-rds | d2
Q:
When do you pick Aurora over RDS for MySQL or PostgreSQL, and what does the higher price actually buy?
A:
Aurora keeps six copies of your data across three Availability Zones in a shared cluster volume that grows automatically, so durability and storage sizing are handled regardless of instance count. Up to 15 Aurora Replicas read from that same volume and double as failover targets, with failover typically completing in under 60 seconds and often under 30, whereas an RDS Multi-AZ standby serves no reads and RDS read replicas each hold their own copy. Aurora is MySQL and PostgreSQL compatible but costs more than plain RDS. Choose it when the question stresses availability, fast failover, many readers or unpredictable storage growth; choose RDS for small workloads or engines Aurora lacks, such as Oracle or SQL Server.
USAGE:
Always connect through the cluster endpoint rather than an instance endpoint, otherwise a failover leaves your application pointing at what is now a reader.

## aws-aurora-global-database | d2
Q:
A company needs its Aurora database readable on three continents and recoverable from a full Regional outage within minutes. Which feature fits, and what are the RPO and RTO trade-offs?
A:
Aurora Global Database has one primary Region for writes and up to 10 read-only secondary Regions, replicated through the storage layer rather than the database engine, with lag typically under a second and little impact on the primary. For disaster recovery the RTO is in the order of minutes: a managed failover promotes a secondary cluster and adds the old Region back automatically once it recovers. Because replication is asynchronous, unplanned failover has a non-zero RPO measured in seconds; Aurora PostgreSQL can cap it with the rds.global_db_rpo parameter. A planned switchover synchronises first, giving an RPO of zero. The distractor is a cross-Region read replica, which uses engine-level replication with higher lag and manual promotion that breaks the topology.
USAGE:
Configure applications with the global writer endpoint from day one, so a switchover or failover needs no connection string change.

## aws-rds-backups-snapshots-pitr | d2
Q:
A developer ran an accidental DELETE on an RDS database 40 minutes ago and asks you to roll back to just before it. What do you use, and how do automated backups differ from manual snapshots?
A:
Point-in-time restore depends on automated backups: RDS takes a daily snapshot and uploads transaction logs to Amazon S3 every five minutes, so you can restore to any point inside the retention period, set between 0 and 35 days (console default 7, CLI default 1). Restoring creates a new DB instance with a new endpoint, so you repoint the application. Manual snapshots never expire, survive deletion of the instance, and can be copied to another Region or shared with another account, making them the tool for long-term retention and cross-Region recovery. The distractor is relying on automated backups long term, because they are deleted with the instance unless you choose to retain them.
USAGE:
Take a manual snapshot before any risky migration or engine upgrade, because automated backups vanish with the instance and the retention window is short.

## aws-rds-cross-region-read-replica-dr | d2
Q:
An RDS for PostgreSQL database in Sydney must survive a Regional outage and also serve reads to users in Ireland. Why is Multi-AZ alone insufficient, and what does the alternative cost you?
A:
Multi-AZ keeps a synchronous standby in another Availability Zone of the same Region, so it survives instance and zone failure but not a Regional outage, and the standby cannot serve reads. A cross-Region read replica covers both requirements: RDS replicates asynchronously to a copy in the other Region that local users can query and that you can promote to a standalone instance if the source Region fails. The costs are higher replication lag, data transfer charges out of the source Region, and a manual recovery step: promotion stops replication permanently, reboots the replica and leaves an ordinary instance, so you redirect traffic and build a new replica afterwards. Combine them: Multi-AZ for automatic failover, the cross-Region replica for disaster recovery.
USAGE:
Rehearse the promotion in a test account so you know the replication lag, the reboot time and the DNS change before a real outage forces the decision.

## aws-dynamodb-global-tables | d2
Q:
A mobile game must accept DynamoDB writes in both us-east-1 and eu-west-1 and keep working if one Region is impaired. Which feature fits, and what does its conflict rule mean for your data model?
A:
DynamoDB global tables replicate a table across Regions in a multi-active arrangement: every replica accepts reads and writes, so failing over is simply routing traffic elsewhere. In the default multi-Region eventual consistency mode, replication is driven by DynamoDB Streams, which cannot be disabled on replicas, and concurrent writes to the same item in different Regions resolve as last writer wins, so the losing write is silently discarded. Design around that with idempotent writes or a home Region per user, and watch the ReplicationLatency metric. A multi-Region strong consistency mode avoids the conflict but is single-account only and lacks TTL and transactions. The distractor is a backup copied to another Region: disaster recovery, not active replication.
USAGE:
Store a version or last-updated attribute on each item so you can detect when last writer wins discarded a change during a Regional incident.

## aws-dynamodb-streams-and-ttl | d2
Q:
A table stores session records that must be archived to S3 when they expire, without paying for the delete writes. How do you build this with DynamoDB features alone?
A:
Set a TTL attribute holding a Unix epoch timestamp in seconds; DynamoDB deletes expired items itself, typically within a few days, without consuming write throughput. Enable a stream with the new and old images view so every change, including those service deletes, becomes a record kept for 24 hours, then attach a Lambda event source mapping to archive the old image. TTL deletes carry a userIdentity with type Service and principalId dynamodb.amazonaws.com, so an event filter can invoke the function only for expirations. The trap is expecting instant removal: expired items can still appear in scans and queries until the delete runs, so use a filter expression, and a consumer that stalls beyond 24 hours loses records.
USAGE:
Store the TTL value in seconds, not milliseconds, or every item lands centuries in the future and nothing ever expires.

## aws-s3-cross-region-replication | d2
Q:
A compliance rule requires copies of a bucket's objects in a second Region, including objects uploaded last year. What must be true of both buckets, and why does enabling CRR alone not satisfy the rule?
A:
Live replication, Cross-Region or Same-Region, requires versioning on both source and destination buckets plus an IAM role that S3 assumes to copy objects asynchronously. A rule replicates only objects created after it is added, so the older objects need an S3 Batch Replication job. Replicas may land in a cheaper storage class, and the owner override can hand ownership to the destination account. Delete markers are not replicated by default in a rule that uses a Filter element unless you enable delete marker replication, and deleting a specific version ID is never replicated, which protects the copy from malicious deletes. The distractor is disabling versioning on the destination to save cost, which makes replication fail.
USAGE:
After enabling a rule, check the ReplicationStatus of a few source objects; a FAILED status usually means the destination lost versioning or the role lacks permissions.

## aws-s3-versioning-and-mfa-delete | d1
Q:
An operator accidentally deleted objects from a bucket. What makes that recoverable, and what stops the same thing happening under stolen credentials?
A:
With versioning enabled, a DELETE without a version ID removes nothing; S3 inserts a delete marker that becomes the current version, and deleting the marker brings the object back. Overwrites create new versions instead of replacing the old one. Once enabled, versioning can only be suspended, never returned to unversioned. MFA delete adds a second factor to permanently deleting a version or changing the versioning state; only the bucket owner's root account can enable it, and only through the CLI or API, not the console. The trap is believing versioning alone blocks permanent deletes: a delete that names a version ID still succeeds without MFA delete.
USAGE:
Every version is billed as a full object, so pair versioning with a lifecycle rule that expires noncurrent versions or the bill grows silently.

## aws-s3-durability-availability | d1
Q:
What is the difference between S3 durability and availability, and which storage class trades resilience to an Availability Zone loss for a lower price?
A:
Durability is the chance your data survives; all mainstream S3 storage classes, including One Zone-IA, are designed for 99.999999999 percent (eleven nines) durability over a year. Availability is the chance you can read it now, and it varies: S3 Standard is designed for 99.99 percent, Standard-IA and Intelligent-Tiering for 99.9 percent, One Zone-IA for 99.5 percent. Most classes store objects redundantly across a minimum of three Availability Zones and are designed to survive losing an entire zone. One Zone-IA keeps data in a single zone, so a zone-level disaster destroys it; use it only for data you can recreate, such as CRR replicas. The distractor is choosing One Zone-IA for a primary copy because it shows the same eleven nines.
USAGE:
Durability figures protect against hardware loss, not against your own mistaken deletes; that is what versioning and replication are for.

## aws-sqs-fifo-vs-standard | d2
Q:
An order system must apply price updates for each product in the order they were sent and must never process the same update twice. Standard or FIFO queue, and what does the choice cost you?
A:
Choose FIFO. Standard queues give nearly unlimited throughput but only at-least-once delivery and best-effort ordering, so consumers must be idempotent and tolerate reordering. FIFO queues keep strict order within each message group ID and give exactly-once processing: a SendMessage retry carrying the same MessageDeduplicationId within the 5 minute deduplication window is accepted but not delivered again, and content-based deduplication can derive that ID from a SHA-256 hash of the body. The cost is throughput: 300 API calls per second per action without batching, 3,000 messages per second with batching, more only in high throughput mode. Use one group per product so unrelated products still process in parallel. The trap is a standard queue with reordering logic in the consumer.
USAGE:
Make the deduplication ID an order or event identifier you control, because a timestamp or random UUID defeats deduplication on retries.

## aws-sqs-long-polling | d1
Q:
A worker fleet polls an SQS queue in a tight loop and the bill shows millions of empty ReceiveMessage responses. What setting fixes it, and why does it help?
A:
Turn on long polling by setting ReceiveMessageWaitTimeSeconds on the queue, or WaitTimeSeconds on each ReceiveMessage request, to a value above zero, up to the maximum of 20 seconds. With the default of zero, short polling samples only a subset of SQS servers and answers immediately, so it returns empty responses even when messages exist elsewhere, and every one of those responses is a request you pay for. Long polling queries all servers and holds the connection until at least one message arrives or the wait expires, so consumers receive messages sooner and issue far fewer requests. The trap is choosing a longer visibility timeout or a delay queue, which control when a message is hidden, not how often you poll.
USAGE:
Pair long polling with a receive batch of up to ten messages so each round trip carries several messages instead of one.

## aws-sqs-message-retention-and-size | d1
Q:
A producer needs to enqueue 5 MB documents, and consumers may be offline for a week. Which SQS defaults get in the way, and what do you change?
A:
SQS keeps a message for 4 days by default; retention runs from 60 seconds to 14 days, so raise it when consumers lag. Bodies have a hard size cap: 256 KB for years, and the figure exam questions still use, though the current quota is 1 MiB. A 5 MB document needs the SQS Extended Client Library, which stores the payload in S3 and sends only a reference, allowing payloads up to 2 GB. A delay queue is a different control: DelaySeconds hides a new message for up to 15 minutes after it is sent, whereas visibility timeout hides it after it is received. The trap is a queue attribute that lifts the body limit; none exists.
USAGE:
Put a lifecycle rule on the S3 bucket used by the Extended Client so orphaned payloads from deleted messages do not accumulate.

## aws-sns-fanout-filtering | d2
Q:
An order event must trigger fulfilment, analytics, and a fraud check independently, and the fraud service only cares about orders above a threshold. What pattern serves this without the producer knowing about each consumer?
A:
Publish once to an SNS topic and subscribe one SQS queue per consumer; fanout replicates the message to every subscriber for parallel, independent processing, and each queue buffers and retries for its own service. By default every subscriber receives every message, so attach a subscription filter policy, a JSON object matched against message attributes or the body, to the fraud queue; SNS delivers only matching messages and skips the rest, removing filtering code from that consumer. When order matters, use an SNS FIFO topic feeding SQS FIFO queues: the message group ID passes through and ordering and deduplication hold within each group. The trap is having the producer write to three queues itself, which couples it to every consumer.
USAGE:
Put the fields you plan to filter on into message attributes at publish time; adding them later means changing every producer.

## aws-lambda-retries-and-destinations | d3
Q:
A Lambda function fails intermittently. Why does the same code seem to retry twice when triggered by S3, never when called through API Gateway, and endlessly when reading a Kinesis stream?
A:
Retry behaviour belongs to the invoker. Asynchronous invokers such as S3 and SNS queue the event inside Lambda; on a function error Lambda tries twice more, then discards the event unless a DLQ or on-failure destination catches it. A destination (SQS, SNS, Lambda, EventBridge, S3 for failures) gets the full invocation record with the response; a DLQ carries only the event. Synchronous callers like API Gateway get the error back and choose whether to retry. Stream sources retry the batch until it succeeds or the records expire, blocking the shard; an SQS source returns messages after the visibility timeout and uses the queue's redrive policy. The async queue can deliver an event more than once, so handlers must be idempotent.
USAGE:
Never attach a DLQ to a function triggered by an SQS queue; configure the redrive policy on the source queue instead, or failures land nowhere useful.

## aws-lambda-concurrency-reserved-provisioned | d2
Q:
A payment Lambda function is being throttled because a noisy batch function in the same account is using all the available concurrency. Do you set reserved or provisioned concurrency, and what does each one actually change?
A:
All functions in a Region draw from one shared account concurrency pool, so a busy neighbour can starve a critical function. Reserved concurrency carves out a slice of that pool that only the chosen function may use, and it is also a hard ceiling: the function can never exceed it, even when the rest of the pool sits idle. It costs nothing. Provisioned concurrency is different: it pre-initialises execution environments so requests skip the cold start, and it is billed. The trap is choosing provisioned concurrency to fix throttling; it addresses latency, not the shared quota. Both settings count against the account limit, and a function's provisioned concurrency cannot exceed its reserved concurrency.
USAGE:
Reserve concurrency on a function that calls a fragile downstream such as a small database, because the cap doubles as a throttle that protects it.

## aws-dr-strategies-rpo-rto | d2
Q:
A workload may lose no more than a few minutes of data, but the business accepts a recovery time measured in hours rather than seconds. Which disaster recovery strategy fits, and why not its cheaper or dearer neighbours?
A:
Set the recovery point objective (tolerable data loss) and recovery time objective (tolerable outage) from a business impact analysis before choosing. The four strategies then rise in cost as RPO and RTO fall: backup and restore, pilot light, warm standby, multi-site active/active. Pilot light fits here: data replicates continuously to a live database in the recovery Region, giving a low RPO, while application servers are provisioned but switched off, so recovery means starting and scaling them, which takes time. Warm standby keeps a scaled-down copy running and can serve traffic immediately, more than this business needs. Periodic backups alone would miss the RPO. The trap: pilot light cannot serve requests without action first, warm standby can.
USAGE:
Write the agreed RPO and RTO into the runbook and rehearse a failover against them, because an untested strategy is only a cost line.

## aws-backup-service | d1
Q:
A team scripts EBS snapshots, RDS snapshots and DynamoDB backups separately and cannot prove retention to auditors. Which service replaces the scripts, and which feature stops even an administrator deleting a backup early?
A:
AWS Backup is the managed, policy-based service for this. A backup plan sets schedule and retention, resources join it by tag or direct selection, and it covers EBS, EC2, RDS, Aurora, DynamoDB, EFS, FSx, S3 and more, storing recovery points in vaults. Plans can copy backups to another Region or account to survive a Regional loss or a compromised account, and AWS Organizations lets you apply one policy to every account. AWS Backup Vault Lock enforces write-once-read-many: in compliance mode, once the grace period ends, neither any user, including root, nor AWS can delete the backups or shorten their retention. The trap is per-service snapshot scripts: AWS Backup does not govern backups taken outside it.
USAGE:
Check every recovery point's retention before locking a vault in compliance mode, because anything retained indefinitely becomes permanent and billed forever.

## aws-multi-az-vs-multi-region | d1
Q:
When is deploying across multiple Availability Zones enough, and when does a workload genuinely need a second Region?
A:
Availability Zones are separate data centre groups inside one Region, far enough apart to avoid shared failures such as power or flooding, yet linked by low-latency fibre so synchronous replication works. Multi-AZ therefore covers the loss of a data centre and is the default high availability design. Regions are isolated from each other and nothing replicates between them automatically, so a second Region is what survives a Regional outage, meets data residency rules, or serves distant users faster. The price is asynchronous replication with some data lag, plus the complexity of failing over DNS, data and deployments. The trap: multi-Region when the requirement only says highly available; multi-AZ answers that with far less complexity.
USAGE:
Check that the database, queue and cache tiers are each Multi-AZ as well, because one single-AZ dependency undoes the resilience of the compute layer.

## aws-cloudfront-origin-failover | d2
Q:
A static site served by CloudFront from an S3 bucket must keep serving if that bucket's Region has problems. How do you make CloudFront fall back, and what exactly triggers the fallback?
A:
Create an origin group of a primary and a secondary origin and assign it to the cache behaviour. On a cache miss CloudFront tries the primary; if it returns a status code you listed as failover criteria (such as 500, 502, 503 or 504), or cannot be reached or times out once 503 and 504 are listed, CloudFront retries the same request against the secondary. Failover is per request, the next one goes to the primary again, and only GET, HEAD and OPTIONS qualify. For a static site, replicate the bucket with S3 Cross-Region Replication so both origins hold the same objects. The trap is expecting one origin's connection retries to do this; only an origin group reroutes.
USAGE:
Lower the primary origin's connection timeout and attempts for latency-sensitive content, otherwise viewers wait through every retry before the secondary is tried.

## aws-ecs-fargate-vs-ec2-launch | d2
Q:
One team needs GPU containers on reserved capacity, another has a spiky API and nobody to patch hosts. Which ECS launch type suits each, and how do the containers get AWS permissions in both cases?
A:
Fargate is serverless: you declare CPU and memory per task, AWS runs and patches the hosts, each task is isolated, and you pay only for what tasks use, suiting the spiky API. The EC2 launch type puts tasks on instances you manage, giving you instance type choice, GPUs, custom AMIs, privileged containers and capacity reservations, and densely packing hosts you own is the cost case at steady scale. Either way, give containers a task IAM role, not the instance profile: the container SDK uses the task role exclusively, so each service gets least privilege, and Fargate has no instance profile. The trap is picking EC2 to save money on bursty traffic, or putting application permissions on the instance role.
USAGE:
Create one task role per service with only the permissions that service needs, rather than one broad role shared across a cluster.

## aws-eks-vs-ecs | d1
Q:
When do you choose Amazon EKS over Amazon ECS for a containerised workload, given that both can run on Fargate?
A:
Choose EKS when the requirement mentions Kubernetes: a team with Kubernetes skills, manifests or Helm charts, or a need to keep the application portable to other clouds or on-premises clusters. EKS is certified Kubernetes-conformant, so standard tooling and workloads run without refactoring, and AWS manages the control plane. Choose ECS otherwise: it is the simpler, AWS-native orchestrator with less to operate, and you avoid the per-cluster charge and the Kubernetes upgrade cadence. Both can place containers on EC2 instances you manage or on Fargate, so Fargate is a capacity choice, not the deciding factor. The trap is treating EKS as the stronger default; Kubernetes or portability in the question signals EKS, their absence points to ECS.
USAGE:
Do not adopt EKS just to keep options open; the recurring cluster upgrades need an owner, which small teams often lack.

## aws-elastic-ip-and-eni-failover | d2
Q:
A licensing server must keep the same IP address after failing over to a standby instance. When do you remap an Elastic IP, and when do you move a secondary network interface instead?
A:
An Elastic IP is a static public IPv4 address owned by your account; when the active instance fails you reassociate it with the standby, masking the failure with no DNS change. It is Regional, not zonal, but moves only the public address. A secondary network interface carries its private IPs, Elastic IPs, MAC address and security groups with it, so attaching it to a hot standby redirects traffic to a fixed private address without touching route tables or DNS. The constraint: the standby must sit in the same Availability Zone, and a primary interface cannot be detached. The trap is an ENI move across Availability Zones, or an Elastic IP when clients use a private address.
USAGE:
Close active connections before moving an Elastic IP and script the interface attach so failover is a single command, not a console hunt.

## aws-eventbridge-archive-replay | d2
Q:
A Lambda target silently mishandled a week of order events because of a bug. How can EventBridge let you reprocess those events after the fix, and what must already be in place?
A:
An archive must already be attached to the bus; it captures matching events and keeps them for the retention you set, indefinitely by default. After the fix, replay a chosen time window to every rule or only the rules you name. Replayed events return to the same bus, carry a replay-name field so targets can tell them apart, and may arrive out of order, so targets must be idempotent. The trap is a dead-letter queue: it holds events EventBridge could not deliver, not events a target accepted and mishandled. Cron and rate jobs are best done with EventBridge Scheduler; cross-account delivery needs a resource policy on the receiving bus plus a sender rule that targets it through an IAM role.
USAGE:
Wait about ten minutes after the incident window before replaying, because events can lag on their way into the archive and an early replay may miss the tail.

## aws-rds-multi-az-cluster-vs-instance | d3
Q:
A team on RDS for PostgreSQL wants automatic failover and also wants to send reporting queries to a standby. Do they choose a Multi-AZ DB instance or a Multi-AZ DB cluster, and why?
A:
A Multi-AZ DB instance keeps one synchronous standby in a second Availability Zone purely for failover; it cannot serve reads, and failover typically takes 60 to 120 seconds. A Multi-AZ DB cluster runs a writer plus two reader instances across three Availability Zones using semisynchronous replication, where a commit needs acknowledgement from at least one reader. Both readers are automatic failover targets and also serve read traffic, and failover is typically under 35 seconds. The trap is answering "add a read replica", which replicates asynchronously and gives no automatic failover. Multi-AZ DB clusters exist only for RDS for MySQL and PostgreSQL, not for Oracle, SQL Server, MariaDB or Db2.
USAGE:
If write latency on a Multi-AZ DB instance is the complaint, a Multi-AZ DB cluster typically commits faster because it waits for only one of the two readers rather than a fully synchronous standby.

## aws-elasticache-redis-cluster-mode-and-multi-az | d2
Q:
A session store must survive the loss of a cache node without manual intervention, and a separate leaderboard needs a dataset larger than one node can hold. Which ElastiCache options do you pick for each?
A:
For the session store use Redis or Valkey with at least one read replica and Multi-AZ automatic failover enabled: if the primary fails, ElastiCache promotes the replica with the least replication lag and repoints the primary endpoint's DNS, so the application keeps writing without a config change. Replication is asynchronous, so a little data can be lost at failover. For the large dataset use cluster mode enabled, which partitions the keyspace across several shards (node groups), each with its own primary and replicas, and supports online resharding. Memcached is the distractor: simple and multi-threaded, but node-based Memcached has no replication, automatic failover or backup, so losing a node loses its data.
USAGE:
Point clients at the primary endpoint rather than an individual node address, so a failover needs no application change.

## aws-ebs-snapshot-cross-region-copy-and-dlm | d2
Q:
A company must keep nightly EBS backups for 30 days and hold a copy in a second Region for disaster recovery, with no custom scripting. What do you set up, and why does the first cross-Region copy cost more than later ones?
A:
EBS snapshots are incremental, point-in-time backups held in S3 buckets you cannot access directly; only blocks changed since the previous snapshot are stored, and the data is replicated across every Availability Zone in the Region. Amazon Data Lifecycle Manager automates creation, retention and deletion of snapshots and EBS-backed AMIs on a schedule, at no additional cost, and its policies can copy backups to other Regions or accounts for disaster recovery. The first copy into a new Region is a full copy; later copies are incremental only while the previous copy still exists there with the same encryption key. The trap is assuming a snapshot alone survives a Region outage: it stays in one Region until copied.
USAGE:
Deleting old snapshots saves less than expected, because blocks still referenced by a newer snapshot are kept and billed.

## aws-ec2-auto-recovery-and-status-checks | d1
Q:
An EC2 instance fails its system status check. What does that tell you compared with a failed instance status check, and what happens to the instance ID and IP addresses if automatic recovery runs?
A:
A system status check monitors the AWS host under the instance: power loss, lost network or physical hardware faults that AWS must fix. An instance status check monitors the guest: corrupted file system, exhausted memory or a bad kernel, which you fix by rebooting or reconfiguring. Simplified automatic recovery, on by default for supported instance types, reacts only to a failed system check by migrating the instance to another host; it keeps the instance ID, private, public and Elastic IPs and attached EBS volumes, and looks like an unplanned reboot. RAM contents are lost. The trap is expecting recovery after an instance check failure, or on instances with instance store volumes, metal sizes or Auto Scaling group membership.
USAGE:
Recovery restores a single instance; put it behind a load balancer or Auto Scaling group anyway, because one recovered host is not a highly available system.

## aws-aurora-backtrack-and-cloning | d2
Q:
A developer ran a DELETE without a WHERE clause on an Aurora MySQL cluster ten minutes ago, and separately the team wants a production-sized copy for load testing. Which Aurora feature fits each, and why not a snapshot restore?
A:
Backtrack rewinds an existing Aurora MySQL cluster in place to a chosen time within its window (up to 72 hours), in minutes, with no new cluster or endpoint change; it briefly pauses the database, must have been enabled at cluster creation, and is not a backup nor available for Aurora PostgreSQL. Cloning creates a new cluster that initially shares the source's storage pages through copy-on-write, so it is created quickly and you pay only for pages that diverge; writes on the clone never touch the source. A point-in-time restore builds a whole new cluster from backup data and can take hours. The trap is choosing restore for an undo, or backtrack for a test copy.
USAGE:
Stop application writes before backtracking; Aurora closes open connections and discards uncommitted work while it rewinds.

## aws-ebs-volume-types | d2
Q:
You must choose EBS volumes for three workloads: a boot volume hosting a mid-sized database, a log-processing job streaming large sequential files, and a latency-sensitive database needing sustained very high IOPS. Which types, and why?
A:
gp3 is the default choice: it delivers a baseline of 3,000 IOPS and 125 MiB/s regardless of size, never uses burst credits, and lets you provision extra IOPS and throughput independently of capacity, unlike gp2 whose performance scales with size and can exhaust burst credits. io2 Block Express is for sustained high IOPS and sub-millisecond latency database work beyond what gp3 offers. st1, the throughput-oriented HDD, suits big sequential streams such as log processing and data warehouses, and sc1 Cold HDD is the cheapest option for infrequently read data. The trap is HDD for boot or random I/O: st1 and sc1 cannot boot an instance and offer very low IOPS, whereas gp2, gp3, io1 and io2 all can.
USAGE:
Moving gp2 to gp3 is an online Elastic Volumes change that usually lowers cost and removes burst-credit surprises.

## aws-ebs-multi-attach-io2 | d3
Q:
Two EC2 instances in the same Availability Zone must both read and write a single block volume for a clustered database. Can EBS do this, and why is it not simply shared storage like EFS?
A:
Yes, with Multi-Attach: an io1 or io2 volume can attach to several Nitro-based instances in the same Availability Zone, each with full read and write access. It is raw block storage with no coordination, so the instances need a cluster-aware file system or an application that manages write ordering; plain XFS or ext4 mounted from both sides corrupts data. io2 supports NVMe reservations for I/O fencing, io1 does not. Multi-Attach volumes cannot be boot volumes or cross zones, and gp2, gp3, st1 and sc1 do not support it. The trap is picking Multi-Attach for ordinary shared files across many instances or zones: that job belongs to EFS, a managed NFS service which handles concurrency.
USAGE:
Set delete-on-termination the same way on every attached instance; the last instance terminated decides whether the shared volume is deleted.

## aws-efs-performance-and-throughput-modes | d2
Q:
A fleet of Linux web servers across three Availability Zones needs a shared POSIX file system whose load is spiky and hard to forecast. Which EFS performance mode and throughput mode do you choose?
A:
EFS is a serverless NFSv4 file system; a Regional file system keeps data across multiple Availability Zones and mounts on many Linux clients at once, but not on Windows. Choose General Purpose performance mode, the default with the lowest per-operation latency; Max I/O is a previous-generation mode for highly parallel work that tolerates higher latency and cannot pair with Elastic throughput. Choose Elastic throughput, the recommended default: it scales automatically and bills for data moved, which suits spiky loads. Provisioned fixes a throughput level independent of size, and Bursting ties throughput to stored size using burst credits. The trap is Bursting on a small, busy file system: little data means a tiny baseline and exhausted credits.
USAGE:
If a Bursting-mode file system slows down as it empties, switch to Elastic rather than padding it with dummy files to raise the baseline.

## aws-fsx-windows-vs-lustre-vs-ontap | d2
Q:
Four requests arrive: Windows home directories joined to Active Directory, a machine-learning job that must read a large S3 dataset at high speed, an on-premises NetApp migration needing NFS and SMB together with snapshots, and a lift of a Linux ZFS file server. Which FSx flavour serves each?
A:
FSx for Windows File Server is a native Windows file system served over SMB with Windows ACLs and Active Directory authentication, in Single-AZ or Multi-AZ form. FSx for Lustre is the POSIX, Linux-only pick for HPC and machine learning; link it to an S3 bucket and the objects appear as files, in scratch (unreplicated) or persistent deployments. FSx for NetApp ONTAP serves NFS, SMB and iSCSI from one file system with snapshots, cloning, SnapMirror replication and automatic tiering, built for NetApp migrations. FSx for OpenZFS is an NFS service with snapshots and cloning for lifting ZFS or Linux file servers. The trap is EFS for anything Windows or SMB: EFS is NFS and Linux only.
USAGE:
FSx for Windows shares are also reachable from Linux clients over SMB, so a mixed fleet does not automatically force you onto ONTAP.

## aws-s3-performance-prefixes-multipart | d2
Q:
A data pipeline writes millions of small objects to one S3 bucket under a single date prefix and starts receiving 503 Slow Down errors. What is the fix, and how do you speed up a single multi-gigabyte upload or download?
A:
S3 scales request capacity per prefix: the documented baseline is at least 3,500 PUT, COPY, POST or DELETE and 5,500 GET or HEAD requests per second per prefix, with no limit on the number of prefixes. Spreading keys across several prefixes multiplies that capacity, and 503 errors under one hot prefix mean S3 is still scaling. For large objects, multipart upload is recommended from about 100 MB and is mandatory above the 5 GB single PUT ceiling, because parts upload in parallel and only a failed part is retried. For downloads, issue byte-range GETs on separate connections, ideally aligned to the original part boundaries. The trap is Transfer Acceleration, which addresses geographic distance, not request rate or parallelism.
USAGE:
Add a lifecycle rule with AbortIncompleteMultipartUpload, because abandoned parts are billed as storage until the upload is completed or aborted.

## aws-s3-transfer-acceleration | d1
Q:
Users on several continents upload large video files to one S3 bucket in us-east-1 and complain about slow uploads. Which S3 feature helps, and what does it not fix?
A:
Enable S3 Transfer Acceleration on the bucket and point clients at the bucket-name.s3-accelerate.amazonaws.com endpoint. Data then enters the nearest CloudFront edge location and travels to the bucket over an optimised AWS network path instead of the public internet, which is why it helps clients that are far from the bucket Region or cannot fill their available bandwidth. It is a bucket-level setting, the bucket name must not contain periods, and it adds a data transfer charge. It does not replace multipart upload: acceleration shortens the network path, multipart parallelises a single large object, and the two can be combined. The exam distractor is suggesting acceleration for clients in the same Region, where it gains little.
USAGE:
Run the Transfer Acceleration Speed Comparison tool from where your clients actually are before enabling it, since the gain depends entirely on distance and route quality.

## aws-s3-select-and-athena | d2
Q:
An application needs only a few columns from one large CSV object in S3, while an analyst wants to run ad hoc SQL across a whole bucket of logs. Which service fits each, and how do you keep the cost down?
A:
S3 Select runs a SQL expression against one CSV, JSON or Parquet object and returns only the matching subset, so less data crosses the network and retrieval cost and latency fall. Athena is a serverless engine that runs SQL over many objects in S3 and charges per query for the data it scans, which makes it the answer for ad hoc analytics across a bucket. Cut that scan with columnar Parquet or ORC, whose predicate pushdown lets Athena skip blocks, and with partitions so a WHERE clause on the partition key reads only matching paths. The trap is choosing Athena to filter one object, or S3 Select for joins across objects.
USAGE:
AWS has closed S3 Select, including the Select restore type for archived objects, to new customers, so for new designs use Athena or fetch only the byte ranges you need, even though the exam still tests the S3 Select rule.

## aws-cloudfront-caching-ttl-and-invalidation | d2
Q:
A team deploys a new app.js behind CloudFront but users keep getting the old file for a day. Why does that happen, and what is the cheaper long-term fix than invalidating?
A:
CloudFront picks a cache behaviour by matching the request path against path patterns in listed order, first match wins, default * last. That behaviour's cache policy decides the TTL: an origin Cache-Control max-age, s-maxage or Expires header is honoured within the minimum and maximum TTL, and with no header the default TTL applies, 86400 seconds unless changed, hence the day-old file. Invalidation works, but only the first 1,000 paths per month per account are free and further paths are billed, so the recommended fix is a versioned file name, which beats browser and proxy caches too. The trap is treating invalidation as the routine deployment step.
USAGE:
A wildcard such as /images/* counts as one invalidation path however many files it clears, so invalidate by prefix rather than listing individual files.

## aws-cloudfront-signed-urls-vs-cookies | d2
Q:
A subscription video site serves hundreds of HLS segment files per stream through CloudFront, and a separate page offers a single paid installer download. Which private-content mechanism suits each, and what stops a user bypassing it?
A:
Use a signed URL for the installer: it grants access to one file and works for clients that cannot hold cookies. Use signed cookies for the video, because one Set-Cookie response covers every segment without rewriting hundreds of URLs. Both are signed with the private key of a signer attached to the cache behaviour; prefer a trusted key group over the root-account CloudFront key pair, since key groups are managed by API and IAM and support rotation. Signing only protects the CloudFront path, so lock the S3 origin to the distribution with origin access control, otherwise the direct S3 URL bypasses everything. The subtle trap is behaviour ordering: an earlier path pattern without a signer serves the file unsigned.
USAGE:
Rotate signing keys by adding the new public key to the key group first and removing the old one only after every URL or cookie signed with it has expired.

## aws-cloudfront-lambda-edge-vs-functions | d3
Q:
One requirement is to rewrite URLs and add a security header on every viewer request at millions of requests per second; another is to fetch a personalisation record from DynamoDB before a request reaches the origin. Which edge compute option fits each, and why can the first not do the second?
A:
CloudFront Functions is JavaScript that runs in under a millisecond on viewer request and viewer response only, scales to millions of requests per second, and has no network, file system or request body access. That suits header edits, redirects and cache key normalisation. Lambda@Edge runs Node.js or Python for up to 30 seconds, can call AWS or external services, can read the body, and also hooks origin request and origin response, which fire only on a cache miss, the place to enrich a request before it reaches the origin. The DynamoDB lookup therefore belongs in Lambda@Edge on origin request. The trap is using Lambda@Edge for trivial header work, or expecting CloudFront Functions to make a network call.
USAGE:
Attach heavy logic to the origin request event rather than viewer request so it runs only on cache misses and CloudFront caches its result with the object.

## aws-global-accelerator-vs-cloudfront | d2
Q:
A multiplayer game uses a custom UDP protocol, partner firewalls must allow-list fixed IP addresses, and players are on several continents. Why is CloudFront the wrong answer and Global Accelerator the right one?
A:
CloudFront is an HTTP content delivery network: it caches responses at edge locations and understands only HTTP requests, so it cannot carry a custom UDP game protocol. Global Accelerator provides two static anycast IPv4 addresses that stay fixed while the accelerator exists, so partners allow-list them once; clients connect to the nearest edge, then traffic rides the AWS global network to an ALB, NLB, EC2 instance or Elastic IP in the closest healthy Region. Listeners support TCP and UDP, health checks instantly send new connections to another healthy endpoint, and it caches nothing. Choose CloudFront for cacheable HTTP content and Global Accelerator for non-HTTP protocols, static IPs or fast Regional failover; the trap is assuming either service does both jobs.
USAGE:
Deleting an accelerator releases its static IPs permanently, so restrict delete permissions with IAM and disable rather than delete when pausing a service.

## aws-elasticache-redis-vs-memcached | d2
Q:
A gaming backend needs a real-time top-10 leaderboard, a pub/sub channel for match events, and the cache must survive a node failure. Which ElastiCache engine, and when would Memcached have been the better pick?
A:
Choose Redis OSS or Valkey. Sorted sets rank every score on insert, so a ZADD plus a range query is the whole leaderboard; pub/sub is native; and replication with automatic failover plus backup and restore survive a node loss. Memcached has none of that: simple values, no replication or automatic failover, no pub/sub, no sorted sets, and no backups for node-based clusters. Its strengths are a multithreaded engine that uses every core of a large node and easy scale-out by adding or removing nodes, so it wins when the question wants the simplest object cache that can lose data without harm. The trap is picking Memcached for simplicity when the scenario names a data structure, durability or messaging.
USAGE:
If the cache only holds rendered fragments or query results you can regenerate, Memcached scale-out is enough; reach for Redis or Valkey when the cache holds anything you would mind losing.

## aws-elasticache-lazy-loading-vs-write-through | d2
Q:
A product catalogue cache returns prices that changed in the database an hour ago, while another team's write-through cache is full of items nobody reads. What is happening in each case, and what single addition helps both?
A:
Lazy loading fills the cache only on a read miss, so only requested data is cached and an empty replacement node merely slows reads, but nothing refreshes an entry when the database changes, hence the hour-old price. Write-through updates the cache on every database write, so entries are never stale, at the cost of a write penalty, churn from data written but never read, and a new node that stays empty until the next write. A TTL on every entry bounds staleness under lazy loading and expires unread items under write-through; the docs recommend combining both strategies with a TTL. The trap is answering write-through for a read-heavy catalogue while forgetting it cannot warm a fresh node.
USAGE:
A session store is the textbook fit: write each session through with a TTL equal to the session lifetime, so expiry and eviction become the same operation.

## aws-dynamodb-dax | d2
Q:
A read-heavy DynamoDB application repeatedly fetches the same hot items and needs microsecond reads. Why choose DAX over ElastiCache, and when does DAX not help?
A:
DAX is a write-through cache that is API-compatible with DynamoDB, so you swap the DynamoDB client for the DAX client and it serves eventually consistent GetItem, Query and Scan results from memory, dropping latency from milliseconds to microseconds while cutting the read capacity you must provision. It runs as a cluster inside your VPC. It does not cache strongly consistent or transactional reads; those pass straight through to DynamoDB, so a workload that needs ConsistentRead gains nothing. It also suits write-heavy workloads poorly. ElastiCache is the distractor: a general in-memory store for Valkey, Redis OSS or Memcached that knows nothing of the DynamoDB API, so your code must manage what is cached and when it is invalidated.
USAGE:
Set the item and query cache TTLs deliberately, because writes that bypass DAX stay invisible to cached readers until the TTL expires.

## aws-dynamodb-gsi-vs-lsi | d3
Q:
A DynamoDB table already exists and you need to query by an attribute that is not in the primary key. Which index type can you add now, and what would an LSI have given you that a GSI cannot?
A:
Only a global secondary index can be added to an existing table; local secondary indexes must be defined when the table is created and cannot be added or removed afterwards. A GSI can use any partition key and sort key, has its own provisioned throughput, and supports only eventually consistent reads. An LSI keeps the table's partition key and swaps the sort key, shares the base table's capacity, allows strongly consistent reads, and can fetch non-projected attributes from the table, but for each partition key value the total size of indexed items must stay within 10 GB. The trap is an LSI on an existing table, or a GSI where strong consistency is required.
USAGE:
Model your access patterns before creating the table, because forgetting an LSI later means recreating the table and migrating the data.

## aws-rds-proxy | d2
Q:
Hundreds of Lambda functions open short-lived connections to an RDS MySQL instance and it starts returning too many connections errors. What do you put in front of the database, and why not just use a larger instance?
A:
Add RDS Proxy. It holds a pool of long-lived connections to the database and lets many client connections share them, so the memory and CPU cost of opening a fresh connection per Lambda invocation disappears and surplus requests are queued rather than failing. It also bypasses DNS caches on Multi-AZ failover, shortening failover time while keeping application connections alive. Clients can authenticate with IAM, and the proxy fetches database credentials from Secrets Manager, so functions carry no passwords. Constraints: the proxy must sit in the same VPC as the database and is never publicly accessible. A bigger instance is the distractor; it raises the ceiling but does not remove connection churn.
USAGE:
Point every client at the proxy endpoint rather than the instance endpoint, otherwise client-side DNS caching brings back the slow failover the proxy was meant to remove.

## aws-aurora-reader-endpoint-and-autoscaling | d2
Q:
Reporting queries are slowing an Aurora cluster's primary instance and read demand spikes unpredictably during the day. Which endpoint should the reports use, and how do you add read capacity automatically?
A:
Point reports at the reader endpoint. The cluster (writer) endpoint always resolves to the primary and follows failover; the reader endpoint balances each new connection across the Aurora Replicas, taking read traffic off the primary. It balances connections, not individual queries, so a long-lived connection stays on one replica. Custom endpoints let you group specific instances, for example larger readers reserved for analytics. For elastic capacity, attach an Aurora Auto Scaling policy that targets average CPU utilisation or average connections of the replicas; it adds readers up to the maximum you set and removes only the ones it created. The distractor is the instance endpoint, which pins clients to one node and does not reroute when that instance fails.
USAGE:
Auto scaling only helps if clients connect through the reader endpoint, so hard-coded instance hostnames silently ignore every replica it adds.

## aws-ec2-instance-families | d1
Q:
Match the EC2 family letter to the workload: a web tier with idle periods, a video encoder, an in-memory database, a node with heavy local disk I/O, and a deep learning trainer.
A:
M is the general purpose balance of compute, memory and network for web servers. T is also general purpose but burstable: it earns CPU credits below its baseline and spends them to burst, cheap for spiky traffic, wrong for sustained load. C is compute optimised for batch, transcoding and HPC. R and X are memory optimised for in-memory data sets. I and D are storage optimised for heavy sequential I/O on local disks. P and G are accelerated computing, using GPU co-processors for work such as model training and graphics. A g in the family name means an AWS Graviton Arm processor, which improves price performance but runs Linux only. The trap is T for a constant CPU workload.
USAGE:
If a T instance slows down under steady load, check whether its CPU credits are exhausted before blaming the application.

## aws-ec2-placement-groups | d2
Q:
When do you choose a cluster, spread or partition placement group, and which one cannot hold fifty instances in a single Availability Zone?
A:
Cluster packs instances close together inside one Availability Zone for the low latency and high throughput that tightly coupled HPC needs; it cannot span AZs, so launch the whole group in one request to avoid capacity errors. Spread puts each instance on distinct hardware to keep a few critical instances from failing together; it can span AZs but permits only seven running instances per AZ, so it cannot hold a fifty-node fleet. Partition splits the group into logical partitions on separate racks, up to seven per AZ, with no instance cap, and shows the layout to topology-aware software such as Hadoop and Cassandra. The trap is spread when the scenario needs scale, or cluster when it needs fault isolation.
USAGE:
Use one instance type and a single launch request for a cluster group, because topping it up later with a different size is the classic insufficient capacity error.

## aws-kinesis-data-streams-vs-firehose | d2
Q:
Clickstream events must land in S3 within about a minute with no consumer code to maintain, while a second team wants to run custom real-time anomaly detection on the same events. Which Kinesis service serves each need?
A:
Firehose for the S3 landing. It is fully managed: it buffers incoming records by size or time, optionally invokes a Lambda function to transform them, then delivers to S3, Redshift, OpenSearch, Splunk or HTTP endpoints. There are no shards to size and no consumer application to run, but buffering makes it near real time. Kinesis Data Streams for the anomaly detector. You choose shards or on-demand capacity, records are retained for 24 hours by default and up to 365 days, and many custom consumer applications can read the same stream independently with put-to-get delay typically under a second. The distractor is Firehose for the second team; it delivers, it does not let your code consume or replay.
USAGE:
If you need both, chain them: Firehose can read from a Kinesis data stream as its source, so one stream feeds custom consumers and the archive.

## aws-kinesis-shards-and-partition-keys | d3
Q:
A provisioned Kinesis stream with ten shards throttles producers with ProvisionedThroughputExceededException while total traffic is well under capacity. What is the likely cause, and what are the fixes?
A:
A shard is fixed capacity: 1 MB and 1000 records per second in, 2 MB per second out. The partition key is MD5-hashed to pick the shard, so a skewed key drives most records to a single shard, which throttles while the rest idle; limits apply per shard, not per stream. Fix the key, or split the hot shard in provisioned mode. On-demand mode auto-scales shards but does not isolate one key that exceeds a single shard's limits. Standard consumers share each shard's 2 MB per second; enhanced fan-out gives each consumer a dedicated 2 MB per second. SQS, the distractor, has no shards to size but delivers each message to a single consumer rather than to many replaying applications.
USAGE:
Use a high-cardinality partition key such as a device or session ID and inspect per-shard traffic before adding shards, because more shards never fix one hot key.

## aws-api-gateway-caching-and-throttling | d2
Q:
A REST API backed by Lambda returns the same catalogue data to thousands of clients, and a few clients are hammering it. Where do you enable caching, and how do you limit each client?
A:
Caching is a REST API feature provisioned per stage; API Gateway then serves repeated GET requests from the cache for the TTL, 300 seconds by default and at most 3600, so fewer calls reach the backend. Only GET is cached unless you override a method. Per client limits need a usage plan, which ties an API key to a stage with a rate, a burst and a quota; a key alone identifies a caller but throttles nothing. Throttled callers get 429 Too Many Requests, and plan limits apply before stage and account limits. The integration timeout ceiling is 29 seconds by default; Regional and private APIs can raise it, possibly costing Region level throttle quota, but edge optimised APIs cannot.
USAGE:
Never use API keys as your authentication mechanism; pair a usage plan with IAM, Cognito or a Lambda authoriser, and treat plan quotas as best effort targets rather than hard cost controls.

## aws-api-gateway-rest-vs-http-vs-websocket | d2
Q:
When do you pick an HTTP API over a REST API in API Gateway, and when is neither of them the right answer?
A:
HTTP APIs suit a plain Lambda or HTTP proxy front end: they are minimal so they cost less, they have native JWT authorisers and automatic deployments, and their integration timeout is capped at 30 seconds. REST APIs are required whenever the question mentions API keys and usage plans, per client throttling, response caching, request validation, AWS WAF, resource policies, private endpoints, canary releases or X-Ray, because HTTP APIs support none of these. Neither fits a chat or live dashboard where the server must push messages: that is a WebSocket API, which holds a persistent two way connection and routes messages through $connect, $disconnect and custom routes. The trap is choosing HTTP for price when a listed requirement needs REST.
USAGE:
Check whether the API must be reachable only from inside a VPC before committing to an HTTP API, because only REST APIs offer the private endpoint type.

## aws-lambda-performance-memory-and-layers | d2
Q:
A CPU heavy Lambda function takes eight seconds at 128 MB. Why can raising its memory make it both faster and cheaper, and what do layers and container images change?
A:
Lambda has one performance lever: CPU is allocated in proportion to memory, from 128 MB to 10,240 MB, with a full vCPU at 1,769 MB. A CPU, network or memory bound function finishes sooner with more memory, and because billing multiplies memory by duration in GB-seconds, a run that is much shorter can cost the same or less despite the higher rate. The trap is cutting memory to save money and paying for a longer duration instead. Layers are zip archives of shared dependencies extracted to /opt, at most five per function and counted within the 250 MB unzipped limit; container image functions cannot use layers but can be up to 10 GB.
USAGE:
Use the AWS Lambda Power Tuning tool to choose memory from measured cost and duration rather than guessing, and raise /tmp ephemeral storage separately when a job must stage large files.

## aws-lambda-event-source-mappings-sqs-batching | d2
Q:
A Lambda function reads an SQS queue, and one bad message in a batch of ten causes all ten to be reprocessed. What is happening, and how do you fix it without shrinking the batch?
A:
SQS, Kinesis and DynamoDB Streams do not push to Lambda; an event source mapping polls them and invokes the function with a batch, whereas S3 and SNS push. The batch is sent when the batch size is reached, the batching window of up to 300 seconds expires, or the payload hits 6 MB. On error the whole batch is retried by default, so processed messages reappear after the visibility timeout. Enable ReportBatchItemFailures and return the failed message IDs in batchItemFailures; only those become visible again. Throwing an exception fails the whole batch. For SQS standard queues Lambda starts at five concurrent invocations and adds up to 300 per minute; use the mapping's maximum concurrency setting to cap it.
CODE: json
{
  "batchItemFailures": [
    { "itemIdentifier": "id2" }
  ]
}
USAGE:
Make the handler idempotent regardless, because event source mappings deliver at least once and a batch can be redelivered after a timeout even when every message succeeded.

## aws-step-functions-standard-vs-express | d2
Q:
An order pipeline charges a card, waits up to two days for a warehouse callback, then emails the customer. Which Step Functions workflow type do you choose, and when would Express be right instead?
A:
Choose Standard. It runs for up to a year, executes each state exactly once, supports the .sync and .waitForTaskToken patterns that let a workflow pause for a human or external callback, and is billed per state transition. Express runs for at most five minutes, is billed by executions, duration and memory, keeps history only in CloudWatch Logs, and supports request response integrations only. Asynchronous Express is at least once and synchronous Express is at most once, so Express suits high volume idempotent work such as IoT ingestion or stream transformation, not payments. The trap is picking Express for cheapness when the workflow needs a callback, a long wait, or a step that must not repeat.
USAGE:
Whichever type you choose, put retries, error catching, branching and parallel fan out in the state machine rather than hand coding them into a chain of Lambda functions that call each other.

## aws-opensearch-use-cases | d1
Q:
Which AWS service handles full text search and log analytics with dashboards, and when are CloudWatch Logs Insights or Athena the better answer?
A:
Amazon OpenSearch Service runs managed OpenSearch clusters, a search and analytics engine built for full text search, log analytics, application monitoring and clickstream analysis, with OpenSearch Dashboards for visualisation. It is usually fed from other stores such as S3, Kinesis, DynamoDB and CloudWatch Logs. Treat it as a searchable index beside your system of record, not as the primary database. CloudWatch Logs Insights is the answer when the requirement is only to query logs already in CloudWatch Logs with no extra infrastructure, and Athena is the answer for SQL over files in S3. The trap is reaching for an OpenSearch domain, billed by instance hour, when a query on existing logs or S3 data would do.
USAGE:
Plan index retention from day one, because indexes grow without limit and the UltraWarm and cold storage tiers exist precisely to move old read only data off the expensive hot nodes.

## aws-redshift-vs-athena-vs-emr | d2
Q:
One team wants occasional SQL over CSV and Parquet files already in S3 with no servers, another needs nightly BI reports joining dozens of very large tables. Which service fits each, and where does EMR belong?
A:
Athena fits the first team: a serverless query service that runs standard SQL straight against S3 objects through Glue Data Catalog tables, billed per query, so it wins whenever the question stresses ad hoc queries, data left in S3 and no infrastructure. Redshift fits the second: a petabyte scale data warehouse, provisioned or serverless, whose engine is optimised for complex queries that join many large tables, so it wins for consolidated history and BI reporting; Redshift Spectrum can read S3 files without loading them. EMR is a managed Hadoop, Spark and Presto cluster for custom big data code when you want cluster control. The trap is choosing EMR or Redshift when the workload is plain SQL over S3.
USAGE:
Convert S3 data to partitioned Parquet or ORC before pointing Athena at it; columnar formats let a query read only the columns it needs, which shortens queries and lowers cost.

## aws-glue-etl-and-catalog | d1
Q:
New JSON files land in S3 every hour and must be cleaned, converted to Parquet and made queryable by Athena with no servers to manage. Which service, and what does the Data Catalog add?
A:
AWS Glue. It is a serverless data integration service: a crawler scans the S3 prefix, infers the schema and writes table definitions into the Glue Data Catalog, and a Glue ETL job on its serverless Spark engine, written in code or visually in Glue Studio, transforms the files on a schedule or trigger. The Catalog is the shared metadata store, so once tables exist there Athena, EMR and Redshift Spectrum can query the data at once. Glue DataBrew is the no code option with over 250 built in transformations. The trap is answering EMR, which exists for custom Spark or Hive code and on EC2 needs a cluster you operate, or Lambda, whose standard timeout is 15 minutes.
USAGE:
Run the crawler on a schedule or after each ETL job, because a new partition or column that is missing from the Catalog stays invisible to Athena until the table definition is refreshed.

## aws-aurora-vs-dynamodb-choice | d2
Q:
A new service needs a serverless database. When does that mean DynamoDB, and when is Aurora still the right answer even though the word serverless appears?
A:
Decide on access pattern, not the word serverless. DynamoDB is a serverless NoSQL key value and document store with single digit millisecond latency at any scale and on demand capacity scaling to zero; it has no JOIN, so you denormalise around known key lookups. It does offer ACID transactions, but each is capped at 100 items and 4 MB and consumes double capacity, so they do not replace a relational model. Aurora is a MySQL or PostgreSQL compatible relational engine with SQL joins and transactions across many tables, and Aurora Serverless scales capacity in half ACU steps and can pause to zero. The trap is choosing DynamoDB because the question says serverless when the workload needs joins or unpredictable queries.
USAGE:
If you find yourself planning a second DynamoDB table just to answer a query the first cannot, check whether the real requirement is relational; secondary indexes cover alternate keys, not joins.

## aws-lambda-limits-timeout-payload | d1
Q:
A video transcoding job takes about 40 minutes per file and the team wants to run it as a standard Lambda function. Which limit stops that, and where should the job run instead?
A:
A standard Lambda function times out after 900 seconds, or 15 minutes, per invocation, so a 40 minute transcode fails before it finishes, and Service Quotas cannot raise that ceiling. The only exception is Lambda Managed Instances, an EC2 based compute type whose asynchronous and most event source mapping invocations can run up to 90 minutes. The other fixed ceilings are 128 MB to 10,240 MB of memory, 6 MB synchronous payloads (1 MB asynchronous), 50 MB zipped or 250 MB unzipped packages and 10 GB container images. Run long continuous work on Fargate, queue it through AWS Batch, or split it into steps that Step Functions orchestrates. The distractor is adding memory: it buys CPU, not time.
USAGE:
Profile the slowest inputs, not only the typical ones, before committing to Lambda; a job that overruns the timeout only occasionally is the hardest kind of failure to diagnose and forces a redesign later.

## aws-appsync-graphql | d1
Q:
A mobile app needs one endpoint that reads from DynamoDB and a Lambda function, pushes live updates to clients, and keeps working offline. Why is AppSync a better fit than an API Gateway REST API?
A:
AppSync is a managed GraphQL service: clients request exactly the fields they need and resolvers fetch them from DynamoDB, Lambda, RDS, OpenSearch or HTTP endpoints through one endpoint, avoiding the over-fetching and round trips of REST. Subscriptions fire in response to mutations over WebSockets that AppSync establishes and maintains, and Amplify DataStore clients generated from the schema give mobile apps offline sync. Caching, WAF and API keys are not differentiators: AppSync has them too. A REST API wins when you need request validation against a JSON schema, usage plans, or a plain proxy for an ordinary HTTP backend. The distractor is an API Gateway WebSocket API: it pushes both ways, but you write connection handling and data fetching yourself.
USAGE:
Do not reach for GraphQL because it is newer; if every client needs the same fixed payloads, a REST API is simpler to build, cache and secure.

## aws-s3-glacier-retrieval-tiers | d2
Q:
Compliance archives are read perhaps once a year, but when auditors ask, a handful of files must be back within minutes. Which Glacier class and retrieval tier do you pick, and what does Deep Archive change?
A:
Pick S3 Glacier Flexible Retrieval: minimum storage 90 days, with three restore tiers, Expedited in about 1 to 5 minutes, Standard in 3 to 5 hours, and Bulk in 5 to 12 hours as the cheapest option, free for this class. S3 Glacier Deep Archive costs least but carries a 180 day minimum, Standard restores of up to 12 hours, Bulk up to 48 hours, and no Expedited tier, so it suits data you can wait half a day for. If the need is millisecond access with no restore step, that is S3 Glacier Instant Retrieval, which charges a per-GB retrieval fee. The distractor is Deep Archive for any 'minutes' requirement: nothing there returns in minutes.
USAGE:
Expedited retrievals can be refused during periods of high demand unless you buy provisioned capacity, so do not promise minute-level restores without it.

## aws-s3-requester-pays-and-data-transfer | d1
Q:
A research group publishes a multi-terabyte dataset in S3 and does not want to pay every time outsiders download it. What setting solves this, and what does the owner still pay for?
A:
Turn on Requester Pays on the bucket: the requester is billed for the request and the download, while the bucket owner always pays for storage. Requesters must authenticate and accept the charge by sending the x-amz-request-payer header (or --request-payer in the CLI); anonymous access is not allowed, so a fully public dataset cannot use it. It works because S3 charges for data transfer out to the internet, whereas inbound transfer is free and, in most cases, transfer between AWS services in the same Region, such as S3 to an EC2 instance, has no charge. The distractor is expecting Requester Pays to shift the storage bill too, or expecting unsigned public downloads to keep working.
USAGE:
Consumers have to opt in explicitly with the request-payer flag, so document it for anyone you share the bucket with or their downloads will fail.

## aws-savings-plans-vs-reserved-instances | d2
Q:
A company runs steady EC2 workloads plus some Fargate and Lambda, and may move between instance families and Regions next year. Which commitment gives the discount without locking them in, and when does a Reserved Instance still win?
A:
A Compute Savings Plan: you commit to a dollar amount per hour and the discount, up to 66 percent, applies to EC2 usage of any family, size, OS, tenancy or Region, plus Fargate and Lambda. An EC2 Instance Savings Plan reaches 72 percent but ties you to one instance family in one Region. Standard RIs give the same 72 percent yet can only be modified, and Convertible RIs can be exchanged but cap at 66 percent. An RI wins only when capacity matters: a zonal RI reserves capacity in one Availability Zone, whereas regional RIs and Savings Plans reserve nothing, so add an On-Demand Capacity Reservation if needed. The distractor is a Standard RI when the question stresses flexibility.
USAGE:
Savings Plans do not cover Spot usage or usage already covered by RIs, so size the hourly commitment on your On-Demand baseline only.

## aws-spot-fleet-and-interruption-handling | d2
Q:
A rendering farm on Spot keeps losing instances mid-job. How should the fleet be configured, and how does the application survive an interruption?
A:
Diversify: run an Auto Scaling group mixed instances policy or EC2 Fleet across many instance types and Availability Zones with the price-capacity-optimized allocation strategy, so instances come from the pools least likely to be reclaimed; lowest-price carries the highest interruption risk. EC2 sends an interruption notice two minutes before stopping or terminating a Spot Instance, as an EventBridge event and in instance metadata, on a best-effort basis, and a rebalance recommendation can arrive earlier. The application must checkpoint progress to S3, EBS or DynamoDB and split jobs into small tasks so a replacement instance can resume. The distractor is Spot blocks with a defined duration: they are no longer available, so no answer can promise an uninterrupted run.
USAGE:
Poll the instance metadata interruption endpoint every few seconds and drain work on notice, then test with a forced interruption because the two-minute warning is best effort.

## aws-ec2-dedicated-hosts-vs-instances | d2
Q:
One team must bring its own per-core Windows Server and SQL Server licences to AWS; another team simply needs hardware not shared with other customers. Which tenancy option does each need?
A:
The licensing team needs Dedicated Hosts: a physical server allocated to your account, billed per host, that shows the number of sockets and physical cores and supports host affinity, which per-socket, per-core or per-VM licence terms require. The isolation team only needs Dedicated Instances: hardware dedicated to one account, billed per instance, with no placement visibility and only partial BYOL support (SQL Server with License Mobility, Windows VDA). Security and performance are identical, and Dedicated Instances add an hourly fee in each Region where one runs. Capacity Reservations work with Dedicated Instances but not with Dedicated Hosts. The distractor is picking Dedicated Instances for per-core licences: without core visibility the licence cannot be applied.
USAGE:
Dedicated Instances may still share a host with your own non-dedicated instances, so they satisfy 'not shared with other customers', not 'a whole box to myself'.

## aws-nat-gateway-cost-vs-vpc-endpoint | d2
Q:
Private-subnet instances push terabytes into S3 every night through a NAT Gateway and the VPC bill has ballooned. What is being charged, and what removes it?
A:
A NAT Gateway is billed per hour plus per gigabyte processed, so bulk S3 or DynamoDB traffic through it pays a processing charge on the whole volume even though that traffic never leaves the AWS network. Add a gateway VPC endpoint for S3 (and DynamoDB): it has no additional charge and inserts a prefix-list route into the subnet route tables that beats the 0.0.0.0/0 route to the NAT, so the traffic bypasses the NAT. Keep the NAT for internet destinations, one per Availability Zone routed locally, to avoid cross-AZ data charges and so a single zone failure does not cut off the others. The distractor is an interface endpoint for S3: PrivateLink charges hourly and per GB.
USAGE:
Gateway endpoints are Region-specific and cannot be reached over peering, VPN or Direct Connect, so traffic to a bucket in another Region still falls back to the NAT.

## aws-data-transfer-costs-az-region | d2
Q:
A web tier in one Availability Zone talks constantly to a cache tier in another, and static files are served straight from S3 to the internet. Where are the hidden transfer charges, and how do you cut them?
A:
Inter-AZ traffic is charged, and both the inbound and outbound bytes are metered, so chatty tiers pay twice; traffic that stays in one zone is free. Data in from the internet is free, data out is charged per GB at rates that fall with volume, and cross-Region transfer is charged on the outbound side. Using an instance's public or Elastic IP is billed as regional or internet transfer, so use private IPs. For static files put CloudFront in front of S3: transfer from an AWS origin to CloudFront is free, edge caching cuts origin fetches, and you pay only CloudFront egress. The distractor is splitting tightly coupled tiers across zones without noticing every call crosses a metered boundary.
USAGE:
Before pinning tiers to a single zone to save transfer cost, weigh it against losing zone-level resilience; the cheapest design is also the most fragile.

## aws-cloudfront-cost-reduction | d1
Q:
A static site served straight from S3 is paying for data transfer and requests from viewers worldwide. How does CloudFront lower that bill, and which three distribution settings cut it further?
A:
CloudFront caches objects at edge locations, so repeat requests never reach S3, and transfer from AWS origins such as S3 or ELB into CloudFront is free; you pay for CloudFront to viewer transfer and requests. A price class other than PriceClass_All serves only from cheaper edge regions, so viewers near excluded regions may see slower responses. Origin Shield adds a regional caching layer that consolidates duplicate requests from many edge caches into as few as one origin fetch, cutting origin load and data transfer out, at an additional per-request charge. Compression with Gzip or Brotli shrinks text assets, and transfer is billed by bytes served. The trap is picking a price class to improve performance; it only lowers cost.
USAGE:
Enable compression and check that the origin returns a Content-Length header, because CloudFront skips compression for objects outside its size range or without that header.

## aws-aurora-serverless-v2 | d2
Q:
A team runs a dev database and a production API whose traffic spikes unpredictably. When is Aurora Serverless v2 the cheaper choice over provisioned Aurora, and what changed from v1?
A:
Aurora Serverless v2 scales compute in Aurora capacity units, each about 2 GiB of memory plus CPU, in steps as small as 0.5 ACU, without waiting for a quiet point, billed per second. That suits spiky, unpredictable, multi-tenant or dev and test workloads, because you stop paying for a peak you rarely reach. For a steady load choose provisioned instances, whose constant capacity is easy to forecast; serverless elasticity earns nothing when usage never dips. Version 1 doubled or halved capacity and was the only option that paused to zero; it is deprecated, and recent v2 engine versions also scale to 0 ACUs with auto-pause. The trap is picking serverless for a flat 24x7 workload because the name sounds cheaper.
USAGE:
Set the minimum ACU high enough to keep the working set in the buffer pool, otherwise every idle period evicts the cache and the first busy minute pays for it in latency.

## aws-dynamodb-standard-ia-table-class | d1
Q:
A DynamoDB table holds years of order history that is rarely read but must stay queryable. Which table class lowers the bill, and what is the trade-off?
A:
Switch the table to the DynamoDB Standard-IA table class. It charges less per GB stored but more per read and write request than the default Standard class, so it pays off when storage exceeds 50 percent of the table's throughput cost under Standard. Performance, durability and availability are identical, and features such as TTL, PITR and on-demand mode still work, though every index inherits the table's class. You can switch back, but only two class changes are allowed in a trailing 30-day period. Reserved capacity is a separate lever for provisioned Standard tables only; it is not offered for Standard-IA or on-demand tables. The trap is treating Standard-IA as a general discount for a busy table.
USAGE:
Compare the table's storage cost against its throughput cost in Cost Explorer before switching, because you only get two class changes per 30 days to undo a wrong call.

## aws-lambda-pricing-and-graviton | d1
Q:
What does AWS bill a Lambda function for, and which two changes cut the bill without touching the code?
A:
Lambda bills per request plus duration in GB-seconds, allocated memory times run time, with billed duration rounded up to the nearest millisecond. The free tier covers one million requests and 400,000 GB-seconds a month. Setting the architecture to arm64 runs the function on Graviton2, which is priced lower per GB-second and documented as significantly better price performance, provided your dependencies and layers ship arm64 builds. Right-sizing memory matters because CPU scales with memory, so a CPU-bound function at 128 MB can run long enough to cost more than the same code at 1,024 MB finishing sooner; the open source Lambda Power Tuning tool measures that trade-off across settings. The trap is assuming the smallest memory is always the cheapest.
USAGE:
Before switching a function to arm64, check each layer, extension and container image for arm64 compatibility and rebuild or replace any that only ship x86_64 builds.

## aws-fargate-spot-and-compute-savings-plans | d2
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
Q:
Finance wants a monthly spend chart per team, an alert before a project overspends, and raw hourly line items for their own warehouse. Which tool answers each request?
A:
Cost Explorer is the view: it graphs and filters up to 13 months of history, forecasts the next 18 months, and groups by service, account or tag. Budgets is the alerting layer: a cost or usage budget fires notifications by email or SNS when actual or forecasted spend crosses a threshold, and budget actions can apply an IAM policy or SCP or target EC2 and RDS instances, automatically or after approval. The Cost and Usage Report is the raw feed: hourly, daily or monthly line items delivered to an S3 bucket you own, queryable with Athena. Per-team splits everywhere depend on cost allocation tags, activated in the Billing console first. The trap is expecting Cost Explorer to send the alert.
USAGE:
Budgets data refreshes only a few times a day, so a runaway resource can pass the threshold before the alert lands; pair a cost budget with a usage budget on the specific service.

## aws-trusted-advisor | d1
Q:
A company on the Basic support plan wants Trusted Advisor to flag idle EC2 instances and underused EBS volumes. Why do those checks not appear, and what does Trusted Advisor cover?
A:
Trusted Advisor checks your account against AWS best practice in six categories: cost optimisation, performance, security, fault tolerance, service limits and operational excellence. Basic and Developer plans (Developer is being discontinued) get only the service limits checks plus a few security and fault tolerance checks such as MFA on the root account. The full set, including cost checks like low-utilisation EC2 instances, underused EBS volumes, idle load balancers and unassociated Elastic IPs, needs Business Support+ or Enterprise Support, which also unlock the API and EventBridge notifications; legacy Business Support keeps them only for existing customers until it ends. The trap is picking Trusted Advisor for a cost question on a Basic plan; use Compute Optimizer or Cost Explorer there.
USAGE:
The low-utilisation check looks at CPU and network only, so a memory-bound instance can look idle; confirm with CloudWatch agent memory metrics before downsizing.

## aws-compute-optimizer-and-rightsizing | d1
Q:
Before committing to a three-year Savings Plan, an architect wants evidence that the fleet is not over-provisioned. Which service gives instance-level rightsizing recommendations, and what does it need?
A:
AWS Compute Optimizer. Once you opt in, it analyses configuration and CloudWatch utilisation metrics over the last 14 days and classifies each instance as under-provisioned, over-provisioned or optimised, with an estimated monthly saving and performance risk. It covers EC2 instances and Auto Scaling groups, EBS volumes, Lambda function memory, ECS services on Fargate, RDS and more, and can show Graviton alternatives. Memory utilisation only counts when the CloudWatch agent is installed. Rightsize first and commit second, because a Savings Plan locks in spend on whatever size you run, so committing to an oversized fleet freezes the waste. The trap is picking Trusted Advisor, which flags low-utilisation instances against fixed thresholds but does not suggest a target instance type.
USAGE:
Compute Optimizer only produces Lambda memory recommendations for x86_64 functions, so arm64 functions still need Power Tuning.

## aws-ebs-gp3-vs-gp2-and-snapshot-archive | d2
Q:
An account has hundreds of 100 GiB gp2 volumes, some no longer attached, and thousands of monthly snapshots kept for seven years of compliance. What are the three cheapest fixes?
A:
First, migrate gp2 to gp3 with a no-downtime Elastic Volumes modify: gp3 costs 20 percent less per GiB and includes a flat 3,000 IOPS and 125 MiB/s baseline regardless of size, whereas gp2 gives 3 IOPS per GiB, so small gp2 volumes only reach 3,000 IOPS by burst credits. Second, delete unattached volumes, which Trusted Advisor flags as underutilised because they still cost money. Third, move long-retained snapshots to the EBS Snapshots Archive tier, up to 75 percent cheaper for snapshots kept 90 days or longer. Archived snapshots become full copies, restores can take up to 72 hours, and you must restore before creating a volume. The trap is archiving daily incrementals, which can cost more than the standard tier.
USAGE:
Deleting or permanently restoring an archived snapshot before 90 days still bills the remaining days, so do not archive anything you might need back next month.

## aws-efs-ia-and-lifecycle | d1
Q:
A shared EFS file system holds years of project files that nobody has opened in months, yet the storage bill keeps growing. Which feature do you enable, and when does it backfire?
A:
Turn on EFS lifecycle management. Its policies move files not accessed in Standard for a set number of days into Infrequent Access (default 30 days) and then Archive (default 90 days), and a third policy can return a file to Standard on first access. Listing a directory does not count as access. The trap is that IA and Archive charge per read, deliver first bytes in tens of milliseconds and bill a 128 KiB minimum per file, so they suit data read a few times a quarter or year, never hot data. A One Zone file system is the alternative for data that does not need the highest availability, but it does not survive loss of its Availability Zone.
USAGE:
After a month, check how much data still sits in Standard; if most of it does, the workload touches files more often than assumed and IA access charges can outweigh the savings.

## aws-rds-reserved-and-stop-start | d1
Q:
A team runs a production PostgreSQL instance 24 hours a day and a dev instance used a few hours a week. What is the cheapest setup for each, and what surprises people who simply stop the dev instance?
A:
For the steady production database buy a reserved DB instance: a one or three year commitment that discounts the hourly instance charge for a matching engine, class and Region; storage, backups and I/O are not discounted. Stop the dev instance when idle so instance hours stop, though provisioned storage and backup storage are still billed. The trap is that RDS automatically restarts a stopped instance after seven consecutive days so it does not miss maintenance, so a database parked for a month runs and bills again. For longer gaps take a snapshot and delete it, or use Aurora Serverless with a minimum of zero ACUs, which pauses after an idle interval and resumes on the next connection.
USAGE:
Automate the stop and start with a scheduler rather than relying on memory, and keep in mind that each stop resets the seven day clock, not the calendar month.

## aws-cloudwatch-logs-metric-filters-and-insights | d2
Q:
An application writes ERROR lines to CloudWatch Logs; the team wants to be paged when errors spike, to investigate them interactively, and to stream them to an external SIEM. Which CloudWatch Logs feature serves each need?
A:
A metric filter matches a pattern in incoming events and publishes a numeric CloudWatch metric, and an alarm on that metric does the paging; filters are not retroactive, so only events arriving after creation count. CloudWatch Logs Insights is the query tool: an interactive query language across many log groups, charged by data scanned. A subscription filter streams matching events in near real time, base64 encoded and gzip compressed, to Kinesis Data Streams, Data Firehose, Lambda or OpenSearch Service, and a cross-account destination lets a central security account receive logs from others. The distractor is picking Insights for alerting: it runs on demand, not continuously. Retention is set per log group and defaults to never expire.
USAGE:
Set a default value of 0 on metric filters so periods with logs but no matches still report a data point; otherwise the metric is sparse and alarms flap between OK and INSUFFICIENT_DATA.

## aws-cloudwatch-agent-custom-metrics | d1
Q:
An operations team wants an alarm when an EC2 instance runs low on memory or disk space, but CloudWatch shows only CPU and network for the instance. Why, and what do they add?
A:
EC2 publishes what the hypervisor can see: CPUUtilization, network bytes, instance store and EBS I/O, and status checks. Memory and file system usage live inside the guest operating system, so they are not default metrics. Install the CloudWatch agent, which collects mem_used_percent, disk_used_percent, swap and many more and can also ship log files; it runs on EC2 and on-premises servers, publishes to the CWAgent namespace, and its metrics are billed as custom metrics. Any application can push its own values with PutMetricData at one minute standard resolution or one second high resolution. The distractor is detailed monitoring: it only moves the existing EC2 metrics from five minute to one minute periods, for a charge, and adds no memory metric.
USAGE:
Roll the agent configuration out once through Systems Manager rather than hand-editing each host, so every new instance publishes the same memory and disk metrics from first boot.

## aws-cloudtrail-vs-config-vs-cloudwatch | d2
Q:
A security group changed last week and the auditor asks three things: who changed it, what its rules were on each day since, and whether any group currently allows 0.0.0.0/0 on port 22. Which service answers each?
A:
CloudTrail answers who: it records API calls as events with the caller identity, time, source and affected resources, keeps 90 days of management events in Event history at no charge, and a trail delivers to S3 for longer retention with optional log file integrity validation, which signs hourly digest files using SHA-256 and RSA so tampering is detectable. AWS Config answers what it looked like: it records configuration items over time, shows resource relationships, and Config rules evaluate compliance continuously with optional remediation, so the open port 22 check is a Config rule. CloudWatch answers how it is performing: metrics, logs and alarms. The distractor is expecting CloudTrail to show configuration history or Config to name the caller.
USAGE:
Send the trail to CloudWatch Logs and put a metric filter on root account use or security group changes; that one pipeline joins the audit trail to real-time alerting.

## aws-systems-manager-run-command-patch-and-parameters | d2
Q:
A fleet of 200 EC2 instances and 50 on-premises servers needs a one-off script, monthly OS patching in a fixed window, and a shared database endpoint injected into apps, all without opening SSH. Which Systems Manager capabilities do you combine?
A:
Everything rides on the SSM Agent, which calls out to Systems Manager endpoints, so no inbound port or SSH key is needed; targets are chosen by tag or resource group. Run Command executes a document once across the fleet. Patch Manager uses a patch baseline to define approved patches and runs Scan or Scan and install operations, scheduled through a patch policy or a maintenance window. State Manager keeps a defined configuration applied on a schedule, and Automation runbooks orchestrate multi-step tasks such as building golden AMIs. Parameter Store holds the endpoint as a String or KMS-encrypted SecureString, free in the standard tier. The distractor is Secrets Manager for a plain endpoint, or Parameter Store for credentials that need rotation.
USAGE:
When an instance is missing from the managed node list, check the instance role and whether the agent can reach the Systems Manager endpoints (a VPC endpoint if there is no internet path) before touching security groups.

## aws-snow-family-selection | d2
Q:
A research site with 400 TB on local disks and a 1 Gbps internet link must get the data into S3, and a second site with no reliable connectivity must run analytics locally. How do you decide between online transfer and a Snow device, and which device fits each?
A:
Estimate network time first: DataSync guidance puts 100 TB over 1 Gbps at 80 percent utilisation at almost 12 days, so 400 TB needs about 46 days. If that misses the deadline or the link is unreliable, ship the data. Both Snowball Edge configurations have 104 vCPUs, 416 GB of memory and EC2-compatible instances; Storage Optimized carries 210 TB for bulk transfer, while Compute Optimized has 28 TB of NVMe reserved for instances and suits the disconnected analytics site. The trap is assuming only Compute Optimized runs instances, or picking it for capacity. AWS no longer offers Snow devices to new customers, recommending DataSync, Data Transfer Terminal, partner solutions or Outposts, yet the exam still tests this rule.
USAGE:
Run the bandwidth formula with the usable share of the link and real working hours; a 1 Gbps line shared with production traffic often delivers a fraction of its label.

## aws-storage-gateway-modes | d2
Q:
An office wants its file server backed by S3 with fast local access, a database server needs an iSCSI volume kept entirely on site with cloud backups, and the backup team wants to retire physical tapes without changing backup software. Which Storage Gateway type and mode serves each?
A:
S3 File Gateway exposes NFS and SMB shares whose files become S3 objects, with a local cache for recently used data. Volume Gateway presents iSCSI volumes in two modes: stored volumes keep the entire dataset on local disks and asynchronously back it up to S3 as EBS snapshots, fitting the database that needs everything on site; cached volumes make S3 the primary store and keep only frequently read data locally. Tape Gateway presents a virtual tape library as iSCSI devices, so existing backup software writes to virtual tapes held in S3, and ejected tapes are archived to S3 Glacier Flexible Retrieval or Deep Archive. The trap is choosing cached volumes when the question insists the whole dataset stays local.
USAGE:
Size the cache and upload buffer disks before go-live; the guidance is cache of at least 20 percent of the file store and larger than the upload buffer, and an undersized cache shows up as slow reads and stalled uploads.

## aws-dms-and-sct | d2
Q:
A company must move an on-premises Oracle database to Aurora PostgreSQL while the application keeps running. Which services do you combine, and what does each one do?
A:
Use the Schema Conversion Tool first, then Database Migration Service. SCT converts the schema and code objects to the target engine and flags whatever it cannot convert automatically so you can finish those parts by hand. DMS then moves the data: a full load followed by change data capture, which reads the source engine's transaction logs and replicates ongoing changes, so the source keeps serving traffic and the cutover shrinks to a final sync. Homogeneous moves such as Oracle to Oracle need DMS only; SCT is for engine changes. The trap is choosing DMS alone for a heterogeneous migration, or forgetting that one endpoint must be in AWS, so DMS cannot copy between two on-premises databases.
USAGE:
Change data capture latency has no SLA, so watch replication lag and let it settle before you point the application at the target.

## aws-application-migration-service-mgn | d1
Q:
A company wants to move two hundred on-premises virtual machines to EC2 with no code changes and only minutes of downtime. Which service does the move, and which services help plan and track it?
A:
Application Migration Service (MGN) is the lift and shift tool. An agent on each source server performs continuous block-level replication into a staging area in your account, and the servers keep running while replication happens. You launch test instances from the replicated data without pausing replication, then launch cutover instances, so the cutover window is typically minutes. Application Discovery Service comes first: its agentless collector or agent inventories servers, utilisation and network connections so you can group them into applications. Migration Hub is the single place that tracks the status of each application migration across MGN and DMS. The distractor is Database Migration Service, which moves databases rather than whole servers.
USAGE:
The console now brands MGN as AWS Transform MGN, and Migration Hub and Application Discovery Service are closed to new customers, but the exam still uses the classic names.

## aws-migration-strategies-7rs | d1
Q:
A migration assessment tags each application with one of the 7 Rs. How do you tell rehost, relocate, replatform, refactor, repurchase, retain and retire apart when the exam gives you a constraint?
A:
Rank them by how much change they allow. Rehost (lift and shift) moves servers unchanged, suiting tight deadlines and large fleets. Relocate moves servers to a cloud version of the same platform, or an RDS instance to another account, with no rewrite; it is the quickest. Replatform (lift, tinker and shift) adds some optimisation, a few changes or many, without redesigning the core, such as self-managed SQL Server to RDS. Refactor redesigns core components for cloud-native features, is the most complex and costly, and AWS advises modernising after a large migration instead. Repurchase (drop and shop) swaps to SaaS to shed licences. Retain defers an application; retire decommissions it. The trap is choosing refactor when the question stresses time.
USAGE:
Idle or zombie servers found during discovery are retire candidates, and cutting them is the cheapest migration win.

## aws-cloudformation-vs-cdk-vs-elastic-beanstalk | d1
Q:
When do you choose CloudFormation, the CDK, or Elastic Beanstalk to stand up an application's infrastructure?
A:
CloudFormation is the declarative engine: a template describes resources, a stack creates and updates them, drift detection reports changes made outside the stack, and StackSets push one template into many accounts and Regions. The CDK sits on top: you write constructs in TypeScript, Python or another supported language, it synthesises a CloudFormation template, and CloudFormation still performs the deployment, so you gain loops and reuse without a new provisioning service. Elastic Beanstalk sits higher again: you upload code and it provisions instances, load balancing, scaling and health monitoring at no charge beyond the resources, so pick it when developers should not manage infrastructure. The trap is treating the CDK as a rival to CloudFormation; it is a generator for it.
USAGE:
Drift detection only reports; you still have to fix the resource or update the template, and it skips properties the template never set explicitly.

## aws-elastic-beanstalk-deployment-policies | d2
Q:
An Elastic Beanstalk environment must deploy a new version with no loss of capacity and a fast, safe rollback if health checks fail. Which deployment policy do you choose, and why not rolling?
A:
Choose immutable. It launches a full set of new instances in a separate Auto Scaling group; if they fail health checks Beanstalk terminates them and leaves the originals untouched, so rollback means discarding the new group. Rolling updates existing instances a batch at a time, so capacity drops by a batch and a failure leaves a mixed fleet you fix by manual redeploy. Rolling with an additional batch launches a spare batch first to hold capacity, but rollback is still manual. All at once is fastest but takes every instance offline. Traffic splitting adds a canary period on top of immutable. Blue/green is not a policy: clone the environment and swap CNAMEs, which changes DNS.
USAGE:
After a CNAME swap keep the old environment alive until DNS caches expire, because resolvers do not always honour your TTL.

## aws-codedeploy-blue-green-lambda-ecs | d2
Q:
A team wants CodeDeploy to send 10 percent of traffic to a new Lambda version, watch an error alarm, then shift the rest automatically. Which deployment type and configuration do they need, and how does this differ from EC2?
A:
Lambda and ECS deployments in CodeDeploy are always blue/green: traffic on a Lambda alias or an ECS task set shifts to the new version according to a deployment configuration. Canary moves a first slice, waits a set number of minutes, then moves the rest; linear moves the same slice every interval; all-at-once moves everything. Attach CloudWatch alarms to the deployment group, up to ten, and enable automatic rollback: if any alarm fires the deployment stops and the last known good revision is redeployed. Only EC2 and on-premises also allow in-place deployment, which updates instances in batches under a minimum healthy hosts rule; EC2 blue/green provisions replacement instances. The trap is offering in-place for Lambda or ECS, which does not exist.
USAGE:
A rollback is a brand new deployment with its own ID, so scripts that key on the deployment ID must expect it.

## aws-config-rules-remediation | d2
Q:
Security wants every unencrypted EBS volume and every security group open to the internet on port 22 detected and fixed automatically across all accounts. Which service, and how do the pieces fit?
A:
AWS Config. It records configuration history and evaluates resources against rules: managed rules are predefined and customisable, for example that EBS volumes are encrypted or a security group blocks a port, while custom rules run your Lambda function or a Guard policy. A failing resource is marked noncompliant. Remediation attaches a Systems Manager Automation runbook to the rule; set it to automatic and Config runs the runbook, with optional retries, whenever a resource is noncompliant. A conformance pack bundles rules and remediation into one unit deployed to an account or a whole organisation; an aggregator gives a read-only view across accounts and Regions but cannot deploy rules. The trap is CloudTrail, which logs API calls but never judges compliance.
USAGE:
Automatic remediation works from a periodic compliance snapshot, so it can occasionally run against a resource that was already fixed; make runbooks idempotent.

## aws-resource-access-manager | d1
Q:
Ten accounts in an organisation each need subnets in one central VPC and a route through one Transit Gateway. Do you build these in every account or share them, and with what?
A:
Share them with AWS Resource Access Manager. The owning account creates a resource share naming the resources and the principals: the whole organisation, an OU or individual accounts. Consuming accounts then see the shared subnet or Transit Gateway in their own console as if it were native, while the owner keeps ownership and one set of permissions, so nothing is duplicated per account. Sharing inside an organisation needs no invitation once enabled; an outside account must accept one. Shareable types include subnets, Transit Gateways, Route 53 Resolver rules, License Manager configurations and prefix lists. Subnets can only be shared within the organisation, and default subnets not at all. The distractor is VPC peering, which links separate VPCs instead.
USAGE:
A resource share is Regional, so a Transit Gateway in one Region needs a share created in that same Region.

## aws-well-architected-pillars | d1
Q:
What are the six pillars of the AWS Well-Architected Framework, and what does the Well-Architected Tool actually do with them?
A:
The pillars are operational excellence (run and improve workloads and processes), security (protect data, systems and assets), reliability (perform the intended function correctly and consistently), performance efficiency (use computing resources efficiently as demand and technology change), cost optimisation (deliver business value at the lowest price point) and sustainability (cut energy use and total resources required). You trade pillars by business context: a development environment might trade reliability for cost, but security and operational excellence are generally not traded away. The Well-Architected Tool is a no-charge service where you answer the framework's questions for a workload and receive recommendations; custom lenses add your own questions. The trap is a five-pillar answer that forgets sustainability, or claiming the Tool changes your architecture.
USAGE:
Record a milestone in the Tool before each major release so the review history shows what changed and why.

## aws-outposts-local-zones-wavelength | d2
Q:
A hospital must run EC2 and RDS inside its own data centre so patient records never leave the site, while a game studio wants lower latency for players in a city far from any Region. Which of Outposts, Local Zones and Wavelength fits each, and when is Wavelength the answer instead?
A:
Choose by where users and data sit. Outposts is AWS-managed hardware installed in your own facility, an extension of an Availability Zone, so pick it when compute and data must stay on premises. A Local Zone is AWS infrastructure near a large population centre, an extension of the parent Region that you enable and add a subnet to, giving users in that metro lower latency than the distant Region. A Wavelength Zone sits at the edge of a telecom carrier's 5G network behind a carrier gateway, so it serves mobile devices on that carrier. The trap is choosing a Local Zone when data may not leave the building, or Wavelength for users off the carrier's 5G network.
USAGE:
Before ordering Outposts, check the per-Region service table, because Outposts servers give instance store only with no EBS, and RDS, ElastiCache, EMR and ALB run on racks but not on servers.

## aws-secrets-manager-vs-parameter-store | d2
Q:
A team must store an Amazon RDS master password that is changed automatically on a schedule without writing custom code, and a colleague suggests an SSM Parameter Store SecureString because the standard tier is free. Which service fits the requirement, and why?
A:
Choose Secrets Manager whenever the requirement includes automatic rotation. It rotates on a schedule you set and offers managed rotation for credentials such as Amazon RDS, Aurora, DocumentDB and Redshift master users, and other secrets can rotate through a Lambda rotation function. It also supports cross-account access through a resource policy on the secret, and is billed per secret per month plus per API call. Parameter Store SecureString is encrypted with AWS KMS and the standard tier costs nothing, which makes it the tempting distractor, but it has no built-in credential rotation; any rotation would be custom code you maintain. Cost-driven questions about plain configuration point to Parameter Store; rotation-driven questions about credentials point to Secrets Manager.
USAGE:
When sharing a secret across accounts, encrypt it with a customer managed KMS key and grant the other account in the key policy, because the AWS managed key aws/secretsmanager cannot be used for cross-account access.

## aws-waf-vs-shield | d2
Q:
An Application Load Balancer fronting a public API is receiving SQL injection payloads in query strings while a separate SYN flood hammers the network layer. Which AWS service handles each, and why would swapping them fail?
A:
AWS WAF is layer 7: web ACL rules such as rate based limits, geo match, SQL injection and XSS checks, and managed rule groups, on resources including CloudFront, Application Load Balancers, API Gateway REST APIs, AppSync and Cognito user pools. Shield Standard is automatic and free and covers common network and transport layer (3 and 4) DDoS. Shield Advanced is a paid subscription adding enhanced event visibility, cost protection via service credits and the Shield Response Team. Firewall Manager pushes WAF and Shield Advanced policies across an AWS Organizations organisation. The trap is picking WAF for a volumetric network flood, which never reaches its HTTP inspection, or Shield for SQL injection, a request pattern only a WAF rule matches.
USAGE:
Deploy a new WAF rule with the Count action first so you can confirm what it would match before switching it to Block.

## aws-ec2-enhanced-networking-efa | d2
Q:
A CFD team runs a tightly coupled MPI simulation across dozens of EC2 instances, while a web team simply wants more throughput and lower latency for its API fleet. Which network adapter suits each, and why would swapping them be a mistake?
A:
Enhanced networking via the Elastic Network Adapter uses SR-IOV to give supported instance types higher bandwidth, more packets per second and lower latency, which is all an ordinary web or API fleet needs. An Elastic Fabric Adapter bundles that ENA device with an extra EFA device whose Libfabric interface bypasses the operating system kernel, so tightly coupled HPC and ML frameworks such as Open MPI and NCCL talk directly to the hardware. EFA traffic cannot cross Availability Zones or VPCs, and AWS recommends a cluster placement group in one AZ. The trap is picking EFA for plain web throughput, where nothing uses OS bypass, or plain ENA for an MPI job, which then runs over the slower TCP/IP stack.
USAGE:
Give EFA instances a security group with self-referencing rules allowing all inbound and outbound traffic to and from the group itself, since without them EFA traffic between instances is blocked.

## aws-datasync-vs-transfer-family | d2
Q:
A company must migrate a large on-premises NFS share into Amazon S3 and keep it synchronised nightly, while its trading partners must keep uploading files with their existing SFTP clients. Which AWS service fits each need, and why is one service not enough?
A:
DataSync handles the migration and nightly sync; Transfer Family serves the partners. DataSync is a transfer engine: an agent VM (not needed between AWS storage services in the same account) reads sources such as NFS, SMB, HDFS and object storage and writes to S3, EFS or FSx, with TLS encryption, scheduling, filters, bandwidth limits and checksum verification. Transfer Family is a fully managed endpoint that speaks protocols such as SFTP, FTPS, FTP and AS2 and stores files in S3 or EFS, so partners keep their existing clients. The trap is picking Transfer Family for a one-off bulk copy, or DataSync when partners need a server to connect to. DataSync pushes on your schedule; Transfer Family waits to receive.
USAGE:
A DataSync bandwidth limit can be changed on a running or queued task execution, so you can throttle a migration during business hours without restarting it.

## aws-purpose-built-databases-selection | d1
Q:
A fraud detection feature must traverse millions of relationships between accounts and devices, while a separate IoT feature stores sensor readings queried by time window. Which AWS database fits each workload, and why is Aurora the distractor?
A:
Map the scenario keyword to the purpose-built engine, including Neptune for relationship traversal over highly connected data, Timestream for timestamped IoT or metrics data, DocumentDB for MongoDB compatible documents, Keyspaces for Cassandra workloads, MemoryDB for a durable Redis or Valkey compatible primary store, and DynamoDB for key value access at any scale. Aurora or RDS is right only when the question stresses tables, joins and referential integrity. The trap is choosing the relational option because it is familiar; AWS itself warns that SQL against highly connected data is hard to write and tune, and each engine is optimised for its own access pattern. Older exam material keys immutable, cryptographically verifiable ledgers to QLDB, which current AWS guidance no longer lists.
USAGE:
AWS guidance expects one application to combine several best-fit databases, so a scenario may legitimately need more than one engine rather than a single relational store.

## aws-route53-resolver-hybrid-dns | d2
Q:
Your on-premises servers, connected to AWS over Site-to-Site VPN, must resolve names in a Route 53 private hosted zone, and EC2 instances must resolve corp.internal names held on an on-premises DNS server. What do you deploy, and why does pointing the on-premises servers at the VPC's .2 address fail?
A:
Deploy a Route 53 Resolver inbound endpoint so on-premises resolvers can forward private hosted zone queries into the VPC, and an outbound endpoint with a forwarding rule for corp.internal so the VPC resolver sends those queries to the on-premises DNS server. Each endpoint is backed by elastic network interfaces with private IP addresses in your subnets, reachable over a private connection such as Direct Connect or Site-to-Site VPN. The default resolver at the VPC CIDR plus two is intended for resources inside the VPC; AWS states that forwarding queries to it from on-premises or other VPC DNS servers is not supported and can give unstable results. The distractor is pointing on-premises servers at that .2 address.
USAGE:
Give each Resolver endpoint IP addresses in at least two Availability Zones, and associate the private hosted zone with the VPC that hosts the inbound endpoint.

## aws-s3-lifecycle-rules-minimums | d2
Q:
A single S3 lifecycle rule moves log objects to S3 Standard-IA at day 7 and then to S3 Glacier Deep Archive at day 20. Which step does S3 reject, and why?
A:
The day 20 step is the fault, not the day 7 step. A single lifecycle rule cannot schedule the next transition before the previous class's minimum storage duration has elapsed. Minimums include 30 days for Standard-IA and One Zone-IA, 90 days for Glacier Flexible Retrieval and 180 days for Deep Archive, so after a day 7 move to Standard-IA the Deep Archive step must be day 37 or later. Moving to Standard-IA at day 7 alone is valid; a prorated charge for the rest of the 30 day minimum applies only if the object later leaves Standard-IA before day 37, for example through a second rule. Objects under 128 KB are not transitioned by default. The distractor blames the day 7 IA step or accepts the rule unchanged.
USAGE:
Expiration rules do not remove incomplete multipart uploads; add an AbortIncompleteMultipartUpload action with DaysAfterInitiation so abandoned parts are cleaned up.
