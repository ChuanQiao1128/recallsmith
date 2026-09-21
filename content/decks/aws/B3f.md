# deck: aws-saa-c03

## aws-cloudfront-lambda-edge-vs-functions | d2
TOPIC: 4.2 Cost-optimized compute
Q:
Every viewer request needs a security header and a normalised cache key at millions of requests per second, as cheaply as possible. Which CloudFront edge option fits, and when is Lambda@Edge worth paying for?
A:
CloudFront Functions: JavaScript that runs in under a millisecond on viewer request and viewer response, scales to millions of requests per second and costs $0.10 per million invocations, with no network, file system or body access. That covers header edits, redirects, URL rewrites and cache key normalisation. Lambda@Edge costs six times more per request ($0.60 per million plus duration) but runs Node.js or Python for up to 30 seconds, can call DynamoDB or other services, reads the body, and hooks origin request and origin response, which fire only on cache misses. Pay for it only when the function needs a network call, the body or an origin event; the trap is Lambda@Edge for trivial header work.
USAGE:
Put heavy logic on the origin request event so it runs only on cache misses and CloudFront caches the result; keep viewer request work in CloudFront Functions.

## aws-lambda-pricing-and-graviton | d1
TOPIC: 4.2 Cost-optimized compute
Q:
A Linux stack of EC2 instances, Fargate tasks, Lambda functions and RDS PostgreSQL must cost less without a redesign. Which single change applies to all four, what does Lambda bill for, and what blocks the change?
A:
Switch to Graviton (arm64). AWS prices Graviton EC2 instances up to 20 percent below comparable x86, and the same lever exists as RDS and Aurora db.*g classes, Fargate arm64 tasks (20 percent cheaper, launched with up to 40 percent better price performance) and Lambda arm64 functions (about 20 percent less per GB-second). Lambda bills per request plus duration in GB-seconds rounded up to the millisecond, so memory right-sizing is the other free lever: CPU scales with memory (one vCPU at 1,769 MB), so a CPU-bound function at 128 MB runs about eight times longer than at 1,024 MB and rarely costs less. Windows, x86-only binaries and layers or images without arm64 builds block the switch; open-source stacks move first.
USAGE:
Before flipping a function or task to arm64, rebuild every layer, extension and container image for arm64; the price cut is worthless if the binary will not start.

## aws-savings-plans-vs-reserved-instances | d2
TOPIC: 4.2 Cost-optimized compute
Q:
A company runs steady EC2 workloads plus some Fargate and Lambda, and may move between instance families and Regions next year. Which commitment gives the discount without locking them in, and when does a Reserved Instance still win?
A:
A Compute Savings Plan: commit to a dollar amount per hour and the discount, up to 66 percent, applies to EC2 of any family, size, OS, tenancy or Region, plus Fargate and Lambda; an EC2 Instance Savings Plan reaches 72 percent but ties you to one family in one Region. Standard RIs give the same 72 percent yet can only be modified or resold on the RI Marketplace; Convertible RIs exchange across family, OS and tenancy but cap at 66 percent. An RI still wins twice: a zonal RI reserves capacity in one Availability Zone, which Savings Plans never do, and RDS, ElastiCache, OpenSearch, Redshift and DynamoDB sell reservations Savings Plans do not cover.
USAGE:
Size the hourly commitment on the On-Demand baseline only: Savings Plans skip Spot usage and anything already covered by an RI.

## aws-asg-scaling-policies | d2
TOPIC: 4.2 Cost-optimized compute
Q:
An Auto Scaling group must hold average CPU near 50 percent, be ready before the 9 am login rush, and stop paying for idle capacity overnight in the non-production copy. Which policy types cover this, and which one should you avoid?
A:
Target tracking is the default: pick a metric that moves inversely with capacity, such as average CPU, set a target, and Auto Scaling manages the alarms. Predictive scaling forecasts from up to 14 days of history (24 hours minimum) and launches capacity before the daily peak, so you can drop the standing safety margin; it only scales out, so keep a dynamic policy beside it. Scheduled actions set desired and minimum capacity on a cron, minimum 0 overnight for non-production, while Instance Scheduler or EventBridge plus Systems Manager stop standalone EC2 and RDS instances (up to 70 percent off a business-hours fleet). Step scaling suits bursts; avoid simple scaling, which makes one adjustment and ignores alarms until its cooldown ends.
USAGE:
When several policies fire at once Auto Scaling takes the largest capacity, so a forecast that overshoots is corrected only by the target tracking policy beside it.

