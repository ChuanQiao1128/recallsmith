# Semantic duplicates: aws-saa-c03 (2026-09-30)

Model `BAAI/bge-small-en-v1.5` (384 dims), cosine of the L2-normalised canonical-text vectors (question + explanation). Offline run of `dc-evals semantic-dupes`; questions only.

- Cards: 371
- Threshold: cosine >= 0.90
- Pairs at or above the threshold: 25 (showing up to 50)
- Cards whose nearest neighbour is at or above the threshold: 49

## Nearest-neighbour cosine per card

| min | p50 | p90 | p99 | max |
|---|---|---|---|---|
| 0.7275 | 0.8490 | 0.9045 | 0.9523 | 0.9567 |

| range | cards |
|---|---|
| < 0.70 | 0 |
| 0.70-0.75 | 2 |
| 0.75-0.80 | 44 |
| 0.80-0.85 | 142 |
| 0.85-0.88 | 86 |
| 0.88-0.90 | 48 |
| 0.90-0.92 | 25 |
| 0.92-0.95 | 20 |
| 0.95-0.98 | 4 |
| >= 0.98 | 0 |

## Pairs with cosine >= 0.90

| cosine | card A | card B |
|---|---|---|
| 0.9567 | `aws-quick-service-card` Business analysts want interactive dashboards over data in Athena, Redshift and RDS, shared with 300 readers, with no servers to run and fa… | `aws-bi-dashboard-choice-mcq-36` A retail company stores sales data in Amazon Redshift and clickstream data in S3 queried through Athena. Business analysts want interactive… |
| 0.9523 | `aws-asg-scale-workers-on-queue-mcq-06` An Auto Scaling group of EC2 workers processes document-conversion jobs from an SQS queue. Each job spends most of its time waiting on a th… | `aws-queue-backlog-per-instance-mcq-08` A fleet of EC2 workers in an Auto Scaling group pulls jobs from an SQS queue; each job calls a slow third-party API and waits for the reply… |
| 0.9473 | `aws-dms-and-sct` An on-premises Oracle database with thousands of lines of PL/SQL must move to AWS. The company wants to stop paying Oracle licence fees, ke… | `aws-d4-db-engine-license-cost-mcq-23` A company's on-premises Oracle Database Enterprise Edition licence renews in nine months at a price the CFO refuses to pay again. The appli… |
| 0.9345 | `aws-amazon-mq-service` A company is lifting an order-processing application into AWS. It talks to an on-premises ActiveMQ broker over JMS and OpenWire, a partner … | `aws-amazon-mq-jms-no-code-change-mcq-11` A logistics company is moving a warehouse application to AWS. The application's components exchange messages through a self-managed Apache … |
| 0.9325 | `aws-single-az-three-tier-to-ha-mcq-04` A three-tier web application runs in a single Availability Zone: an Auto Scaling group of two EC2 web servers whose only subnet is in that … | `aws-single-az-asg-make-regional-ha-mcq-26` A stateless web tier runs in an EC2 Auto Scaling group whose network configuration lists a single private subnet in Availability Zone a, be… |
| 0.9284 | `aws-lambda-concurrency-reserved-provisioned` A payment Lambda function is being throttled because a noisy batch function in the same account is using all the available concurrency. Do … | `aws-lambda-critical-function-throttled-mcq-17` An account runs a payment-authorisation Lambda function and, in the same Region, a nightly batch function that fans out thousands of concur… |
| 0.9277 | `aws-asg-predictable-daily-spike-mcq-05` An internal web application on an Auto Scaling group with a target tracking policy on CPU is slow every weekday between 9:00 and 9:20 AM: s… | `aws-d4-scheduled-vs-predictive-scaling-mcq-17` A customer-facing web tier on an Auto Scaling group with a target tracking policy on CPU is slow every weekday at 09:00. New instances take… |
| 0.9250 | `aws-artifact-service` When does an exam scenario point to AWS Artifact rather than Security Hub, AWS Config or Trusted Advisor, and what two things can an accoun… | `aws-artifact-audit-evidence-mcq-34` An external auditor reviewing a company's payment platform asks for evidence that the AWS infrastructure it runs on has been independently … |
| 0.9244 | `aws-acm-certificates-and-cloudfront-region` A team requests one ACM certificate in ap-southeast-2 and attaches it to an ALB, then cannot select it for their CloudFront distribution. W… | `aws-acm-cert-region-for-cloudfront-mcq-39` A team in Sydney requested a public certificate in AWS Certificate Manager in ap-southeast-2 and attached it to their Application Load Bala… |
| 0.9230 | `aws-firewall-manager-service` A security team runs an AWS Organization with 80 accounts. Every new Application Load Balancer and CloudFront distribution must carry the c… | `aws-firewall-manager-enforce-waf-org-mcq-30` A company with 40 AWS accounts in one organization must ensure that every Application Load Balancer in every account, including ALBs create… |
| 0.9209 | `aws-d4-pat-ec2-hibernation` A rendering farm's EC2 workers take 20 minutes to load models into RAM before they can accept jobs, so the team pays for idle instances ove… | `aws-d4-scaling-method-hibernation-mcq-16` A financial modelling service runs on a single memory-optimized EC2 instance with 96 GiB of RAM. At startup it spends 40 minutes loading an… |
| 0.9207 | `aws-dr-backup-and-restore` A regional payroll application can tolerate several hours of data loss and up to a day of downtime if its AWS Region fails, and finance wan… | `aws-dr-24h-objectives-lowest-cost-mcq-39` An internal reporting application runs in one AWS Region on EC2 instances behind a load balancer with an RDS for PostgreSQL database. The b… |
| 0.9159 | `aws-rds-backups-snapshots-pitr` A developer ran an accidental DELETE on an RDS database 40 minutes ago and asks you to roll back; the team also asks whether taking more sn… | `aws-d4-db-backup-retention-cost-mcq-22` An RDS for MySQL instance with 500 GiB of storage supports an order system. The recovery point objective is 5 minutes, and any point in the… |
| 0.9158 | `aws-cloudfront-cost-reduction` A static site served straight from S3 is paying for data transfer and requests from viewers worldwide. How does CloudFront lower that bill,… | `aws-d4-cdn-edge-caching-need-mcq-32` A marketing site of static HTML, images and video clips is served directly from an S3 bucket in us-east-1 to viewers worldwide. The monthly… |
| 0.9153 | `aws-snow-family-selection` A research site holds 500 TB on local disks behind a 500 Mbps internet link. The data must be in Amazon S3 within 3 weeks, and about 50 GB … | `aws-d4-data-migration-service-mcq-08` A media company must move a 500 TB archive from an on-premises NFS array into Amazon S3 within three weeks, before its data centre lease en… |
| 0.9139 | `aws-datasync-vs-transfer-family` About 40 trading partners push CSV files every day over SFTP with their existing clients and credentials. Each file must land in Amazon S3 … | `aws-partner-sftp-into-s3-mcq-22` A logistics company is closing the data centre that hosts its SFTP server. Two hundred partners upload shipment files to it with scripted S… |
| 0.9124 | `aws-mfa-pattern` A security team wants MFA on every human path into an account: console sign-in, destructive API calls, and permanent deletion of S3 object … | `aws-iam-mfa-for-destructive-api-mcq-02` A company's IAM users administer EC2 and S3 from both the console and the CLI. A new control requires that TerminateInstances and DeleteBuc… |
| 0.9093 | `aws-rds-multi-az-vs-read-replica` An RDS PostgreSQL instance must survive an Availability Zone failure and also serve a growing reporting load. Which of Multi-AZ and read re… | `aws-rds-multi-az-cluster-vs-instance` A team on RDS for PostgreSQL wants automatic failover and also wants to send reporting queries to a standby. Do they choose a Multi-AZ DB i… |
| 0.9045 | `aws-efs-performance-and-throughput-modes` Several hundred Linux web servers spread across three Availability Zones must share one POSIX file system for uploaded assets. Load is spik… | `aws-shared-posix-across-azs-mcq-18` A video rendering farm runs Linux instances in an Auto Scaling group across three Availability Zones. Every node must read and write the sa… |
| 0.9044 | `aws-control-tower-service` A company is about to build its first multi-account AWS environment. It wants dedicated log archive and audit accounts, guardrails that blo… | `aws-control-tower-new-landing-zone-mcq-11` A company new to AWS expects to grow to about 20 accounts within a year. Security wants preventive and detective guardrails on every accoun… |
| 0.9033 | `aws-s3-bucket-policy-vs-iam-policy` A Lambda role in account B must read objects from a bucket owned by account A. Which policy must account A write, and is an identity policy… | `aws-cross-account-s3-two-policies-mcq-13` An analytics job runs under an IAM role in account B and must read objects from a bucket that account A owns. Both accounts already exist, … |
| 0.9028 | `aws-d4-transfer-cost-routes-mcq-30` EC2 instances in private subnets download about 50 TB a month from an S3 bucket in the same Region through a NAT gateway. The same instance… | `aws-d4-network-review-optimizations-mcq-31` A monthly cost review of a VPC shows two large line items: NatGateway-Bytes, which VPC Flow Logs attribute almost entirely to EC2 instances… |
| 0.9024 | `aws-d4-pat-s3-intelligent-tiering` A media archive holds objects whose popularity is unpredictable: some are fetched daily for years, others never again after upload. Why is … | `aws-d4-storage-tier-unknown-pattern-mcq-04` A SaaS company stores customer-uploaded documents, typically 1 to 20 MB each, in S3 Standard. Some customers open their documents daily for… |
| 0.9013 | `aws-s3-glacier-retrieval-tiers` Compliance archives are read perhaps once a year, but when auditors ask, a handful of files must be back within minutes. Which Glacier clas… | `aws-d4-backup-archival-selection-mcq-07` A brokerage must keep 40 TB of trade confirmation files for seven years. Regulators require that no one, including administrators, can dele… |
| 0.9001 | `aws-nat-gateway-cost-vs-vpc-endpoint` Private-subnet instances push terabytes into S3 every night through a NAT Gateway, and dozens of VPCs each call SQS and Secrets Manager thr… | `aws-d4-transfer-cost-routes-mcq-30` EC2 instances in private subnets download about 50 TB a month from an S3 bucket in the same Region through a NAT gateway. The same instance… |

