# deck: aws-saa-c03

## aws-storage-gateway-modes | d2
TOPIC: 3.1 High-performing storage
Q:
An office file server must keep its NFS and SMB shares while the data lives in S3, and the backup team wants to retire physical tapes without changing backup software. Which Storage Gateway types fit, and when is DataSync the wrong answer?
A:
S3 File Gateway presents NFS and SMB shares whose files become S3 objects, with a local cache for recently used data. Tape Gateway presents a virtual tape library over iSCSI, so existing backup software writes to virtual tapes held in S3 and ejected tapes archive to S3 Glacier Flexible Retrieval or Deep Archive. Volume Gateway covers iSCSI block: stored volumes keep the whole dataset on site and back up to S3 as EBS snapshots, cached volumes make S3 primary. The rule: ongoing on-premises access with cloud backing is Storage Gateway; a one-time or scheduled bulk copy is DataSync, a mover that leaves no persistent mount behind; NetApp features on both sides is FSx for ONTAP; AWS services on site is Outposts.
USAGE:
Size the cache and upload buffer disks before go-live: the guidance is a cache of at least 20 percent of the file store and larger than the upload buffer, and an undersized cache shows up as slow reads and stalled uploads.

## aws-fsx-windows-vs-lustre-vs-ontap | d2
TOPIC: 3.1 High-performing storage
Q:
Windows home directories on Active Directory, an ML job reading an S3 dataset at speed, and a NetApp migration needing NFS and SMB. Which FSx flavour serves each, and where do S3, EFS and EBS fit?
A:
FSx for Windows File Server: SMB with Windows ACLs and Active Directory, Single-AZ or Multi-AZ. FSx for Lustre: POSIX, Linux-only, built for HPC and ML; link it to an S3 bucket and the objects appear as files. FSx for NetApp ONTAP: NFS, SMB and iSCSI from one file system with snapshots and SnapMirror, for NetApp migrations. Around them: S3 for objects over HTTP at unlimited scale; EFS when many Linux hosts across AZs share one POSIX file system over NFS; EBS for one instance's low-latency block volume for boot or a database. Traps: EFS is NFS and Linux only, so Windows or SMB means FSx; an EBS volume lives in one AZ and attaches to one instance, unless io1 or io2 Multi-Attach shares it with up to 16 Nitro instances in that AZ.
USAGE:
FSx for Windows shares are also reachable from Linux clients over SMB, so a mixed fleet does not automatically force you onto ONTAP.

## aws-ebs-vs-efs-vs-instance-store | d1
TOPIC: 3.1 High-performing storage
Q:
An application needs a boot volume, scratch space for a 20 GB sort, shared files for a fleet spread across two AZs, and a home for millions of uploaded photos served over HTTP. Which storage type and service fits each, and what can object storage not do?
A:
Block storage (EBS, instance store) presents raw volumes the OS formats: lowest latency, one host at a time. EBS is network-attached, persistent and snapshot-able in one AZ, the boot and database choice; instance store is disk on the host, fastest, but its data is gone when the instance stops or fails, so it is scratch and cache only. File storage (EFS, FSx) is a hierarchical tree shared over NFS or SMB with POSIX permissions and locking; an EFS Regional file system mounts from thousands of instances across AZs. Object storage (S3) is a flat key space over HTTP at unlimited scale, but every write replaces the whole object: no in-place edit, no random writes, no boot volume, so databases and OS images never live directly on S3.
USAGE:
Put scratch and cache on instance store and anything you would miss on EBS with snapshots; if two instances in different AZs need the same files it is EFS, and if a file is written once and served many times it is S3.

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

## aws-redshift-vs-athena-vs-emr | d2
TOPIC: 3.2 Elastic compute
Q:
One team wants occasional SQL over CSV and Parquet files already in S3 with no servers, another needs nightly BI reports joining dozens of very large tables, and a third has existing Spark jobs. Which service fits each, and what is inside an EMR cluster?
A:
Athena fits the first team: serverless SQL straight against S3 objects through Glue Data Catalog tables, billed per terabyte scanned, so it wins for ad hoc queries over data left in S3. Redshift fits the second: a petabyte-scale warehouse optimised for complex joins across many large tables; Redshift Spectrum reads S3 without loading. EMR takes the Spark jobs: a managed Spark, Hive, Presto and HBase cluster whose primary node runs YARN and the HDFS NameNode, whose core nodes hold HDFS, and whose task nodes hold no HDFS and so are the safe place for Spot; reading and writing S3 through EMRFS or S3A keeps data alive after the cluster is gone, and EMR Serverless removes the cluster entirely. The traps are EMR or Redshift for plain SQL over S3, and EMR for a simple serverless ETL job that Glue runs without a cluster.
USAGE:
Convert S3 data to partitioned Parquet or ORC before pointing Athena at it; columnar formats let a query read only the columns it needs, which shortens queries and lowers cost.