## aws-elasticache-lazy-loading-vs-write-through | d2
TOPIC: 4.3 Cost-optimized database
Q:
A catalogue cache serves hour-old prices, a write-through cache is full of items nobody reads, and finance asks why the database class did not shrink after the cache went in. What is wrong in each case, and what one addition helps?
A:
Lazy loading fills the cache only on a read miss, so memory holds only what is requested, but nothing refreshes an entry when the database changes. Write-through updates the cache on every write, so entries are never stale, at the cost of a write penalty and churn from data nobody reads. A TTL on every entry bounds staleness under lazy loading and expires unread items under write-through. The finance answer is a cost rule: a cache lowers the database bill only when repeated reads move into memory, allowing a smaller RDS class or one replica fewer, or fewer read capacity units when DAX fronts DynamoDB; a write-heavy database gains nothing. Watch the hit ratio.
USAGE:
A session store is the textbook fit: write each session through with a TTL equal to the session lifetime, so expiry and eviction become the same operation.

## aws-dynamodb-streams-and-ttl | d2
TOPIC: 4.3 Cost-optimized database
Q:
Session records must be archived to S3 when they expire without paying for the delete writes, and a reviewer asks which other stores bill forever unless retention is set. How do you build this, and what is the retention rule?
A:
Set a TTL attribute holding a Unix epoch timestamp in seconds: DynamoDB deletes expired items itself, typically within a few days, without consuming write throughput. Enable a stream with new and old images and attach a Lambda event source mapping to archive the old image; TTL deletes are marked as service deletes, so an event filter fires only for expirations. Expired items still appear in scans until the delete runs. The retention rule: every store needs an explicit setting or it bills forever. DynamoDB PITR bills per GB-month; RDS automated backups are free up to the provisioned storage and keep 0 to 35 days, but manual snapshots bill until deleted; CloudWatch Logs defaults to never expire; S3 needs expiration rules.
USAGE:
Store the TTL value in seconds, not milliseconds, or every item lands centuries in the future, nothing expires and the table bills for all of it.

## aws-dynamodb-capacity-and-keys | d2
TOPIC: 4.3 Cost-optimized database
Q:
A new table has unpredictable traffic today and a steady, measurable curve expected within months. Which capacity mode do you start with, when do you switch and what do you buy, and what makes a good partition key?
A:
Start on-demand: pay per request, no throttling on spikes. Provisioned bills per capacity unit-hour: one WCU is one 1 KB write per second, one RCU one strongly consistent 4 KB read per second, transactions use double. A fully used WCU-hour ($0.00065) is about $0.18 per million writes against $0.625 on-demand, so provisioned wins once average utilisation exceeds roughly 30 percent; run auto scaling at the recommended 70 percent target and add reserved capacity (1 or 3 years, up to 54 or 77 percent off). You may switch to on-demand four times per rolling 24 hours and back any time. A good partition key has many distinct, evenly accessed values; a date or status column funnels writes into one hot partition.
USAGE:
Start on-demand, read ConsumedCapacity for a month, then switch to provisioned with auto scaling if the curve is flat; a date-only partition key will throttle on day one, and a large, rarely read table belongs in the Standard-IA class at $0.10 instead of $0.25 per GB-month.

## aws-rds-proxy | d2
TOPIC: 4.3 Cost-optimized database
Q:
Hundreds of Lambda functions open short-lived connections to RDS MySQL and it returns too many connections errors. What goes in front of the database, why not a larger instance, and when is the proxy not worth its fee?
A:
Add RDS Proxy. It keeps a pool of long-lived database connections and multiplexes many client connections onto them, so the cost of a fresh connection per invocation disappears and surplus requests queue instead of failing; it also shortens Multi-AZ failover by skipping client DNS caches. It must sit in the same VPC as the database and is never public. The fee is charged per vCPU of the target instance per hour, so it pays for itself when the alternative is a bigger class bought only for connection memory. Skip it for a small, long-lived application pool; HTTP-only serverless access to Aurora can use the Data API instead. A bigger instance raises the ceiling, not the churn.
USAGE:
Point every client at the proxy endpoint, not the instance endpoint, or client-side DNS caching brings back the slow failover the proxy was meant to remove.

