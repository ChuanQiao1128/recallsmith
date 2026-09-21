# deck: aws-saa-c03
## aws-alb-vs-nlb | d1
TOPIC: 2.1 Loosely coupled architectures
Q:
A platform team runs a dozen HTTP microservices plus one partner-facing TCP API whose clients allow-list fixed IP addresses, and wants every service to scale on its own. How do they lay out Elastic Load Balancing, and why does a load balancer by itself never add capacity?
A:
One Application Load Balancer fronts all the HTTP services: it works at layer 7, so listener rules that match host, path, HTTP header, method, query string or source IP forward to one target group per service, each with its own health check; only healthy targets receive traffic, and weighted forwarding between two target groups gives blue/green shifts. Targets register by instance ID, by IP address (containers, peered VPCs, on-premises hosts over Direct Connect or VPN) or as a Lambda function. The partner API gets a Network Load Balancer: layer 4 TCP, UDP and TLS at millions of requests per second with a static IP, optionally an Elastic IP, per Availability Zone. Gateway Load Balancer is the third current-generation type, steering traffic through third-party firewall or IDS appliances over GENEVE on port 6081. Capacity comes from an Auto Scaling group attached to the target group: Auto Scaling registers new instances and the balancer hides scale-out from clients, but the balancer itself only spreads the load it is given.
USAGE:
One ALB with host and path rules fronts a dozen microservices; reach for NLB only when a partner needs a fixed IP or the protocol is not HTTP.
## aws-lambda-limits-timeout-payload | d1
TOPIC: 2.1 Loosely coupled architectures
Q:
A video transcoding job takes about 40 minutes per file and the team wants to run it as a standard Lambda function. Which limit stops that, and where should the job run instead?
A:
A standard Lambda function times out after 900 seconds, or 15 minutes, per invocation, so a 40 minute transcode fails before it finishes and Service Quotas cannot raise that ceiling; only Lambda Managed Instances, an EC2 based compute type, allow up to 90 minutes for asynchronous and most event source mapping invocations. The other fixed limits are 128 MB to 10,240 MB of memory, 6 MB synchronous and 1 MB asynchronous payloads, 50 MB zipped or 250 MB unzipped packages, 10 GB container images and a default of 1,000 concurrent executions per Region. Lambda is invoked synchronously (API Gateway, ALB, function URLs), asynchronously (S3, SNS, EventBridge) or through event source mappings that poll SQS, Kinesis and DynamoDB Streams, and it bills per millisecond, so it wins for short event-driven work. The decision rule: short and event-driven, Lambda; long-running or container-native, Fargate; GPUs, custom kernels or licence-bound software, EC2. Adding memory buys CPU, not time.
USAGE:
Profile the slowest inputs, not only the typical ones, before committing to Lambda; a job that overruns the timeout only occasionally is the hardest kind of failure to diagnose and forces a redesign later.
## aws-ebs-vs-efs-vs-instance-store | d1
TOPIC: 2.1 Loosely coupled architectures
Q:
An application needs three kinds of storage: a PostgreSQL data volume, a shared directory that web servers in three Availability Zones read and write, and user uploads served straight to browsers. Which AWS storage type fits each, and what rule decides?
A:
Decide by who needs the data and how they reach it. Block storage (EBS) is a raw device for one instance in one Availability Zone with the lowest latency, persistent and snapshot-able, so it takes the boot and database volumes; instance store is host-attached disk that is faster still but empties when the instance stops or the host fails, so it holds only caches and scratch. File storage (EFS, or FSx for SMB and Lustre) is a POSIX or SMB file system that many instances across Availability Zones mount at once, so the shared directory goes on EFS. Object storage (S3) is reached over an HTTPS API by anything with credentials, stores whole objects up to 5 GB in one PUT and up to 50 TB with multipart, has effectively unlimited capacity and is designed for eleven nines of durability, so browser-served uploads live there. Trap: S3 cannot be mounted as a boot or database volume, and an EBS volume cannot be shared across Availability Zones.
USAGE:
Put scratch and cache on instance store and anything you would miss on EBS with snapshots; if two instances in different AZs need the same files it is EFS, full stop.
## aws-step-functions-standard-vs-express | d2
TOPIC: 2.1 Loosely coupled architectures
Q:
An order pipeline charges a card, waits up to two days for a warehouse callback, then emails the customer. Which Step Functions workflow type do you choose, and when would Express be right instead?
A:
Choose Standard: it runs for up to a year, executes each state exactly once, supports the .sync and .waitForTaskToken patterns that pause a workflow for a human or an external callback, and bills per state transition. Express runs for at most five minutes, bills by executions, duration and memory, keeps history only in CloudWatch Logs, and its asynchronous form is at-least-once, so it suits high-volume idempotent work such as IoT ingestion or stream transformation, never payments. The wider rule is orchestration versus choreography: use a state machine when steps are ordered, branch, fan out through Parallel or Map, need Retry with IntervalSeconds, BackoffRate, MaxAttempts and jitter, Catch fallbacks, TimeoutSeconds or HeartbeatSeconds, or when someone must see where an execution is; use events and queues when services are independent and nobody needs the end-to-end state. Trap: one Lambda function invoking the next synchronously to sequence work pays for both while one waits and loses the failure history.
USAGE:
Whichever type you choose, put retries, error catching, branching and parallel fan out in the state machine rather than hand coding them into a chain of Lambda functions that call each other.
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
## aws-route53-health-checks-failover | d2
TOPIC: 2.2 HA and fault tolerance
Q:
A failover record set points to a primary web tier in a private subnet with no public IPs, and the endpoint health check stays unhealthy even though the site works. What is wrong, how do you fix it, and how fast can each failover layer react?
A:
Route 53 health checkers sit outside your VPC and can only probe a public IP or DNS name, so for private resources create a CloudWatch alarm (for example on StatusCheckFailed) and a health check that monitors the alarm's data stream; failover routing is active-passive, answering with the primary until every primary resource is unhealthy. Pick the failover layer by scope and accept its timing: inside a fleet the load balancer drops a target after a few failed health checks, in seconds; inside a Region an RDS Multi-AZ instance fails over in typically 60 to 120 seconds, Aurora in under 60 and often under 30, ElastiCache Multi-AZ in a few seconds; across Regions Route 53 failover takes the check interval (30 seconds standard, 10 fast) times the failure threshold plus whatever TTL resolvers cached, and an Aurora Global Database managed failover promotes a secondary within a few minutes; clients bound to an IP address need an Elastic IP reassociation, not DNS. Active-active makes failover pure routing; active-passive makes it a switch. The trap is giving private servers public IPs to satisfy the checker.
USAGE:
For an alias record pointing at an ALB or another AWS resource, set Evaluate Target Health to yes rather than attaching a separate health check.
## aws-elastic-beanstalk-deployment-policies | d2
TOPIC: 2.2 HA and fault tolerance
Q:
An Elastic Beanstalk environment must deploy a new version with no loss of capacity and a fast, safe rollback if health checks fail. Which deployment policy do you choose, why not rolling, and what wider principle is it applying?
A:
Choose immutable: it launches a full set of new instances in a separate Auto Scaling group; if they fail health checks Beanstalk terminates them and leaves the originals untouched, so rollback is discarding the new group. Rolling updates existing instances a batch at a time, so capacity drops and a failure leaves a mixed fleet; rolling with an additional batch keeps capacity but rollback stays manual; all at once takes every instance offline; traffic splitting adds a canary on top of immutable; blue/green is a CNAME swap between environments, not a policy. Immutable is Beanstalk's form of immutable infrastructure: never patch a running server; bake a golden AMI with EC2 Image Builder (free beyond the resources it uses), roll it out with a launch template and an Auto Scaling instance refresh, and roll back by relaunching the previous image, so fleets never drift; in-place tools such as Systems Manager Patch Manager are the mutable distractor when a question says drift or integrity. Beanstalk itself costs nothing extra: upload Go, Java, .NET, Node.js, PHP, Python, Ruby or Docker code and it provisions EC2, Auto Scaling, a load balancer, CloudWatch and optionally RDS while you keep full access to them; pick ECS or EKS for multi-service container fleets and CloudFormation when the resource set must be custom.
USAGE:
After a CNAME swap keep the old environment alive until DNS caches expire, because resolvers do not always honour your TTL.
## aws-lambda-concurrency-reserved-provisioned | d2
TOPIC: 2.2 HA and fault tolerance
Q:
A payment Lambda function is being throttled because a noisy batch function in the same account is using all the available concurrency. Do you set reserved or provisioned concurrency, what does each change, and why does the fix not carry over to your disaster recovery Region?
A:
All functions in a Region draw from one shared pool, 1,000 concurrent executions by default, so a busy neighbour can starve a critical function. Reserved concurrency carves out a slice only that function may use and is also a hard ceiling; it costs nothing. Provisioned concurrency pre-initialises execution environments to remove cold starts and is billed; choosing it to fix throttling is the trap, because it addresses latency, not the shared quota. That pool is one service quota among many, and quotas apply per account per Region (Lambda concurrency, EC2 On-Demand vCPUs, five Elastic IP addresses, load balancers), so a standby Region starts at the defaults: request the same increases there before a disaster, use a Service Quotas request template so new accounts in the Organization get them automatically, and monitor utilisation so you are notified before a quota is hit. API throttling is a separate mechanism from quotas: retry with exponential backoff and jitter, and remember that a reserved-concurrency cap doubles as a throttle for a fragile downstream.
USAGE:
Reserve concurrency on a function that calls a fragile downstream such as a small database, because the cap doubles as a throttle that protects it.
## aws-cloudwatch-agent-custom-metrics | d1
TOPIC: 2.2 HA and fault tolerance
Q:
An operations team wants an alarm when an EC2 instance runs low on memory or disk space, but CloudWatch shows only CPU and network for the instance. Why, what do they add, and which tool answers the questions memory metrics cannot?
A:
EC2 publishes what the hypervisor can see: CPUUtilization, network bytes, disk I/O and status checks; memory and file system usage live inside the guest, so install the CloudWatch agent, which reports mem_used_percent, disk_used_percent and more to the CWAgent namespace (billed as custom metrics) and can ship log files too. Detailed monitoring is the distractor: it only moves the existing metrics from five-minute to one-minute periods, for a charge. Memory and disk belong to the metrics pillar, which answers how much; the other two pillars answer different questions. Logs (CloudWatch Logs with Logs Insights) answer what happened, and traces (X-Ray) answer where the time went: an instrumented request becomes segments and subsegments that X-Ray assembles into a trace map of every downstream call, which is how you find the slow microservice or database behind a latency spike, and CloudWatch's application monitoring views show the three together. Trap: CloudTrail records API calls for audit and is not workload visibility.
USAGE:
Roll the agent configuration out once through Systems Manager rather than hand-editing each host, so every new instance publishes the same memory and disk metrics from first boot.
## aws-dynamodb-global-tables | d3
TOPIC: 2.2 HA and fault tolerance
Q:
A mobile game must accept DynamoDB writes in both us-east-1 and eu-west-1, keep serving players if one Region is impaired, and fail over without an operator rebuilding anything. What does the full active-active design look like, and what does its conflict rule mean for the data model?
A:
Active-active means both Regions take live traffic all the time, so failover is routing, not rebuilding. Data layer: DynamoDB global tables replicate multi-active, every replica accepts reads and writes, and the default multi-Region eventual consistency mode replicates through DynamoDB Streams with last-writer-wins, so a concurrent write to the same item in two Regions silently discards one; design around it with idempotent writes or a home Region per player, keep a version attribute, and watch ReplicationLatency, which is your RPO. Multi-Region strong consistency removes the conflict but is single-account only, drops TTL and transactions, and adds write latency. Traffic layer: Route 53 latency or weighted records with health checks (Evaluate Target Health on alias records) or Global Accelerator send each player to the nearest healthy Region. Against warm standby this buys near-zero RPO and RTO at the highest cost: two full stacks, quotas raised in both Regions, and conflict handling in code. The distractor is a backup copied to another Region: disaster recovery, not active replication.
USAGE:
Store a version or last-updated attribute on each item so you can detect when last writer wins discarded a change during a Regional incident.
## aws-s3-durability-availability | d1
TOPIC: 2.2 HA and fault tolerance
Q:
A team wants to keep the only copy of scanned contracts in S3 One Zone-IA because the console shows the same eleven nines of durability as S3 Standard at a lower price. What is the difference between durability and availability, why is this the wrong class for a primary copy, and how do other storage services compare?
A:
Durability is the chance data survives; availability is the chance you can read it now. Every mainstream S3 class including One Zone-IA is designed for 99.999999999 percent (eleven nines) durability, while availability varies: Standard 99.99, Standard-IA and Intelligent-Tiering 99.9, One Zone-IA 99.5 percent; most classes spread objects across at least three Availability Zones and survive losing one, but One Zone-IA keeps a single zone, so it suits only recreatable data such as replicas, and choosing it for a primary copy because it shows the same eleven nines is the trap. Other services differ sharply: EFS is also eleven nines, though EFS One Zone data can be lost with its zone; EBS gp2, gp3, io1, st1 and sc1 volumes are 99.8 to 99.9 percent (a 0.1 to 0.2 percent annual failure rate) and only io2 Block Express reaches 99.999; instance store promises nothing; Aurora writes six copies across three zones. Durability protects against media loss, not against deletes or corruption, which replicate faithfully, so versioning and backups remain mandatory.
USAGE:
Durability figures protect against hardware loss, not against your own mistaken deletes; that is what versioning and replication are for.
## aws-rds-proxy | d2
TOPIC: 2.2 HA and fault tolerance
Q:
Hundreds of Lambda functions open short-lived connections to an RDS MySQL instance and it starts returning too many connections errors. What do you put in front of the database, what are its constraints, and why not just use a larger instance?
A:
Add RDS Proxy: it holds a pool of long-lived connections and multiplexes many client connections over them, so the memory and CPU cost of a fresh connection per invocation disappears and surplus requests queue instead of failing; it also skips DNS caches on failover and keeps application connections alive. It supports RDS for MySQL, MariaDB, PostgreSQL and SQL Server plus Aurora MySQL and PostgreSQL; the proxy authenticates to the database with credentials it reads from Secrets Manager (or IAM database authentication) and can force clients to IAM, so functions carry no passwords. It must sit in the same VPC as the database, is never publicly accessible and cannot reach another Region, though extra endpoints can serve other VPCs in the same Region; on Aurora a read-only endpoint spreads queries over the readers. Pricing is per vCPU-hour of the database instance. Watch session pinning: prepared statements, SET session variables, temporary tables, locks or any statement over 16 KB pin a client to one connection until it disconnects, which quietly switches multiplexing off. A bigger instance raises the ceiling but not the churn.
USAGE:
Point every client at the proxy endpoint rather than the instance endpoint, otherwise client-side DNS caching brings back the slow failover the proxy was meant to remove.
## aws-s3-cross-region-replication | d2
TOPIC: 2.2 HA and fault tolerance
Q:
A compliance rule requires copies of a bucket's objects in a second Region, including objects uploaded last year. What must be true of both buckets, why does enabling CRR alone not satisfy the rule, and where does CRR sit among AWS replication mechanisms?
A:
Live replication, Cross-Region or Same-Region, requires versioning on both buckets plus an IAM role that S3 assumes to copy objects asynchronously; a rule copies only objects created after it exists, so last year's objects need an S3 Batch Replication job. Replicas may land in a cheaper class, the owner override can hand ownership to the destination account, delete markers are replicated only if you opt in, and deleting a specific version ID is never replicated, which protects the copy from malicious deletes; Replication Time Control adds an SLA that 99.99 percent of new objects arrive within 15 minutes. CRR is on the asynchronous side of a taxonomy worth knowing: synchronous replication (an RDS Multi-AZ standby, Aurora's six storage copies, S3 within a Region across three Availability Zones) gives an RPO of about zero but needs low latency, so it stays inside a Region; asynchronous replication (read replicas, S3 CRR, DynamoDB global tables, Aurora Global with lag typically under a second) spans Regions at a seconds-to-minutes RPO. Either kind propagates deletes and corruption, so it complements backups and never replaces them.
USAGE:
After enabling a rule, check the ReplicationStatus of a few source objects; a FAILED status usually means the destination lost versioning or the role lacks permissions.
## aws-eks-vs-ecs | d1
TOPIC: D2 services
Q:
When do you choose Amazon EKS over Amazon ECS for a containerised workload, given that both can run on Fargate, and what do you still have to choose once you pick EKS?
A:
Choose EKS when the requirement says Kubernetes: a team with Kubernetes skills, manifests or Helm charts, or a need to stay portable to other clouds or on-premises clusters; EKS is certified Kubernetes-conformant and AWS runs the control plane. Its building blocks are what you pick after that: nodes as managed node groups (AWS-optimised AMIs with one-click updates), self-managed instances, Fargate profiles for hostless pods, EKS Auto Mode that also runs the data plane, or hybrid nodes on-premises; add-ons such as the VPC CNI, CoreDNS, kube-proxy and the EBS and EFS CSI drivers; IAM per pod by mapping Kubernetes service accounts to roles (IAM roles for service accounts or Pod Identity); and Karpenter or the Cluster Autoscaler for scaling. Choose ECS otherwise: simpler, AWS-native, no per-cluster charge and no Kubernetes upgrade cadence. Fargate is a capacity choice under either orchestrator, not the deciding factor. The trap is EKS as the stronger default: Kubernetes or portability signals EKS, their absence points to ECS.
USAGE:
Do not adopt EKS just to keep options open; the recurring cluster upgrades need an owner, which small teams often lack.
## aws-eventbridge-archive-replay | d2
TOPIC: D2 services
Q:
A Lambda target silently mishandled a week of order events because of a bug. How can EventBridge let you reprocess those events after the fix, what must already be in place, and where does EventBridge stop being the right tool?
A:
An archive must already be attached to the bus; it keeps matching events for the retention you set, indefinitely by default, and after the fix you replay a time window to every rule or only the rules you name; replayed events carry a replay-name field and may arrive out of order, so targets must be idempotent. The model around that: the default bus receives AWS service events, custom buses take your own and partner buses take SaaS events; rules match on event content and route to targets with retries for up to 24 hours and 185 attempts using exponential backoff and jitter, after which a dead-letter queue keeps what could not be delivered. That DLQ is the trap: it holds events EventBridge could not deliver, not events a target accepted and mishandled. Scheduler runs cron and rate schedules at scale; Pipes joins a source such as SQS, Kinesis or DynamoDB Streams to a target with filtering and enrichment. Not for high-volume streaming (Kinesis), ordered buffering (SQS FIFO) or plain push fan-out where SNS is cheaper.
USAGE:
Wait about ten minutes after the incident window before replaying, because events can lag on their way into the archive and an early replay may miss the tail.
## aws-ecs-fargate-vs-ec2-launch | d2
TOPIC: D2 services
Q:
One team needs GPU containers on reserved capacity, another has a spiky API and nobody to patch hosts. Which ECS launch type suits each, what are Fargate's hard limits, and how do the containers get AWS permissions in both cases?
A:
Fargate is serverless: you declare CPU and memory per task from 0.25 vCPU with 512 MiB up to 32 vCPU with 244 GB, get 20 GiB of ephemeral storage by default and up to 200 GiB on request, run Linux or Windows containers with each task isolated on its own kernel, and pay per second only while the task runs, which suits the spiky API; Fargate Spot takes interruption-tolerant tasks at a discount. Its exclusions decide the other team: a Fargate task definition cannot request a GPU or a privileged container, so GPU containers on reserved capacity use the EC2 launch type, where you manage the instances but gain instance choice, custom AMIs and dense packing that is cheaper at steady scale. Either way give containers a task IAM role rather than the instance profile: the SDK in the container uses the task role exclusively, so each service gets least privilege, and Fargate has no instance profile at all. The trap is EC2 for bursty traffic, or application permissions on the instance role.
USAGE:
Create one task role per service with only the permissions that service needs, rather than one broad role shared across a cluster.
## aws-rds-multi-az-cluster-vs-instance | d3
TOPIC: D2 services
Q:
A team on RDS for PostgreSQL wants automatic failover and also wants to send reporting queries to a standby. Do they choose a Multi-AZ DB instance or a Multi-AZ DB cluster, why, and what does RDS itself give and withhold?
A:
A Multi-AZ DB instance keeps one synchronous standby in a second Availability Zone purely for failover; it cannot serve reads, and failover typically takes 60 to 120 seconds. A Multi-AZ DB cluster runs a writer plus two readers across three zones with semisynchronous replication, where a commit needs one reader's acknowledgement; both readers are failover targets and serve reads, and failover is typically under 35 seconds, so it is the answer here. The trap is "add a read replica", which is asynchronous and gives no automatic failover; Multi-AZ DB clusters exist only for RDS for MySQL and PostgreSQL. Step back to what RDS is: managed MySQL, PostgreSQL, MariaDB, Oracle, SQL Server and Db2 with automated backups kept 0 to 35 days, patching, encryption, IAM authentication and storage that autoscales up to 64 TiB (16 TiB for SQL Server), in exchange for no OS or shell access and only engine-level features. It is the wrong pick for key-value scale (DynamoDB), for engines or extensions RDS does not offer (run them on EC2), and when Aurora's six-copy storage and sub-minute failover justify its price.
USAGE:
If write latency on a Multi-AZ DB instance is the complaint, a Multi-AZ DB cluster typically commits faster because it waits for only one of the two readers rather than a fully synchronous standby.
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
## aws-fsx-windows-vs-lustre-vs-ontap | d2
TOPIC: 3.1 High-performing storage
QUALIFIER: HIGHEST performance
Q:
An ML team trains on a 400 TB S3 image dataset that grows daily. Dozens of Linux GPU instances must read it concurrently as a POSIX file system at hundreds of GB/s with sub-millisecond latency. Which storage design gives the HIGHEST performance?
OPT: a *
Create an FSx for Lustre file system linked to the S3 bucket as a data repository and mount it on every training instance.
OPT: b
Create an EFS file system in Max I/O performance mode and copy the dataset into it.
WHY:
EFS is general-purpose NFS whose Regional file systems top out at tens of GiB/s, and Max I/O is a previous-generation mode that raises latency rather than lowering it; it also has no S3 linkage, so the growing bucket must be copied by hand.
OPT: c
Attach an io2 Block Express volume holding a copy of the dataset to each instance.
WHY:
EBS is a block device for one instance in one Availability Zone; dozens of private 400 TB copies are neither a shared dataset nor synchronised with the bucket.
OPT: d
Create an FSx for Windows File Server Multi-AZ file system and share the dataset over SMB.
WHY:
FSx for Windows serves SMB with Windows ACLs and Active Directory; it is the wrong protocol for Linux POSIX training and is not built for HPC throughput.
A:
FSx for Lustre is the POSIX, Linux-only file system for HPC and machine learning: sub-millisecond latency, up to terabytes per second of throughput and millions of IOPS, and when linked to an S3 bucket it presents the objects as files, loading data lazily on first access and importing new objects as the bucket grows; scratch deployments suit short jobs, persistent ones replicate data. The other FSx flavours answer other questions: FSx for Windows File Server for SMB shares with Active Directory, FSx for NetApp ONTAP for NFS, SMB and iSCSI from one system with snapshots and SnapMirror. EFS is for shared general-purpose Linux files, EBS for a single instance, and S3 Transfer Acceleration only shortens long-distance uploads.
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
