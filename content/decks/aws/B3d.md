# deck: aws-saa-c03

## aws-elasticache-lazy-loading-vs-write-through | d2
TOPIC: 3.3 High-performing databases
Q:
A catalogue cache serves prices that changed an hour ago; another team's write-through cache is full of items nobody reads. What is wrong in each case, what one addition fixes both, and where does each kind of cache belong?
A:
Lazy loading fills the cache only on a read miss, so nothing refreshes an entry when the database changes, hence the hour-old price. Write-through updates the cache on every database write, so entries are never stale, at the cost of a write penalty and churn from data nobody reads. A TTL on every entry bounds staleness under lazy loading and expires unread items under write-through, so the docs recommend combining both with a TTL. Place each cache at its bottleneck: CloudFront for static and edge content, an API Gateway stage cache for repeated GETs (default TTL 300 seconds, maximum 3,600), ElastiCache for application data and sessions, DAX for DynamoDB reads, read replicas for SQL reads. The trap is expecting a cache to fix write-heavy load: caches absorb reads only.
USAGE:
A session store is the textbook fit: write each session through with a TTL equal to the session lifetime, so expiry and eviction become the same operation.

## aws-dynamodb-gsi-vs-lsi | d2
TOPIC: 3.3 High-performing databases
Q:
A DynamoDB table already exists and you need to query by an attribute outside the primary key. Which index type can you add now, and is the new index a read-scaling or a write-scaling decision?
A:
Only a global secondary index can be added later; local secondary indexes exist only from table creation. A GSI takes any partition and sort key, has its own throughput and serves eventually consistent reads only; an LSI keeps the table's partition key, shares its capacity, allows strongly consistent reads, and caps each partition key value's item collection at 10 GB. Every index is a write-side cost, because each write also updates every index that projects the item. That is the general rule: read-heavy load has cheap levers (read replicas, reader endpoints, ElastiCache or DAX, eventually consistent reads); write-heavy load has only expensive ones (a larger writer, Provisioned IOPS, partition-key spread or write sharding, on-demand capacity, a queue that buffers bursts). The trap is adding read replicas to fix write throughput: they replay every write, they never absorb one.
USAGE:
Model your access patterns before creating the table, because forgetting an LSI later means recreating the table and migrating the data.

## aws-dynamodb-capacity-and-keys | d2
TOPIC: 3.3 High-performing databases
Q:
A new DynamoDB table has unpredictable traffic and 3 KB items. Which capacity mode do you start with, what does each read and write of such an item cost in capacity units, and what makes a good partition key?
A:
Start on-demand: you pay per request and the table instantly absorbs up to double its previous peak without throttling (only a jump past that within 30 minutes can throttle); move to provisioned capacity with auto scaling once the curve is flat. The arithmetic: one RCU is one strongly consistent read per second of up to 4 KB, or two eventually consistent reads; one WCU is one write per second of up to 1 KB; transactional operations cost double; sizes round up, so a 3 KB item costs 1 RCU to read and 3 WCUs to write. Each partition tops out at 3,000 RCU and 1,000 WCU, so a good partition key has many evenly accessed values; a date or status key lands most writes in one partition and throttles. RDS scales the same two ways: instance class for CPU and memory, io2 Provisioned IOPS for storage.
USAGE:
Start on-demand, read ConsumedCapacity for a month, then switch to provisioned with auto scaling if the curve is flat; a date-only partition key will throttle on day one.

## aws-rds-multi-az-vs-read-replica | d1
TOPIC: 3.3 High-performing databases
Q:
An RDS PostgreSQL instance must survive an Availability Zone failure and also serve a growing reporting load. Which of Multi-AZ and read replicas answers each need, and how does the replica story differ on Aurora and DynamoDB?
A:
Multi-AZ keeps a synchronous standby in another Availability Zone and fails over to it automatically; the one-standby instance deployment serves no reads from the standby, only the two-standby Multi-AZ DB cluster deployment does. A read replica is an asynchronous copy you can query, up to 15 per primary, in the same or another Region, with its own endpoint, promotable to a standalone instance as a manual disaster-recovery step. Aurora replicas share the cluster volume instead of copying it: up to 15 per cluster behind one reader endpoint, lag usually well under 100 milliseconds, and they double as failover targets. DynamoDB global tables are multi-active, so every replica Region serves reads and writes. Multi-AZ answers "keep running"; replicas answer "handle more reads", never "write faster".
USAGE:
Multi-AZ is the first switch to flip when uptime starts to matter more than cost; add a replica only once reads, not availability, are the problem.