## aws-dms-and-sct | d2
TOPIC: 4.3 Cost-optimized database
Q:
A company must move an on-premises Oracle database to AWS while the application keeps running, and the CFO wants the licence bill gone. Which target and which services do you combine, and what does each one do?
A:
Target Aurora PostgreSQL or RDS for PostgreSQL, because licensing is the cost lever: RDS License Included Oracle and SQL Server prices bundle the commercial licence, and Bring Your Own License only helps if the licence already exists, so "reduce licensing cost" means a heterogeneous migration to an open-source engine. Run the free Schema Conversion Tool first: it converts schema and code objects and flags what it cannot. Then DMS moves the data with a full load followed by change data capture from the source transaction logs, so the source keeps serving and the cutover shrinks to a final sync. A homogeneous move needs DMS alone and saves nothing on licences. The trap is DMS alone for an engine change.
USAGE:
Watch the task's CDCLatencySource and CDCLatencyTarget metrics and let both settle near zero before you point the application at the target; an open, uncommitted source transaction keeps source latency climbing until it commits.

## aws-rds-multi-az-vs-read-replica | d2
TOPIC: 4.3 Cost-optimized database
Q:
A PostgreSQL instance on RDS is CPU-bound by reporting queries and the team proposes doubling the instance class. What is the cheaper option, how does it differ from Multi-AZ, and what does it not fix?
A:
Add a read replica: an asynchronous copy that serves reads, up to 15 per source for MySQL, MariaDB and PostgreSQL, so you pay for a second instance only when reads need it instead of a permanently larger primary that also carries writes; Aurora adds and removes up to 15 replicas automatically on CPU or connection targets. Multi-AZ costs about the same as a replica, but its synchronous standby serves no reads; it exists for automatic failover, and only a Multi-AZ DB cluster's two readers do both jobs. A cross-Region replica adds inter-Region data transfer, and promoting it is a manual DR step. Replicas do not help write-heavy load, which still needs a bigger primary or sharding.
USAGE:
Multi-AZ is the first switch to flip when uptime starts to matter more than cost; add a replica only once reads, not availability, are the problem.

## aws-aurora-vs-dynamodb-choice | d2
TOPIC: 4.3 Cost-optimized database
Q:
A new service needs a serverless database with low idle cost. When does that mean DynamoDB, and when is Aurora still the right answer even though the word serverless appears?
A:
Decide on access pattern first, then on cost profile. DynamoDB is a serverless key-value and document store: per-request pricing, $0.25 per GB-month, nothing when idle, but no JOIN, so you denormalise around known key lookups. Aurora is MySQL or PostgreSQL compatible with joins and transactions across many tables; instances bill by the hour whether busy or not (Serverless v2 scales in half-ACU steps and can pause), storage bills per GB actually used, and I/O-Optimized removes I/O charges once they pass about 25 percent of spend. Sporadic key-value access is cheapest on DynamoDB on-demand; heavy joins are cheaper on Aurora than emulated in DynamoDB. The trap is choosing DynamoDB for the word serverless.
USAGE:
If you find yourself planning a second DynamoDB table just to answer a query the first cannot, check whether the real requirement is relational; secondary indexes cover alternate keys, not joins.