## Closest pairs below the threshold

| cosine | card A | card B |
|---|---|---|
| 0.8992 | `aws-tls-in-transit-pattern` An auditor requires encryption in transit end to end for a web app behind an Application Load Balancer, for its S3 uploads and for its RDS … | `aws-end-to-end-tls-alb-targets-mcq-40` A healthcare application runs on EC2 instances in private subnets behind an internet-facing Application Load Balancer. The ALB has an HTTPS… |
| 0.8982 | `aws-rds-encryption-and-iam-auth` An unencrypted RDS MySQL instance must now be encrypted at rest and reachable from an EC2 application without a stored password. What are t… | `aws-rds-encrypt-existing-instance-mcq-37` An Amazon RDS for MySQL DB instance was created two years ago without encryption at rest. A new compliance rule requires all database stora… |
| 0.8977 | `aws-d4-s3-lifecycle-management-mcq-05` An application writes about 2 TB of log objects a day to S3. Engineers query the logs heavily for 30 days; for roughly three months after t… | `aws-d4-backup-archival-selection-mcq-07` A brokerage must keep 40 TB of trade confirmation files for seven years. Regulators require that no one, including administrators, can dele… |
| 0.8958 | `aws-security-group-referencing` Web servers behind an ALB scale in and out, and the database must accept connections only from those web servers. How do you write the rule… | `aws-three-tier-security-group-chain-mcq-19` A three-tier application has an internet-facing Application Load Balancer, web servers in an Auto Scaling group, and an RDS for MySQL insta… |
| 0.8957 | `aws-nat-gateway-cost-vs-vpc-endpoint` Private-subnet instances push terabytes into S3 every night through a NAT Gateway, and dozens of VPCs each call SQS and Secrets Manager thr… | `aws-d4-network-review-optimizations-mcq-31` A monthly cost review of a VPC shows two large line items: NatGateway-Bytes, which VPC Flow Logs attribute almost entirely to EC2 instances… |
| 0.8956 | `aws-s3-encryption-options-sse` Auditors require proof of which principal decrypted each object and the ability to revoke a key for one dataset. Which S3 server-side encry… | `aws-s3-sse-kms-audit-revoke-mcq-36` A company keeps three regulated datasets in one S3 bucket, one prefix each. Auditors require a log entry for every object decryption, and t… |
| 0.8954 | `aws-rds-proxy` Thousands of concurrent Lambda invocations each open a short-lived connection to an RDS for MySQL instance, which now returns too many conn… | `aws-legacy-app-too-many-connections-mcq-40` A legacy Java application on a fleet of EC2 instances opens a new connection to an RDS for MySQL Multi-AZ instance for every request and cl… |
| 0.8938 | `aws-d4-nat-single-vs-per-az-mcq-28` A production application runs in private subnets across three Availability Zones. All outbound traffic, about 20 TB a month, leaves through… | `aws-d4-transfer-cost-routes-mcq-30` EC2 instances in private subnets download about 50 TB a month from an S3 bucket in the same Region through a NAT gateway. The same instance… |
| 0.8925 | `aws-route-tables-ha-angle` A VPC has private subnets in three Availability Zones that all share one route table whose 0.0.0.0/0 route points at a single NAT gateway i… | `aws-single-nat-gateway-spof-mcq-31` A VPC has private subnets in Availability Zones a and b. Application servers in both zones reach third-party HTTPS APIs through one NAT gat… |
| 0.8913 | `aws-dr-strategies-rpo-rto` A workload may lose no more than a few minutes of data, but the business accepts a recovery time measured in hours rather than seconds. Whi… | `aws-dr-rto-1h-rpo-minutes-mcq-37` A company's order system runs on EC2 behind an ALB with an Amazon RDS for PostgreSQL database in one Region. The business requires that aft… |