## aws-eks-vs-ecs | d1
TOPIC: 3.2 Elastic compute
Q:
One team has Helm charts and a portability mandate, another has no Kubernetes skills and nobody to patch hosts, and a third service needs GPUs. Which orchestrator and launch type fits each, and what scales the tasks once they run?
A:
Choose EKS when the requirement says Kubernetes: existing manifests or Helm charts, Kubernetes skills, or portability to other clouds. EKS is certified conformant and AWS runs the control plane, at $0.10 per cluster per hour on standard support. Choose ECS otherwise: the simpler AWS-native orchestrator with no cluster upgrades to own. Both place containers on EC2 instances you manage or on Fargate, so the launch type is a separate decision: no host management means Fargate; GPUs, daemonsets, privileged containers or custom AMIs mean the EC2 launch type. Task and pod counts are scaled by Application Auto Scaling, not by an EC2 Auto Scaling group: target tracking on average CPU, memory or ALBRequestCountPerTarget. The trap is treating EKS as the stronger default.
USAGE:
Do not adopt EKS just to keep options open; the recurring cluster upgrades need an owner, which small teams often lack.

## aws-ec2-placement-groups | d2
TOPIC: 3.2 Elastic compute
Q:
Which placement group serves a tightly coupled HPC job, which one cannot hold fifty instances in one Availability Zone, and when is the right lever a Local Zone, a Wavelength Zone or an Outpost rather than any placement group?
A:
Cluster packs instances close together in one AZ for the low latency tightly coupled HPC needs. Spread puts each instance on distinct hardware, can span AZs, but allows only seven running instances per AZ, so it cannot hold fifty. Partition splits the group into up to seven partitions per AZ on separate racks with no instance cap, for Hadoop and Cassandra. Placement groups only move instances within an AZ; latency to users or data is a global-infrastructure choice: a Region for residency and the full catalogue, several AZs for fault isolation, a Local Zone for metro latency with fewer services, a Wavelength Zone inside a carrier's 5G network, an Outpost on your premises, and edge locations for CloudFront and Global Accelerator, which run no EC2. Place compute nearest the latency that matters.
USAGE:
Use one instance type and a single launch request for a cluster group, because topping it up later with a different size is the classic insufficient capacity error.

## aws-sqs-sns-eventbridge-choice | d2
TOPIC: 3.2 Elastic compute
Q:
Three teams describe their needs as absorb spikes without dropping work, tell several services about every event, and route by what is inside the event. Which of SQS, SNS and EventBridge fits each, and which one also becomes a scaling signal?
A:
SQS is a pull queue: producers enqueue at any rate and consumers drain at theirs, so the queue absorbs bursts and the two sides scale independently; ApproximateNumberOfMessagesVisible divided by running instances gives the backlog-per-instance metric that target tracking uses, because raw queue length does not scale with fleet size. SNS is push fan-out: one publish reaches many subscribers, queues, Lambda, HTTP or email; it retries a failed delivery for a while and then discards it, so nothing waits for a consumer to drain at its own pace, and a standard topic has no replay for a subscriber that was down. EventBridge is an event bus with rule-based routing on event content, a schema registry, and SaaS and AWS service sources. Rule of thumb: absorb spikes, queue; notify many, topic; route by content, bus; and pair SNS with SQS when the many consumers also need buffering.
USAGE:
Put one SQS job between an API that must answer in under a second and a worker that takes minutes; SNS when several teams need the same event; EventBridge when routing depends on the event body.

## aws-asg-lifecycle-hooks-and-warm-pools | d3
TOPIC: 3.2 Elastic compute
Q:
An Auto Scaling group must copy logs off each instance before termination, scale-out is slow because bootstrap takes minutes, and a colleague wants the same group to scale the ECS service and DynamoDB table too. Which features fit, and why does the last idea fail?
A:
A lifecycle hook pauses an instance in Pending:Wait or Terminating:Wait, one hour by default and extendable with heartbeats, while a script or Lambda function installs software or copies logs off; you then complete it with CONTINUE or ABANDON. A warm pool keeps pre-initialised instances beside the group, normally Stopped so you pay for volumes only, and scale-out draws from it instead of cold booting; without a launch hook the pool stops half-built instances. The colleague's idea fails because EC2 Auto Scaling groups scale EC2 instances only: ECS services, DynamoDB tables and indexes, Aurora Replicas, Lambda provisioned concurrency and Spot Fleets belong to Application Auto Scaling, and AWS Auto Scaling scaling plans, the tag-discovered console across both, now come with AWS's own advice to set predictive scaling policies directly on each resource instead.
USAGE:
Have the user data script call complete-lifecycle-action as its last line, so the launch hook holds the instance until bootstrap really finishes and a warm pool never stops a half-built one.

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