## aws-rds-backups-snapshots-pitr | d2
TOPIC: 4.3 Cost-optimized database
Q:
A developer ran an accidental DELETE on an RDS database 40 minutes ago and asks you to roll back; the team also asks whether taking more snapshots will raise the backup bill. What do you use, and what actually drives backup cost?
A:
Point-in-time restore depends on automated backups: RDS takes a daily snapshot and ships transaction logs to S3 every five minutes, so you can restore to any point inside the retention period, 0 to 35 days. On cost, backup storage is free up to the total provisioned database storage in the Region and snapshots are incremental, so more frequent snapshots barely move the bill; longer retention and manual snapshots do, because manual snapshots never expire, survive instance deletion and bill per GB until deleted. A cross-Region copy pays transfer plus destination storage. For cheap long-term analysis, export a snapshot to S3 as Parquet and query it with Athena. Automated backups vanish with the instance unless retained.
USAGE:
Take a manual snapshot before any risky migration, then delete it once the change is proven, because it bills until you do.

## aws-site-to-site-vpn-vs-direct-connect | d2
TOPIC: 4.4 Cost-optimized network
Q:
A company needs its data centre connected to a VPC within days and later expects to pull tens of terabytes a month back on premises. When is Site-to-Site VPN the answer, when is Direct Connect, and what does each cost?
A:
Site-to-Site VPN runs IPsec over the internet: quick to stand up, $0.05 per connection-hour (about $36 a month; a 5 Gbps connection is $0.60) plus internet egress near $0.09 per GB, 1.25 Gbps per tunnel on the standard size. Direct Connect is a dedicated link: ports at 1, 10, 100 or 400 Gbps billed per port-hour (1 Gbps is $0.30), hosted connections from 50 Mbps to 25 Gbps, and egress near $0.02 per GB, so it pays back once monthly egress reaches a few terabytes; but it needs a physical cross connect, takes weeks and is unencrypted. Ingress is free on both. Standard pattern: Direct Connect primary, VPN backup; the trap is Direct Connect for an urgent deadline.
USAGE:
Test the VPN backup path before you need it; a backup that has never carried traffic tends to have a stale route or a misconfigured customer gateway.

## aws-vpc-peering-vs-transit-gateway | d2
TOPIC: 4.4 Cost-optimized network
Q:
You peer VPC A with B and B with C, then find A cannot reach C. Why, and at what point does a Transit Gateway become cheaper than adding more peerings?
A:
VPC peering is a one-to-one link with no transitive routing: A reaches only VPCs it is directly peered with, and B cannot forward for them. CIDRs must not overlap, and a full mesh needs n(n-1)/2 links. Peering has no hourly fee: same-AZ traffic is free and cross-AZ costs $0.01 per GB each direction. A Transit Gateway is a Regional hub for VPCs, VPNs, Direct Connect gateways and other transit gateways, with route tables that connect or isolate groups, at about $0.05 per attachment-hour (roughly $36 a month per VPC) plus $0.02 per GB, so it costs more for a handful of VPCs. It wins with many VPCs, hybrid attachments, inspection, or one shared egress VPC replacing a NAT per VPC.
USAGE:
Plan non-overlapping CIDR ranges across accounts from day one, because peering refuses overlapping VPCs and a transit gateway cannot route sensibly between them.

## aws-route53-alias-vs-cname | d1
TOPIC: 4.4 Cost-optimized network
Q:
You need example.com, the bare domain, to resolve to an Application Load Balancer at the lowest DNS cost. Why does a CNAME fail here, and what do you use instead?
A:
DNS forbids a CNAME at the zone apex, so Route 53 refuses one for example.com. An alias record answers as an A or AAAA record but points at an AWS resource such as an ALB, CloudFront, API Gateway or S3 website endpoint. Cost is the second reason: a hosted zone is $0.50 a month and standard queries $0.40 per million, but queries to alias records that target AWS resources are free, while CNAME queries are billed. Health checks cost $0.50 a month each beyond 50 free ones on AWS endpoints, and Resolver endpoints $0.125 per ENI-hour, so do not create them by reflex. The trap is a CNAME because it works for www.example.com; it never sits at the apex.
USAGE:
An alias to an AWS resource has no TTL of its own; Route 53 uses the resource's default, so plan cutovers with that in mind.

