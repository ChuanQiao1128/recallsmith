# deck: aws-saa-c03

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

## aws-glue-etl-and-catalog | d1
TOPIC: 3.5 Data ingestion and transformation
Q:
New JSON files land in S3 every hour and must be cleaned, converted to Parquet and made queryable by Athena with no servers to manage. Which service does it, what does the Data Catalog add, and when would DataBrew, EMR, Lambda or Firehose be the better transform?
A:
AWS Glue: a crawler infers the schema into the Glue Data Catalog, and a serverless Spark ETL job, coded or built visually in Glue Studio, transforms the files on a schedule or trigger. The Catalog is the shared metadata store, so Athena, EMR and Redshift Spectrum see the tables at once. Pick the neighbours by the shape of the work: DataBrew for no-code preparation with over 250 built-in transformations; EMR for a long-running cluster you tune or frameworks beyond Spark; Lambda for small per-record transforms inside its 15-minute timeout; Firehose when the data is streaming and the transform is inline, including JSON-to-Parquet on the way to S3. Trap: EMR or Lambda for a batch conversion Glue does serverless.
USAGE:
Run the crawler after each ETL job, because a new partition or column that is missing from the Catalog stays invisible to Athena until the table definition is refreshed.

## aws-s3-select-and-athena | d2
TOPIC: 3.5 Data ingestion and transformation
Q:
An application needs only a few columns from one large CSV object in S3, while an analyst runs ad hoc SQL across a whole bucket of CSV logs and the Athena bill keeps rising. Which service fits each, and how do you cut the scan cost?
A:
S3 Select runs a SQL expression against one CSV, JSON or Parquet object and returns only the matching subset. Athena runs SQL over many objects and bills $5 per TB scanned, so the lever is scanning less: convert CSV to columnar Parquet or ORC so a query reads only its columns (the pricing page's example drops a $15 scan to $1.25), and partition by the keys queries filter on so a WHERE clause reads only matching prefixes. Conversion paths: a Glue ETL job for scheduled batches, an Athena CTAS statement for a one-off, EMR Spark when a cluster already runs, Firehose format conversion while data streams in. Trap: Athena to filter one object, or S3 Select for joins across objects.
USAGE:
AWS has closed S3 Select to new customers, so new designs fetch byte ranges or use Athena; convert to Parquet before the bill grows, not after.

## aws-purpose-built-databases-selection | d1
TOPIC: 3.3 High-performing databases
Q:
A fraud detection feature must traverse millions of relationships between accounts and devices, while a separate IoT feature stores sensor readings queried by time window. Which AWS database fits each workload, and why is Aurora the distractor?
A:
Map the keyword to the engine. Neptune for the fraud graph: a managed graph database querying billions of relationships in milliseconds with Gremlin, openCypher or SPARQL, also serverless. Timestream for sensor readings queried by time window, today its InfluxDB edition, since LiveAnalytics closed to new customers in June 2025. The rest of the map: DocumentDB when the stem says MongoDB-compatible, same drivers and code, JSON documents, up to 15 replicas, global clusters; Keyspaces when it says Cassandra or CQL, serverless with no cluster to run, on-demand or provisioned; MemoryDB for a durable Redis- or Valkey-compatible primary; DynamoDB for key-value at any scale. Aurora or RDS wins only when tables, joins and referential integrity matter; AWS itself warns that SQL over highly connected data is hard to write and tune.
USAGE:
Read the compatibility word in the stem first: MongoDB, Cassandra and Redis each map to one managed engine, and picking DynamoDB for them forces a rewrite the question never asked for.

## aws-outposts-local-zones-wavelength | d2
TOPIC: D4 services
Q:
A hospital must run EC2 and RDS inside its own data centre so patient records never leave the site, while a game studio wants lower latency for players in a city far from any Region. Which of Outposts, Local Zones and Wavelength fits each?
A:
Choose by where users and data sit. Outposts is AWS-managed hardware in your facility, an extension of an Availability Zone, so it fits the hospital; it is bought on a 3-year term, never the cheap option, and belongs only where residency or on-premises latency rules out the Region. A Local Zone is AWS infrastructure near a large metro that you enable and add a subnet to, giving the studio's players lower latency than the distant Region. A Wavelength Zone sits inside a carrier's 5G network behind a carrier gateway: a VPC subnet with EC2, EBS, ECS and EKS for single-digit-millisecond mobile apps on that carrier only. Trap: a Local Zone when data may not leave the building.
USAGE:
Before ordering Outposts, try the cheaper fits first, a Local Zone for metro latency, Wavelength for 5G devices, a VPN or Direct Connect to the Region; Outposts servers give instance store only, and RDS and ALB run on racks alone.

## aws-s3-requester-pays-and-data-transfer | d2
TOPIC: 4.1 Cost-optimized storage
Q:
A research group publishes a multi-terabyte dataset in S3. Compare the four ways outsiders can read it, a public bucket, presigned URLs, CloudFront in front, and Requester Pays, by who pays for storage, requests and data transfer out.
A:
Storage is always billed to the bucket owner; only requests and transfer out move. A public bucket or a presigned URL, signed with the owner's credentials, bills the owner for every GET and for internet egress at $0.09 per GB for the first 10 TB a month. CloudFront in front turns that egress into CloudFront pricing: origin fetches from S3 are free, the first 1 TB out per month is free, and caching cuts S3 requests. Requester Pays flips request and download charges to the caller, who must authenticate and send the x-amz-request-payer header; anonymous access is refused, so a fully public dataset cannot use it. A cross-account VPC endpoint avoids egress but still bills the owner for requests.
USAGE:
Consumers must opt in with the request-payer flag, so document it for anyone you share the bucket with or their downloads fail with 403.

## aws-s3-durability-availability | d2
TOPIC: 2.2 HA and fault tolerance
Q:
Logs in S3 Standard are read about once a month by an audit job, and a colleague wants to move them all, including millions of 20 KB files, to One Zone-IA to save money. What do durability and availability say about the plan, and where are the hidden fees?
A:
Durability is the chance data survives: every mainstream class, One Zone-IA included, is designed for 99.999999999 percent. Availability is the chance you can read it now: Standard 99.99 percent, Standard-IA and Intelligent-Tiering 99.9, One Zone-IA 99.5, because it lives in a single zone a disaster can destroy, so it suits only recreatable copies such as replicas. The fees: IA classes charge $0.01 per GB retrieved plus a 30-day minimum, so against $0.0125 versus $0.023 per GB-month the saving of about $0.0105 vanishes after roughly one full read a month, and IA bills a 128 KB minimum per object, so a 20 KB log is charged as 128 KB. Unknown pattern: Intelligent-Tiering, which never tiers objects under 128 KB.
USAGE:
Durability figures protect against hardware loss, not your own deletes; run S3 Storage Class Analysis for 30 days before moving anything to an IA class.

## aws-backup-service | d2
TOPIC: 1.3 Data security controls
Q:
A team scripts EBS, RDS and DynamoDB backups separately, must keep daily recovery points for 35 days and year-end copies for 7 years, and is asked to retire its tape library. Which service replaces the scripts, and how do you keep the 7-year copies cheap without letting an administrator delete them?
A:
AWS Backup: a plan sets schedule and retention, resources join by tag, recovery points sit in vaults that can copy to another Region or account. Then split backup from archive. Backup is frequent recovery points with short retention: keep the 35 daily points warm. Archive is rarely read and long lived: lifecycle the year-end copies to cold storage, where they must stay at least 90 days, or land them in S3 Glacier Deep Archive at about $0.001 per GB-month under Object Lock compliance mode, which even root cannot shorten; Vault Lock in compliance mode does the same for a backup vault. Tape retirement is a Tape Gateway writing virtual tapes to Glacier. Trap: 7 years of daily warm snapshots.
USAGE:
Check every recovery point's retention before locking a vault in compliance mode, because anything retained indefinitely becomes permanent and billed forever.

## aws-organizations-scp | d2
TOPIC: 1.1 Secure access
Q:
An SCP on a member account's OU allows only ec2:* and s3:*, and a user in that account has no IAM policies attached. What can the user do, would the same SCP restrict the management account, and what does the organization's consolidated billing change?
A:
Nothing. An SCP never grants; it caps what identity-based and resource-based policies can grant to every user and role in member accounts, root included, so someone must still attach an IAM policy. It does not bind the management account, service-linked roles, or outside principals granted by a resource policy. Consolidated billing is the other half of Organizations: one bill paid by the management account, combined usage so S3 and data transfer reach volume tiers sooner, and Reserved Instance and Savings Plans discounts shared across members, which the management account can switch off per account. It costs nothing and restricts nothing; capping spend still needs Budgets actions or an SCP. Trap: treating billing as a guardrail.
USAGE:
Test a new SCP on an OU holding a single sandbox account before attaching it near the root, since one typo can lock every member account out of a service at once.

## aws-s3-performance-prefixes-multipart | d2
TOPIC: 3.1 High-performing storage
Q:
A data pipeline writes millions of small objects to one S3 bucket under a single date prefix, starts receiving 503 Slow Down errors, and its request bill now exceeds its storage bill. What fixes the errors, what fixes the bill, and how do you speed up one multi-gigabyte upload?
A:
S3 scales per prefix, at least 3,500 PUT, COPY, POST or DELETE and 5,500 GET or HEAD requests per second per prefix, so spread keys across prefixes; 503s mean S3 is still scaling. The bill is arithmetic: PUT, COPY, POST and LIST cost $0.005 per 1,000 and GET $0.0004 per 1,000, so a million 20 KB puts cost $5 in requests against about $0.46 of storage, and small objects miss IA and Glacier savings too (128 KB minimum billable size). Aggregate: buffer through Firehose, write larger Parquet files, use S3 Batch Operations for bulk actions. Multipart upload, from about 100 MB and mandatory above 5 GB, sends parts in parallel and retries only a failed part.
USAGE:
Add a lifecycle rule with AbortIncompleteMultipartUpload, because abandoned parts are billed as storage until the upload is completed or aborted.

## aws-multi-az-vs-multi-region | d1
TOPIC: 2.2 HA and fault tolerance
Q:
When is deploying across multiple Availability Zones enough, when does a workload genuinely need a second Region, and what do those choices cost in data transfer and instance pricing?
A:
Availability Zones are separate data centre groups inside one Region, linked by low-latency fibre so synchronous replication works, and Multi-AZ is the default high-availability design. Regions are isolated and replicate nothing automatically, so a second Region is what survives a Regional outage, meets residency rules or serves distant users, at the price of asynchronous lag. The cost side: traffic between AZs costs $0.01 per GB each direction and between Regions about $0.02 per GB, while the same AZ over private IPs is free; instance prices differ per Region, an m5.large being $0.096 an hour in N. Virginia and $0.153 in Sao Paulo; Spot prices are set per instance type per AZ, so spreading across AZs cuts cost and interruptions.
USAGE:
Check that the database, queue and cache tiers are each Multi-AZ as well, because one single-AZ dependency undoes the resilience of the compute layer.

## aws-ec2-instance-families | d2
TOPIC: 3.2 Elastic compute
Q:
Match the EC2 family letter to the workload, a web tier with idle periods, a video encoder, an in-memory database, a node with heavy local disk I/O and a deep learning trainer, and explain when the cheap-looking T instance ends up costing more than an M.
A:
The letter is the resource ratio: M balanced for web servers; T burstable, earning CPU credits below its baseline and spending them to burst; C compute-optimised for transcoding and HPC; R and X memory-optimised; I and D storage-optimised for local disk I/O; P and G GPU-accelerated. Sizes double vCPU, memory and price together; a newer generation usually costs the same or less per unit of performance. The T trap: a t3.medium's baseline is 20 percent, and T3, T3a and T4g launch in unlimited mode, billing surplus credits at $0.05 per vCPU-hour once the 24-hour average exceeds baseline; a T3 pinned at 100 percent costs about 1.5 times an M5; a t3.large breaks even with an m5.large at 42.5 percent.
USAGE:
If a T instance slows down or its bill grows under steady load, check its CPU credit metrics before blaming the application; sustained CPU belongs on M or C.

## aws-alb-vs-nlb | d2
TOPIC: 3.4 Scalable network
Q:
A platform team runs twelve microservices behind twelve Application Load Balancers, and a partner needs a fixed IP for a non-HTTP feed. When is an ALB versus an NLB the right choice, and how would you shrink the load-balancer bill?
A:
An ALB works at layer 7: it routes HTTP and HTTPS by host, path or header, terminates TLS and fronts WAF and Cognito. An NLB works at layer 4: TCP and UDP with a static IP per AZ, for non-HTTP protocols or allow-listed clients. Both bill about $0.0225 per hour plus capacity units, $0.008 per LCU-hour on ALB (highest of connections, bytes, rule evaluations) and $0.006 per NLCU-hour on NLB; a Gateway Load Balancer is $0.0125 per hour plus GLCU. Twelve ALBs are twelve hourly fees, so consolidate onto one ALB with host- and path-based rules. Cross-zone balancing is free and always on for ALB; NLB and GWLB have it off by default and bill it as Regional data transfer.
USAGE:
One ALB with host and path rules fronts a dozen microservices; reach for NLB only when a partner needs a fixed IP or the protocol is not HTTP.

## aws-asg-scaling-policies | d2
TOPIC: 4.2 Cost-optimized compute
Q:
An Auto Scaling group must hold average CPU near 50 percent, be ready before the 9 am login rush every weekday, and stop paying for idle capacity at night in the non-production copy. Which policy types cover this, and which costs do hibernation and warm pools remove?
A:
Target tracking is the default: pick a metric that moves inversely with capacity, such as ASGAverageCPUUtilization, set a target, and Auto Scaling manages the alarms. Predictive scaling forecasts daily or weekly patterns and adds capacity before the peak; scheduled scaling sets desired and minimum capacity on a cron, and a minimum of 0 overnight removes non-production hours entirely. Step scaling suits bursts; avoid simple scaling, which makes one adjustment and ignores alarms until its cooldown ends. Hibernation writes RAM to the encrypted EBS root, so a hibernated instance bills only EBS storage yet resumes with its processes intact; a warm pool keeps pre-initialised instances Stopped or Hibernated at that EBS-only cost, so scale-out is fast without running spares.
USAGE:
If several dynamic policies fire at the same moment, Auto Scaling applies the one that yields the largest capacity, for scale in as well as scale out.