## aws-purpose-built-databases-selection | d1
TOPIC: 3.3 High-performing databases
Q:
A fraud detection feature must traverse millions of relationships between accounts and devices, while a separate IoT feature stores sensor readings queried by time window. Which AWS database fits each workload, and why is Aurora the distractor?
A:
Map the scenario keyword to the purpose-built engine: Neptune for relationship traversal over highly connected data, Timestream for timestamped IoT or metrics data, DocumentDB for MongoDB-compatible documents, Keyspaces for Cassandra, DynamoDB for key-value at any scale, Redshift for the warehouse. Aurora or RDS is right only when the question stresses tables, joins and referential integrity; SQL over highly connected data is hard to write and tune. Two tiers cut across the map. In-memory: ElastiCache is a cache beside a database and may lose data, MemoryDB is a durable Valkey or Redis OSS compatible primary store with a Multi-AZ transaction log, DAX is DynamoDB-only. Serverless: Aurora Serverless v2, DynamoDB on-demand, Redshift Serverless and Neptune Serverless remove capacity planning for spiky or idle-heavy traffic. Older material keys immutable ledgers to QLDB, which current AWS guidance no longer lists.
USAGE:
AWS guidance expects one application to combine several best-fit databases, so a scenario may legitimately need more than one engine rather than a single relational store.

## aws-rds-proxy | d2
TOPIC: 3.3 High-performing databases
Q:
Hundreds of Lambda functions open short-lived connections to an RDS MySQL instance and it starts returning too many connections errors. What do you put in front of the database, and why not just use a larger instance?
A:
Add RDS Proxy. It holds a pool of long-lived database connections that many client connections share, so the memory and CPU cost of opening a fresh connection per invocation disappears and surplus requests are queued or throttled instead of failing. On failover it reconnects to the new writer while keeping application connections alive, and clients can authenticate with IAM while the proxy takes database credentials from Secrets Manager. Scope: RDS for MySQL, MariaDB, PostgreSQL and SQL Server, plus Aurora MySQL and PostgreSQL; nothing for DynamoDB or Redshift. For Aurora reads, add a read-only proxy endpoint or use the cluster reader endpoint. The proxy must sit in the same VPC as the database and is never public. A bigger instance or a higher max_connections is the distractor: it raises the ceiling, not the churn that hits it.
USAGE:
Point every client at the proxy endpoint rather than the instance endpoint, otherwise client-side DNS caching brings back the slow failover the proxy was meant to remove.

## aws-dms-and-sct | d2
TOPIC: 3.3 High-performing databases
Q:
A company must move an on-premises Oracle database to Aurora PostgreSQL while the application keeps running. Which services do you combine, and what does each one do?
A:
Use the Schema Conversion Tool first, then Database Migration Service. SCT converts schema and code objects to the target engine; DMS then moves the data with a full load followed by change data capture, so the source keeps serving traffic and cutover shrinks to a final sync. The engine change makes this heterogeneous. A homogeneous move, same engine both ends, needs no SCT: use native tools such as mysqldump or pg_dump, restore an RDS snapshot, promote a read replica, or run DMS full load plus CDC. Pick the engine by requirement: MySQL or PostgreSQL for commodity OLTP, Aurora when you already run either and want up to 15 replicas on shared three-AZ storage, Oracle or SQL Server only when a licence or vendor feature locks you in. The trap is DMS alone for a heterogeneous migration, or forgetting one endpoint must be in AWS.
USAGE:
Change data capture latency has no SLA, so watch replication lag and let it settle before you point the application at the target.