## aws-api-gateway-caching-and-throttling | d2
TOPIC: 4.4 Cost-optimized network
Q:
A REST API on Lambda serves the same catalogue data to thousands of clients, a few paying clients hammer it, and anonymous scrapers run up the Lambda bill. Where do you cache, and how do you cap each kind of caller?
A:
Caching is a REST API feature provisioned per stage: repeated GET requests are served from the cache for the TTL, so fewer calls reach Lambda. Paying clients get a usage plan, which ties an API key to a stage with a rate, a burst and a quota; throttled callers get 429. Anonymous abuse is cheapest to stop before API Gateway bills it, with a WAF rate-based rule that blocks IPs exceeding a request limit over its window. Behind the API, an SQS queue before the workers smooths bursts so compute scales for the average, and Lambda reserved concurrency caps a function's concurrent instances at no charge. Usage plans for customers, WAF for strangers, queues and concurrency for the bill.
USAGE:
Never use API keys as authentication; pair a usage plan with IAM, Cognito or a Lambda authoriser, and treat plan quotas as best-effort targets rather than hard cost controls.

## aws-nat-gateway-cost-vs-vpc-endpoint | d2
TOPIC: 4.4 Cost-optimized network
Q:
Private-subnet instances push terabytes into S3 every night through a NAT Gateway, and dozens of VPCs each call SQS and Secrets Manager through their own NAT. What is being charged, and what removes it?
A:
A NAT Gateway bills $0.045 per hour plus $0.045 per GB processed, so bulk S3 or DynamoDB traffic pays a processing charge on the whole volume. Add a gateway endpoint for S3 (and DynamoDB): no hourly or data charge, and its prefix-list route beats the 0.0.0.0/0 route to the NAT. Other services need an interface endpoint (PrivateLink) at $0.01 per AZ-hour plus $0.01 per GB: cheaper than NAT at volume but dearer at near-zero traffic, so centralise interface endpoints in one shared VPC reached through Transit Gateway and a Route 53 private hosted zone instead of paying per VPC. Keep one NAT per AZ for internet destinations; the distractor is an interface endpoint for S3.
USAGE:
Gateway endpoints are Region-specific and unreachable over peering, VPN or Direct Connect, so traffic to a bucket in another Region still falls back to the NAT.

## aws-cost-explorer-budgets-cur | d1
TOPIC: D4 services
Q:
Finance wants a per-team spend chart with purchase recommendations, an alert that can stop instances before a project overspends, and hourly line items with amortised commitments for their warehouse. Which tool answers each request?
A:
Cost Explorer is the view: up to 13 months of history, an 18-month forecast, and rightsizing plus Savings Plans and RI recommendations; API requests cost $0.01 each and hourly granularity is an opt-in extra. Budgets is the alerting layer: cost, usage, RI and Savings Plans utilisation or coverage budgets notify by email or SNS, and budget actions apply an IAM policy or SCP or stop EC2 and RDS instances; the first two action-enabled budgets are free, then $0.10 a day, and data refreshes only three times a day. The Cost and Usage Report (CUR 2.0 in Data Exports) is the raw feed: hourly line items with resource IDs, tags and amortised commitment costs, delivered to S3 for Athena.
USAGE:
Because Budgets data lags by hours, pair a cost budget with a usage budget on the specific service and treat the stop action as a backstop, not a circuit breaker.

## aws-datasync-vs-transfer-family | d2
TOPIC: D4 services
Q:
A company must migrate a large on-premises NFS share into S3 and keep it synchronised nightly, while trading partners keep uploading with their existing SFTP clients. Which service fits each need, and what does the partner endpoint cost?
A:
DataSync handles the migration and nightly sync; Transfer Family serves the partners. DataSync is a transfer engine: an agent reads NFS, SMB, HDFS or object sources and writes to S3, EFS or FSx. Transfer Family is a fully managed endpoint speaking SFTP, FTPS, FTP and AS2 that lands files in S3 or EFS, authenticating users through its own store, AWS Managed Microsoft AD, or a custom Lambda or API Gateway identity provider. It bills $0.30 per hour per enabled protocol plus $0.04 per GB, roughly $216 a month before any transfer, so it is for partners who must keep their clients, never for a one-off bulk copy. DataSync pushes on your schedule; Transfer Family waits to receive.
USAGE:
A DataSync bandwidth limit can be changed on a running task execution, so throttle a migration during business hours without restarting it; disable unused Transfer Family protocols, since each one bills hourly.