## aws-multi-az-vs-multi-region | d1
TOPIC: 3.3 High-performing databases
Q:
When is deploying across multiple Availability Zones enough, when does a workload genuinely need a second Region, and what does each hop cost in latency and replication lag?
A:
Availability Zones are discrete data centres with independent power and networking, kilometres apart yet within 100 km, linked by encrypted high-bandwidth fibre, so synchronous replication works: Multi-AZ covers the loss of a data centre. Regions are isolated and replicate nothing automatically, so a second Region is what survives a Regional outage, meets residency rules or serves distant users faster, at the price of asynchronous replication with lag plus a failover runbook. Latency and cost climb the same ladder: same-AZ traffic is free and fastest; cross-AZ synchronous replication (Multi-AZ, the Aurora three-AZ volume) adds milliseconds and cross-AZ transfer is billed per GB; cross-Region is asynchronous only (Aurora Global Database lags under a second; DynamoDB global tables are multi-active). Spread tiers across AZs for resilience, keep chatty tiers in one AZ, and compare AZ IDs rather than names across older accounts. The trap: multi-Region when the requirement only says highly available.
USAGE:
Check that the database, queue and cache tiers are each Multi-AZ as well, because one single-AZ dependency undoes the resilience of the compute layer.

## aws-dynamodb-dax | d2
TOPIC: 3.3 High-performing databases
Q:
A read-heavy DynamoDB application repeatedly fetches the same hot items and needs microsecond reads. Why choose DAX over ElastiCache, when does DAX not help, and where does MemoryDB fit?
A:
DAX is a write-through cache API-compatible with DynamoDB: swap the client and it serves eventually consistent GetItem, Query and Scan results from memory, dropping latency from single-digit milliseconds to microseconds while cutting the read capacity you provision; it runs as a cluster in your VPC. It does not cache strongly consistent or transactional reads, and it suits write-heavy workloads poorly. ElastiCache is a general in-memory store for Valkey, Redis OSS or Memcached that knows nothing of the DynamoDB API, and a node failure can lose data. MemoryDB is the third tier: a Valkey or Redis OSS compatible primary database with a Multi-AZ transaction log, microsecond reads and single-digit millisecond writes, for when the store must be durable rather than a cache. Rule: microsecond DynamoDB reads, DAX; generic cache or sessions, ElastiCache; durable Redis-style primary, MemoryDB.
USAGE:
Set the item and query cache TTLs deliberately, because writes that go straight to DynamoDB stay invisible to cached readers until the TTL expires.

## aws-ebs-volume-types | d2
TOPIC: 3.3 High-performing databases
Q:
You must choose block storage for three workloads: an EC2 boot volume hosting a mid-sized database, a log-processing job streaming large sequential files, and an RDS database needing sustained very high IOPS at low latency. Which types, and why?
A:
gp3 is the default: a baseline of 3,000 IOPS and 125 MiB/s regardless of size, no burst credits, and IOPS (up to 80,000) and throughput (up to 2,000 MiB/s) provisioned independently of capacity, unlike gp2, which scales with size and burns burst credits. st1, the throughput HDD, suits big sequential streams such as log processing, and sc1 is cheapest for rarely read data; neither can boot an instance. io2 Block Express is for sustained IOPS and sub-millisecond latency: up to 256,000 IOPS at a 1,000:1 IOPS-to-GiB ratio, where io1 stops at 64,000. RDS offers the same choice as storage types: gp3 starts at the same 3,000 IOPS and 125 MiB/s baseline, while io2 Block Express lets you set 1,000 to 256,000 IOPS separately from the storage size, within the same 1,000:1 ratio. Rule: sustained tens of thousands of IOPS or latency-critical, io2; everything else, gp3.
USAGE:
Moving gp2 to gp3 is an online Elastic Volumes change that usually lowers cost and removes burst-credit surprises.

## aws-aurora-serverless-v2 | d1
TOPIC: 3.3 High-performing databases
Q:
A team runs a dev database and a production API whose traffic spikes unpredictably. When is Aurora Serverless v2 the right choice over provisioned Aurora, and which serverless option covers the key-value, warehouse and graph cases?
A:
Aurora Serverless v2 scales compute in Aurora capacity units of roughly 2 GiB of memory each, in steps as small as 0.5 ACU across a 0 to 256 ACU range, in place without waiting for a quiet point, billed per second; it keeps Multi-AZ readers, Global Database and the engine's features, and recent versions pause to 0 ACUs when idle. That suits spiky, unpredictable, multi-tenant or dev and test relational workloads. A flat 24x7 load belongs on provisioned instances; v1 doubled or halved capacity and is deprecated. The rest of the serverless map: DynamoDB on-demand for key-value, Redshift Serverless (RPUs of 16 GB each) for the warehouse, Neptune Serverless (1 to 128 NCUs) for graph. Rule: unpredictable or idle-heavy relational, Aurora Serverless v2; key-value, DynamoDB. The trap is serverless for a steady load because the name sounds cheaper.
USAGE:
Set the minimum ACU high enough to keep the working set in the buffer pool, otherwise every idle period evicts the cache and the first busy minute pays for it in latency.

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

## aws-cloudfront-caching-ttl-and-invalidation | d1
TOPIC: 3.4 Scalable network
Q:
A team deploys a new app.js behind CloudFront but users keep getting the old file for a day. Why does that happen, what is the cheaper long-term fix than invalidating, and what is CloudFront for in the first place?
A:
CloudFront is a global HTTP content delivery network with more than 750 points of presence: it caches responses from any HTTP origin (S3 behind Origin Access Control, a load balancer, any HTTP server), protects private content with signed URLs and cookies, collapses origin requests with Origin Shield, trims cost with price classes, and runs CloudFront Functions or Lambda@Edge at the edge. It is not a load balancer and carries only HTTP; custom TCP or UDP goes to Global Accelerator. The stale file: CloudFront picks a cache behaviour by path pattern and its cache policy sets the TTL; an origin Cache-Control max-age, s-maxage or Expires header is honoured inside the minimum and maximum TTL, and with no header the default TTL of 24 hours applies, hence the day-old file. Invalidation works, but only the first 1,000 paths per month per account are free, so use versioned file names.
USAGE:
A wildcard such as /images/* counts as one invalidation path however many files it clears, so invalidate by prefix rather than listing individual files.

## aws-global-accelerator-vs-cloudfront | d1
TOPIC: 3.4 Scalable network
Q:
A multiplayer game uses a custom UDP protocol, partner firewalls must allow-list fixed IP addresses, and players are on several continents. Why is CloudFront the wrong answer and Global Accelerator the right one?
A:
CloudFront is an HTTP content delivery network: it caches responses at edge locations and understands only HTTP, so it cannot carry a custom UDP game protocol. Global Accelerator gives an accelerator two static anycast IPv4 addresses that stay fixed for its lifetime, so partners allow-list them once; clients enter at the nearest edge and ride the AWS global network to Application or Network Load Balancers, EC2 instances or Elastic IPs in one or many Regions. Listeners carry TCP and UDP, traffic dials shift a percentage of traffic per Region, health checks take an unhealthy endpoint out of service in under a minute, and nothing is cached. Keywords: static IP, gaming or VoIP, fast Regional failover. Choose CloudFront for cacheable HTTP content; the trap is assuming either service does both jobs.
USAGE:
Deleting an accelerator releases its static IPs permanently, so restrict delete permissions with IAM and disable rather than delete when pausing a service.

## aws-site-to-site-vpn-vs-direct-connect | d2
TOPIC: 3.4 Scalable network
Q:
A company needs its data centre connected to a VPC within days, and later wants predictable throughput for large nightly transfers. When is Site-to-Site VPN the answer, when is Direct Connect, and when is neither the right tool?
A:
Site-to-Site VPN runs IPsec tunnels over the public internet: encrypted and up in days, but capped at 1.25 Gbps per standard tunnel. Direct Connect is dedicated fibre into an AWS location: consistent latency, 1, 10, 100 or 400 Gbps ports, but it needs a physical cross connect, AWS can take up to 72 business hours just to provision the port, and it is unencrypted unless you add MACsec or run a VPN over it. Pair them, Direct Connect primary and VPN backup: AWS prefers the Direct Connect route for the same prefix, so failover is automatic. Neither is right for exposing one service rather than a network: PrivateLink publishes it through a Network Load Balancer to consumer VPCs, one-way, even with overlapping CIDRs; peering or a Transit Gateway gives VPC-to-VPC layer-3 reach. The trap is Direct Connect for an urgent deadline.
USAGE:
Test the VPN backup path before you need it; a backup that has never carried traffic tends to have a stale route or a misconfigured customer gateway.

## aws-vpc-private-subnet-nat | d2
TOPIC: 3.4 Scalable network
Q:
An application in a private subnet must call a third-party HTTPS API. Why can it not reach the internet, what do you add, and how should the VPC's subnets and CIDR be laid out so this keeps working as it grows?
A:
A private subnet's route table has no route to an internet gateway and its instances have no public IP, so outbound traffic has nowhere to go. Add a NAT gateway in a public subnet and a 0.0.0.0/0 route to it from the private route table; NAT allows outbound connections while still refusing inbound ones. Keep it working by tiering each Availability Zone: a public subnet routed to the internet gateway, a private subnet routed to the NAT gateway, and an isolated data subnet with no default route. Size the VPC between /16 and /28, remember every subnet loses five addresses (network, router, DNS, reserved, broadcast), and note that a too-small subnet blocks scaling because a CIDR block can never be resized, only joined by secondary blocks or IPv6. Keep CIDRs non-overlapping with every VPC or site you may peer or attach to a transit gateway.
USAGE:
Databases and workers live in private subnets; only the load balancer and NAT need a public subnet.

## aws-security-group-referencing | d1
TOPIC: 3.4 Scalable network
Q:
Web servers behind an ALB scale in and out, and the database must accept connections only from those web servers. How do you write the rule without maintaining IP lists, and where does each tier live in the VPC?
A:
Set the source of the inbound rule to a security group ID rather than a CIDR: a rule that references the web tier's group admits the private IP of every network interface carrying that group, so new instances are covered at launch. Chain the tiers: the load balancer group allows 0.0.0.0/0 on 443, the web group allows only the load balancer group, the database group allows only the web group on the database port. That chain is the multi-tier topology: an internet-facing ALB in public subnets, the application Auto Scaling group in private subnets, RDS Multi-AZ and ElastiCache in isolated data subnets, an internal ALB or NLB between tiers, NAT gateways or VPC endpoints for egress, every tier in at least two Availability Zones. Referencing works within a VPC, across peering and inbound across a transit gateway. The subnet CIDR, which admits everything there, is the distractor.
USAGE:
A rule that references a security group counts as one rule regardless of how many instances sit behind it, which keeps you well under the per-group rule quota.

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

## aws-redshift-vs-athena-vs-emr | d2
TOPIC: 3.5 Data ingestion and transformation
QUALIFIER: MOST cost-effective
Q:
A data team owns a set of PySpark jobs that run for about four hours every night on a self-managed Spark cluster. They want to move the jobs to AWS without rewriting them and cut both cost and operations work. Which option is the MOST cost-effective?
OPT: a *
Submit the jobs unchanged to an Amazon EMR Serverless Spark application, or to a transient EMR cluster that uses Spot Instances for task nodes and reads from S3.
OPT: b
Rewrite the jobs as AWS Glue ETL jobs.
WHY:
Glue also runs serverless Spark, but this option rewrites jobs the team refuses to rewrite, and Glue's standard rate of $0.44 per DPU-hour (4 vCPU, 16 GB) is above the roughly $0.30 EMR Serverless charges for the same vCPU and memory; Glue Flex at $0.29 only matches that by accepting delayed starts and interruptions.
OPT: c
Split the jobs into AWS Lambda functions triggered nightly.
WHY:
A Lambda invocation stops at 15 minutes (90 minutes at most on Lambda Managed Instances) and 10 GB of memory; a four-hour Spark job cannot run there without being re-architected.
OPT: d
Run the jobs as AWS Batch container jobs.
WHY:
Batch schedules containers on EC2 or Fargate but provides no managed Spark runtime; you would build, tune and operate Spark inside your own images, which is the operations work the team wants to shed.
A:
Move the jobs to EMR: EMR Serverless runs Spark without configuring or operating a cluster, provisions workers per job and releases them when it finishes, and bills per vCPU-hour and GB-hour; a transient EMR-on-EC2 cluster with Spot task nodes and data in S3 is the other cheap route when custom cluster settings matter. Either keeps the PySpark code as it is. Glue is the plausible second, also serverless Spark, but its standard per-DPU price is higher for equal capacity and the option as written rewrites the jobs. Lambda's 15-minute limit rules it out, and AWS Batch has no Spark runtime. Athena and Redshift are for SQL, not for existing Spark code.
USAGE:
Convert S3 data to partitioned Parquet or ORC before pointing Athena at it; columnar formats let a query read only the columns it needs, which shortens queries and lowers cost.
