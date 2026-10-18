# deck: aws-saa-fundamentals

## awsb-sig-least-ops | d1
TOPIC: Reading the question
Q:
A question's key requirement is least operational overhead. Which kind of option should you pick?
Q_ZH:
题目的关键要求是“运维开销最小”（least operational overhead），该选哪一类选项？
A:
Answer: A managed or built-in AWS feature: AWS runs it.
Because: in a managed service AWS runs the servers, patches and scaling, so none of that work is yours, while custom scripts on self-run Amazon EC2 (Elastic Compute Cloud) instances leave all of it to you.
Exam: least operational overhead → ✅ the managed or built-in feature, such as Amazon SNS (Simple Notification Service) sending one message to many receivers; ❌ your own code on Amazon EC2 copying Amazon SQS (Simple Queue Service) messages to each receiver: you run it
A_ZH:
答：托管或内置的 AWS 功能：AWS 替你运行。
因为：托管服务里服务器、补丁和扩缩容都由 AWS 负责，这些活都不归你；在自己管的 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例上跑自定义脚本，这些活全落在你身上。
考法：least operational overhead → ✅ 托管或内置功能，比如用 Amazon SNS（Simple Notification Service，简单通知服务）把一条消息推给多个接收方；❌ 自己在 Amazon EC2 上写代码，把 Amazon SQS（Simple Queue Service，简单队列服务）里的消息逐个转给每个接收方：要你自己运维
SOURCE: https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/design-principles.html
AWS does the heavy lifting of data center operations like racking, stacking, and powering servers. It also removes the operational burden of managing operating systems and applications with managed services.

## awsb-iam-role-not-keys | d1
TOPIC: Identity and accounts
Q:
An application on an Amazon EC2 (Elastic Compute Cloud) instance needs AWS permissions, with no secret stored on the server. What do you attach to the instance?
Q_ZH:
一台 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例上的应用需要 AWS 权限，但服务器上不能存任何密钥，要给实例挂什么？
A:
Answer: An IAM (Identity and Access Management) role via an instance profile: temporary credentials.
Because: the instance profile delivers the role's temporary credentials to the instance and AWS rotates them automatically, so no long-term secret is stored; the role grants permissions only, not network access.
Exam: an application on EC2 needs AWS permissions → ✅ an IAM role in an instance profile; ❌ IAM user access keys in the code or environment variables: long-term secrets that can leak
A_ZH:
答：通过实例配置文件（instance profile）挂一个 IAM（Identity and Access Management，身份与访问管理）角色：拿临时凭证。
因为：instance profile 把角色的临时凭证交给实例，AWS 会自动轮换，实例上不存任何长期密钥；角色只给权限，不开任何网络通路。
考法：EC2 上的应用需要 AWS 权限 → ✅ 放在 instance profile 里的 IAM 角色；❌ 把 IAM 用户的 access key 写进代码或环境变量：长期密钥，容易泄露
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2.html
Instead, you can and should use an IAM role to manage temporary credentials for applications that run on an Amazon EC2 instance. When you use a role, you don't have to distribute long-term credentials (such as sign-in credentials or access keys) to an Amazon EC2 instance.

## awsb-sl-lambda-pay-per-use | d1
TOPIC: Serverless and containers
Q:
A small task runs for a few seconds at a time, with long idle gaps between runs. Which AWS compute service keeps the cost lowest?
Q_ZH:
一个小任务每次只跑几秒钟，两次运行之间有很长的空闲时间，用哪个 AWS 计算服务成本最低？
A:
Answer: AWS Lambda: pay per request and millisecond.
Because: Lambda charges for each request plus the time your code runs, measured in milliseconds, so the idle gaps between runs cost nothing, while a running server is billed even when it sits idle.
Exam: short, infrequent or unpredictable tasks, pay only for what you use → ✅ AWS Lambda; ❌ an always-on Amazon EC2 (Elastic Compute Cloud) instance: billed every second it runs, even idle
A_ZH:
答：AWS Lambda：按请求次数和毫秒计费。
因为：Lambda 按每次请求加上代码实际运行的时间收费，时间以毫秒计，所以两次运行之间的空闲不花钱；而开着的服务器即使闲着也照样计费。
考法：任务短、次数少或不可预测，只为实际用量付费（pay only for what you use）→ ✅ AWS Lambda；❌ 一直开着的 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例：只要在运行就按秒计费，闲着也收钱
SOURCE: https://aws.amazon.com/lambda/pricing/
AWS Lambda is a serverless compute service that charges you only for what you use. Lambda Event Functions are priced per request and execution duration.

## awsb-in-sqs-decouple | d1
TOPIC: Messaging and streaming
Q:
An order website must keep accepting orders even while the order-processing service is down or slow. Which AWS service goes between them?
Q_ZH:
一个下单网站必须在订单处理服务宕机或变慢时照样接单，两者之间放哪个 AWS 服务？
A:
Answer: Amazon SQS (Simple Queue Service): a queue holds the work.
Because: the website sends each order to a queue that stores it redundantly until a consumer receives, processes and deletes it, so each side can scale, slow down or fail without losing orders.
Exam: decouple components so producers and consumers scale and fail independently → ✅ Amazon SQS queue; ❌ Amazon SNS (Simple Notification Service): pushes each message at once, keeps no backlog to pull
A_ZH:
答：Amazon SQS（Simple Queue Service，简单队列服务）：用队列把活存住。
因为：网站把每个订单发进队列，队列冗余存储它，直到消费者取走、处理完并删除；所以两边都可以各自扩缩、变慢或出故障，订单不会丢。
考法：解耦组件（decouple），让生产者和消费者各自扩缩、各自出故障 → ✅ Amazon SQS 队列；❌ Amazon SNS（Simple Notification Service，简单通知服务）：每条消息立刻推送出去，不留积压给消费者来拉取
SOURCE: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html
Amazon Simple Queue Service (Amazon SQS) offers a secure, durable, and available hosted queue that lets you integrate and decouple distributed software systems and components.

## awsb-in-sqs-buffer-writes | d1
TOPIC: Messaging and streaming
Q:
On sale days, traffic spikes send more writes than the database can take, and no write may be lost. Which AWS service goes in front of the database?
Q_ZH:
促销日流量暴涨，写入量超过数据库能承受的程度，而且一条写入都不能丢，数据库前面放哪个 AWS 服务？
A:
Answer: Amazon SQS (Simple Queue Service): buffer the spike, write steadily.
Because: the app puts each write into a queue that absorbs the spike, and consumers pull messages at a rate the database can handle, deleting each one only after it is saved, so nothing is dropped.
Exam: absorb write spikes, protect the database, no data loss → ✅ Amazon SQS queue in front of the database; ❌ a larger database instance class: pays for peak all year, bigger spikes still overload it
A_ZH:
答：Amazon SQS（Simple Queue Service，简单队列服务）：先缓冲高峰，再平稳写入。
因为：应用把每次写入先放进队列，由队列吸收高峰；消费者按数据库承受得了的速度取消息，确认保存后才删除，所以一条都不会丢。
考法：吸收写入高峰、保护数据库、数据不能丢 → ✅ 在数据库前放 Amazon SQS 队列；❌ 换更大的数据库实例类（instance class）：全年都为峰值容量付费，更大的高峰照样会压垮它
SOURCE: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html
Scalability – Amazon SQS can process each buffered request independently, scaling transparently to handle any load increases or spikes without any provisioning instructions.

## awsb-nc-dynamodb-vs-sql | d1
TOPIC: Databases
Q:
An order app must combine its customer, order and product tables in one query with SQL (Structured Query Language) joins. Which kind of AWS database fits?
Q_ZH:
一个订单应用要在一条查询里用 SQL（Structured Query Language，结构化查询语言）join 把客户、订单和商品表连起来，适合哪类 AWS 数据库？
A:
Answer: Amazon RDS (Relational Database Service) or Amazon Aurora: relational, SQL joins.
Because: relational engines keep data in tables with a fixed schema (set columns for every row) and defined relationships, so one SQL query can join them, while DynamoDB has no join operator and is built for key lookups.
Exam: joins across tables, fixed schema, SQL → ✅ Amazon RDS or Amazon Aurora; ❌ Amazon DynamoDB: key-value lookups at huge or bursty scale, no joins
A_ZH:
答：Amazon RDS（Relational Database Service，关系型数据库服务）或 Amazon Aurora：关系型，支持 SQL join。
因为：关系型引擎把数据存在有固定 schema（表结构，每行的列都是定好的）、彼此定义好关系的表里，所以一条 SQL 就能把多张表 join 起来；DynamoDB 没有 join 操作，是为按键查找设计的。
考法：多表 join、固定 schema、SQL → ✅ Amazon RDS 或 Amazon Aurora；❌ Amazon DynamoDB：超大或突发规模的键值查找，不支持 join
SOURCE: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html
Unlike relational databases, DynamoDB doesn't support a JOIN operator.

## awsb-nc-dynamodb-basics | d1
TOPIC: Databases
Q:
A shopping-cart service must fetch each cart by its key in a few milliseconds, however many users arrive. Which AWS database fits?
Q_ZH:
一个购物车服务要按 key 取出每个购物车，不管来多少用户都要在几毫秒内响应，选哪个 AWS 数据库？
A:
Answer: Amazon DynamoDB: serverless key-value, millisecond speed.
Because: DynamoDB scales out across distributed hardware and finds each item by its primary key, so latency stays at single-digit milliseconds as traffic grows, and it leaves out joins to keep that speed.
Exam: millisecond key-value reads and writes at any scale, serverless → ✅ Amazon DynamoDB; ❌ Amazon Redshift: a data warehouse for big analytic scans, not app transactions
A_ZH:
答：Amazon DynamoDB：无服务器键值库，毫秒级。
因为：DynamoDB 在分布式硬件上横向扩展，并按主键直接找到每一项，所以流量再大延迟也保持在个位数毫秒；为了保住这个速度，它不提供 join。
考法：任意规模的毫秒级键值读写、无服务器 → ✅ Amazon DynamoDB；❌ Amazon Redshift：做大规模分析扫描的数据仓库，不跑应用事务
SOURCE: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html
Amazon DynamoDB is a serverless, fully managed, distributed NoSQL database with single-digit millisecond performance at any scale.

## awsb-rds-managed-vs-ec2 | d1
TOPIC: Databases
Q:
A team wants a MySQL database whose backups, patching and failure recovery are handled by AWS, not by its own staff. Which option fits?
Q_ZH:
一个团队想要一个 MySQL 数据库，备份、打补丁和故障恢复都由 AWS 负责，而不是自己的人来做，选哪种方案？
A:
Answer: Amazon RDS (Relational Database Service) for MySQL: AWS runs the database.
Because: Amazon RDS is a managed service, so AWS patches the database and its operating system, takes backups, and detects and recovers from failures, while on Amazon EC2 (Elastic Compute Cloud) you do all of this yourself.
Exam: managed database, AWS handles backups, patching and high availability → ✅ Amazon RDS (or Aurora); ❌ database on Amazon EC2: you patch and back up; only when RDS lacks a needed feature
A_ZH:
答：Amazon RDS（Relational Database Service，关系型数据库服务）for MySQL：数据库由 AWS 运维。
因为：Amazon RDS 是托管服务，所以 AWS 负责修补数据库及其操作系统、做备份、发现故障并自动恢复；在 Amazon EC2（Elastic Compute Cloud，弹性计算云）上自建数据库，这些全得自己做。
考法：托管数据库，由 AWS 负责备份、补丁和高可用 → ✅ Amazon RDS（或 Aurora）；❌ 在 Amazon EC2 上自建数据库：补丁、备份都自己做，只在 RDS 缺少必需功能时才选
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html
Amazon RDS manages backups, software patching, automatic failure detection, and recovery.

## awsb-sig-least-change | d1
TOPIC: Reading the question
Q:
A question asks you to move an application's database to a managed AWS service with the least change to the application's code. Which kind of option should you pick?
Q_ZH:
题目要求把一个应用的数据库迁到 AWS 的托管服务上，并且应用代码改动最少（least change），该选哪一类选项？
A:
Answer: Replatform: keep the same database engine.
Because: the application keeps calling the same database engine, so only its connection address changes, while a rewrite to AWS Lambda or Amazon DynamoDB changes both its code and its design.
Exam: managed service, least change, minimal code changes → ✅ replatform to the same engine, such as Amazon RDS (Relational Database Service); ❌ a rewrite to AWS Lambda or Amazon DynamoDB: a refactor, the most change
A_ZH:
答：Replatform（换平台）：保留同一种数据库引擎。
因为：应用继续连同一种数据库引擎，只需改连接地址；改写成 AWS Lambda 或 Amazon DynamoDB 则代码和架构都要改。
考法：managed service、least change、minimal code changes → ✅ 换平台（replatform）到同一引擎，比如 Amazon RDS（Relational Database Service，关系型数据库服务）；❌ 改写成 AWS Lambda 或 Amazon DynamoDB：属于重构（refactor），改动最大
SOURCE: https://docs.aws.amazon.com/prescriptive-guidance/latest/large-migration-guide/migration-strategies.html
Using this migration strategy, you move the application to the cloud, and you introduce some level of optimization in order to operate the application efficiently, to reduce costs, or to take advantage of cloud capabilities. For example, you might replatform a Microsoft SQL Server database to Amazon RDS for SQL Server.

## awsb-ed-cloudfront-basics | d1
TOPIC: Edge and DNS
Q:
Users on other continents download the same images from one web server, and pages load slowly for them. Which AWS service should deliver those files?
Q_ZH:
其他大洲的用户都从同一台 Web 服务器下载同样的图片，页面加载很慢，该用哪个 AWS 服务来分发这些文件？
A:
Answer: Amazon CloudFront: cached copies near users.
Because: CloudFront caches copies of your files in edge locations worldwide and routes each request to the lowest-latency edge, so distant users get a nearby copy instead of a long trip to your server.
Exam: global users, same static content, lower latency and less origin load → ✅ Amazon CloudFront; ❌ Amazon S3 (Simple Storage Service) Transfer Acceleration: speeds long-distance transfers to and from one bucket, no caching
A_ZH:
答：Amazon CloudFront：在用户附近缓存副本。
因为：CloudFront 把文件副本缓存在全球各地的边缘站点（edge location），并把每个请求路由到延迟最低的边缘站点，所以远方用户拿到的是就近的副本，不用长途跑回你的服务器。
考法：全球用户、相同的静态内容、降低延迟并减轻源站负载 → ✅ Amazon CloudFront；❌ Amazon S3（Simple Storage Service，简单存储服务）Transfer Acceleration：加速与单个存储桶之间的远距离传输，不做缓存
SOURCE: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html
CloudFront delivers your content through a worldwide network of data centers called edge locations. When a user requests content that you're serving with CloudFront, the request is routed to the edge location that provides the lowest latency (time delay), so that content is delivered with the best possible performance.

## awsb-hy-direct-connect-basics | d1
TOPIC: Hybrid networking
Q:
A company's data center needs a connection to AWS with steady latency that never crosses the public internet. Which service?
Q_ZH:
公司机房到 AWS 需要一条延迟稳定、完全不经过公共互联网的连接，用哪个服务？
A:
Answer: AWS Direct Connect: a dedicated private line.
Because: the name says it: Direct Connect runs a direct fiber line from your router to an AWS router, so traffic skips the public internet and latency stays steady; the line is not encrypted by default.
Exam: dedicated private connection, consistent latency → ✅ AWS Direct Connect; ❌ AWS Site-to-Site VPN (virtual private network): encrypted tunnels over the internet, latency varies; ❌ AWS Snowball Edge: a shipped storage device, not a network link, closed to new customers
A_ZH:
答：AWS Direct Connect：专用私有线路。
因为：名字就是答案：Direct Connect 是从你的路由器直连 AWS 路由器的一根光纤，流量不经过公共互联网，延迟自然稳定；这条线默认不加密。
考法：dedicated private connection、consistent latency → ✅ AWS Direct Connect；❌ AWS Site-to-Site VPN（virtual private network，虚拟专用网络）：走互联网的加密隧道，延迟会波动；❌ AWS Snowball Edge：寄送的存储设备，不是网络连接，且已不再向新客户开放
SOURCE: https://aws.amazon.com/directconnect/
While in transit, your network traffic remains on the AWS global network and never touches the public internet. This reduces the chance of hitting bottlenecks or unexpected increases in latency.

## awsb-iam-identity-vs-resource-policy | d1
TOPIC: Identity and accounts
Q:
A partner AWS account must read one Amazon S3 (Simple Storage Service) bucket, and the access rule must live on the bucket itself. Which policy type?
Q_ZH:
一个合作方的 AWS 账户要读取某个 Amazon S3（Simple Storage Service，简单存储服务）桶，而且访问规则必须写在桶本身上，用哪种策略？
A:
Answer: A resource-based policy (a bucket policy): it names who gets in.
Because: a resource-based policy sits on the bucket and has a Principal element (who may use it), so it can name the other account, while an identity-based policy sits on a user or role and names nobody.
Exam: access rule stored on the resource, other accounts named → ✅ a resource-based policy, such as a bucket policy; ❌ an identity-based policy: attaches to your own user or role, cannot name other accounts
A_ZH:
答：基于资源的策略（resource-based policy，即存储桶策略）：它能写明谁可以访问。
因为：基于资源的策略挂在桶上，带有 Principal 元素（写明谁可以用它），所以能写明另一个账户；基于身份的策略挂在用户或角色上，不写任何访问者。
考法：access rule stored on the resource、写明其他账户 → ✅ 基于资源的策略，比如存储桶策略；❌ 基于身份的策略（identity-based policy）：挂在你自己的用户或角色上，写不了其他账户
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_identity-vs-resource.html
With resource-based policies, you can specify who has access to the resource and what actions they can perform on it.

## awsb-hy-site-to-site-vpn | d1
TOPIC: Hybrid networking
Q:
An office must connect its network to a VPC (virtual private cloud) over its existing internet line, with encryption. Which service?
Q_ZH:
一个办公室要通过现有的互联网线路，把自己的网络加密连到一个 VPC（virtual private cloud，虚拟私有云），用哪个服务？
A:
Answer: AWS Site-to-Site VPN (virtual private network): IPsec (Internet Protocol Security) tunnels.
Because: the name says it: Site-to-Site joins your whole site's network to AWS through two encrypted tunnels across the internet, so it reuses your existing line, but latency and throughput follow internet conditions.
Exam: encrypted connection over the internet, quick and low cost → ✅ AWS Site-to-Site VPN; ❌ AWS Direct Connect: needs a new physical circuit, not encrypted by default
A_ZH:
答：AWS Site-to-Site VPN（virtual private network，虚拟专用网络）：IPsec（Internet Protocol Security，互联网协议安全）隧道。
因为：名字就是答案：Site-to-Site 是把你整个站点的网络通过两条穿过互联网的加密隧道连到 AWS，所以能复用现有线路，但延迟和吞吐随互联网状况波动。
考法：encrypted connection over the internet、快且便宜 → ✅ AWS Site-to-Site VPN；❌ AWS Direct Connect：要新拉物理线路，而且默认不加密
SOURCE: https://docs.aws.amazon.com/whitepapers/latest/aws-vpc-connectivity-options/aws-site-to-site-vpn.html
Amazon VPC provides the option of creating an IPsec VPN connection between your remote networks and Amazon VPC over the internet, as shown in the following figure.

## awsb-bf-storage-types | d1
TOPIC: Block and file storage
Q:
A database on one Amazon EC2 (Elastic Compute Cloud) instance needs a disk it can format and update in small pieces with low latency. Which storage type?
Q_ZH:
一台 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例上的数据库需要一块磁盘，能格式化、能低延迟地小块改写，用哪种存储类型？
A:
Answer: Block storage, such as Amazon EBS (Elastic Block Store): a raw disk.
Because: block storage splits data into fixed-size blocks that the operating system reads and writes directly, so one block can change without rewriting the rest, which is why databases and boot disks use it.
Exam: a disk for one instance, database or boot volume → ✅ block storage (Amazon EBS); ❌ Amazon S3 (Simple Storage Service) object storage: whole objects over web requests; ❌ Amazon EFS (Elastic File System) file storage: a shared folder over NFS (Network File System)
A_ZH:
答：块存储，例如 Amazon EBS（Elastic Block Store，弹性块存储）：一块裸磁盘。
因为：块存储把数据切成固定大小的块，由操作系统直接读写，所以改一个块不用重写其余部分，数据库和启动盘都用它。
考法：给一台实例用的磁盘、数据库盘或启动卷 → ✅ 块存储（Amazon EBS）；❌ Amazon S3（Simple Storage Service，简单存储服务）对象存储：通过网络请求整体存取对象；❌ Amazon EFS（Elastic File System，弹性文件系统）文件存储：通过 NFS（Network File System，网络文件系统）共享的文件夹
SOURCE: https://aws.amazon.com/compare/the-difference-between-block-file-object-storage/
Block storage allows direct access to individual data blocks. You can read or write data to specific blocks without having to retrieve or modify the entire dataset the block belongs to.

## awsb-iam-least-privilege | d1
TOPIC: Identity and accounts
Q:
A Lambda function only reads objects from one Amazon S3 (Simple Storage Service) bucket. Which permissions should its role get?
Q_ZH:
一个 Lambda 函数只读取某一个 Amazon S3（Simple Storage Service，简单存储服务）桶里的对象，它的角色该给哪些权限？
A:
Answer: Only s3:GetObject on that bucket: least privilege.
Because: an IAM (Identity and Access Management) policy names exact actions and resources, so granting only the read action on that one bucket means a bug or a stolen credential can do nothing else.
Exam: most secure permissions → ✅ only the needed actions on the needed resources; ❌ AdministratorAccess or s3:*: far more than needed; ❌ IAM user access keys in the code: a long-term secret that can leak
A_ZH:
答：只给这个桶的 s3:GetObject：最小权限。
因为：IAM（Identity and Access Management，身份与访问管理）策略能写死具体操作和资源，只给这一个桶的读权限，代码出 bug 或凭证被盗也做不了别的事。
考法：most secure permissions → ✅ 只给所需资源上的所需操作；❌ AdministratorAccess 或 s3:*：远超所需；❌ 把 IAM 用户的 access key 写进代码：长期密钥，容易泄露
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
When you set permissions with IAM policies, grant only the permissions required to perform a task. You do this by defining the actions that can be taken on specific resources under specific conditions, also known as least-privilege permissions.

## awsb-sig-cost-effective | d1
TOPIC: Reading the question
Q:
A question asks for the most cost-effective solution. Which option should you pick?
Q_ZH:
题目要的是“最具成本效益”（most cost-effective）的方案，该选哪个选项？
A:
Answer: The cheapest fit: lowest cost, every requirement met.
Because: cost optimization means reaching the outcome at the lowest price that still meets the stated requirements, so extra availability, speed or features the question never asked for are wasted money.
Exam: most cost-effective → ✅ the cheapest option that meets every stated requirement; ❌ a cheaper option that misses one requirement: it fails; ❌ extra Regions or performance nobody asked for: wasted cost
A_ZH:
答：最便宜且达标的那个：成本最低，要求全满足。
因为：成本优化就是在满足所列要求的前提下用最低的价格拿到结果，题目没要求的额外可用性、性能或功能都是白花钱。
考法：most cost-effective → ✅ 满足全部要求里最便宜的那个；❌ 更便宜但漏掉一条要求的：直接不合格；❌ 题目没要的多区域或高性能：多花的钱
SOURCE: https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/welcome.html
A cost-optimized workload fully utilizes all resources, achieves an outcome at the lowest possible price point, and meets your functional requirements.

## awsb-dr-ha-vs-backup | d1
TOPIC: Backup and disaster recovery
Q:
A web app must keep serving users when one Availability Zone fails, with no time spent restoring anything. Which approach?
Q_ZH:
一个 Web 应用在某个可用区（Availability Zone）出故障时也必须继续服务用户，而且不能花时间去恢复任何东西，用哪种思路？
A:
Answer: High availability: running copies across Availability Zones.
Because: copies already run in two or more isolated Availability Zones, so traffic keeps flowing to the healthy zone while failed parts are replaced automatically, whereas a backup only helps you rebuild after downtime.
Exam: keep running through an instance or zone failure → ✅ high availability: a multi-zone deployment that replaces failures automatically; ❌ backups or snapshots alone: you restore after the outage, with downtime
A_ZH:
答：高可用（high availability）：多个可用区里同时跑着副本。
因为：副本本来就在两个以上相互隔离的可用区里运行，流量会继续流向健康的可用区，坏掉的部分会被自动替换；备份只能在宕机之后帮你重建。
考法：实例或可用区出故障时照常运行（keep running through a failure）→ ✅ 高可用：跨多个可用区、自动替换故障的部署；❌ 只靠备份或快照：要等故障后再恢复，中间有停机
SOURCE: https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-is-different-in-the-cloud.html
Availability Zones are designed for physical redundancy and provide resilience, allowing for uninterrupted performance, even in the event of power outages, Internet downtime, floods, and other natural disasters.

## awsb-vpc-public-private-subnet | d1
TOPIC: VPC networking
Q:
Two subnets share one VPC (virtual private cloud), but only one may let its instances talk directly with the internet. Which route makes that subnet public?
Q_ZH:
同一个 VPC（virtual private cloud，虚拟私有云）里有两个子网，只有其中一个能让实例直接和互联网通信，哪条路由让这个子网成为公有子网？
A:
Answer: Route 0.0.0.0/0 to an internet gateway: a direct internet path.
Because: subnet type comes only from the route table, so a route sending 0.0.0.0/0 (every internet address) to an internet gateway makes a subnet public; its instances still need public IP (Internet Protocol) addresses, such as Elastic IP addresses, to be reached.
Exam: subnet whose instances are reachable from the internet → ✅ route 0.0.0.0/0 to an internet gateway, plus public IP addresses; ❌ route 0.0.0.0/0 to a NAT (network address translation) gateway: outbound only, the subnet stays private
A_ZH:
答：把 0.0.0.0/0 路由到互联网网关（internet gateway）：直通互联网。
因为：子网是公有还是私有只看它的路由表，把 0.0.0.0/0（所有互联网地址）指向互联网网关，子网就是公有的；但里面的实例还得有公有 IP（Internet Protocol，互联网协议）地址（比如 Elastic IP 地址），外面才能连到它。
考法：子网里的实例要能从互联网访问 → ✅ 0.0.0.0/0 路由到 internet gateway，并配公有 IP 地址；❌ 0.0.0.0/0 路由到 NAT（network address translation，网络地址转换）gateway：只能出不能进，子网仍是私有
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html
Public subnet – The subnet has a direct route to an internet gateway. Resources in a public subnet can access the public internet.

## awsb-f-region-az | d1
TOPIC: VPC networking
Q:
An app in one AWS Region must keep running when one isolated data center location in that Region fails. Where do you launch its instances?
Q_ZH:
一个应用部署在某个 AWS 区域（Region）里，当该区域内一个相互隔离的数据中心位置出故障时仍要继续运行，实例应该放在哪里？
A:
Answer: Subnets in two or more Availability Zones: zones fail separately.
Because: a Region holds several isolated Availability Zones, and the VPC (virtual private cloud) spans them all while each subnet sits in exactly one zone, so only instances spread over subnets in different zones survive one zone failing.
Exam: highly available, survive the loss of one Availability Zone → ✅ instances in subnets across at least two Availability Zones; ❌ more instances in one Availability Zone: that zone's failure stops them all
A_ZH:
答：放在两个或更多可用区（Availability Zone）的子网里：各可用区独立出故障。
因为：一个区域里有多个相互隔离的可用区，VPC（virtual private cloud，虚拟私有云）横跨所有可用区，但每个子网只落在一个可用区里，所以只有把实例分散到不同可用区的子网，才能扛住一个可用区故障。
考法：高可用、能承受一个可用区故障（survive the loss of one Availability Zone）→ ✅ 实例分布在至少两个可用区的子网中；❌ 在同一个可用区里多加实例：这个可用区一挂就全停
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html
Each subnet must reside entirely within one Availability Zone and cannot span zones. By launching AWS resources in separate Availability Zones, you can protect your applications from the failure of a single Availability Zone.

## awsb-dr-rpo-rto | d1
TOPIC: Backup and disaster recovery
Q:
After a disaster, the business accepts losing at most the last 15 minutes of data. Which recovery objective does that 15 minutes set?
Q_ZH:
发生灾难后，业务最多只能接受丢失最近 15 分钟的数据，这 15 分钟定的是哪个恢复目标？
A:
Answer: RPO (recovery point objective): maximum data loss, measured in time.
Because: the name says it: the recovery point is the last moment you can restore to, so RPO caps how far back it may be, while RTO (recovery time objective) caps the downtime; smaller targets cost more.
Exam: how much data, measured in time, you can afford to lose → ✅ RPO; ❌ RTO: the maximum downtime before service is back
A_ZH:
答：RPO（recovery point objective，恢复点目标）：按时间算的最大数据损失。
因为：名字就是答案：恢复点就是你能恢复到的最后时刻，RPO 规定这个时刻最多能往前推多远；RTO（recovery time objective，恢复时间目标）规定停机最多多久；目标定得越小，花钱越多。
考法：按时间算能丢多少数据（how much data you can afford to lose）→ ✅ RPO；❌ RTO：服务恢复前允许的最长停机时间
SOURCE: https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/business-continuity-plan-bcp.html
Recovery Point Objective (RPO) is the maximum acceptable amount of time since the last data recovery point. This objective determines what is considered an acceptable loss of data between the last recovery point and the interruption of service and is defined by the organization.

## awsb-f-iam-user-vs-role | d1
TOPIC: Identity and accounts
Q:
A script must use AWS credentials that stop working on their own after one hour. Which IAM (Identity and Access Management) identity gives it those?
Q_ZH:
一个脚本要用一小时后自动失效的 AWS 凭证，该用哪种 IAM（Identity and Access Management，身份与访问管理）身份来拿？
A:
Answer: An IAM role via AWS STS (Security Token Service) AssumeRole: temporary credentials.
Because: assuming the role makes AWS STS issue credentials with a set lifetime, one hour by default, after which AWS rejects them, while an IAM user's access keys keep working until someone deactivates or deletes them.
Exam: temporary credentials that expire automatically → ✅ an IAM role (AWS STS AssumeRole); ❌ an IAM user's access keys in the script: long-term, valid until deactivated or deleted
A_ZH:
答：通过 AWS STS（Security Token Service，安全令牌服务）AssumeRole 扮演的 IAM 角色：临时凭证。
因为：扮演角色时 AWS STS 签发的凭证有固定有效期，默认一小时，到期 AWS 就不再认；IAM 用户的 access key 则一直有效，直到有人停用或删除。
考法：temporary credentials that expire automatically → ✅ IAM 角色（AWS STS AssumeRole）；❌ 脚本里放 IAM 用户的 access key：长期有效，直到停用或删除
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html
Temporary security credentials are short-term, as the name implies. They can be configured to last for anywhere from a few minutes to several hours.

## awsb-f-cloudwatch | d1
TOPIC: Monitoring, governance and cost
Q:
When an Amazon EC2 (Elastic Compute Cloud) instance's CPU (central processing unit) use stays above 80% for 10 minutes, a notification and a reboot must happen automatically. Which feature?
Q_ZH:
一台 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例的 CPU（central processing unit，中央处理器）使用率连续 10 分钟超过 80% 时，要自动发通知并重启实例，用哪个功能？
A:
Answer: An Amazon CloudWatch alarm: watches a metric, then acts.
Because: the alarm compares the instance's CPU metric with your threshold over a set number of periods, and when it breaches it runs its actions, such as notifying an Amazon SNS (Simple Notification Service) topic or rebooting the instance.
Exam: act automatically when a metric crosses a threshold → ✅ a CloudWatch alarm; ❌ AWS CloudTrail: records API (application programming interface) calls, not metrics; ❌ AWS Config: records resource configuration, not performance
A_ZH:
答：Amazon CloudWatch 告警（alarm）：盯住一个指标，越线就动作。
因为：告警在设定的若干个周期里把实例的 CPU 指标和你的阈值比较，一旦越线就执行它的动作，例如通知 Amazon SNS（Simple Notification Service，简单通知服务）主题或重启实例。
考法：指标越过阈值时自动采取行动 → ✅ CloudWatch 告警（CloudWatch alarm）；❌ AWS CloudTrail：记录 API（application programming interface，应用程序接口）调用，不是指标；❌ AWS Config：记录资源配置，不管性能
SOURCE: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html
A metric alarm watches a single CloudWatch metric or the result of a math expression based on CloudWatch metrics. The alarm performs one or more actions based on the value of the metric or expression relative to a threshold over a number of time periods.

## awsb-f-route-table | d1
TOPIC: VPC networking
Q:
You create two subnets in one new VPC (virtual private cloud) and add no routes. Why can instances in the two subnets already send traffic to each other?
Q_ZH:
你在一个新 VPC（virtual private cloud，虚拟私有云）里建了两个子网，一条路由都没加，为什么两个子网里的实例已经能互相发送流量？
A:
Answer: The local route: built into every route table.
Because: every route table automatically holds a local route for the VPC's own CIDR (Classless Inter-Domain Routing) block, so traffic to any address inside the VPC is delivered within it, whichever subnet it is in.
Exam: subnets in the same VPC communicate by default → ✅ the local route; ❌ VPC peering connection: links two separate VPCs, not subnets of one
A_ZH:
答：本地路由（local route）：每个路由表都自带。
因为：每个路由表都会自动带一条指向 VPC 自身 CIDR（Classless Inter-Domain Routing，无类别域间路由）地址块的本地路由，所以发往 VPC 内任何地址的流量都在 VPC 内部直接送达，不管在哪个子网。
考法：同一 VPC 内的子网默认互通 → ✅ 本地路由（local route）；❌ VPC peering 对等连接：连接两个不同的 VPC，不是连接同一 VPC 里的子网
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html
Every route table contains a local route for communication within the VPC. This route is added by default to all route tables.

## awsb-misc-shared-responsibility | d1
TOPIC: Reading the question
Q:
An Amazon S3 (Simple Storage Service) bucket's settings let anyone on the internet read customer files. Under the shared responsibility model, whose job was it to set them correctly?
Q_ZH:
一个 Amazon S3（Simple Storage Service，简单存储服务）桶的设置让互联网上任何人都能读取客户文件。按责任共担模型（shared responsibility model），把它设对是谁的责任？
A:
Answer: Yours, the customer's: security in the cloud.
Because: AWS secures the hardware, network and facilities that run the service, so the bucket is safe underneath, but your data, its permissions and its encryption settings are yours to configure.
Exam: customer data and who can access it → ✅ the customer (security in the cloud); ❌ AWS: secures only the hardware, network and facilities (security of the cloud)
A_ZH:
答：你，也就是客户：云“里面”的安全。
因为：AWS 负责运行该服务的硬件、网络和机房，所以底层是安全的；但你的数据、它的访问权限和加密设置都由你来配置。
考法：客户数据以及谁能访问它 → ✅ 客户（security in the cloud）；❌ AWS：只负责硬件、网络和机房（security of the cloud）
SOURCE: https://aws.amazon.com/compliance/shared-responsibility-model/
For abstracted services, such as Amazon S3 and Amazon DynamoDB, AWS operates the infrastructure layer, the operating system, and platforms, and customers access the endpoints to store and retrieve data. Customers are responsible for managing their data (including encryption options), classifying their assets, and using IAM tools to apply the appropriate permissions.

## awsb-f-cidr | d1
TOPIC: VPC networking
Q:
You are choosing the IPv4 (Internet Protocol version 4) address block size for a new VPC (virtual private cloud). Which range of sizes does AWS accept?
Q_ZH:
你要为一个新 VPC（virtual private cloud，虚拟私有云）选 IPv4（Internet Protocol version 4，第 4 版互联网协议）地址块的大小，AWS 接受哪个大小范围？
A:
Answer: From /16 to /28: 65,536 down to 16 addresses.
Because: AWS limit: a VPC or subnet IPv4 CIDR (Classless Inter-Domain Routing) block must be between /16 (65,536 addresses) and /28 (16 addresses), so a larger block such as /8 or a smaller one such as /32 is rejected.
Exam: valid VPC or subnet CIDR size → ✅ any block from /16 to /28; ❌ a /8 block for more addresses: larger than the /16 maximum
A_ZH:
答：从 /16 到 /28：65,536 到 16 个地址。
因为：AWS 规定，记住即可：VPC 或子网的 IPv4 CIDR（Classless Inter-Domain Routing，无类别域间路由）地址块必须在 /16（65,536 个地址）和 /28（16 个地址）之间，比它大的 /8 或比它小的 /32 都会被拒绝。
考法：合法的 VPC 或子网 CIDR 大小 → ✅ /16 到 /28 之间的任意地址块；❌ 想要更多地址就用 /8：超过 /16 的上限
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html
The allowed block size is between a /16 netmask (65,536 IP addresses) and /28 netmask (16 IP addresses).

## awsb-f-container-image | d1
TOPIC: Serverless and containers
Q:
Your team packs its app and all its dependencies into container images and needs a private place in AWS to store them for deployment. Which service?
Q_ZH:
你的团队把应用和全部依赖打包成容器镜像，需要在 AWS 里找一个私有的地方存放这些镜像以便部署，用哪个服务？
A:
Answer: Amazon ECR (Elastic Container Registry): a private image registry.
Because: the name says it: a registry stores container images, so you push each image to a private repository and Amazon ECS (Elastic Container Service) or Amazon EKS (Elastic Kubernetes Service) pulls it from there to start containers.
Exam: store, scan or replicate private container images → ✅ Amazon ECR; ❌ Amazon ECS: runs containers, does not store images
A_ZH:
答：Amazon ECR（Elastic Container Registry，弹性容器镜像仓库）：私有镜像仓库。
因为：名字就是答案：registry 就是存放容器镜像的仓库；你把镜像推送到私有仓库，Amazon ECS（Elastic Container Service，容器服务）或 Amazon EKS（Elastic Kubernetes Service，托管 Kubernetes 服务）再从这里拉取镜像来启动容器。
考法：存放、扫描或跨区域复制私有容器镜像 → ✅ Amazon ECR；❌ Amazon ECS：负责运行容器，不存放镜像
SOURCE: https://docs.aws.amazon.com/AmazonECR/latest/userguide/what-is-ecr.html
Amazon Elastic Container Registry (Amazon ECR) is an AWS managed container image registry service that is secure, scalable, and reliable. Amazon ECR supports private repositories with resource-based permissions using AWS IAM.

## awsb-f-aws-account | d1
TOPIC: Identity and accounts
Q:
A role in the development account tries to read an Amazon S3 (Simple Storage Service) bucket in the production account, and no one has granted any access. Why is the request denied?
Q_ZH:
开发（development）账户里的一个角色去读生产（production）账户里的一个 Amazon S3（Simple Storage Service，简单存储服务）桶，没有任何人授过权，为什么请求被拒？
A:
Answer: Account isolation: no access between accounts by default.
Because: AWS rule: an account is an identity and access isolation boundary, so no access crosses accounts until both sides grant it: a bucket policy naming the role, and a role policy allowing the read.
Exam: two accounts, nothing shared yet → ✅ denied until access is explicitly granted on both sides; ❌ both accounts in the same organization: membership alone grants no access
A_ZH:
答：账户隔离：账户之间默认互不可访问。
因为：AWS 规定，记住即可：账户是身份与访问的隔离边界，两边都授权之前，访问不能跨账户：桶策略要写明这个角色，角色自己的策略也要允许读取。
考法：两个账户、还没做任何共享 → ✅ 两边都明确授权之前一律拒绝；❌ 两个账户在同一个组织（organization）里：光是成员关系不给任何权限
SOURCE: https://docs.aws.amazon.com/accounts/latest/reference/accounts-welcome.html
An account acts as an identity and access management isolation boundary. When you need to share resources and data between two accounts, you must explicitly allow this access.

## awsb-f-dns-route53 | d1
TOPIC: Edge and DNS
Q:
Users type www.example.com, and that name must be turned into the address of your load balancer. Which AWS service answers those lookups?
Q_ZH:
用户输入 www.example.com，这个名字要被解析成你的负载均衡器的地址，由哪个 AWS 服务来回答这些查询？
A:
Answer: Amazon Route 53: AWS's managed DNS (Domain Name System).
Because: Route 53 answers DNS queries from your domain's hosted zone (its set of DNS records): each record maps a name to a target, and the record's routing policy decides which answer to return when there are several.
Exam: map domain names to resources, host DNS records → ✅ Amazon Route 53; ❌ Amazon CloudFront: caches and delivers content, does not host your DNS records
A_ZH:
答：Amazon Route 53：AWS 托管的 DNS（Domain Name System，域名系统）。
因为：Route 53 用你这个域名的托管区域（hosted zone，也就是这个域名的全部 DNS 记录）回答 DNS 查询：每条记录把一个名字映射到一个目标，有多个答案时由记录的路由策略（routing policy）决定返回哪一个。
考法：把域名映射到资源、托管 DNS 记录 → ✅ Amazon Route 53；❌ Amazon CloudFront：负责缓存和分发内容，不托管你的 DNS 记录
SOURCE: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/Welcome.html
Amazon Route 53 is a highly available and scalable Domain Name System (DNS) web service. You can use Route 53 to perform three main functions in any combination: domain registration, DNS routing, and health checking.

## awsb-f-ec2-you-run-the-os | d1
TOPIC: Reading the question
Q:
Your application runs on an Amazon EC2 (Elastic Compute Cloud) instance, and a security patch comes out for its Linux operating system. Who must install it?
Q_ZH:
你的应用跑在一台 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例上，它的 Linux 操作系统出了安全补丁，谁来装？
A:
Answer: You: the EC2 guest operating system is yours.
Because: EC2 gives you a virtual server with a guest operating system you manage, so its patches are yours, while a managed service such as Amazon RDS (Relational Database Service) has AWS patch it.
Exam: who patches the guest operating system on EC2 → ✅ the customer; ❌ AWS: patches the hosts and virtualization layer under EC2, not your instance
A_ZH:
答：你：EC2 的客户操作系统归你管。
因为：EC2 给你的是一台虚拟服务器，上面的客户操作系统由你管理，补丁自然归你；换成 Amazon RDS（Relational Database Service，关系型数据库服务）这类托管服务，操作系统补丁就由 AWS 来打。
考法：EC2 上的客户操作系统谁来打补丁 → ✅ 客户；❌ AWS：只负责 EC2 底下的宿主机和虚拟化层，不管你的实例
SOURCE: https://aws.amazon.com/compliance/shared-responsibility-model/
Customers that deploy an Amazon EC2 instance are responsible for management of the guest operating system (including updates and security patches), any application software or utilities installed by the customer on the instances, and the configuration of the AWS-provided firewall (called a security group) on each instance.

## awsb-f-iops-vs-throughput | d1
TOPIC: Block and file storage
Q:
A database performs thousands of small, random reads and writes every second. Which storage performance measure must its volume be sized for?
Q_ZH:
一个数据库每秒要做成千上万次小块随机读写，它的卷要按哪个存储性能指标来定规格？
A:
Answer: IOPS (input/output operations per second): how many operations.
Because: each small read or write counts as one operation however few bytes it moves, so a busy database hits its volume's IOPS limit long before its throughput limit in MiB/s (mebibytes per second).
Exam: many small random reads and writes, transactional database → ✅ IOPS; ❌ throughput (MiB/s): bytes per second, the limit for large sequential reads and writes
A_ZH:
答：IOPS（input/output operations per second，每秒读写次数）：看的是操作次数。
因为：每一次小读写不管搬多少字节都算一次操作，所以繁忙的数据库会先撞上卷的 IOPS 上限，远早于以 MiB/s（mebibytes per second，每秒兆字节）计的吞吐上限。
考法：大量小块随机读写、事务型数据库 → ✅ IOPS；❌ 吞吐量（throughput，MiB/s）：每秒字节数，是大块顺序读写的瓶颈
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/ebs-io-characteristics.html
IOPS are a unit of measure representing input/output operations per second. The operations are measured in KiB, and the underlying drive technology determines the maximum amount of data that a volume type counts as a single I/O.

## awsb-f-layer4-vs-layer7 | d1
TOPIC: Reading the question
Q:
A load balancer only forwards TCP (Transmission Control Protocol) connections by IP (Internet Protocol) address and port, never looking inside the requests, at millions of requests per second. At which OSI (Open Systems Interconnection) layer does it work?
Q_ZH:
一个负载均衡器只按 IP（Internet Protocol，互联网协议）地址和端口转发 TCP（Transmission Control Protocol，传输控制协议）连接，从不查看请求内容，每秒要处理数百万个请求，它工作在 OSI（Open Systems Interconnection，开放系统互连）模型的哪一层？
A:
Answer: Layer 4, the transport layer: addresses and ports only.
Because: a Network Load Balancer picks each connection's target from a hash of its protocol, IP addresses and ports, so it never parses HTTP (Hypertext Transfer Protocol) content and can handle millions of requests per second.
Exam: forward TCP or UDP (User Datagram Protocol) by address and port at extreme scale → ✅ layer 4 (Network Load Balancer); ❌ layer 7 (Application Load Balancer): reads HTTP, needed only for path, host or header rules
A_ZH:
答：第 4 层，即传输层：只看地址和端口。
因为：Network Load Balancer 按每条连接的协议、IP 地址和端口算哈希来选目标，从不解析 HTTP（Hypertext Transfer Protocol，超文本传输协议）内容，所以每秒能处理数百万个请求。
考法：按地址和端口转发 TCP 或 UDP（User Datagram Protocol，用户数据报协议）流量，而且规模极大 → ✅ 第 4 层（Network Load Balancer）；❌ 第 7 层（Application Load Balancer）：要读 HTTP，只有按路径、主机或请求头路由时才需要
SOURCE: https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html
A Network Load Balancer functions at the fourth layer of the Open Systems Interconnection (OSI) model. It can handle millions of requests per second.

## awsb-f-on-premises | d1
TOPIC: Hybrid networking
Q:
Servers in the company's own data center (on premises) must reach Amazon EC2 (Elastic Compute Cloud) instances by their private IP (Internet Protocol) addresses in a VPC (virtual private cloud). What must you add first?
Q_ZH:
公司自己机房里（on premises，本地）的服务器，要用私有 IP（Internet Protocol，互联网协议）地址访问一个 VPC（virtual private cloud，虚拟私有云）里的 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例，先得加什么？
A:
Answer: AWS Site-to-Site VPN (virtual private network) or AWS Direct Connect: a private path.
Because: private IP addresses are not routed across the internet, so on-premises traffic to them needs a connection ending on an AWS gateway attached to the VPC: an encrypted internet tunnel or a dedicated line.
Exam: on premises must reach private addresses in a VPC → ✅ AWS Site-to-Site VPN or AWS Direct Connect; ❌ an internet gateway: public internet access only, private addresses are not routable there
A_ZH:
答：AWS Site-to-Site VPN（virtual private network，虚拟专用网络）或 AWS Direct Connect：一条私有通路。
因为：私有 IP 地址在互联网上不路由，所以本地机房要访问它们，必须有一条终结在 VPC 所挂 AWS 网关上的连接：要么是走互联网的加密隧道，要么是专线。
考法：本地机房要访问 VPC 里的私有地址 → ✅ AWS Site-to-Site VPN 或 AWS Direct Connect；❌ 互联网网关（internet gateway）：只提供公网访问，私有地址在互联网上路由不通
SOURCE: https://docs.aws.amazon.com/vpn/latest/s2svpn/VPC_VPN.html
By default, an instance that you launch within an Amazon VPC can't communicate with a local (AWS Cloud) network and a remote device — for example, this might be a site or an on-premises device. You can enable access to your remote devices from your VPC by creating an AWS Site-to-Site VPN (Site-to-Site VPN) connection, and configuring routing to pass traffic through the connection.

## awsb-f-scale-out-vs-up | d1
TOPIC: Reading the question
Q:
A web tier must handle more users without any restart downtime. Which way do you scale?
Q_ZH:
一个 Web 层要扛住更多用户，而且不能有任何重启停机，该怎么扩展？
A:
Answer: Scale out: add instances behind a load balancer.
Because: changing an Amazon EC2 (Elastic Compute Cloud) instance to a bigger type requires stopping it first, so scaling up means downtime, while new instances join behind the load balancer as the running ones keep serving.
Exam: more capacity with no downtime → ✅ scale out (horizontal) with an Auto Scaling group behind a load balancer; ❌ scale up to a larger instance type: needs a stop and start
A_ZH:
答：横向扩展（scale out）：在负载均衡器后面加实例。
因为：把 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例换成更大的类型必须先停机，所以纵向扩展（scale up）就意味着停机；新实例则可以在现有实例继续服务的同时加到负载均衡器后面。
考法：more capacity with no downtime → ✅ scale out（横向扩展），用负载均衡器后面的 Auto Scaling 组；❌ scale up 换更大的实例类型：要先停机再启动
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/change-instance-type-of-ebs-backed-instance.html
You must stop your instance before you can change its instance type. Ensure that you plan for downtime while your instance is stopped.

## awsb-f-smb-vs-nfs | d1
TOPIC: Block and file storage
Q:
Windows computers open a company file share as a mapped network drive. Which file-sharing protocol do they use?
Q_ZH:
Windows 电脑把公司的文件共享映射成网络驱动器来打开，它们用的是哪种文件共享协议？
A:
Answer: SMB (Server Message Block): the Windows file-sharing protocol.
Because: Windows clients speak SMB natively, so a Windows share needs a server that serves SMB, while Linux clients mount shares over NFS (Network File System); the protocol therefore picks the AWS file service.
Exam: Windows clients map a network drive → ✅ SMB, served by Amazon FSx for Windows File Server; ❌ NFS: the Linux protocol, served by Amazon EFS (Elastic File System)
A_ZH:
答：SMB（Server Message Block，Windows 文件共享协议）：Windows 的文件共享协议。
因为：Windows 客户端原生就用 SMB，所以 Windows 共享盘需要能提供 SMB 的服务器；Linux 客户端则通过 NFS（Network File System，网络文件系统）挂载，所以协议决定了用哪个 AWS 文件服务。
考法：Windows 客户端映射网络驱动器 → ✅ SMB，由 Amazon FSx for Windows File Server 提供；❌ NFS：Linux 用的协议，由 Amazon EFS（Elastic File System，弹性文件系统）提供
SOURCE: https://docs.aws.amazon.com/fsx/latest/WindowsGuide/what-is.html
Amazon FSx supports a broad set of enterprise Windows workloads with fully managed file storage built on Microsoft Windows Server. Amazon FSx has native support for Windows file system features and for the industry-standard Server Message Block (SMB) protocol to access file storage over a network.

## awsb-f-sync-vs-async | d1
TOPIC: Databases
Q:
A standby copy of a database must already hold every committed write, so a failover loses no data. Which kind of replication?
Q_ZH:
数据库的备用副本必须已经存有每一笔提交过的写入，故障切换时一点数据都不丢，用哪种复制？
A:
Answer: Synchronous replication: each write waits for the copy.
Because: with synchronous replication a write commits only after the standby also has it, so the standby never falls behind, while asynchronous replication copies after the commit, so the newest writes can be lost.
Exam: no data loss on failover → ✅ synchronous replication, as in a Multi-AZ (Multi-Availability Zone) standby; ❌ asynchronous replication: the copy lags; used for read replicas and other Regions
A_ZH:
答：同步复制（synchronous replication）：每笔写入都等副本写好。
因为：同步复制下，一笔写入要等备用副本也存好才算提交，所以备用副本从不落后；异步复制是提交之后再复制，所以最新的写入可能丢失。
考法：故障切换不丢数据 → ✅ 同步复制，比如 Multi-AZ（Multi-Availability Zone，多可用区）的备用实例；❌ 异步复制（asynchronous replication）：副本有延迟，用于只读副本和跨区域（Region）复制
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html
DB instances using Multi-AZ DB instance deployments can have increased write and commit latency compared to a Single-AZ deployment. This can happen because of the synchronous data replication that occurs.

## awsb-f-vpc-isolated | d1
TOPIC: VPC networking
Q:
Two VPCs (virtual private clouds) sit in the same account and Region, and nothing has been set up between them. Why can't their instances reach each other by private IP (Internet Protocol) address?
Q_ZH:
两个 VPC（virtual private cloud，虚拟私有云）在同一账户、同一区域（Region），彼此之间什么都没配置，为什么它们的实例不能用私有 IP（Internet Protocol，互联网协议）地址互相访问？
A:
Answer: Each VPC is isolated: no path until connected.
Because: a VPC is a logically isolated virtual network whose route tables, by default, know only its own address range, so packets for another VPC have no route until you add peering or a transit gateway.
Exam: two VPCs must talk over private IP addresses → ✅ a VPC peering connection or AWS Transit Gateway; ❌ the local route: covers only the VPC's own address range
A_ZH:
答：每个 VPC 彼此隔离：不连接就没有通路。
因为：VPC 是逻辑隔离的虚拟网络，默认情况下它的路由表只认识自己的地址范围，所以发往另一个 VPC 的数据包无路可走，直到你加上对等连接（peering）或中转网关（transit gateway）。
考法：两个 VPC 要用私有 IP 地址互通 → ✅ 建 VPC peering 连接或用 AWS Transit Gateway；❌ 本地路由（local route）：只覆盖本 VPC 自己的地址范围
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/how-it-works.html
A virtual private cloud (VPC) is a virtual network dedicated to your AWS account. It is logically isolated from other virtual networks in the AWS Cloud.

## awsb-rds-multi-az-vs-replica | d2
TOPIC: Databases
Q:
Nightly report queries slow down the primary Amazon RDS (Relational Database Service) database instance. Which feature takes those reports off the primary?
Q_ZH:
每晚的报表查询拖慢了主 Amazon RDS（Relational Database Service，关系型数据库服务）数据库实例，用哪个功能把这些报表从主库上移走？
A:
Answer: A read replica: a read-only copy.
Because: the name says it: RDS keeps this read-only copy updated asynchronously from the primary, so report queries can run on the replica and leave the primary free for the app.
Exam: offload reads or reports → ✅ read replica; ❌ Multi-AZ (Multi-Availability Zone) instance standby: failover only, serves no reads; ❌ larger instance class: more power, but reports still load the primary
A_ZH:
答：只读副本（read replica）：一份只读拷贝。
因为：名字就是答案：read replica 是 RDS 异步更新的只读拷贝，所以报表查询可以跑在它上面，主库留给应用。
考法：分流读请求或报表（offload reads）→ ✅ 只读副本；❌ Multi-AZ（Multi-Availability Zone，多可用区）实例的备用库：只做故障切换，不提供读；❌ 换更大的实例规格：算力更强，但报表仍压在主库上
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html
A read replica is a read-only copy of a DB instance. You can reduce the load on your primary DB instance by routing queries from your applications to the read replica.

## awsb-rds-multi-az-instance-standby | d1
TOPIC: Databases
Q:
A team adds a Multi-AZ (Multi-Availability Zone) standby to one Amazon RDS (Relational Database Service) database instance. Why doesn't the primary's read load drop?
Q_ZH:
一个团队给一台 Amazon RDS（Relational Database Service，关系型数据库服务）数据库实例加了 Multi-AZ（Multi-Availability Zone，多可用区）备用实例，为什么主库的读负载没有下降？
A:
Answer: The Multi-AZ instance standby is passive: it serves no reads.
Because: AWS rule: the standby only receives a synchronous copy of each write and accepts no connections until a failover, which typically takes 60 to 120 seconds.
Exam: high availability with automatic failover, no read scaling needed → ✅ Multi-AZ DB (database) instance deployment; ❌ read replica: asynchronous read-only copy, no automatic failover
A_ZH:
答：Multi-AZ 实例的备用库是被动的：不提供读。
因为：AWS 规定，记住即可：备用库只接收每笔写入的同步拷贝，在故障切换之前不接受任何连接；切换通常需要 60 到 120 秒。
考法：要自动故障切换的高可用、不需要扩展读 → ✅ Multi-AZ DB（database，数据库）instance 部署；❌ 只读副本（read replica）：异步的只读拷贝，不会自动故障切换
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html
The high availability option isn't a scaling solution for read-only scenarios. You can't use a standby replica to serve read traffic.

## awsb-bf-efs | d1
TOPIC: Block and file storage
Q:
Linux Amazon EC2 (Elastic Compute Cloud) instances in three Availability Zones must read and write the same files at the same time. Which storage service?
Q_ZH:
分布在三个可用区（Availability Zone）的 Linux Amazon EC2（Elastic Compute Cloud，弹性计算云）实例要同时读写同一批文件，用哪个存储服务？
A:
Answer: Amazon EFS (Elastic File System): one shared NFS (Network File System) file system.
Because: a Regional EFS file system stores data across several Availability Zones and gives each zone its own mount target, so instances in every zone mount it locally and the data stays available if one zone fails.
Exam: Linux instances in several Availability Zones share files → ✅ Amazon EFS, one mount target per zone; ❌ Amazon FSx for Windows File Server: SMB (Server Message Block) for Windows; ❌ Amazon FSx for Lustre: built for HPC (high performance computing) jobs
A_ZH:
答：Amazon EFS（Elastic File System，弹性文件系统）：一个共享的 NFS（Network File System，网络文件系统）文件系统。
因为：区域级（Regional）EFS 文件系统把数据存放在多个可用区，并在每个可用区提供一个挂载目标（mount target），所以每个可用区的实例都就近挂载，一个可用区故障时数据照样可用。
考法：多个可用区的 Linux 实例共享文件 → ✅ Amazon EFS，每个可用区一个挂载目标；❌ Amazon FSx for Windows File Server：给 Windows 用的 SMB（Server Message Block，Windows 文件共享协议）；❌ Amazon FSx for Lustre：为 HPC（high performance computing，高性能计算）任务而建
SOURCE: https://docs.aws.amazon.com/efs/latest/ug/how-it-works.html
You can access your EFS file system concurrently from multiple NFS clients, so applications that scale beyond a single connection can access a file system. Amazon EC2 and other AWS compute instances running in multiple Availability Zones within the same AWS Region can access the file system, so that many users can access and share a common data source.

## awsb-s3-lifecycle | d2
TOPIC: S3 storage
Q:
In a versioned bucket, old object versions keep piling up and the storage bill grows every month. Which Amazon S3 (Simple Storage Service) feature deletes them automatically after a set number of days?
Q_ZH:
一个开了版本控制的存储桶里，旧的对象版本越积越多，存储账单每月都在涨，用哪个 Amazon S3（Simple Storage Service，简单存储服务）功能在设定天数后自动删掉它们？
A:
Answer: An S3 Lifecycle rule: it acts on object age.
Because: S3 runs the rule's actions when an object or version reaches a set age, so a noncurrent-version expiration permanently deletes each old version N days after it becomes noncurrent, and transitions can move it to cheaper classes first.
Exam: delete old versions or move objects after a set number of days → ✅ S3 Lifecycle rules; ❌ S3 Intelligent-Tiering: tiers by access, never deletes; ❌ S3 Glacier Flexible Retrieval: cheaper storage, still keeps every version
A_ZH:
答：S3 Lifecycle（生命周期）规则：按对象年龄自动处理。
因为：对象或版本到了设定天数，S3 就执行规则里的动作：noncurrent-version expiration（非当前版本过期）会在旧版本变成非当前版本 N 天后把它永久删除，transition（转换）还能先把它挪到更便宜的存储类。
考法：在设定天数后删除旧版本或迁移对象（delete old versions or move objects after a set number of days）→ ✅ S3 Lifecycle rules；❌ S3 Intelligent-Tiering：按访问情况换层，从不删除；❌ S3 Glacier Flexible Retrieval：存储更便宜，但每个版本照样留着
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-configuration-examples.html
The NoncurrentVersionExpiration action doesn't apply to the current object versions. It removes only the noncurrent versions.

## awsb-dt-guardduty-vs-inspector | d2
TOPIC: Encryption and threat detection
Q:
A team must find known software vulnerabilities on its Amazon EC2 (Elastic Compute Cloud) instances, container images and Lambda functions. Which AWS service scans for them?
Q_ZH:
一个团队要找出自己的 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例、容器镜像和 Lambda 函数上已知的软件漏洞，用哪个 AWS 服务来扫描？
A:
Answer: Amazon Inspector: scans software for known CVEs (Common Vulnerabilities and Exposures).
Because: it checks the packages installed on each instance, image and function against published CVE records and rescans when a package or a new CVE appears, so it finds weak software; it only reports findings and blocks nothing.
Exam: scan EC2, container images or Lambda for CVEs → ✅ Amazon Inspector; ❌ Amazon GuardDuty: spots attacks in activity logs, not unpatched software; ❌ Amazon Macie: finds sensitive data in Amazon S3 (Simple Storage Service)
A_ZH:
答：Amazon Inspector：扫描软件里的已知 CVE（Common Vulnerabilities and Exposures，公开漏洞编号）。
因为：它把每台实例、每个镜像和函数里装的软件包与已公布的 CVE 记录逐一比对，装了新包或发布了新 CVE 就自动重扫，所以能找出有漏洞的软件；它只报告发现（finding），不拦截任何东西。
考法：扫描 EC2、容器镜像或 Lambda 的 CVE（scan for vulnerabilities）→ ✅ Amazon Inspector；❌ Amazon GuardDuty：从活动日志里发现攻击，不查没打补丁的软件；❌ Amazon Macie：在 Amazon S3（Simple Storage Service，简单存储服务）里找敏感数据
SOURCE: https://docs.aws.amazon.com/inspector/latest/user/what-is-inspector.html
Amazon Inspector is a vulnerability management service that automatically discovers workloads and continually scans them for software vulnerabilities and unintended network exposure. Amazon Inspector discovers and scans Amazon EC2 instances, container images in Amazon ECR, and Lambda functions.

## awsb-dt-guardduty-threat-detection | d2
TOPIC: Encryption and threat detection
Q:
An AWS account must be watched for signs of attack, such as stolen credentials or instances talking to known malicious IP (Internet Protocol) addresses. Which AWS service?
Q_ZH:
要持续监视一个 AWS 账户里的攻击迹象，比如凭证被盗，或者实例在和已知的恶意 IP（Internet Protocol，互联网协议）地址通信，用哪个 AWS 服务？
A:
Answer: Amazon GuardDuty: threat detection from your logs.
Because: it reads CloudTrail management events, VPC (virtual private cloud) Flow Logs and DNS (Domain Name System) logs and checks them against threat intelligence and machine learning, so it raises findings; it never blocks traffic itself.
Exam: detect malicious activity or compromised credentials from logs → ✅ Amazon GuardDuty; ❌ Amazon Inspector: scans software for CVEs (Common Vulnerabilities and Exposures), not activity; ❌ Amazon Macie: finds sensitive data in Amazon S3 (Simple Storage Service)
A_ZH:
答：Amazon GuardDuty：从你的日志里检测威胁。
因为：它读取 CloudTrail 管理事件、VPC（virtual private cloud，虚拟私有云）Flow Logs（流日志）和 DNS（Domain Name System，域名系统）日志，再用威胁情报和机器学习比对，所以能发出发现（finding）；它自己从不拦截流量。
考法：从日志中检测恶意活动或凭证泄露（malicious activity, compromised credentials）→ ✅ Amazon GuardDuty；❌ Amazon Inspector：扫描软件的 CVE（Common Vulnerabilities and Exposures，公开漏洞编号），不看活动；❌ Amazon Macie：在 Amazon S3（Simple Storage Service，简单存储服务）里找敏感数据
SOURCE: https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html
Amazon GuardDuty is a threat detection service that continuously monitors, analyzes, and processes AWS data sources and logs in your AWS environment. GuardDuty uses threat intelligence feeds, such as lists of malicious IP addresses and domains, file hashes, and machine learning (ML) models to identify suspicious and potentially malicious activity in your AWS environment.

## awsb-tr-s3-file-gateway | d2
TOPIC: Migration and transfer
Q:
On-premises apps must keep saving files to an NFS (Network File System) share, but each file must end up as an object in an Amazon S3 (Simple Storage Service) bucket. Which AWS service?
Q_ZH:
机房里的应用要继续往 NFS（Network File System，网络文件系统）共享盘里存文件，但每个文件最终都要成为 Amazon S3（Simple Storage Service，简单存储服务）存储桶里的一个对象，用哪个 AWS 服务？
A:
Answer: Amazon S3 File Gateway: a file share backed by S3.
Because: a gateway VM (virtual machine) in your data center serves NFS or SMB (Server Message Block) shares with a local cache for fast reads, and stores every file you write as an object in your bucket.
Exam: on-premises NFS or SMB share, files stored as S3 objects → ✅ Amazon S3 File Gateway; ❌ Amazon FSx File Gateway: FSx for Windows cache, closed to new customers; ❌ AWS DataSync: copy jobs, not a live share
A_ZH:
答：Amazon S3 File Gateway：背后是 S3 的文件共享盘。
因为：你在机房里跑一台网关 VM（virtual machine，虚拟机），它对外提供 NFS 或 SMB（Server Message Block，Windows 文件共享协议）共享，并用本地缓存加快读取，你写入的每个文件都作为对象存进你的存储桶。
考法：本地 NFS 或 SMB 共享、文件存成 S3 对象（on-premises NFS or SMB share, files stored as S3 objects）→ ✅ Amazon S3 File Gateway；❌ Amazon FSx File Gateway：缓存 FSx for Windows 共享，且已不对新客户开放；❌ AWS DataSync：跑复制任务，不是在线共享盘
SOURCE: https://docs.aws.amazon.com/filegateway/latest/files3/what-is-file-s3.html
By using this combination, you can store and retrieve objects in Amazon S3 using industry-standard file protocols such as Network File System (NFS) and Server Message Block (SMB).

## awsb-vpc-gateway-endpoint | d2
TOPIC: VPC networking
Q:
Instances in private subnets copy terabytes from Amazon S3 (Simple Storage Service) every day and must avoid any per-GB data processing charge. Which VPC (virtual private cloud) feature?
Q_ZH:
私有子网里的实例每天要从 Amazon S3（Simple Storage Service，简单存储服务）复制数 TB 数据，而且不能产生任何按 GB 计费的数据处理费，用哪个 VPC（virtual private cloud，虚拟私有云）功能？
A:
Answer: A gateway VPC endpoint for S3: free and private.
Because: a gateway endpoint is a route-table entry for S3's address ranges, so requests reach S3 over the AWS network with no NAT (network address translation) device, and gateway endpoints cost nothing extra.
Exam: private subnets reach S3 or DynamoDB at the lowest cost → ✅ gateway VPC endpoint; ❌ NAT gateway: also works, but billed per hour and per GB
A_ZH:
答：S3 的网关型 VPC 终端节点（gateway VPC endpoint）：免费又私有。
因为：网关型终端节点是路由表里指向 S3 地址段的一条记录，请求经 AWS 网络直达 S3，不需要 NAT（network address translation，网络地址转换）设备，而且网关型终端节点不额外收费。
考法：私有子网以最低成本访问 S3 或 DynamoDB → ✅ gateway VPC endpoint；❌ NAT gateway：也能通，但按小时和按 GB 收费
SOURCE: https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html
Gateway VPC endpoints provide reliable connectivity to Amazon S3 and DynamoDB without requiring an internet gateway or a NAT device for your VPC. Gateway endpoints do not use AWS PrivateLink, unlike other types of VPC endpoints.

## awsb-ct-fargate | d2
TOPIC: Serverless and containers
Q:
An Amazon ECS (Elastic Container Service) team wants its long-running containers billed only for the CPU (central processing unit) and memory each task requests, never for whole servers. Which compute option?
Q_ZH:
一个 Amazon ECS（Elastic Container Service，容器服务）团队希望长时间运行的容器只按每个任务申请的 CPU（central processing unit，中央处理器）和内存计费，绝不为整台服务器付钱，用哪种计算方式？
A:
Answer: AWS Fargate: serverless compute for containers.
Because: Fargate runs each task in its own isolated environment and bills only that task's requested CPU and memory, per second, so there is no server to pay for or patch, and a task can run for hours.
Exam: serverless containers, pay per task → ✅ AWS Fargate; ❌ a Lambda function: each invocation stops at 15 minutes; ❌ ECS Managed Instances: AWS patches them, but you pay for whole EC2 (Elastic Compute Cloud) instances
A_ZH:
答：AWS Fargate：容器的无服务器计算。
因为：Fargate 把每个任务放进各自隔离的环境里运行，只按这个任务申请的 CPU 和内存按秒计费，所以没有要你付钱或打补丁的服务器，任务也能一连跑好几个小时。
考法：无服务器容器、按任务付费 → ✅ AWS Fargate；❌ Lambda 函数：每次调用最多 15 分钟；❌ ECS Managed Instances：AWS 负责打补丁，但你要为整台 EC2（Elastic Compute Cloud，弹性计算云）实例付费
SOURCE: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html
AWS Fargate is a technology that you can use with Amazon ECS to run containers without having to manage servers or clusters of Amazon EC2 instances. With AWS Fargate, you no longer have to provision, configure, or scale clusters of virtual machines to run containers.

## awsb-ct-eks-compute-options | d2
TOPIC: Serverless and containers
Q:
An Amazon EKS (Elastic Kubernetes Service) team wants to pay only for the CPU (central processing unit) and memory each pod requests, never for whole worker nodes. Which compute option runs the pods?
Q_ZH:
一个使用 Amazon EKS（Elastic Kubernetes Service，托管 Kubernetes 服务）的团队只想为每个 Pod 申请的 CPU（central processing unit，中央处理器）和内存付费，绝不为整台工作节点付钱，用哪种计算方式来跑 Pod？
A:
Answer: AWS Fargate: each pod gets its own compute.
Because: Fargate gives each pod its own right-sized compute boundary and bills only that pod's CPU and memory, so you never pay for a node, while managed node groups and EKS Auto Mode bill whole EC2 (Elastic Compute Cloud) instances.
Exam: EKS pods, no worker nodes to manage or pay for → ✅ AWS Fargate; ❌ EKS Auto Mode: AWS manages the nodes, you still pay for them; ❌ managed node groups: EC2 instances you pay for and update
A_ZH:
答：AWS Fargate：每个 Pod 有自己的一份计算资源。
因为：Fargate 给每个 Pod 一份大小合适、独立隔离的计算资源，只按这个 Pod 的 CPU 和内存计费，所以你从不为节点付钱；而托管节点组（managed node groups）和 EKS Auto Mode 都按整台 EC2（Elastic Compute Cloud，弹性计算云）实例计费。
考法：EKS 的 Pod 不想管理工作节点、也不想为节点付费 → ✅ AWS Fargate；❌ EKS Auto Mode：节点由 AWS 管理，但节点的钱还是你付；❌ 托管节点组：EC2 实例要你付费并负责更新
SOURCE: https://docs.aws.amazon.com/eks/latest/userguide/fargate.html
Each Pod that runs on Fargate has its own compute boundary.

## awsb-tr-datasync | d2
TOPIC: Migration and transfer
Q:
Each night, new and changed files on an on-premises NFS (Network File System) server must be copied over the network to Amazon EFS (Elastic File System) and checked for integrity. Which service?
Q_ZH:
每天晚上，机房 NFS（Network File System，网络文件系统）服务器上新增和改动的文件都要通过网络复制到 Amazon EFS（Elastic File System，弹性文件系统），并校验完整性，用哪个服务？
A:
Answer: AWS DataSync: scheduled, verified online copies.
Because: a DataSync agent installed next to the NFS server reads the files and copies them over the network to EFS on a schedule you set, so the nightly job runs by itself, encrypted in transit and validated for integrity.
Exam: online, scheduled, verified copies from NFS or SMB (Server Message Block) shares → ✅ AWS DataSync; ❌ AWS Snowball Edge: shipped device for one-time moves, closed to new customers; ❌ Amazon S3 (Simple Storage Service) File Gateway: a live share into S3, not copy jobs
A_ZH:
答：AWS DataSync：按计划、带校验的在线复制。
因为：在 NFS 服务器旁边装一个 DataSync agent（代理），它读取文件，按你设定的计划通过网络复制到 EFS，所以每晚的任务自己就跑完，传输中加密，还会校验完整性。
考法：在线、按计划、带校验地从 NFS 或 SMB（Server Message Block，Windows 文件共享协议）共享复制（online, scheduled, verified copies）→ ✅ AWS DataSync；❌ AWS Snowball Edge：寄送设备做一次性搬运，已不对新客户开放；❌ Amazon S3（Simple Storage Service，简单存储服务）File Gateway：存进 S3 的在线共享盘，不是复制任务
SOURCE: https://docs.aws.amazon.com/datasync/latest/userguide/what-is-datasync.html
Migrate data – Transfer active datasets rapidly over the network into AWS storage services. DataSync includes automatic encryption and data integrity validation to help make sure that your data arrives securely, intact, and ready to use.

## awsb-vpc-nat-gateway | d2
TOPIC: VPC networking
Q:
Instances in a private subnet must download patches from the internet, but nothing on the internet may open a connection to them. Which managed AWS feature?
Q_ZH:
私有子网里的实例要从互联网下载补丁，但互联网上的任何东西都不能主动连进来，用哪个由 AWS 托管的功能？
A:
Answer: A NAT (network address translation) gateway: outbound only.
Because: the private subnet's route sends internet traffic to the NAT gateway, which swaps each instance's private address for its own and lets only replies back, so instances can start connections out but nobody can start one in.
Exam: private instances need outbound-only internet, nothing to manage → ✅ NAT gateway (a zonal one sits in a public subnet); ❌ NAT instance: a self-managed EC2 (Elastic Compute Cloud) instance you patch; ❌ a public subnet: lets the internet reach them
A_ZH:
答：NAT（network address translation，网络地址转换）gateway：只出不进。
因为：私有子网的路由把去往互联网的流量交给 NAT 网关，它把每个实例的私有地址换成自己的地址，只放回应答流量，所以实例能主动往外连，外面却没人能主动连进来。
考法：私有实例只需出站上网、不想自己运维 → ✅ NAT gateway（可用区级的要放在公有子网里）；❌ NAT instance：自己管理的 EC2（Elastic Compute Cloud，弹性计算云）实例，要自己打补丁；❌ 放进公有子网：互联网就能连到它们
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html
A NAT gateway is a Network Address Translation (NAT) service. You can use a NAT gateway so that instances in a private subnet can connect to services outside your VPC but external services can't initiate a connection with those instances.

## awsb-asg-multi-az-alb | d2
TOPIC: Compute and scaling
Q:
Failed Amazon EC2 (Elastic Compute Cloud) web instances must be replaced automatically, and requests must reach only healthy instances, even if a whole Availability Zone goes down. Which two services together?
Q_ZH:
坏掉的 Amazon EC2（Elastic Compute Cloud，弹性计算云）Web 实例必须被自动替换，请求也只能发到健康的实例上，即使整个可用区（Availability Zone）挂掉也一样，哪两个服务一起用？
A:
Answer: Auto Scaling group across zones plus an Application Load Balancer: self-healing.
Because: the load balancer health-checks instances and sends requests only to healthy ones, while the Auto Scaling group replaces failed instances in a working zone, so requests to the load balancer's DNS (Domain Name System) name avoid failed instances.
Exam: highly available web tier across Availability Zones → ✅ Auto Scaling group in two or more zones plus an Application Load Balancer; ❌ database on those instances: no managed failover, use Amazon RDS (Relational Database Service)
A_ZH:
答：跨多个可用区的 Auto Scaling group，前面放 Application Load Balancer：能自愈。
因为：负载均衡器对每台实例做健康检查，只把请求发给健康的实例；Auto Scaling group 会在正常的可用区里替换坏掉的实例，所以发到负载均衡器 DNS（Domain Name System，域名系统）名字上的请求会绕开坏掉的实例。
考法：跨可用区的高可用 Web 层（highly available web tier）→ ✅ 跨两个以上可用区的 Auto Scaling group 加 Application Load Balancer；❌ 把数据库装在这些实例上：没有托管的故障切换，应改用 Amazon RDS（Relational Database Service，关系型数据库服务）
SOURCE: https://docs.aws.amazon.com/autoscaling/ec2/userguide/disaster-recovery-resiliency.html
Make sure that the Elastic Load Balancing health checks are configured correctly, and also that they are enabled on the Auto Scaling group. Then, if an instance fails its health check, Elastic Load Balancing stops sending traffic to it and reroutes traffic to healthy instances, while Amazon EC2 Auto Scaling replaces the unhealthy instance.

## awsb-s3-static-site | d1
TOPIC: S3 storage
Q:
A website made only of static files must load fast for visitors worldwide, with no servers to run. Which AWS design?
Q_ZH:
一个只由静态文件组成的网站要让全球访客都打开得快，而且不运行任何服务器，用哪种 AWS 架构？
A:
Answer: An Amazon S3 (Simple Storage Service) bucket origin behind Amazon CloudFront: cached at edges.
Because: the files live in the bucket, and CloudFront keeps copies at edge locations near visitors, so most requests are answered nearby and never reach the bucket, with no web servers to patch or scale.
Exam: static content, global users, no servers → ✅ S3 origin with Amazon CloudFront; ❌ AWS Global Accelerator: cannot use an S3 bucket as an endpoint; ❌ Amazon EC2 (Elastic Compute Cloud) behind a load balancer: servers to run
A_ZH:
答：以 Amazon S3（Simple Storage Service，简单存储服务）存储桶为源站，前面放 Amazon CloudFront：内容缓存在边缘站点。
因为：文件放在存储桶里，CloudFront 在离访客近的边缘站点（edge location）保存副本，所以大多数请求就近就被响应，根本到不了存储桶，也没有 Web 服务器要打补丁或扩容。
考法：静态内容、全球用户、不要服务器（static content, global users, no servers）→ ✅ S3 源站 + Amazon CloudFront；❌ AWS Global Accelerator：不能把 S3 存储桶当作终端节点（endpoint）；❌ 负载均衡器后面的 Amazon EC2（Elastic Compute Cloud，弹性计算云）：服务器要你自己运行
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/website-hosting-cloudfront-walkthrough.html
CloudFront makes your website files (such as HTML, images, and video) available from data centers around the world (known as edge locations). When a visitor requests a file from your website, CloudFront automatically redirects the request to a copy of the file at the nearest edge location.

## awsb-s3-static-website-hosting | d2
TOPIC: S3 storage
Q:
A small site has only static pages and no server-side code. Which Amazon S3 (Simple Storage Service) feature serves it straight from a bucket?
Q_ZH:
一个小网站只有静态页面，没有服务器端代码，用哪个 Amazon S3（Simple Storage Service，简单存储服务）功能直接从存储桶对外提供网页？
A:
Answer: S3 static website hosting: the bucket serves the pages.
Because: you enable website hosting and set an index document, so S3 answers browser requests at the bucket's website endpoint; it serves HTTP (Hypertext Transfer Protocol) only, so add CloudFront or AWS Amplify Hosting for HTTPS (Hypertext Transfer Protocol Secure).
Exam: static site, no server-side code, lowest cost → ✅ S3 static website hosting; ❌ Amazon EC2 (Elastic Compute Cloud) web server: servers to run, patch and pay for
A_ZH:
答：S3 静态网站托管（static website hosting）：存储桶直接出网页。
因为：你在存储桶上开启网站托管并设好首页文档（index document），S3 就在存储桶的网站终端节点上直接响应浏览器请求；它只支持 HTTP（Hypertext Transfer Protocol，超文本传输协议），要 HTTPS（Hypertext Transfer Protocol Secure，安全超文本传输协议）就在前面加 CloudFront 或 AWS Amplify Hosting。
考法：静态网站、没有服务器端代码、成本最低（static site, no server-side code, lowest cost）→ ✅ S3 static website hosting；❌ 用 Amazon EC2（Elastic Compute Cloud，弹性计算云）跑 Web 服务器：要自己运行、打补丁、付费
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteHosting.html
You can use Amazon S3 to host a static website. On a static website, individual webpages include static content.

## awsb-tr-snowball | d2
TOPIC: Migration and transfer
Q:
A one-time move of 500 TB must reach AWS within a month, but the site's internet link would need more than a year. Which kind of transfer fits?
Q_ZH:
一次性要把 500 TB 数据在一个月内搬到 AWS，但现场的网络要传一年以上，适合哪种传输方式？
A:
Answer: AWS Snowball Edge devices: ship the data instead.
Because: the data is copied onto devices that a carrier ships to AWS, so the slow link no longer limits the move; Snowball Edge is closed to new customers, who bring their own drives to an AWS Data Transfer Terminal instead.
Exam: tens of TB to PB, slow link, one-time move → ✅ AWS Snowball Edge (offline transfer); ❌ AWS Snowmobile: truck for 10 PB or more, retired 2024; ❌ AWS DataSync: online, still bound by the slow link
A_ZH:
答：AWS Snowball Edge 设备：改成把数据寄过去。
因为：数据在现场拷进设备，再由承运商把设备运到 AWS，所以慢网络不再卡住这次搬迁；Snowball Edge 现已不对新客户开放，新客户改为把自己的硬盘带到 AWS Data Transfer Terminal 上传。
考法：几十 TB 到 PB 级、网络慢、一次性搬迁（tens of TB to PB, slow link, one-time move）→ ✅ AWS Snowball Edge（离线传输）；❌ AWS Snowmobile：用卡车运 10 PB 以上的数据，2024 年已退役；❌ AWS DataSync：走在线网络，照样被慢链路卡住
SOURCE: https://docs.aws.amazon.com/snowball/latest/developer-guide/whatisedge.html
Each Snowball Edge device can transport data at speeds faster than the internet. This transport is done by shipping the data in the devices through a regional carrier.

## awsb-tr-bandwidth-math | d1
TOPIC: Migration and transfer
Q:
You must move 150 TB to AWS within 30 days, and the spare internet bandwidth is 100 Mbps (megabits per second). Why can't an online copy meet the deadline?
Q_ZH:
你要在 30 天内把 150 TB 数据搬到 AWS，可用的空闲带宽是 100 Mbps（megabits per second，每秒兆比特），为什么在线复制赶不上期限？
A:
Answer: 100 Mbps moves only about 1 TB a day.
Because: transfer time is size in bits divided by link speed: 150 TB is 1,200 trillion bits, and 100 million bits per second for 86,400 seconds moves about 1 TB a day, so the copy needs about 139 days.
Exam: data size divided by bandwidth misses the deadline → ✅ move the data physically (AWS Snowball Edge in exam items; new customers now bring drives to an AWS Data Transfer Terminal); ❌ AWS DataSync: online, limited by the same link
A_ZH:
答：100 Mbps 每天只能传大约 1 TB。
因为：传输时间等于数据的比特数除以链路速度：150 TB 是 1,200 万亿比特，100 Mbps 每秒传 1 亿比特，一天 86,400 秒约传 1 TB，所以要大约 139 天。
考法：数据量除以带宽超过了期限（size divided by bandwidth misses the deadline）→ ✅ 把数据物理搬过去（考题里是 AWS Snowball Edge；新客户现在把自己的硬盘带到 AWS Data Transfer Terminal 上传）；❌ AWS DataSync：走在线网络，被同一条链路卡住
SOURCE: https://docs.aws.amazon.com/datasync/latest/userguide/datasync-large-migration-timelines.html
Calculate how many days a transfer takes by using the following formula, which provides a theoretical minimum transfer time: (DATA_SIZE * 8 bits per byte)/(CIRCUIT * NETWORK_UTILIZATION percentage * 3600 seconds per hour * AVAILABLE_HOURS) = Number of days

## awsb-alb-vs-nlb | d2
TOPIC: Compute and scaling
Q:
On one website, requests for /api and /images must go to different server groups based on the URL (uniform resource locator) path. Which load balancer?
Q_ZH:
同一个网站上，/api 和 /images 的请求要按 URL（uniform resource locator，网址）路径分到不同的服务器组，用哪种负载均衡器？
A:
Answer: Application Load Balancer: routes on request content.
Because: it works at layer 7 (the application layer), so it reads each HTTP (Hypertext Transfer Protocol) request and listener rules can match path, host or headers, while a Network Load Balancer, at layer 4 (the transport layer), sees only addresses and ports.
Exam: route by URL path, host name or header → ✅ Application Load Balancer; ❌ Network Load Balancer: for plain connections, fixed addresses and huge traffic, cannot read paths; ❌ AWS Global Accelerator: two fixed global entry addresses, no path rules
A_ZH:
答：Application Load Balancer：按请求内容路由。
因为：它工作在第 7 层（应用层），会读懂每个 HTTP（Hypertext Transfer Protocol，超文本传输协议）请求，监听器规则能匹配路径、主机名或请求头；Network Load Balancer 工作在第 4 层（传输层），只看得到地址和端口。
考法：按 URL 路径、主机名或请求头路由（path-based or host-based routing）→ ✅ Application Load Balancer；❌ Network Load Balancer：用于普通连接、固定地址和超大流量，读不懂路径；❌ AWS Global Accelerator：提供两个固定的全球入口地址，没有路径规则
SOURCE: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html
Support for Path conditions. You can configure rules for your listener that forward requests based on the URL in the request.

## awsb-in-sns-sqs-fanout | d2
TOPIC: Messaging and streaming
Q:
Each new order must be pushed at once to several separate services, such as billing and shipping. Which AWS service delivers it?
Q_ZH:
每个新订单都要立刻推送给几个独立的服务，比如计费和发货，用哪个 AWS 服务来投递？
A:
Answer: Amazon SNS (Simple Notification Service): one publish, many pushes.
Because: a publisher sends one message to an SNS topic, and SNS copies it and pushes it to every subscriber at once, while an SQS (Simple Queue Service) queue keeps each message until one consumer takes and deletes it.
Exam: push one message to many subscribers right now → ✅ Amazon SNS topic; ❌ a single Amazon SQS queue: each message goes to one consumer, then is deleted
A_ZH:
答：Amazon SNS（Simple Notification Service，简单通知服务）：发布一次，推给多方。
因为：发布者把一条消息发到 SNS 主题（topic），SNS 复制后立刻推送给每个订阅者；而 SQS（Simple Queue Service，简单队列服务）队列会把每条消息存着，直到某一个消费者取走并删除它。
考法：一条消息马上推给多个订阅者（push to many subscribers）→ ✅ Amazon SNS 主题；❌ 单个 Amazon SQS 队列：每条消息只给一个消费者，处理完就删除
SOURCE: https://docs.aws.amazon.com/sns/latest/dg/welcome.html
The Fanout scenario is when a message published to an SNS topic is replicated and pushed to multiple endpoints, such as Firehose delivery streams, Amazon SQS queues, HTTP(S) endpoints, and Lambda functions.

## awsb-in-sns-sqs-fanout-b | d2
TOPIC: Messaging and streaming
Q:
Every order event must reach three independent services, and a service that was offline must still get every event it missed. Which design?
Q_ZH:
每个订单事件都要送到三个互相独立的服务，而且某个服务离线期间错过的事件，回来后也必须一个不落地收到，用哪种设计？
A:
Answer: SNS (Simple Notification Service) to SQS (Simple Queue Service) fanout: one queue per service.
Because: SNS copies each published message into every subscribed queue, and each queue keeps its copy until that service polls and deletes it, so a service that was down reads its missed events when it returns.
Exam: fan out each event durably to several independent consumers → ✅ Amazon SNS topic with one Amazon SQS queue per consumer; ❌ one shared Amazon SQS queue: each message reaches only one consumer
A_ZH:
答：SNS（Simple Notification Service，简单通知服务）到 SQS（Simple Queue Service，简单队列服务）的扇出（fanout）：每个服务一个队列。
因为：SNS 把每条发布的消息复制进每个订阅的队列，每个队列都留着自己那一份，直到对应的服务拉取并删除；所以宕机的服务恢复后，能读到错过的事件。
考法：把每个事件可靠地扇出给多个独立消费者 → ✅ Amazon SNS 主题 + 每个消费者一个 Amazon SQS 队列；❌ 多个服务共用一个 Amazon SQS 队列：每条消息只会被其中一个消费者拿到
SOURCE: https://docs.aws.amazon.com/sns/latest/dg/sns-sqs-as-subscriber.html
When you use Amazon SNS and Amazon SQS together, messages reach applications that need instant notification of an event. The messages also persist in an Amazon SQS queue for other applications to process later.

## awsb-bf-ebs-one-az | d1
TOPIC: Block and file storage
Q:
An Amazon EC2 (Elastic Compute Cloud) instance in one Availability Zone must attach an Amazon EBS (Elastic Block Store) volume created in another zone. Why can't it?
Q_ZH:
一个可用区里的 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例要挂载在另一个可用区创建的 Amazon EBS（Elastic Block Store，弹性块存储）卷，为什么挂不上？
A:
Answer: An EBS volume attaches only inside its own zone.
Because: AWS rule: an EBS volume and the instance it attaches to must be in the same Availability Zone, and even Multi-Attach shares one io1 or io2 volume only among instances in that zone.
Exam: storage that instances in several Availability Zones share → ✅ Amazon EFS (Elastic File System); ❌ EBS Multi-Attach: one io1 or io2 volume, same zone only
A_ZH:
答：EBS 卷只能挂在它所在的可用区里。
因为：AWS 规定，记住即可：EBS 卷和它挂载的实例必须在同一个可用区；就连 Multi-Attach（多重挂载）也只能把一个 io1 或 io2 卷共享给同一可用区里的实例。
考法：多个可用区的实例共用存储 → ✅ Amazon EFS（Elastic File System，弹性文件系统）；❌ EBS Multi-Attach：一个 io1 或 io2 卷，只限同一可用区
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes.html
You can attach multiple EBS volumes to a single instance. The volume and instance must be in the same Availability Zone.

## awsb-an-athena | d1
TOPIC: Analytics and ML
Q:
Analysts want to run occasional SQL (Structured Query Language) queries directly on log files in Amazon S3 (Simple Storage Service), with no servers to run. Which service?
Q_ZH:
分析师想偶尔直接对 Amazon S3（Simple Storage Service，简单存储服务）里的日志文件跑 SQL（Structured Query Language，结构化查询语言）查询，而且不想运行任何服务器，用哪个服务？
A:
Answer: Amazon Athena: serverless SQL on files in S3.
Because: Athena reads the files where they sit in S3, using a table schema from the AWS Glue Data Catalog, so nothing is loaded or provisioned and each query is billed by the data it scans.
Exam: ad hoc SQL on S3 data, serverless, pay per query → ✅ Amazon Athena; ❌ Amazon EMR (Elastic MapReduce): clusters you run for Spark or Hadoop; ❌ Amazon OpenSearch Service: a search engine billed for running capacity, not per query
A_ZH:
答：Amazon Athena：直接对 S3 里的文件跑无服务器 SQL。
因为：Athena 就地读取 S3 里的文件，用 AWS Glue Data Catalog 里的表结构来解析，所以不用导入数据、不用开服务器，每次查询按扫描的数据量计费。
考法：对 S3 数据做临时 SQL 查询、无服务器、按查询付费 → ✅ Amazon Athena；❌ Amazon EMR（Elastic MapReduce，托管大数据集群）：要自己运行 Spark 或 Hadoop 集群；❌ Amazon OpenSearch Service：搜索引擎，按运行的容量计费，不是按查询计费
SOURCE: https://docs.aws.amazon.com/athena/latest/ug/what-is.html
Athena SQL and Apache Spark on Amazon Athena are serverless, so there is no infrastructure to set up or manage, and you pay only for the queries you run.

## awsb-an-glue-crawler-data-catalog | d2
TOPIC: Analytics and ML
Q:
New CSV (comma-separated values) files keep landing in Amazon S3 (Simple Storage Service), and Athena needs table definitions for them without anyone writing a schema by hand. Which feature?
Q_ZH:
新的 CSV（comma-separated values，逗号分隔值）文件不断落进 Amazon S3（Simple Storage Service，简单存储服务），Athena 需要它们的表定义，又不想有人手写表结构，用哪个功能？
A:
Answer: An AWS Glue crawler: it infers schemas automatically.
Because: the crawler reads the data, uses classifiers to recognize its format and schema, and writes table definitions into the AWS Glue Data Catalog, where Athena, Amazon EMR (Elastic MapReduce) and Redshift Spectrum read them.
Exam: discover schemas and build tables automatically → ✅ an AWS Glue crawler filling the Data Catalog; ❌ Amazon EMR: processes data on clusters, does not discover schemas for you
A_ZH:
答：AWS Glue 爬网程序（crawler）：自动推断表结构。
因为：爬网程序读取数据，用分类器（classifier）识别格式和结构，再把表定义写进 AWS Glue Data Catalog，Athena、Amazon EMR（Elastic MapReduce，托管大数据集群）和 Redshift Spectrum 都从这里读取。
考法：自动发现数据结构并建表 → ✅ 用 AWS Glue crawler 填充 Data Catalog；❌ Amazon EMR：在集群上处理数据，不会替你发现表结构
SOURCE: https://docs.aws.amazon.com/glue/latest/dg/add-crawler.html
You can use an AWS Glue crawler to populate the AWS Glue Data Catalog with databases and tables. This is the primary method used by most AWS Glue users.

## awsb-an-glue-vs-emr | d2
TOPIC: Analytics and ML
Q:
A nightly job must convert CSV (comma-separated values) files in Amazon S3 (Simple Storage Service) to Parquet, and the team wants no clusters to manage. Which service?
Q_ZH:
一个每晚运行的任务要把 Amazon S3（Simple Storage Service，简单存储服务）里的 CSV（comma-separated values，逗号分隔值）文件转成 Parquet，团队不想管理任何集群，用哪个服务？
A:
Answer: An AWS Glue ETL (extract, transform, and load) job: serverless Spark.
Because: Glue runs the job on an Apache Spark-based serverless engine that AWS manages, so there is no cluster to size, patch or shut down, and billing is pay-as-you-go for the run.
Exam: serverless batch ETL with the least operations → ✅ an AWS Glue ETL job; ❌ Amazon EMR (Elastic MapReduce) on Amazon EC2 (Elastic Compute Cloud): you choose, run and scale the cluster
A_ZH:
答：AWS Glue ETL（extract, transform, and load，抽取、转换、加载）作业：无服务器的 Spark。
因为：Glue 在 AWS 托管的、基于 Apache Spark 的无服务器引擎上运行作业，所以没有集群要选型、打补丁或关机，按这次运行的用量付费。
考法：运维最少的无服务器批量 ETL → ✅ AWS Glue ETL 作业；❌ 跑在 Amazon EC2（Elastic Compute Cloud，弹性计算云）上的 Amazon EMR（Elastic MapReduce，托管大数据集群）：集群要你自己选型、运行和扩缩
SOURCE: https://docs.aws.amazon.com/glue/latest/dg/what-is-glue.html
You can visually compose data transformation workflows and seamlessly run them on the Apache Spark–based serverless ETL engine in AWS Glue.

## awsb-an-emr-clusters | d2
TOPIC: Analytics and ML
Q:
A data team needs to run Apache Spark and Hive with full control over the cluster's instance types and installed software. Which service?
Q_ZH:
一个数据团队要运行 Apache Spark 和 Hive，并且要完全掌控集群的实例类型和所装软件，用哪个服务？
A:
Answer: Amazon EMR (Elastic MapReduce): managed big data clusters you control.
Because: EMR launches a cluster of Amazon EC2 (Elastic Compute Cloud) instances running frameworks such as Hadoop, Spark and Hive, so you pick the instance types, applications and configuration while AWS handles provisioning.
Exam: Spark, Hive or Hadoop with cluster-level control → ✅ Amazon EMR; ❌ Amazon Athena: serverless SQL (Structured Query Language) queries, no cluster to control
A_ZH:
答：Amazon EMR（Elastic MapReduce，托管大数据集群）：集群由你掌控。
因为：EMR 用一组 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例搭起运行 Hadoop、Spark、Hive 等框架的集群，实例类型、应用和配置由你选，资源的开通（provisioning）由 AWS 负责。
考法：需要集群级控制的 Spark、Hive 或 Hadoop → ✅ Amazon EMR；❌ Amazon Athena：无服务器的 SQL（Structured Query Language，结构化查询语言）查询，没有集群可控
SOURCE: https://docs.aws.amazon.com/emr/latest/ManagementGuide/emr-what-is-emr.html
Amazon EMR, which was previously called Amazon Elastic MapReduce, is a managed cluster platform that simplifies running big data frameworks, such as Apache Hadoop and Apache Spark, on AWS to process and analyze vast amounts of data.

## awsb-cr-secrets-manager | d2
TOPIC: Encryption and threat detection
Q:
An app's database password must change automatically every 30 days without any code change or redeploy. Which AWS service should hold it?
Q_ZH:
一个应用的数据库密码要每 30 天自动更换，而且不改代码、不重新部署，应该放在哪个 AWS 服务里？
A:
Answer: AWS Secrets Manager: built-in automatic rotation.
Because: the app fetches the password from Secrets Manager at runtime instead of keeping it, so when rotation updates both the secret and the database, the app simply reads the new value.
Exam: rotate database credentials automatically → ✅ AWS Secrets Manager, with built-in rotation for Amazon RDS (Relational Database Service); ❌ AWS Systems Manager Parameter Store: stores config and SecureString values, no built-in rotation
A_ZH:
答：AWS Secrets Manager：自带自动轮换。
因为：应用在运行时才去 Secrets Manager 取密码，自己不保存，所以轮换同时改掉机密（secret）和数据库里的密码后，应用直接读到新值就行。
考法：自动轮换数据库凭证（rotate database credentials automatically）→ ✅ AWS Secrets Manager，对 Amazon RDS（Relational Database Service，关系型数据库服务）提供内置轮换；❌ AWS Systems Manager Parameter Store：存配置和 SecureString 值，没有内置轮换
SOURCE: https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html
For secrets such as database credentials, API keys, or tokens, we recommend AWS Secrets Manager, which provides purpose built security controls including automatic rotation and cross-region replication.

## awsb-s3-standard-ia | d2
TOPIC: S3 storage
Q:
Backups that are the only copy are read about once a month, yet must open in milliseconds when needed. Which Amazon S3 (Simple Storage Service) storage class?
Q_ZH:
一批备份是唯一的副本，大约每月才读一次，但需要时必须毫秒级打开，用哪个 Amazon S3（Simple Storage Service，简单存储服务）存储类？
A:
Answer: S3 Standard-IA (Infrequent Access): multi-zone, instant reads.
Because: it stores each object across at least three Availability Zones, so the only copy survives losing a zone, and reads return in milliseconds; you pay less to store but a per-GB fee to retrieve.
Exam: infrequent access, millisecond retrieval, data that can't be re-created → ✅ S3 Standard-IA; ❌ S3 One Zone-IA: one zone, data lost if it fails; ❌ S3 Glacier Flexible Retrieval: restores take minutes to hours
A_ZH:
答：S3 Standard-IA（Infrequent Access，低频访问）：多可用区，读取即时。
因为：它把每个对象存放在至少三个可用区（Availability Zone），唯一的副本也扛得住一个可用区失效，读取仍是毫秒级；存储更便宜，但每取回 1 GB 都要付取回费。
考法：不常访问、毫秒取回、数据无法重建（infrequent access, millisecond retrieval, can't be re-created）→ ✅ S3 Standard-IA；❌ S3 One Zone-IA：只存一个可用区，它一坏数据就没了；❌ S3 Glacier Flexible Retrieval：取回要几分钟到几小时
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html
S3 Standard-IA (STANDARD_IA) – Use for your primary or only copy of data that can't be re-created. S3 One Zone-IA (ONEZONE_IA) – Use if you can re-create the data if the Availability Zone fails, for object replicas when configuring S3 Cross-Region Replication (CRR).

## awsb-mo-aws-config-rules | d2
TOPIC: Monitoring, governance and cost
Q:
Security wants every unencrypted Amazon EBS (Elastic Block Store) volume flagged automatically as soon as it appears. Which service?
Q_ZH:
安全团队希望每一个未加密的 Amazon EBS（Elastic Block Store，弹性块存储）卷一出现就被自动标记出来，用哪个服务？
A:
Answer: AWS Config rules: evaluate configuration continuously.
Because: AWS Config records each resource's configuration and every change to it, and rules evaluate those settings, so a volume that breaks a rule is marked noncompliant, with optional automatic remediation.
Exam: flag and record noncompliant resource settings → ✅ AWS Config rules; ❌ Amazon Inspector: scans software for vulnerabilities; ❌ an SCP (service control policy): blocks actions up front, does not flag existing resources
A_ZH:
答：AWS Config 规则（rules）：持续评估资源配置。
因为：AWS Config 记录每个资源的配置和每一次变更，规则会评估这些设置，所以违反规则的卷会被标记为不合规（noncompliant），还可以选配自动修复。
考法：标记并记录不合规的资源设置 → ✅ AWS Config rules；❌ Amazon Inspector：扫描软件漏洞；❌ SCP（service control policy，服务控制策略）：事先阻止操作，不会标记已有资源
SOURCE: https://docs.aws.amazon.com/config/latest/developerguide/WhatIsConfig.html
You can use AWS Config rules to evaluate the configuration settings of your AWS resources. When AWS Config detects that a resource violates the conditions in one of your rules, AWS Config flags the resource as noncompliant and sends a notification.

## awsb-ed-cloudfront-vs-global-accelerator | d2
TOPIC: Edge and DNS
Q:
A multiplayer game sends UDP (User Datagram Protocol) traffic, and players worldwide need a faster, steadier path to its servers in two Regions. Which AWS service?
Q_ZH:
一款多人游戏走 UDP（User Datagram Protocol，用户数据报协议）流量，全球玩家需要更快、更稳的路径连到它部署在两个区域（Region）的服务器，用哪个 AWS 服务？
A:
Answer: AWS Global Accelerator: two fixed IP (Internet Protocol) addresses on AWS's network.
Because: anycast means the same two static IP addresses are announced from AWS edge locations worldwide, so packets enter the AWS network at the edge nearest each player and ride it to a healthy endpoint, even non-HTTP (Hypertext Transfer Protocol) UDP traffic.
Exam: non-HTTP traffic, static IP addresses or fast cross-Region failover → ✅ AWS Global Accelerator; ❌ Amazon CloudFront: built for HTTP content and caching; ❌ Network Load Balancer: handles UDP, but in one Region only
A_ZH:
答：AWS Global Accelerator：AWS 网络上的两个固定 IP（Internet Protocol，互联网协议）地址。
因为：anycast 指同样两个静态 IP 地址在全球各个 AWS 边缘站点同时对外宣告，所以数据包从离每个玩家最近的边缘站点进入 AWS 网络，再沿这张网络到达健康的终端节点，非 HTTP（Hypertext Transfer Protocol，超文本传输协议）的 UDP 流量也一样。
考法：非 HTTP 流量、静态 IP 地址或跨区域快速故障切换 → ✅ AWS Global Accelerator；❌ Amazon CloudFront：为 HTTP 内容和缓存而设计；❌ Network Load Balancer：支持 UDP，但只在一个区域内
SOURCE: https://aws.amazon.com/global-accelerator/faqs/
Global Accelerator improves performance for a wide range of applications over TCP or UDP by proxying packets at the edge to applications running in one or more AWS Regions. Global Accelerator is a good fit for non-HTTP use cases, such as gaming (UDP), IoT (MQTT), or Voice over IP, as well as for HTTP use cases that specifically require static IP addresses or deterministic, fast regional failover.

## awsb-cost-spot-instances | d2
TOPIC: Compute and scaling
Q:
A nightly image-processing batch can be stopped and restarted at any time, and its cost must be as low as possible. Which Amazon EC2 (Elastic Compute Cloud) purchase option?
Q_ZH:
一个每晚跑的图片处理批任务随时可以停下再重跑，成本要尽量低，选哪种 Amazon EC2（Elastic Compute Cloud，弹性计算云）购买方式？
A:
Answer: Spot Instances: spare capacity at a deep discount.
Because: Spot Instances run on spare EC2 capacity at up to 90% off On-Demand prices, and AWS can take them back with a two-minute warning, so they fit only work that survives interruption.
Exam: fault-tolerant, interruptible work at the lowest cost → ✅ Spot Instances; ❌ Reserved Instances: 1- or 3-year term, billed even when idle; ❌ On-Demand Instances: full price for work that could be interrupted
A_ZH:
答：Spot Instances（竞价实例）：用闲置容量，折扣很大。
因为：Spot Instances 用的是 EC2 的闲置容量，最多比 On-Demand 便宜 90%，但 AWS 要收回时只提前两分钟通知，所以只适合能承受中断的工作。
考法：能容错、可中断、成本最低（fault-tolerant, interruptible）→ ✅ Spot Instances；❌ Reserved Instances：要签 1 年或 3 年，不用也照样计费；❌ On-Demand Instances：可以中断的活却付全价
SOURCE: https://aws.amazon.com/ec2/spot/
Amazon EC2 Spot Instances let you take advantage of unused EC2 capacity in the AWS cloud and are available at up to a 90% discount compared to On-Demand prices.

## awsb-cost-steady-vs-sporadic | d2
TOPIC: Compute and scaling
Q:
An internal app server must run nonstop at the same size for the next three years. Which Amazon EC2 (Elastic Compute Cloud) purchase option gives the lowest cost for that steady use?
Q_ZH:
一台内部应用服务器未来三年都要以同样的规格不间断运行，哪种 Amazon EC2（Elastic Compute Cloud，弹性计算云）购买方式能让这种稳定用量的成本最低？
A:
Answer: A 3-year Standard Reserved Instance: steady use earns the discount.
Because: a Reserved Instance bills a discounted rate every hour of its term, used or not, so it pays off when the server runs most of the time; AWS now recommends Savings Plans, with similar discounts.
Exam: steady, always-on use for years → ✅ Reserved Instances or Savings Plans; ❌ Spot Instances: AWS can reclaim them with a two-minute warning
A_ZH:
答：3 年期 Standard Reserved Instance（标准预留实例）：长期稳定使用换来折扣。
因为：Reserved Instance 在整个期限内每个小时都按折扣价计费，用不用都收钱，所以服务器大部分时间都开着时才划算；AWS 现在更推荐 Savings Plans，折扣幅度相近。
考法：多年稳定、一直开着（steady, always-on）→ ✅ Reserved Instances 或 Savings Plans；❌ Spot Instances：AWS 提前两分钟通知就能收回
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-reserved-instances.html
Reserved Instances provide you with significant savings on your Amazon EC2 costs compared to On-Demand Instance pricing. Reserved Instances are not physical instances, but rather a billing discount applied to the use of On-Demand Instances in your account.

## awsb-cost-on-demand-short-uninterruptible | d2
TOPIC: Compute and scaling
Q:
A critical job runs only a few hours a week at unpredictable times and must never be interrupted. Which Amazon EC2 (Elastic Compute Cloud) purchase option?
Q_ZH:
一个关键任务每周只在无法预测的时间跑几个小时，而且绝不能被中断，选哪种 Amazon EC2（Elastic Compute Cloud，弹性计算云）购买方式？
A:
Answer: On-Demand Instances: pay per second, no commitment.
Because: you pay only for the seconds an On-Demand Instance runs and only you decide when it stops, so a short, irregular job pays no idle hours and is never reclaimed like Spot.
Exam: short, irregular work that must not be interrupted → ✅ On-Demand Instances; ❌ Spot Instances: AWS can reclaim them with a two-minute warning
A_ZH:
答：On-Demand Instances（按需实例）：按秒付费，无需承诺。
因为：On-Demand Instance 只按实际运行的秒数收费，什么时候停由你自己决定，所以短时、不规律的任务不用为闲置时间买单，也不会像 Spot Instance 那样被收回。
考法：短时、不规律、不能中断（short-term, irregular, cannot be interrupted）→ ✅ On-Demand Instances；❌ Spot Instances：AWS 提前两分钟通知就能收回
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-on-demand-instances.html
We recommend that you use On-Demand Instances for applications with short-term, irregular workloads that cannot be interrupted.

## awsb-nc-elasticache-read-offload | d2
TOPIC: Databases
Q:
The same product-page queries run thousands of times a minute and slow a read-heavy Amazon RDS (Relational Database Service) database. Which service returns those repeated results faster?
Q_ZH:
同样的商品页查询每分钟要跑几千次，拖慢了一个读多写少的 Amazon RDS（Relational Database Service，关系型数据库服务）数据库，用哪个服务更快地返回这些重复结果？
A:
Answer: Amazon ElastiCache: cache the hot query results.
Because: ElastiCache keeps data in memory, so the app runs an expensive query once, stores the result, and serves every repeat in under a millisecond without touching the database.
Exam: repeated read queries overload a database → ✅ Amazon ElastiCache; ❌ DAX (DynamoDB Accelerator): caches DynamoDB only; ❌ Amazon RDS Proxy: pools connections, does not speed up queries
A_ZH:
答：Amazon ElastiCache：缓存热点查询结果。
因为：ElastiCache 把数据放在内存里，所以昂贵的查询只跑一次，结果存起来，之后每次重复请求都在一毫秒内返回，不再碰数据库。
考法：重复的读查询压垮数据库 → ✅ Amazon ElastiCache；❌ DAX（DynamoDB Accelerator，DynamoDB 加速器）：只给 DynamoDB 做缓存；❌ Amazon RDS Proxy：只做连接池，不会让查询变快
SOURCE: https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/elasticache-use-cases.html
By caching such query results, you pay the price of the query only once. Then you can quickly retrieve the data multiple times without having to re-execute the query.

## awsb-tr-dms | d2
TOPIC: Migration and transfer
Q:
An on-premises MySQL database must move to Amazon RDS (Relational Database Service) for MySQL while it keeps taking writes, with only minutes of downtime. Which service?
Q_ZH:
机房里一个 MySQL 数据库要迁到 Amazon RDS（Relational Database Service，关系型数据库服务）for MySQL，迁移期间它还在不断写入，停机只能有几分钟，用哪个服务？
A:
Answer: AWS DMS (Database Migration Service): full load, then ongoing replication.
Because: a DMS replication instance copies the existing rows, then reads the source's transaction log and applies each new change to the target, so the target stays in sync until you switch the app over.
Exam: migrate a live database with minimal downtime → ✅ AWS DMS with CDC (change data capture); ❌ DMS Schema Conversion: rewrites schemas for engine changes, moves no data; ❌ AWS DataSync: copies files, not live database changes
A_ZH:
答：AWS DMS（Database Migration Service，数据库迁移服务）：先全量加载，再持续复制。
因为：DMS 复制实例先把现有数据行拷过去，再读取源库的事务日志，把每个新变更应用到目标库，所以在你把应用切过去之前，目标库一直保持同步。
考法：在线数据库迁移、停机时间最短（migrate a live database with minimal downtime）→ ✅ AWS DMS + CDC（change data capture，变更数据捕获）；❌ DMS Schema Conversion：只在换引擎时改写结构，不搬数据；❌ AWS DataSync：复制文件，不复制数据库的实时变更
SOURCE: https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html
After you convert your source schemas and apply the converted code to your target database, you can use AWS DMS to migrate your data. You can perform one-time migrations or replicate ongoing changes to keep sources and targets in sync.

## awsb-tr-dms-cdc-ongoing-replication | d2
TOPIC: Migration and transfer
Q:
During a database migration, the source keeps taking writes for two weeks before cutover. Which AWS DMS (Database Migration Service) task type keeps the target current?
Q_ZH:
一次数据库迁移中，源库在切换前的两周里一直有新写入，用哪种 AWS DMS（Database Migration Service，数据库迁移服务）任务类型让目标库保持最新？
A:
Answer: A full load and CDC (change data capture) task: copy, then follow.
Because: DMS first copies the existing data, then reads each new change from the source engine's transaction log and applies it to the target, so the target keeps up until cutover.
Exam: keep source and target in sync until cutover → ✅ DMS full load plus CDC (ongoing replication); ❌ a full-load-only task: copies once, misses later changes
A_ZH:
答：full load and CDC（change data capture，变更数据捕获）任务：先复制，再跟进变更。
因为：DMS 先把现有数据复制过去，再从源数据库引擎的事务日志里读出每个新变更、应用到目标库，所以直到切换前目标库都能跟上。
考法：切换前保持源库和目标库同步（keep source and target in sync until cutover）→ ✅ DMS full load + CDC（持续复制）；❌ 只做 full load 的任务：只复制一次，之后的变更全漏掉
SOURCE: https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Task.CDC.html
You can also create a task that captures ongoing changes after you complete your initial (full-load) migration to a supported target data store. This process is called ongoing replication or change data capture (CDC).

## awsb-s3-glacier-deep-archive | d1
TOPIC: S3 storage
Q:
Compliance records that are almost never read can wait up to two days for a restore. Which Amazon S3 (Simple Storage Service) storage class costs least?
Q_ZH:
几乎从不读取的合规记录，恢复时最多可以等两天，哪个 Amazon S3（Simple Storage Service，简单存储服务）存储类最便宜？
A:
Answer: S3 Glacier Deep Archive: lowest-cost storage in AWS.
Because: AWS rule: it is the cheapest class, but objects must be restored before reading, within 12 hours (Standard) or 48 hours (Bulk), and every object is billed for at least 180 days.
Exam: rarely accessed, kept for years, restore within 12 to 48 hours, lowest cost → ✅ S3 Glacier Deep Archive; ❌ S3 Intelligent-Tiering: per-object monitoring fee, built for unknown access; ❌ S3 Glacier Flexible Retrieval: faster restores, higher storage price
A_ZH:
答：S3 Glacier Deep Archive：AWS 里最便宜的存储。
因为：AWS 规定，记住即可：它是最便宜的存储类，但读之前必须先恢复，Standard 在 12 小时内、Bulk 在 48 小时内完成，而且每个对象至少按 180 天计费。
考法：几乎不访问、保存多年、恢复可等 12 到 48 小时、成本最低（rarely accessed, restore within 12 to 48 hours, lowest cost）→ ✅ S3 Glacier Deep Archive；❌ S3 Intelligent-Tiering：按对象收监控费，适合访问规律未知的数据；❌ S3 Glacier Flexible Retrieval：恢复更快，但存储更贵
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/glacier-storage-classes.html
S3 Glacier Deep Archive is the lowest-cost storage option in AWS. Objects stored in S3 Glacier Deep Archive are archived and not available for real-time access.

## awsb-vpc-only-tgw-transits | d3
TOPIC: VPC networking
Q:
Twenty VPCs (virtual private clouds) in one Region must all reach each other, with each VPC connected only once. Which AWS service?
Q_ZH:
同一区域（Region）里有 20 个 VPC（virtual private cloud，虚拟私有云）需要全部互通，而且每个 VPC 只连一次，用哪个 AWS 服务？
A:
Answer: AWS Transit Gateway: one hub that routes between attachments.
Because: each VPC attaches once and the transit gateway acts as a Regional router that forwards packets between attachments, so traffic transits the hub; peering never forwards traffic onward, so 20 VPCs would need 190 peering connections.
Exam: many VPCs, transitive routing, hub-and-spoke → ✅ AWS Transit Gateway; ❌ VPC peering: one to one and non-transitive, a full mesh grows fast
A_ZH:
答：AWS Transit Gateway：在各挂载之间转发流量的中心枢纽。
因为：每个 VPC 只挂载（attach）一次，中转网关就像一台区域级路由器，在各挂载之间转发数据包，流量可以经过这个枢纽中转；VPC 对等连接不会把流量再转给第三个 VPC，所以 20 个 VPC 两两互通得建 190 条对等连接。
考法：很多 VPC、需要传递路由（transitive routing）、星型拓扑（hub-and-spoke）→ ✅ AWS Transit Gateway；❌ VPC peering：一对一、不可传递，全网状连接数量增长极快
SOURCE: https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html
In AWS Transit Gateway, a transit gateway acts as a Regional virtual router for traffic flowing between your virtual private clouds (VPCs) and on-premises networks.

## awsb-vpc-transit-gateway-basics | d2
TOPIC: VPC networking
Q:
One Site-to-Site VPN (virtual private network) from the office must reach ten VPCs (virtual private clouds) in the same Region. Which AWS service lets that single VPN serve all ten?
Q_ZH:
办公室的一条 Site-to-Site VPN（virtual private network，虚拟专用网络）要连通同一区域（Region）里的 10 个 VPC（virtual private cloud，虚拟私有云），用哪个 AWS 服务能让这一条 VPN 服务全部 10 个 VPC？
A:
Answer: AWS Transit Gateway: attach the VPN once.
Because: a transit gateway is a Regional hub that both the VPN and every VPC attach to, and its route table forwards packets between any two attachments, so office traffic reaches all ten VPCs through one VPN connection.
Exam: connect on premises and many VPCs through one hub → ✅ AWS Transit Gateway; ❌ VPC peering: a peered VPC cannot pass on-premises traffic onward
A_ZH:
答：AWS Transit Gateway：VPN 只需挂载一次。
因为：中转网关是一个区域级枢纽，VPN 和每个 VPC 都挂载到它上面，它的路由表在任意两个挂载之间转发数据包，所以办公室流量通过一条 VPN 就能到达全部 10 个 VPC。
考法：通过一个枢纽连接本地机房和多个 VPC → ✅ AWS Transit Gateway；❌ VPC peering：对等的 VPC 不能把本地机房流量再转发出去
SOURCE: https://docs.aws.amazon.com/vpc/latest/tgw/what-is-transit-gateway.html
AWS Transit Gateway is a network transit hub used to interconnect virtual private clouds (VPCs) and on-premises networks. As your cloud infrastructure expands globally, inter-Region peering connects transit gateways together using the AWS Global Infrastructure.

## awsb-an-redshift-olap | d2
TOPIC: Analytics and ML
Q:
Sales history from many systems is loaded into one central store, where analysts run complex SQL (Structured Query Language) reports over billions of rows. Which service?
Q_ZH:
多个系统的销售历史被加载进一个集中存储，分析师在上面跑扫描几十亿行的复杂 SQL（Structured Query Language，结构化查询语言）报表，用哪个服务？
A:
Answer: Amazon Redshift: a data warehouse built for analytics.
Because: a leader node splits each query across compute nodes that each scan their own slice of the data in parallel, so huge analytic scans finish fast.
Exam: complex analytics over large data, OLAP (online analytical processing) → ✅ Amazon Redshift (or Redshift Serverless, no cluster to manage); ❌ Amazon RDS (Relational Database Service): OLTP (online transaction processing) for many small app transactions
A_ZH:
答：Amazon Redshift：为分析而生的数据仓库。
因为：领导节点（leader node）把每个查询拆开分给多个计算节点，各自并行扫描自己那一份数据，所以海量扫描也很快。
考法：大数据量上的复杂分析、OLAP（online analytical processing，联机分析处理）→ ✅ Amazon Redshift（不想管集群就用 Redshift Serverless）；❌ Amazon RDS（Relational Database Service，关系型数据库服务）：OLTP（online transaction processing，联机事务处理），服务应用的大量小事务
SOURCE: https://docs.aws.amazon.com/redshift/latest/dg/c_high_level_system_architecture.html
Although it provides the same functionality as a typical RDBMS, including online transaction processing (OLTP) functions such as inserting and deleting data, Amazon Redshift is optimized for high-performance analysis and reporting of very large datasets.

## awsb-rds-aurora-replicas | d3
TOPIC: Databases
Q:
An Aurora MySQL app must spread its read-only connections across several database copies through one connection address. Which Aurora endpoint?
Q_ZH:
一个 Aurora MySQL 应用要通过同一个连接地址，把只读连接分摊到多份数据库副本上，用 Aurora 的哪种终端节点（endpoint）？
A:
Answer: The reader endpoint: it balances across Aurora Replicas.
Because: Aurora Replicas read the same shared cluster volume as the writer, so up to 15 can be added without copying data, and the reader endpoint balances read-only connections across them.
Exam: scale reads behind one address → ✅ Aurora Replicas with the reader endpoint, and the same replicas are failover targets; ❌ Multi-AZ (Multi-Availability Zone) instance standby: an Amazon RDS (Relational Database Service) standby that serves no reads
A_ZH:
答：reader endpoint（读取器终端节点）：在 Aurora Replica 之间均衡。
因为：Aurora Replica 和写实例读的是同一个共享集群卷，所以最多可加 15 个而且不用复制数据，reader endpoint 再把只读连接均衡地分到它们身上。
考法：用一个地址扩展读（scale reads）→ ✅ Aurora Replica 加 reader endpoint，这些副本同时也是故障切换目标；❌ Multi-AZ（Multi-Availability Zone，多可用区）实例备用库：Amazon RDS（Relational Database Service，关系型数据库服务）的备用库，不提供读
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.Endpoints.html
To perform queries, you can connect to the reader endpoint, with Aurora automatically performing connection-balancing among all the Aurora Replicas.

## awsb-rds-aurora-replica-failover | d1
TOPIC: Databases
Q:
The writer instance of an Aurora cluster fails, and the cluster has one Aurora Replica in another Availability Zone. What does Aurora do?
Q_ZH:
一个 Aurora 集群的写实例故障了，集群在另一个可用区有一个 Aurora Replica，Aurora 会怎么做？
A:
Answer: Aurora promotes the replica to writer: automatic failover.
Because: the replica already reads the same shared cluster volume, so Aurora only has to switch it to the writer role, and service usually returns in under 60 seconds, often under 30.
Exam: Aurora writer fails, a replica exists → ✅ Aurora promotes a replica automatically, so replicas give both reads and high availability; ❌ Amazon RDS (Relational Database Service) read replica: no automatic failover, you promote it by hand
A_ZH:
答：Aurora 自动把副本提升为写实例：自动故障切换。
因为：副本本来就读同一个共享集群卷，所以 Aurora 只需把它切换成写角色，服务通常 60 秒内恢复，往往不到 30 秒。
考法：Aurora 写实例故障、有副本 → ✅ Aurora 自动提升副本，所以副本既分流读又提供高可用；❌ Amazon RDS（Relational Database Service，关系型数据库服务）只读副本：不会自动故障切换，要手动提升
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.AuroraHighAvailability.html
If the DB cluster has one or more Aurora Replicas, then an Aurora Replica is promoted to the primary instance during a failure event.

## awsb-bf-fsx-windows | d2
TOPIC: Block and file storage
Q:
Windows servers in AWS need one shared drive that keeps their NTFS (New Technology File System) permissions from Active Directory. Which AWS file service?
Q_ZH:
AWS 上的一组 Windows 服务器要共用一个共享盘，并保留来自 Active Directory 的 NTFS（New Technology File System，Windows 的文件系统）权限，用哪个 AWS 文件服务？
A:
Answer: Amazon FSx for Windows File Server: native Windows shares.
Because: it runs real Windows file servers, so clients connect over SMB (Server Message Block), the file system joins your Active Directory, and NTFS permissions work as they do on premises.
Exam: Windows, SMB, NTFS ACLs (access control lists), Active Directory → ✅ Amazon FSx for Windows File Server; ❌ Amazon EFS (Elastic File System): Linux NFS (Network File System) shares; ❌ Amazon S3 (Simple Storage Service) File Gateway: an on-premises cache that stores files as objects in S3
A_ZH:
答：Amazon FSx for Windows File Server：原生 Windows 共享盘。
因为：它跑的就是真正的 Windows 文件服务器，客户端走 SMB（Server Message Block，Windows 文件共享协议）连接，文件系统加入你的 Active Directory，NTFS 权限和机房里一样用。
考法：Windows、SMB、NTFS ACL（access control list，访问控制列表）、Active Directory → ✅ Amazon FSx for Windows File Server；❌ Amazon EFS（Elastic File System，弹性文件系统）：Linux 的 NFS（Network File System，网络文件系统）共享；❌ Amazon S3（Simple Storage Service，简单存储服务）File Gateway：机房里的缓存，文件最终以对象形式存进 S3
SOURCE: https://docs.aws.amazon.com/fsx/latest/WindowsGuide/what-is.html
Amazon FSx for Windows File Server provides fully managed Microsoft Windows file servers, backed by a fully native Windows file system.

## awsb-dt-shield | d3
TOPIC: Encryption and threat detection
Q:
A public game site wants AWS DDoS (distributed denial of service) specialists on call 24/7 whenever a large attack hits. Which protection?
Q_ZH:
一个公开的游戏网站希望遭到大规模 DDoS（distributed denial of service，分布式拒绝服务）攻击时，随时有 AWS 的 DDoS 专家 24/7 支援，用哪种防护？
A:
Answer: AWS Shield Advanced: paid DDoS protection with experts.
Because: Shield Standard already absorbs common network and transport layer floods free on every account, and the paid Shield Advanced subscription adds 24/7 Shield Response Team help and credits for attack-driven scaling on the internet-facing resources you enroll.
Exam: large DDoS attacks, response team, cost protection → ✅ AWS Shield Advanced; ❌ AWS WAF (web application firewall) alone: filters HTTP (Hypertext Transfer Protocol) requests at some entry points, no experts or credits; ❌ Shield Standard: free baseline, no experts
A_ZH:
答：AWS Shield Advanced：带专家支援的付费 DDoS 防护。
因为：Shield Standard 已经在每个账户上免费挡住常见的网络层和传输层洪水攻击；付费订阅 Shield Advanced 才加上 24/7 的 Shield Response Team（DDoS 响应团队）支援，以及你登记的面向互联网资源因攻击扩容时的费用抵扣。
考法：大规模 DDoS、专家响应团队、费用保护（cost protection）→ ✅ AWS Shield Advanced；❌ 只用 AWS WAF（web application firewall，Web 应用防火墙）：只在部分入口过滤 HTTP（Hypertext Transfer Protocol，超文本传输协议）请求，没有专家也不抵扣费用；❌ Shield Standard：免费的基础防护，没有专家
SOURCE: https://aws.amazon.com/shield/features/
In addition to the network and transport layer protections that come with Standard, Shield Advanced provides additional detection and mitigation against large and sophisticated DDoS attacks, near real-time visibility into attacks, and integration with AWS WAF, a web application firewall. Shield Advanced also gives you 24/7 access to the AWS Shield Response Team (SRT) and protection against DDoS-related spikes in your EC2, ELB, CloudFront, Global Accelerator, and Route 53 charges.

## awsb-dt-shield-advanced-resources | d2
TOPIC: Encryption and threat detection
Q:
A web app runs on a single Amazon EC2 (Elastic Compute Cloud) instance with a static public address and no load balancer. Which resource do you enroll in AWS Shield Advanced to protect it?
Q_ZH:
一个 Web 应用只跑在一台 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例上，有固定的公网地址，没有负载均衡器，要把哪个资源加入 AWS Shield Advanced 才能保护它？
A:
Answer: Its Elastic IP (Internet Protocol) address: Shield guards entry points.
Because: AWS rule: Shield Advanced protects only enrolled internet entry points: edge ones like CloudFront and Route 53, or Regional ones like load balancers and Elastic IP addresses, so an instance is covered through its Elastic IP.
Exam: Shield Advanced for an EC2 instance → ✅ enroll its Elastic IP address, or the load balancer in front; ❌ the instance itself: cannot be enrolled directly; ❌ Amazon GuardDuty: detects threats in logs, blocks no DDoS (distributed denial of service)
A_ZH:
答：它的 Elastic IP（Internet Protocol，互联网协议）地址：Shield 守的是入口。
因为：AWS 规定，记住即可：Shield Advanced 只保护你登记的互联网入口，边缘的如 CloudFront 和 Route 53，区域内的如负载均衡器和 Elastic IP 地址，所以实例要通过它的 Elastic IP 来受保护。
考法：用 Shield Advanced 保护 EC2 实例 → ✅ 登记它的 Elastic IP 地址，或前面的负载均衡器；❌ 实例本身：不能直接登记；❌ Amazon GuardDuty：只从日志里检测威胁，挡不住 DDoS（distributed denial of service，分布式拒绝服务）
SOURCE: https://docs.aws.amazon.com/waf/latest/developerguide/ddos-advanced-summary-protected-resources.html
Shield Advanced protects the resources that are associated with protected Elastic IP addresses.

## awsb-in-eventbridge-scheduler | d2
TOPIC: Messaging and streaming
Q:
A cleanup container must start at 01:00 every night with no server kept running just to hold a cron job, and each run takes about 2 hours. Which AWS service starts it?
Q_ZH:
一个清理用的容器每晚 01:00 都要启动，不能为了跑 cron 定时任务专门开一台服务器，每次要跑约 2 小时，用哪个 AWS 服务来启动它？
A:
Answer: Amazon EventBridge Scheduler: serverless cron for any target.
Because: Scheduler stores your cron, rate or one-time schedule and at each due time calls the target's API (application programming interface) itself, here ECS (Elastic Container Service) RunTask to start a Fargate task, so no server waits for the clock.
Exam: run a task on a cron, rate or one-time schedule with no servers → ✅ Amazon EventBridge Scheduler; ❌ a scheduled Lambda function doing the job: Lambda stops at 15 minutes
A_ZH:
答：Amazon EventBridge Scheduler：无服务器的定时器，可触发各种目标。
因为：Scheduler 保存你的 cron、固定频率（rate）或一次性计划，到点由它自己调用目标的 API（application programming interface，应用程序接口），这里是用 ECS（Elastic Container Service，容器服务）的 RunTask 启动一个 Fargate 任务，所以不需要任何服务器守着时钟。
考法：按 cron、固定频率或一次性计划运行任务，且不要服务器 → ✅ Amazon EventBridge Scheduler；❌ 用定时触发的 Lambda 函数来跑这个活：Lambda 15 分钟就停
SOURCE: https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html
With EventBridge Scheduler, you can create schedules using cron and rate expressions for recurring patterns, or configure one-time invocations.

## awsb-scaling-target-vs-step | d2
TOPIC: Compute and scaling
Q:
An Auto Scaling group must keep average CPU (central processing unit) use near 50% while traffic changes unpredictably. Which scaling policy?
Q_ZH:
一个 Auto Scaling group 要在流量无法预测地变化时，把平均 CPU（central processing unit，中央处理器）使用率保持在 50% 左右，用哪种扩缩容策略？
A:
Answer: Target tracking: you set the target value.
Because: the name says it: you pick a metric and a target value, and Auto Scaling creates and manages the CloudWatch alarms and adds or removes instances to hold the metric near that target.
Exam: keep a metric such as average CPU at a set value → ✅ target tracking scaling policy; ❌ step scaling: bigger alarm breach, bigger capacity change, alarms built by you; ❌ scheduled scaling: set times, not load
A_ZH:
答：Target tracking（目标跟踪）：你只设目标值。
因为：名字就是答案：你选一个指标和目标值，Auto Scaling 自己创建并管理 CloudWatch 告警，增减实例，让指标一直贴近目标。
考法：把平均 CPU 等指标保持在设定值（keep a metric at a target value）→ ✅ target tracking scaling policy；❌ step scaling：告警超出阈值越多，一次增减的实例越多，告警要你自己建；❌ scheduled scaling：只看固定时间，不看负载
SOURCE: https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-target-tracking.html
With target tracking, you select a metric and a target value to represent the ideal average utilization or throughput level for your application. Amazon EC2 Auto Scaling creates and manages the CloudWatch alarms that invoke scaling events when the metric deviates from the target.

## awsb-st-firehose | d2
TOPIC: Messaging and streaming
Q:
Clickstream records must be loaded into an Amazon S3 (Simple Storage Service) bucket continuously, with no consumer application for your team to write or run. Which service?
Q_ZH:
点击流记录要源源不断地写进 Amazon S3（Simple Storage Service，简单存储服务）存储桶，而且你的团队不想编写或运行任何消费端程序，用哪个服务？
A:
Answer: Amazon Data Firehose: managed delivery, no consumer code.
Because: producers send records to a Firehose stream, which buffers them by size or time and then writes each batch to the destination itself, so no consumer code exists and delivery is near real time.
Exam: load streaming data into S3 or Amazon Redshift with no consumer code → ✅ Amazon Data Firehose; ❌ Amazon Kinesis Data Streams: you build and run the consumers
A_ZH:
答：Amazon Data Firehose：托管投递，不用写消费端代码。
因为：生产者把记录发到 Firehose 流，Firehose 按大小或时间先攒一批（缓冲），再自己把每批写入目标，所以没有消费端代码，投递是近实时的。
考法：把流数据装进 S3 或 Amazon Redshift，且不写消费端代码 → ✅ Amazon Data Firehose；❌ Amazon Kinesis Data Streams：消费端要你自己写、自己运行
SOURCE: https://docs.aws.amazon.com/firehose/latest/dev/what-is-this-service.html
With Amazon Data Firehose, you don't need to write applications or manage resources. You configure your data producers to send data to Amazon Data Firehose, and it automatically delivers the data to the destination that you specified.

## awsb-st-kinesis-streams | d2
TOPIC: Messaging and streaming
Q:
Three separate apps must each read the same ordered stream of events, and any of them may need to re-read the last day of data. Which service?
Q_ZH:
三个独立的应用都要读取同一条有序的事件流，而且任何一个都可能需要重读最近一天的数据，用哪个服务？
A:
Answer: Amazon Kinesis Data Streams: ordered, replayable, many readers.
Because: records stay in ordered shards for the retention period (default 24 hours, maximum 365 days) instead of being deleted when read, so each app reads at its own position and can go back.
Exam: ordered real-time stream, several consumers, replay → ✅ Amazon Kinesis Data Streams; ❌ Amazon SQS (Simple Queue Service): a consumer deletes each message after processing, so no replay; ❌ Amazon Data Firehose: delivers to destinations, no replay
A_ZH:
答：Amazon Kinesis Data Streams：有序、可重放、多方读取。
因为：记录按顺序存放在分片（shard）里，保留期内（默认 24 小时，最长 365 天）读过也不删除，所以每个应用按自己的位置读，还能回头重读。
考法：有序的实时流、多个消费者、需要重放（replay）→ ✅ Amazon Kinesis Data Streams；❌ Amazon SQS（Simple Queue Service，简单队列服务）：消费者处理完就删除消息，所以无法重放；❌ Amazon Data Firehose：只负责投递到目标，不能重放
SOURCE: https://docs.aws.amazon.com/streams/latest/dev/key-concepts.html
There can be multiple applications for one stream, and each application can consume data from the stream independently and concurrently.

## awsb-cost-savings-plan-types | d2
TOPIC: Compute and scaling
Q:
A company will commit to a steady hourly spend while it moves workloads from Amazon EC2 (Elastic Compute Cloud) to Fargate and Lambda over the next year. Which Savings Plan type?
Q_ZH:
一家公司打算承诺每小时固定的花费，同时会在接下来一年里把工作负载从 Amazon EC2（Elastic Compute Cloud，弹性计算云）迁到 Fargate 和 Lambda，选哪种 Savings Plan？
A:
Answer: Compute Savings Plans: cover EC2, Fargate and Lambda.
Because: the name says it: a Compute Savings Plan discounts compute of any instance family, size, Region or operating system, plus Fargate and Lambda, so the discount follows the workload wherever it moves.
Exam: commitment that must follow changes of family, Region or service → ✅ Compute Savings Plans; ❌ EC2 Instance Savings Plans: bigger discount, but one family in one Region, no Fargate or Lambda
A_ZH:
答：Compute Savings Plans：EC2、Fargate、Lambda 都能抵扣。
因为：名字就是答案：Compute Savings Plan 抵扣任意实例系列、规格、区域（Region）或操作系统的计算用量，还包括 Fargate 和 Lambda，所以工作负载搬到哪里，折扣就跟到哪里。
考法：承诺要能跟着实例系列、区域或服务的变化走（flexibility across family, Region and service）→ ✅ Compute Savings Plans；❌ EC2 Instance Savings Plans：折扣更大，但只限一个区域里的一个实例系列，不含 Fargate 和 Lambda
SOURCE: https://docs.aws.amazon.com/savingsplans/latest/userguide/plan-types.html
These plans automatically apply to your EC2 instance usage, regardless of instance family (for example, m5, c5, etc.), instance size (for example, c5.large, c5.xlarge, etc.), Region (for example, us-east-1, us-east-2, etc.), operating system (for example, Windows, Linux, etc.), or tenancy (for example, Dedicated, default, Dedicated Host). They also apply to your Fargate and Lambda usage.

## awsb-elb-scheduled-scaling | d2
TOPIC: Compute and scaling
Q:
A flash sale starts at a known date and time, and extra instances must already be running when it begins. Which scaling method?
Q_ZH:
一场限时抢购会在已知的日期和时间开始，开始时额外的实例必须已经在运行，用哪种扩缩容方式？
A:
Answer: Scheduled scaling: capacity changes at set times.
Because: a scheduled action sets the Auto Scaling group's desired capacity at a date and time you choose, so instances launch before the sale, while dynamic scaling policies react only after load has risen.
Exam: load changes at a known time → ✅ scheduled scaling; ❌ target tracking scaling: reacts only after the metric moves
A_ZH:
答：Scheduled scaling（计划扩缩容）：在设定的时间改容量。
因为：计划动作会在你指定的日期和时间调整 Auto Scaling group 的期望容量，所以实例在抢购开始前就启动好了；动态扩缩容策略要等负载上来了才反应。
考法：负载在已知时间变化（predictable load changes at specific times）→ ✅ scheduled scaling；❌ target tracking scaling：指标变了才反应
SOURCE: https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-scheduled-scaling.html
With scheduled scaling, you can set up automatic scaling for your application based on predictable load changes. You create scheduled actions that increase or decrease your group's desired capacity at specific times.

## awsb-mo-cloudtrail | d2
TOPIC: Monitoring, governance and cost
Q:
A security group was changed overnight, and you must find which IAM (Identity and Access Management) user made the change and from which IP (Internet Protocol) address. Which service?
Q_ZH:
一个安全组（security group）在夜里被改了，你要查出是哪个 IAM（Identity and Access Management，身份与访问管理）用户改的、来自哪个 IP（Internet Protocol，互联网协议）地址，用哪个服务？
A:
Answer: AWS CloudTrail: records who called which API (application programming interface).
Because: every console or command line action is an API call, and CloudTrail records management calls like this one as events with who made them, when, and the source IP address; an organization trail covers every account.
Exam: who did what, when, from where → ✅ AWS CloudTrail; ❌ VPC (virtual private cloud) Flow Logs: which IP addresses and ports exchanged traffic, not who called an API
A_ZH:
答：AWS CloudTrail：记录谁调用了哪个 API（application programming interface，应用程序接口）。
因为：控制台或命令行上的每个操作都是一次 API 调用，像这样的管理操作 CloudTrail 都会记成事件，包括谁做的、什么时候、来源 IP 地址；组织级跟踪（organization trail）覆盖所有账户。
考法：谁、在何时、从哪里做了什么 → ✅ AWS CloudTrail；❌ VPC（virtual private cloud，虚拟私有云）Flow Logs：记录哪些 IP 和端口之间有流量，不记录谁调用了 API
SOURCE: https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html
Actions taken by a user, role, or an AWS service are recorded as events in CloudTrail. Events include actions taken in the AWS Management Console, AWS Command Line Interface, and AWS SDKs and APIs.

## awsb-s3-intelligent-tiering | d2
TOPIC: S3 storage
Q:
A data lake's access pattern is unknown and keeps changing, yet every object must stay instantly readable. Which Amazon S3 (Simple Storage Service) storage class?
Q_ZH:
一个数据湖的访问规律不明，而且一直在变，但每个对象都必须随时能立即读取，用哪个 Amazon S3（Simple Storage Service，简单存储服务）存储类？
A:
Answer: S3 Intelligent-Tiering: tiers each object by its access.
Because: for a small monthly per-object monitoring fee, it moves an object to the Infrequent Access tier after 30 days without access and back to Frequent Access when it is read again, with no retrieval fees.
Exam: unknown or changing access patterns, no retrieval fees → ✅ S3 Intelligent-Tiering; ❌ S3 Lifecycle rules: move objects by fixed age, not actual access; ❌ S3 Glacier Deep Archive: restore takes hours, not instant
A_ZH:
答：S3 Intelligent-Tiering：按每个对象的访问情况自动换层。
因为：每月按对象收一点监控费，对象连续 30 天没被访问就挪到 Infrequent Access 层，再被读取时挪回 Frequent Access 层，而且没有取回费。
考法：访问规律未知或经常变化、不要取回费（unknown or changing access patterns）→ ✅ S3 Intelligent-Tiering；❌ S3 Lifecycle rules：按固定天数挪，不看实际访问；❌ S3 Glacier Deep Archive：恢复要几小时，不能即时读取
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/intelligent-tiering-overview.html
For a low monthly object monitoring and automation charge, S3 Intelligent-Tiering monitors access patterns and automatically moves objects to the Infrequent Access tier when they haven't been accessed for 30 consecutive days.

## awsb-cost-explorer-vs-cur | d2
TOPIC: Monitoring, governance and cost
Q:
A manager wants charts of the last six months of costs grouped by service, plus a spending forecast, with nothing to set up. Which tool?
Q_ZH:
一位经理想看过去六个月按服务分组的费用图表，外加支出预测，而且什么都不用设置，用哪个工具？
A:
Answer: AWS Cost Explorer: built-in cost charts and forecasts.
Because: Cost Explorer already holds up to 13 months of your cost and usage data in the Billing console, so you filter, group and forecast up to 18 months ahead without building an export or query.
Exam: view or forecast costs with no setup → ✅ AWS Cost Explorer; ❌ Cost and Usage Report 2.0 (AWS Data Exports): line-item files you query with Athena; ❌ AWS Budgets: threshold alerts, not analysis
A_ZH:
答：AWS Cost Explorer：自带的费用图表和预测。
因为：Cost Explorer 在账单控制台里已经备好最多 13 个月的费用和用量数据，所以可以直接筛选、分组，还能预测未来最多 18 个月，不用建导出也不用写查询。
考法：无需设置就查看或预测费用 → ✅ AWS Cost Explorer；❌ Cost and Usage Report 2.0（AWS Data Exports）：逐行明细文件，要自己用 Athena 查询；❌ AWS Budgets：阈值告警，不做分析
SOURCE: https://docs.aws.amazon.com/cost-management/latest/userguide/ce-what-is.html
You can view data for up to the last 13 months, forecast how much you're likely to spend for the next 18 months, and get recommendations for what Reserved Instances to purchase.

## awsb-dt-waf-layer7-filtering | d2
TOPIC: Encryption and threat detection
Q:
Attackers send login requests stuffed with SQL (Structured Query Language) injection strings to an app behind an Application Load Balancer. Which AWS service blocks those requests?
Q_ZH:
攻击者向一个位于 Application Load Balancer 后面的应用发送夹带 SQL（Structured Query Language，结构化查询语言）注入字符串的登录请求，用哪个 AWS 服务拦截这些请求？
A:
Answer: AWS WAF (web application firewall): inspects every web request.
Because: a web ACL (access control list) on the load balancer checks each HTTP (Hypertext Transfer Protocol) request against rules such as the AWS managed SQL database rule group, so matching requests get a 403 error before reaching the app.
Exam: block SQL injection or XSS (cross-site scripting) → ✅ AWS WAF web ACL with managed rule groups; ❌ AWS Shield: absorbs DDoS (distributed denial of service) floods, does not look for injection attacks
A_ZH:
答：AWS WAF（web application firewall，Web 应用防火墙）：逐个检查 Web 请求。
因为：挂在负载均衡器上的 web ACL（access control list，访问控制列表）会把每个 HTTP（Hypertext Transfer Protocol，超文本传输协议）请求和规则比对，例如 AWS 托管的 SQL 数据库规则组，命中的请求在到达应用之前就收到 403 错误。
考法：拦截 SQL 注入或 XSS（cross-site scripting，跨站脚本）→ ✅ AWS WAF web ACL 加托管规则组；❌ AWS Shield：吸收 DDoS（distributed denial of service，分布式拒绝服务）洪水攻击，不检查注入攻击
SOURCE: https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-use-case.html
The SQL database rule group contains rules to block request patterns associated with exploitation of SQL databases, like SQL injection attacks. This can help prevent remote injection of unauthorized queries.

## awsb-org-guardrails-cap | d3
TOPIC: Identity and accounts
Q:
An SCP (service control policy) on a member account allows all actions, yet a new IAM (Identity and Access Management) user with no policies of its own still cannot list Amazon S3 (Simple Storage Service) buckets. Why?
Q_ZH:
一个成员账户上的 SCP（service control policy，服务控制策略）允许所有操作，可一个自己没有任何策略的新 IAM（Identity and Access Management，身份与访问管理）用户还是列不出 Amazon S3（Simple Storage Service，简单存储服务）桶，为什么？
A:
Answer: SCPs never grant: they only cap permissions.
Because: an SCP only sets the most that member-account users, roles and even the root user can do, so the user still needs an IAM policy of its own that allows listing buckets.
Exam: an SCP or a permissions boundary allows an action → ✅ still add an IAM policy that grants it; ❌ adding a permissions boundary that allows Amazon S3: it also only caps, grants nothing
A_ZH:
答：SCP 从不授权：只设上限。
因为：SCP 只规定成员账户里的用户、角色乃至 root 用户最多能做什么，这个用户仍然需要一条自己的 IAM 策略来允许列出存储桶。
考法：SCP 或 permissions boundary 允许某操作 → ✅ 仍要加一条授予它的 IAM 策略；❌ 给用户加一个允许 Amazon S3 的 permissions boundary（权限边界）：同样只设上限，不授予任何权限
SOURCE: https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html
Users and roles must still be granted permissions with appropriate IAM permission policies. A user without any IAM permission policies has no access, even if the applicable SCPs allow all services and all actions.

## awsb-rds-pitr-vs-snapshots | d2
TOPIC: Databases
Q:
A faulty script corrupted rows in an Amazon RDS (Relational Database Service) database at 14:05 today. Which feature brings the data back as it was at 14:04?
Q_ZH:
今天 14:05 一个出错的脚本把 Amazon RDS（Relational Database Service，关系型数据库服务）数据库里的行改坏了，用哪个功能把数据恢复成 14:04 的样子？
A:
Answer: Point-in-time recovery: automated backups plus transaction logs.
Because: automated backups keep daily snapshots plus transaction logs uploaded every five minutes, so RDS can replay changes to any moment in the retention period (up to 35 days), as a new database instance.
Exam: restore to an exact time within the last 35 days → ✅ point-in-time recovery from automated backups; ❌ manual DB (database) snapshot: restores only the moment it was taken
A_ZH:
答：时间点恢复（point-in-time recovery）：自动备份加事务日志。
因为：自动备份保留每天的快照，外加每 5 分钟上传一次的事务日志，所以 RDS 能把变更重放到保留期（最长 35 天）内的任意时刻，恢复成一个新的数据库实例。
考法：恢复到最近 35 天内的某个确切时间 → ✅ 用自动备份做时间点恢复；❌ 手动 DB（database，数据库）快照：只能恢复到拍快照的那一刻
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html
RDS saves the automated backups of your DB instance according to the backup retention period that you specify. If necessary, you can recover your DB instance to any point in time during the backup retention period.

## awsb-rds-manual-snapshots | d1
TOPIC: Databases
Q:
Compliance requires keeping a backup of an Amazon RDS (Relational Database Service) database for 7 years. Which backup type stays that long?
Q_ZH:
合规要求把一个 Amazon RDS（Relational Database Service，关系型数据库服务）数据库的备份保留 7 年，哪种备份能保留这么久？
A:
Answer: Manual DB (database) snapshots: kept until you delete them.
Because: AWS rule: automated backups expire at the end of the retention period, at most 35 days, while manual snapshots are not tied to that period and never expire on their own.
Exam: keep backups longer than 35 days → ✅ manual DB snapshots, or AWS Backup with a long retention rule; ❌ automated backups: retention is 35 days at most
A_ZH:
答：手动 DB（database，数据库）快照：不删就一直保留。
因为：AWS 规定，记住即可：自动备份在保留期结束时过期，保留期最长 35 天；手动快照不受保留期限制，自己不会过期。
考法：备份要保留超过 35 天 → ✅ 手动 DB 快照，或设置了长期保留规则的 AWS Backup；❌ 自动备份：保留期最长 35 天
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateSnapshot.html
Unlike automated backups, manual snapshots aren't subject to the backup retention period. Snapshots don't expire.

## awsb-rds-proxy | d2
TOPIC: Databases
Q:
Thousands of concurrent Lambda invocations open new connections at once and use up an Amazon RDS (Relational Database Service) database's connection limit. Which service fixes this?
Q_ZH:
几千个并发的 Lambda 调用同时新建连接，把一个 Amazon RDS（Relational Database Service，关系型数据库服务）数据库的连接数上限用光了，用哪个服务解决？
A:
Answer: Amazon RDS Proxy: it pools and reuses connections.
Because: RDS Proxy sits between Lambda and the database and keeps a pool of open connections, so many short calls share a few connections instead of each opening its own.
Exam: too many or bursty connections, for example from Lambda → ✅ Amazon RDS Proxy; ❌ Amazon ElastiCache: caches query results, does not pool connections
A_ZH:
答：Amazon RDS Proxy：把连接放进池里复用。
因为：RDS Proxy 站在 Lambda 和数据库之间，维持一个已打开的连接池，所以大量短调用共用少量连接，不用各自新开。
考法：连接太多或突发连接（比如来自 Lambda）→ ✅ Amazon RDS Proxy；❌ Amazon ElastiCache：缓存查询结果，不做连接池
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html
RDS Proxy establishes a database connection pool and reuses connections in this pool. This approach avoids the memory and CPU overhead of opening a new database connection each time.

## awsb-rds-scale-compute-vs-storage | d2
TOPIC: Databases
Q:
An Amazon RDS (Relational Database Service) database instance runs its CPU (central processing unit) near 100% during heavy writes. Which change adds compute power?
Q_ZH:
一台 Amazon RDS（Relational Database Service，关系型数据库服务）数据库实例在大量写入时 CPU（central processing unit，中央处理器）一直接近 100%，做哪项改动来增加算力？
A:
Answer: A larger DB (database) instance class: more CPU and memory.
Because: the DB instance class sets the instance's compute and memory, so modifying to a bigger class gives the writes more CPU, while storage autoscaling only adds disk when free space runs low.
Exam: more CPU or memory for a busy database → ✅ modify to a larger DB instance class; ❌ storage autoscaling: grows disk only, never compute; ❌ read replica: offloads reads, not writes
A_ZH:
答：换更大的 DB（database，数据库）实例规格：更多 CPU 和内存。
因为：DB 实例规格决定实例的算力和内存，所以改成更大的规格，写入就有更多 CPU；存储自动扩展只在剩余空间不足时加磁盘。
考法：给繁忙的数据库加 CPU 或内存 → ✅ 改成更大的 DB instance class；❌ 存储自动扩展（storage autoscaling）：只加磁盘，从不加算力；❌ 只读副本：分流读，不分担写
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.DBInstanceClass.html
The DB instance class determines the computation and memory capacity of an Amazon RDS DB instance.

## awsb-s3-event-notifications | d1
TOPIC: S3 storage
Q:
Each time a photo is uploaded to a bucket, a thumbnail must be made within seconds. Which Amazon S3 (Simple Storage Service) feature starts the work?
Q_ZH:
每当有照片上传到存储桶，就要在几秒内生成缩略图，用哪个 Amazon S3（Simple Storage Service，简单存储服务）功能来启动这项处理？
A:
Answer: S3 Event Notifications: the upload event triggers Lambda.
Because: you add a notification configuration to the bucket, so S3 sends each object-created event to a destination such as a Lambda function, usually within seconds, and the function makes the thumbnail.
Exam: react to object uploads or deletes → ✅ S3 Event Notifications (for example to AWS Lambda); ❌ Amazon EMR (Elastic MapReduce): big-data clusters, not per-object triggers
A_ZH:
答：S3 Event Notifications（事件通知）：上传事件触发 Lambda。
因为：你给存储桶加一份通知配置，S3 就会把每个对象创建事件发给目标（比如一个 Lambda 函数），通常几秒内送达，再由函数生成缩略图。
考法：对象上传或删除时自动处理（react to object uploads or deletes）→ ✅ S3 Event Notifications（比如发给 AWS Lambda）；❌ Amazon EMR（Elastic MapReduce，大数据处理服务）：大数据集群，不是逐个对象的触发器
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html
You can use the Amazon S3 Event Notifications feature to receive notifications when certain events happen in your S3 bucket. To enable notifications, add a notification configuration that identifies the events that you want Amazon S3 to publish.

## awsb-s3-glacier-flexible-retrieval | d1
TOPIC: S3 storage
Q:
Archived project files are read about once a year, and when someone needs one it must arrive within minutes. Which Amazon S3 (Simple Storage Service) storage class costs least?
Q_ZH:
归档的项目文件大约一年才读一次，但有人要用时必须在几分钟内拿到，哪个 Amazon S3（Simple Storage Service，简单存储服务）存储类最便宜？
A:
Answer: S3 Glacier Flexible Retrieval: archive with minutes-to-hours restores.
Because: AWS rule: objects are archived and must be restored before reading, in 1 to 5 minutes with Expedited or up to 12 hours with Bulk, and each object is billed for at least 90 days.
Exam: archive read about once a year, restore in minutes to hours → ✅ S3 Glacier Flexible Retrieval; ❌ S3 Standard-IA (Infrequent Access): instant reads, but costs more to store
A_ZH:
答：S3 Glacier Flexible Retrieval：归档存储，几分钟到几小时取回。
因为：AWS 规定，记住即可：对象是归档状态，读之前要先恢复，Expedited 只要 1 到 5 分钟，Bulk 最长 12 小时，而且每个对象至少按 90 天计费。
考法：大约一年访问一次的归档、几分钟到几小时内恢复（archive read about once a year, restore in minutes to hours）→ ✅ S3 Glacier Flexible Retrieval；❌ S3 Standard-IA（Infrequent Access，低频访问）：读取即时，但存储更贵
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/glacier-storage-classes.html
We recommend using S3 Glacier Flexible Retrieval for archive data that's accessed one to two times a year and doesn't require immediate access. S3 Glacier Flexible Retrieval offers flexible retrieval times to help you balance costs, with access times ranging from a few minutes to hours, and free bulk retrievals.

## awsb-s3-large-objects-pointer | d2
TOPIC: S3 storage
Q:
Each record in a DynamoDB table needs a 5 MB product photo that the app shows on every page view. Where should the photo be stored?
Q_ZH:
DynamoDB 表里每条记录都要配一张 5 MB 的商品照片，应用每次打开页面都要显示它，照片应该存在哪里？
A:
Answer: In Amazon S3 (Simple Storage Service), with its object key in the item.
Because: a DynamoDB item can hold at most 400 KB, so the photo is stored as an S3 object and the item keeps only the object key, which the app uses to fetch the photo when needed.
Exam: large files or images linked to database records → ✅ store them in Amazon S3 and keep the key or URL (uniform resource locator) in the database; ❌ S3 Glacier Deep Archive: hours to restore, useless for page views
A_ZH:
答：存进 Amazon S3（Simple Storage Service，简单存储服务），条目里只放对象键（object key）。
因为：一个 DynamoDB 条目最多 400 KB，所以照片存成 S3 对象，条目里只留对象键，应用需要时用它去取照片。
考法：和数据库记录关联的大文件或图片（large files or images linked to database records）→ ✅ 文件放 Amazon S3，数据库里存键或 URL（uniform resource locator，网址）；❌ S3 Glacier Deep Archive：恢复要几小时，没法用于每次页面浏览
SOURCE: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-use-s3-too.html
You can also store the item as an object in Amazon Simple Storage Service (Amazon S3) and store the Amazon S3 object identifier in your DynamoDB item.

## awsb-s3-object-lock | d2
TOPIC: S3 storage
Q:
Regulators require that stored trade records cannot be changed or deleted for seven years. Which Amazon S3 (Simple Storage Service) feature?
Q_ZH:
监管要求存下来的交易记录七年内不能被修改或删除，用哪个 Amazon S3（Simple Storage Service，简单存储服务）功能？
A:
Answer: S3 Object Lock: write-once-read-many retention.
Because: S3 stores a retain-until date in each object version's metadata and refuses to overwrite or delete that version before the date; it needs versioning, and a legal hold protects the same way with no end date.
Exam: WORM (write once, read many), retention period, legal hold → ✅ S3 Object Lock on a versioned bucket; ❌ S3 Lifecycle rules: move or delete by age, never block deletes
A_ZH:
答：S3 Object Lock：WORM（write once, read many，一次写入、多次读取）保留。
因为：S3 把“保留到期日”写进每个对象版本的元数据，到期前拒绝覆盖或删除该版本；它要求开启版本控制，legal hold（法律保留）的保护效果一样，但没有到期日。
考法：WORM、保留期（retention period）、法律保留（legal hold）→ ✅ 开了版本控制的存储桶 + S3 Object Lock；❌ S3 Lifecycle rules：按年龄迁移或删除，从不阻止删除
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html
S3 Object Lock can help prevent Amazon S3 objects from being deleted or overwritten for a fixed or variable amount of time, or indefinitely. Object Lock uses a write-once-read-many (WORM) model to store objects.

## awsb-s3-object-lock-compliance-vs-governance | d1
TOPIC: S3 storage
Q:
Locked records must not be deletable by any user, not even the root user, until their retention ends. Which S3 (Simple Storage Service) Object Lock retention mode?
Q_ZH:
被锁定的记录在保留期结束前，任何用户都不能删除，连 root 用户也不行，用 S3（Simple Storage Service，简单存储服务）Object Lock 的哪种保留模式？
A:
Answer: Compliance mode: nobody can delete early.
Because: AWS rule: in compliance mode no user, root included, can overwrite or delete the version or shorten its retention, while governance mode lets users with the s3:BypassGovernanceRetention permission do so.
Exam: no one, including root, can delete before retention ends → ✅ Object Lock compliance mode; ❌ governance mode: users with bypass permission can still delete
A_ZH:
答：Compliance mode（合规模式）：谁都不能提前删。
因为：AWS 规定，记住即可：合规模式下任何用户（包括 root 用户）都不能覆盖或删除该版本，也不能缩短保留期；governance mode（治理模式）则允许有 s3:BypassGovernanceRetention 权限的用户这么做。
考法：保留期结束前任何人（包括 root）都不能删除（no one, including root, can delete）→ ✅ Object Lock compliance mode；❌ governance mode：有绕过权限的用户仍然能删
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html
In compliance mode, a protected object version can't be overwritten or deleted by any user, including the root user in your AWS account. When an object is locked in compliance mode, its retention mode can't be changed, and its retention period can't be shortened.

## awsb-dt-waf-attach-points | d2
TOPIC: Encryption and threat detection
Q:
A web app sits behind a Network Load Balancer. Why can't you attach an AWS WAF (web application firewall) web ACL (access control list) to that load balancer?
Q_ZH:
一个 Web 应用在 Network Load Balancer 后面，为什么不能把 AWS WAF（web application firewall，Web 应用防火墙）的 web ACL（access control list，访问控制列表）挂到这个负载均衡器上？
A:
Answer: WAF attaches only to services that parse HTTP (Hypertext Transfer Protocol).
Because: AWS WAF reads each HTTP request's headers and body, so it needs a resource that ends the HTTP connection, such as CloudFront or an Application Load Balancer, while a Network Load Balancer just forwards TCP (Transmission Control Protocol) connections.
Exam: WAF for an app behind a Network Load Balancer or Global Accelerator → ✅ add CloudFront or an Application Load Balancer and attach WAF there; ❌ AWS Shield Advanced: DDoS (distributed denial of service) protection, no request filtering
A_ZH:
答：WAF 只能挂在会解析 HTTP（Hypertext Transfer Protocol，超文本传输协议）的服务上。
因为：AWS WAF 要读取每个 HTTP 请求的头部和正文，所以必须挂在终结 HTTP 连接的资源上，比如 CloudFront 或 Application Load Balancer；Network Load Balancer 只是转发 TCP（Transmission Control Protocol，传输控制协议）连接。
考法：给 Network Load Balancer 或 Global Accelerator 后面的应用加 WAF → ✅ 在前面加 CloudFront 或 Application Load Balancer，把 WAF 挂在那里；❌ AWS Shield Advanced：DDoS（distributed denial of service，分布式拒绝服务）防护，不做请求过滤
SOURCE: https://docs.aws.amazon.com/waf/latest/developerguide/what-is-aws-waf.html
AWS WAF is a web application firewall that lets you monitor the HTTP and HTTPS requests that are forwarded to your protected web application resources.

## awsb-rds-aurora-serverless-v2 | d2
TOPIC: Databases
Q:
An app's MySQL-compatible database has spiky, unpredictable load, and the team wants capacity to follow it without choosing instance sizes. Which Aurora option?
Q_ZH:
一个应用用的是兼容 MySQL 的数据库，负载突发且不可预测，团队希望容量自动跟着负载走、不用挑实例规格，选 Aurora 的哪个选项？
A:
Answer: Aurora Serverless v2 (now named Aurora serverless): capacity follows load.
Because: you set a minimum and maximum in ACUs (Aurora capacity units, each about 2 gibibytes of memory plus matching processing power), and Aurora scales each instance within that range in steps as small as 0.5 ACU, so no sizing is needed.
Exam: spiky or unpredictable relational load, little admin → ✅ Aurora Serverless v2; ❌ Amazon DynamoDB: not relational, no SQL (Structured Query Language) joins
A_ZH:
答：Aurora Serverless v2（现名 Aurora serverless）：容量跟着负载走。
因为：你以 ACU（Aurora capacity unit，Aurora 容量单位，每个约含 2 gibibyte 内存加相应的处理能力）为单位设定最小值和最大值，Aurora 在这个范围内以最小 0.5 ACU 的步长伸缩每个实例，所以不用选规格。
考法：突发或不可预测的关系型负载、少运维 → ✅ Aurora Serverless v2；❌ Amazon DynamoDB：不是关系型，没有 SQL（Structured Query Language，结构化查询语言）join
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.html
Aurora serverless is an on-demand, autoscaling configuration for Amazon Aurora. Aurora serverless helps to automate the processes of monitoring the workload and adjusting the capacity for your databases.

## awsb-rds-aurora-serverless-v2-scale-to-zero | d1
TOPIC: Databases
Q:
A development Aurora Serverless v2 database sits idle every night and weekend. Which minimum capacity setting stops its compute charges while idle?
Q_ZH:
一个开发用的 Aurora Serverless v2 数据库每晚和周末都闲着，最小容量设成多少，闲置时就不再付计算费？
A:
Answer: A 0 ACU (Aurora capacity unit) minimum: auto-pause.
Because: AWS rule: at a 0 ACU minimum, an instance idle (no user connections) for a set time pauses and stops instance charges; the next connection resumes it in about 15 seconds, or 30 seconds or more after a day paused.
Exam: idle development or test Aurora database, no compute cost → ✅ Aurora Serverless v2 with a 0 ACU minimum (auto-pause); ❌ Aurora Serverless v1: deprecated, end of life in 2025
A_ZH:
答：最小 0 ACU（Aurora capacity unit，Aurora 容量单位）：自动暂停。
因为：AWS 规定，记住即可：最小值设为 0 ACU 时，实例闲置（没有用户连接）达到设定时间就会暂停，不再收实例费用；下一个连接到来时约 15 秒恢复，暂停超过一天则要 30 秒或更久。
考法：闲置的开发或测试 Aurora 数据库，不付计算费 → ✅ Aurora Serverless v2 设最小 0 ACU（auto-pause）；❌ Aurora Serverless v1：已弃用，2025 年已停止支持
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html
You can specify that Aurora serverless DB instances scale down to zero ACUs and automatically pause, if they don't have any connections initiated by user activity within a specified time period. You do so by specifying a minimum ACU value of zero for your DB cluster.

## awsb-s3-transfer-acceleration | d2
TOPIC: S3 storage
Q:
Users on several continents upload large files to one bucket in a single Region, and the long-distance uploads are slow. Which Amazon S3 (Simple Storage Service) feature speeds them up?
Q_ZH:
好几个大洲的用户把大文件上传到同一个区域的一个存储桶，长距离上传很慢，用哪个 Amazon S3（Simple Storage Service，简单存储服务）功能提速？
A:
Answer: S3 Transfer Acceleration: enter AWS at a nearby edge.
Because: each upload goes to the nearest CloudFront edge location, then travels to the bucket over an optimized AWS network path instead of the long public internet route, so distance hurts much less.
Exam: fast uploads from distant clients into one bucket → ✅ S3 Transfer Acceleration; ❌ Amazon CloudFront distribution: caches content that viewers download; uploads are not cached
A_ZH:
答：S3 Transfer Acceleration：就近从边缘站点进入 AWS。
因为：每次上传先进入最近的 CloudFront 边缘站点，再经 AWS 优化过的网络路径送到存储桶，不走漫长的公网路线，所以距离的影响小得多。
考法：远方客户端快速上传到同一个存储桶（fast uploads from distant clients into one bucket）→ ✅ S3 Transfer Acceleration；❌ Amazon CloudFront 分发：缓存访客下载的内容，上传的数据不会被缓存
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/transfer-acceleration.html
Transfer Acceleration takes advantage of the globally distributed edge locations in Amazon CloudFront. As the data arrives at an edge location, the data is routed to Amazon S3 over an optimized network path.

## awsb-sl-lambda-15-min-timeout | d1
TOPIC: Serverless and containers
Q:
A video-encoding step takes about 2 hours per file in one continuous run. Why can't a Lambda function do it?
Q_ZH:
一个视频转码步骤处理每个文件要连续跑约 2 小时，为什么不能用一个 Lambda 函数来做？
A:
Answer: Lambda ends each invocation at 15 minutes.
Because: AWS limit: one Lambda function invocation runs for at most 900 seconds (15 minutes), then Lambda stops it, however much work is left; even Lambda Managed Instances raise it only to 90 minutes.
Exam: one task longer than 15 minutes → ✅ an Amazon ECS (Elastic Container Service) task on AWS Fargate, or AWS Batch; ❌ a single Lambda function: it times out at 15 minutes
A_ZH:
答：Lambda 每次调用最多 15 分钟。
因为：AWS 规定，记住即可：一次 Lambda 函数调用最长 900 秒（15 分钟），到时间就被终止，不管活干完没有；就算用 Lambda Managed Instances，上限也只放宽到 90 分钟。
考法：单个任务超过 15 分钟 → ✅ 在 AWS Fargate 上跑 Amazon ECS（Elastic Container Service，容器服务）任务，或用 AWS Batch；❌ 单个 Lambda 函数：15 分钟就超时
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html
Code can run for up to 15 minutes in a single invocation (up to 90 minutes for Lambda Managed Instances functions invoked asynchronously or through any event source mapping except Amazon MQ and Amazon DocumentDB) and a single function can use up to 10,240 MB of memory.

## awsb-tr-transfer-family-sftp | d2
TOPIC: Migration and transfer
Q:
Partners must keep sending files with their existing SFTP (Secure File Transfer Protocol) clients, and the files must land in Amazon S3 (Simple Storage Service). Which AWS service?
Q_ZH:
合作方要继续用现有的 SFTP（Secure File Transfer Protocol，安全文件传输协议）客户端发送文件，文件要落到 Amazon S3（Simple Storage Service，简单存储服务）里，用哪个 AWS 服务？
A:
Answer: AWS Transfer Family: a managed SFTP endpoint.
Because: it runs a fully managed SFTP server endpoint for you, so partner clients connect without changes and each uploaded file is written straight into S3 or Amazon EFS (Elastic File System).
Exam: SFTP or FTPS (File Transfer Protocol Secure) into S3 → ✅ AWS Transfer Family; ❌ Amazon S3 File Gateway: NFS (Network File System) or SMB (Server Message Block) shares only; ❌ AWS DataSync: storage-to-storage copies, no partner logins
A_ZH:
答：AWS Transfer Family：托管的 SFTP 终端节点。
因为：它替你运行一个全托管的 SFTP 服务器终端节点，合作方的客户端不用改就能连，上传的每个文件直接写进 S3 或 Amazon EFS（Elastic File System，弹性文件系统）。
考法：通过 SFTP 或 FTPS（File Transfer Protocol Secure，加密的文件传输协议）传进 S3（SFTP or FTPS into S3）→ ✅ AWS Transfer Family；❌ Amazon S3 File Gateway：只提供 NFS（Network File System，网络文件系统）或 SMB（Server Message Block，Windows 文件共享协议）共享；❌ AWS DataSync：存储到存储的复制，不提供合作方登录
SOURCE: https://docs.aws.amazon.com/transfer/latest/userguide/what-is-aws-transfer-family.html
AWS Transfer Family offers fully managed support for the transfer of files over SFTP, AS2, FTPS, FTP, and web browser-based transfers directly into and out of AWS storage services.

## awsb-vpc-sg-vs-nacl | d2
TOPIC: VPC networking
Q:
Attacks come from one known IP (Internet Protocol) address range, and it must be stopped before it reaches any instance in a subnet. Which control can block it?
Q_ZH:
攻击来自一个已知的 IP（Internet Protocol，互联网协议）地址段，必须在它到达某个子网里的任何实例之前就拦下，哪种控制能把它挡掉？
A:
Answer: A network ACL (access control list) deny rule: subnet-wide block.
Because: network ACLs check traffic at the subnet boundary against numbered allow and deny rules in order, so a deny rule for that range stops it for every instance, while security groups hold allow rules only and cannot deny.
Exam: block specific IP addresses for a whole subnet → ✅ network ACL deny rule (stateless: replies need their own allow rule); ❌ security group rule: stateful, but allow rules only, no deny
A_ZH:
答：network ACL（access control list，访问控制列表）的拒绝规则：整个子网一起挡。
因为：网络 ACL 在子网边界按编号顺序检查允许和拒绝规则，所以给这个地址段写一条拒绝规则就能挡住子网里的所有实例；安全组（security group）只有允许规则，不能拒绝。
考法：为整个子网封禁特定 IP 地址（block specific IP addresses）→ ✅ network ACL 拒绝规则（无状态：回包也要单独放行）；❌ security group 规则：有状态，但只能允许，不能拒绝
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html
A network access control list (ACL) allows or denies specific inbound or outbound traffic at the subnet level.

## awsb-cost-budgets | d2
TOPIC: Monitoring, governance and cost
Q:
Once forecast monthly spend passes a fixed $5,000 limit, finance wants an email and new resource creation blocked automatically. Which feature?
Q_ZH:
预测的月支出一旦超过固定的 5,000 美元，财务希望收到邮件，并自动禁止再创建新资源，用哪个功能？
A:
Answer: AWS Budgets with a budget action: alert, then act.
Because: a budget compares actual or forecast spend with your fixed amount and alerts at the threshold, and its budget action then applies an IAM (Identity and Access Management) deny policy or an SCP (service control policy).
Exam: alert or act when spend crosses a fixed amount → ✅ AWS Budgets; ❌ AWS Cost Explorer: charts and forecasts, no alerts or actions; ❌ AWS Cost Anomaly Detection: flags unusual spend, no fixed threshold
A_ZH:
答：带预算操作（budget action）的 AWS Budgets：先告警，再自动执行。
因为：预算把实际或预测支出和你设定的固定金额比较，到阈值就告警，预算操作随即套用 IAM（Identity and Access Management，身份与访问管理）拒绝策略或 SCP（service control policy，服务控制策略）。
考法：支出越过固定金额时告警或自动处理 → ✅ AWS Budgets；❌ AWS Cost Explorer：看图和预测，不告警也不执行操作；❌ AWS Cost Anomaly Detection：标出异常支出，没有固定阈值
SOURCE: https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html
You can use AWS Budgets to run an action on your behalf when a budget exceeds a certain cost or usage threshold. To do this, after you set a threshold, configure a budget action to run either automatically or after your manual approval.

## awsb-cost-optimizer-vs-ta | d2
TOPIC: Monitoring, governance and cost
Q:
You want specific instance type and size recommendations for over-provisioned Amazon EC2 (Elastic Compute Cloud) instances, based on their measured use. Which service?
Q_ZH:
你想根据实测用量，为配置过大的 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例拿到具体的实例类型和大小建议，用哪个服务？
A:
Answer: AWS Compute Optimizer: rightsizing from measured usage.
Because: Compute Optimizer analyzes each resource's configuration and utilization metrics, so it reports whether the resource is over- or under-provisioned and names a better-fitting instance type, or flags it as idle.
Exam: rightsize EC2, Amazon EBS (Elastic Block Store), Lambda or Amazon ECS (Elastic Container Service) from actual usage → ✅ AWS Compute Optimizer; ❌ AWS Trusted Advisor: broad best-practice checks across cost, security and service limits
A_ZH:
答：AWS Compute Optimizer：按实测用量给出规格调整（rightsizing）建议。
因为：Compute Optimizer 分析每个资源的配置和利用率指标，所以能判断它是配大了还是配小了，给出更合适的实例类型，或标记为闲置。
考法：按实际用量给 EC2、Amazon EBS（Elastic Block Store，弹性块存储）、Lambda 或 Amazon ECS（Elastic Container Service，容器服务）调规格 → ✅ AWS Compute Optimizer；❌ AWS Trusted Advisor：覆盖成本、安全、服务限额的通用最佳实践检查
SOURCE: https://docs.aws.amazon.com/compute-optimizer/latest/ug/what-is-compute-optimizer.html
AWS Compute Optimizer is a service that analyzes your AWS resources' configuration and utilization metrics to provide you with rightsizing recommendations and identify idle resources.

## awsb-dt-macie-pii-s3 | d2
TOPIC: Encryption and threat detection
Q:
A company must find out which of its Amazon S3 (Simple Storage Service) buckets hold passport or credit card numbers. Which AWS service?
Q_ZH:
一家公司要查清自己哪些 Amazon S3（Simple Storage Service，简单存储服务）存储桶里存着护照号或信用卡号，用哪个 AWS 服务？
A:
Answer: Amazon Macie: finds sensitive data in Amazon S3.
Because: it samples or scans objects in your buckets and inspects their contents with machine learning and pattern matching, so it reports where PII (personally identifiable information) actually sits.
Exam: discover PII or sensitive data in S3 buckets → ✅ Amazon Macie; ❌ Amazon Inspector: scans compute for CVEs (Common Vulnerabilities and Exposures), not file contents; ❌ Amazon GuardDuty: watches activity logs for threats, does not classify data
A_ZH:
答：Amazon Macie：在 Amazon S3 里找敏感数据。
因为：它从存储桶里抽样或全量取出对象，用机器学习和模式匹配检查内容，所以能报告 PII（personally identifiable information，个人身份信息）实际存在哪里。
考法：发现 S3 存储桶里的 PII 或敏感数据（sensitive data）→ ✅ Amazon Macie；❌ Amazon Inspector：扫描计算资源的 CVE（Common Vulnerabilities and Exposures，公开漏洞编号），不看文件内容；❌ Amazon GuardDuty：盯着活动日志里的威胁，不给数据分类
SOURCE: https://docs.aws.amazon.com/macie/latest/user/what-is-macie.html
Amazon Macie is a data security service that discovers sensitive data by using machine learning and pattern matching, provides visibility into data security risks, and enables automated protection against those risks.

## awsb-iam-identity-center | d2
TOPIC: Identity and accounts
Q:
Employees must sign in once with the corporate identity provider and then reach many AWS accounts. Which service?
Q_ZH:
员工要用公司的身份提供商（identity provider）登录一次，然后进入很多个 AWS 账户，用哪个服务？
A:
Answer: AWS IAM (Identity and Access Management) Identity Center: one sign-in, many accounts.
Because: Identity Center federates once with the corporate identity provider and turns permission sets into IAM roles in each assigned account, so users pick an account and role in one portal, with no per-account IAM users.
Exam: workforce single sign-on to many accounts → ✅ AWS IAM Identity Center; ❌ AWS Managed Microsoft AD (Active Directory): a real directory in AWS, not a sign-in portal by itself
A_ZH:
答：AWS IAM（Identity and Access Management，身份与访问管理）Identity Center：登录一次，进多个账户。
因为：Identity Center 只和公司身份提供商联合一次，再把权限集（permission set）变成每个被分配账户里的 IAM 角色，用户在一个门户里选账户和角色，不用在每个账户里建 IAM 用户。
考法：workforce single sign-on to many accounts → ✅ AWS IAM Identity Center；❌ AWS Managed Microsoft AD（Active Directory，微软目录服务）：在 AWS 里跑的真目录，本身不是登录门户
SOURCE: https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html
By providing one point of federation, IAM Identity Center reduces the administrative effort required to use multiple AWS managed applications and AWS accounts. With IAM Identity Center, you only federate once, and you have only one certificate to manage when using a SAML 2.0 identity provider.

## awsb-iam-identity-center-permission-sets | d2
TOPIC: Identity and accounts
Q:
In IAM (Identity and Access Management) Identity Center you assign a group one permission set for three accounts. Which IAM resource appears in each of those accounts?
Q_ZH:
在 IAM（Identity and Access Management，身份与访问管理）Identity Center 里，你给一个组分配了一个权限集（permission set），覆盖三个账户，这三个账户里各会出现哪种 IAM 资源？
A:
Answer: An Identity Center-managed IAM role: one per account.
Because: a permission set is a template of IAM policies, so assigning it makes Identity Center create a role with those policies in every target account, which users assume by choosing that account in the AWS access portal.
Exam: how Identity Center grants account access → ✅ permission sets become IAM roles in each account; ❌ IAM users created in each account: Identity Center creates none
A_ZH:
答：由 Identity Center 管理的 IAM 角色：每个账户一个。
因为：权限集是一组 IAM 策略的模板，一分配下去，Identity Center 就在每个目标账户里建一个挂着这些策略的角色；用户在 AWS 访问门户里选中这个账户时，扮演的就是它。
考法：Identity Center 怎么授予账户访问 → ✅ 权限集在每个账户里变成 IAM 角色；❌ 在每个账户里建 IAM 用户：Identity Center 一个都不建
SOURCE: https://docs.aws.amazon.com/singlesignon/latest/userguide/permissionsetsconcept.html
When you assign a permission set, IAM Identity Center creates corresponding IAM Identity Center-controlled IAM roles in each account, and attaches the policies specified in the permission set to those roles.

## awsb-sl-lambda-sqs-event-source | d1
TOPIC: Serverless and containers
Q:
Jobs wait in an Amazon SQS (Simple Queue Service) queue, and a Lambda function must work through them with no polling code of your own. Which Lambda feature connects the two?
Q_ZH:
任务排在 Amazon SQS（Simple Queue Service，简单队列服务）队列里，要让一个 Lambda 函数逐个处理，又不想自己写轮询代码，用 Lambda 的哪个功能把两者连起来？
A:
Answer: An event source mapping: Lambda polls the queue for you.
Because: with an SQS event source mapping, Lambda polls the queue, invokes your function with a batch of messages, and deletes them only after the function succeeds, so failed messages reappear after the visibility timeout.
Exam: Lambda processes messages that wait in a queue → ✅ Lambda event source mapping on the SQS queue; ❌ an Amazon SNS (Simple Notification Service) subscription: pushes its own messages, cannot pull from a queue
A_ZH:
答：事件源映射（event source mapping）：Lambda 替你轮询队列。
因为：配置 SQS 事件源映射后，Lambda 自己轮询队列，把一批消息交给函数处理，函数成功后才删除这批消息；失败的消息在可见性超时（visibility timeout）过后会重新出现。
考法：Lambda 处理在队列里排队的消息 → ✅ 在 SQS 队列上配置 Lambda 事件源映射；❌ Amazon SNS（Simple Notification Service，简单通知服务）订阅：只推送发到主题的消息，不能从队列里拉取
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html
With Amazon SQS event source mappings, Lambda polls the queue and invokes your function synchronously with an event. Each event can contain a batch of multiple messages from the queue.

## awsb-vpc-peering | d1
TOPIC: VPC networking
Q:
VPC (virtual private cloud) A already peers with VPC B and with VPC C, and now B must reach C as well. How many more peering connections are needed?
Q_ZH:
VPC（virtual private cloud，虚拟私有云）A 已经分别和 VPC B、VPC C 建了对等连接（peering），现在 B 也要能访问 C，还需要再建几条对等连接？
A:
Answer: One more: a direct B-to-C peering connection.
Because: AWS rule: peering links exactly two VPCs and is non-transitive, so A never forwards traffic between B and C; every pair needs its own connection, with non-overlapping CIDR (Classless Inter-Domain Routing) ranges.
Exam: peering is non-transitive, B must reach C → ✅ a direct B-to-C peering connection; ❌ AWS Transit Gateway: also works, but bills every attachment hourly, costly for three VPCs
A_ZH:
答：再加一条：B 和 C 之间直接建对等连接。
因为：AWS 规定，记住即可：对等连接只连两个 VPC，而且不可传递，A 不会替 B 和 C 转发流量；每一对 VPC 都要有自己的连接，而且双方的 CIDR（Classless Inter-Domain Routing，无类别域间路由）地址范围不能重叠。
考法：对等连接不可传递，B 要访问 C → ✅ 在 B 和 C 之间直接建 peering 连接；❌ AWS Transit Gateway：也能通，但每个挂载按小时收费，三个 VPC 不划算
SOURCE: https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-basics.html
A VPC peering connection is a one to one relationship between two VPCs. You can create multiple VPC peering connections for each VPC that you own, but transitive peering relationships are not supported.

## awsb-vpc-sg-reference-sg | d2
TOPIC: VPC networking
Q:
Only the web servers may connect to the database on port 3306, even as web servers are added and replaced. Which source goes in the database security group's inbound rule?
Q_ZH:
只有 Web 服务器可以连数据库的 3306 端口，而且 Web 服务器会不断增减和替换，数据库安全组的入站规则里，来源（source）填什么？
A:
Answer: The web tier's security group: members, not addresses.
Because: a rule whose source is another security group matches traffic from every instance that group is attached to, so new or replaced web servers get in automatically and nothing else does.
Exam: allow only the tier in front, instances keep changing → ✅ inbound rule with the front tier's security group as source; ❌ a deny rule for all other sources: security groups have allow rules only
A_ZH:
答：Web 层的安全组：认成员，不认地址。
因为：来源是另一个安全组的规则，会匹配挂了那个安全组的所有实例发来的流量，所以新增或替换的 Web 服务器自动能连上，其他任何东西都进不来。
考法：只允许前一层访问、实例经常变化 → ✅ 入站规则的来源填前一层的安全组；❌ 给其他所有来源写拒绝规则：安全组只有允许规则
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html
When you specify a security group as the source or destination for a rule, the rule affects all instances that are associated with the security groups.

## awsb-vpc-three-tier | d2
TOPIC: VPC networking
Q:
A three-tier app has a load balancer, app servers and a database, and only the load balancer may face the internet. Where do the app servers and the database go?
Q_ZH:
一个三层应用有负载均衡器、应用服务器和数据库，只有负载均衡器可以面向互联网，应用服务器和数据库放在哪里？
A:
Answer: Private subnets: no route in from the internet.
Because: private subnets have no route to an internet gateway, so nothing on the internet can reach the app or database tiers, while the internet-facing load balancer in public subnets forwards requests to them over private addresses.
Exam: three-tier, database must not be internet-accessible → ✅ load balancer in public subnets, app and database tiers in private subnets; ❌ database in a public subnet: gives it a direct internet path
A_ZH:
答：私有子网：互联网没有路由进来。
因为：私有子网没有通往互联网网关的路由，互联网上的任何东西都到不了应用层和数据库层；放在公有子网里的面向互联网的负载均衡器用私有地址把请求转发给它们。
考法：三层架构、数据库不能被互联网访问 → ✅ 负载均衡器放公有子网，应用层和数据库层放私有子网；❌ 数据库放公有子网：等于给了它一条直通互联网的路
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-example-private-subnets-nat.html
For additional security, you deploy the servers in private subnets. The servers receive requests through the load balancer.

## awsb-vpc-internet-facing-public-subnets | d1
TOPIC: VPC networking
Q:
An internet-facing Application Load Balancer must receive requests from users on the internet. Which kind of subnet must you place it in?
Q_ZH:
一个面向互联网（internet-facing）的 Application Load Balancer 要接收互联网用户的请求，必须放在哪种子网里？
A:
Answer: Public subnets: they route to an internet gateway.
Because: the load balancer's nodes get public IP (Internet Protocol) addresses, which work only in subnets with a route to an internet gateway, and the nodes reach targets over private addresses, so the targets can stay in private subnets.
Exam: internet-facing load balancer placement → ✅ public subnets, one per enabled Availability Zone; ❌ private subnets plus a NAT (network address translation) gateway: NAT carries outbound traffic only, never inbound requests
A_ZH:
答：公有子网：有通往互联网网关的路由。
因为：负载均衡器的节点会拿到公有 IP（Internet Protocol，互联网协议）地址，只有在有互联网网关路由的子网里才用得上；节点再用私有地址访问目标，所以目标可以留在私有子网。
考法：面向互联网的负载均衡器放哪 → ✅ 公有子网，每个启用的可用区一个；❌ 放私有子网再配 NAT（network address translation，网络地址转换）gateway：NAT 只管出站，从不接入站请求
SOURCE: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-troubleshooting.html
You must specify public subnets for your load balancer. A public subnet has a route to the Internet Gateway for your virtual private cloud (VPC).

## awsb-bf-fsx-lustre-hpc | d2
TOPIC: Block and file storage
Q:
Hundreds of instances training a machine learning model need a high-speed parallel file system over a dataset kept in an Amazon S3 (Simple Storage Service) bucket. Which service?
Q_ZH:
训练机器学习模型的几百台实例，需要在 Amazon S3（Simple Storage Service，简单存储服务）存储桶里的数据集之上用一个高速并行文件系统，用哪个服务？
A:
Answer: Amazon FSx for Lustre: fast file system linked to S3.
Because: when linked to an S3 bucket, FSx for Lustre presents the bucket's objects as files, so every instance reads the dataset through a Lustre file system with sub-millisecond latency instead of fetching objects one by one.
Exam: HPC (high performance computing) or machine learning, fastest file access, S3-linked → ✅ Amazon FSx for Lustre; ❌ Amazon EFS (Elastic File System): general-purpose NFS (Network File System) shares; ❌ Amazon FSx for NetApp ONTAP: multi-protocol enterprise file storage
A_ZH:
答：Amazon FSx for Lustre：与 S3 关联的高速文件系统。
因为：关联 S3 存储桶后，FSx for Lustre 把桶里的对象呈现为文件，所以每台实例都通过亚毫秒延迟的 Lustre 文件系统读取数据集，而不是一个个去取对象。
考法：HPC（high performance computing，高性能计算）或机器学习、最快的文件访问、关联 S3 → ✅ Amazon FSx for Lustre；❌ Amazon EFS（Elastic File System，弹性文件系统）：通用的 NFS（Network File System，网络文件系统）共享；❌ Amazon FSx for NetApp ONTAP：多协议的企业文件存储
SOURCE: https://docs.aws.amazon.com/fsx/latest/LustreGuide/what-is.html
FSx for Lustre integrates with Amazon S3, making it easier for you to process cloud datasets using the Lustre high-performance file system. When linked to an Amazon S3 bucket, an FSx for Lustre file system transparently presents S3 objects as files.

## awsb-cr-customer-managed-key | d3
TOPIC: Encryption and threat detection
Q:
Your security team must write and edit the key policy of the key that encrypts its data. Which type of AWS KMS (Key Management Service) key do you use?
Q_ZH:
安全团队必须自己编写和修改加密数据所用那把密钥的密钥策略（key policy），用哪种 AWS KMS（Key Management Service，密钥管理服务）密钥？
A:
Answer: A customer managed key: you own its policy.
Because: you create and own a customer managed key, so you edit its key policy, rotation and grants, including other accounts, while an AWS managed key's policy is fixed by the service and works only in its own account.
Exam: own key policy, rotation control or cross-account use → ✅ customer managed key; ❌ AWS managed key (aws/service-name): fixed policy, never shared; ❌ imported key material: only needed when you must create the key bytes yourself
A_ZH:
答：客户托管密钥（customer managed key）：策略归你管。
因为：客户托管密钥由你创建、归你所有，所以密钥策略、轮换和授权（grant）都由你改，包括给其他账户访问；AWS 托管密钥的策略由服务定死，只能在它自己的账户里用。
考法：自定义密钥策略、控制轮换或跨账户使用（cross-account use）→ ✅ customer managed key；❌ AWS managed key（aws/服务名）：策略固定，不能共享；❌ 导入密钥材料（imported key material）：只有必须自己生成密钥字节时才需要
SOURCE: https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html
Customer managed keys are KMS keys in your AWS account that you create, own, and manage. You have full control over these KMS keys, including establishing and maintaining their key policies, IAM policies, and grants, enabling and disabling them, rotating their cryptographic material, adding tags, creating aliases that refer to the KMS keys, and scheduling the KMS keys for deletion.

## awsb-cr-share-encrypted-snapshot | d2
TOPIC: Encryption and threat detection
Q:
An encrypted Amazon EBS (Elastic Block Store) snapshot must be shared with a partner's AWS account. Which key must encrypt the snapshot you share?
Q_ZH:
一个加密的 Amazon EBS（Elastic Block Store，弹性块存储）快照要共享给合作方的 AWS 账户，共享出去的快照必须用哪种密钥加密？
A:
Answer: A customer managed key: shareable with that account.
Because: the partner needs permission to decrypt with the key, and only a customer managed key's policy can add another account, so copy the snapshot under that key, then share the snapshot and the key.
Exam: share an encrypted snapshot or AMI (Amazon Machine Image) with another account → ✅ re-encrypt with a customer managed key and share the key; ❌ the default AWS managed key (aws/ebs): its policy cannot add other accounts
A_ZH:
答：客户托管密钥（customer managed key）：能共享给那个账户。
因为：合作方必须获准用这把密钥解密，而只有客户托管密钥的策略能加上别的账户，所以先用这种密钥复制快照，再把快照和密钥一起共享出去。
考法：跨账户共享加密快照或 AMI（Amazon Machine Image，亚马逊机器镜像）→ ✅ 用客户托管密钥重新加密并共享密钥；❌ 默认的 AWS 托管密钥（aws/ebs）：它的策略加不了其他账户
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/ebs-modifying-snapshot-permissions.html
You can't share snapshots that are encrypted with the default AWS managed key. You can only share snapshots that are encrypted with a customer managed key.

## awsb-dr-aws-backup-basics | d1
TOPIC: Backup and disaster recovery
Q:
A company wants one central place to schedule and keep backups of its Amazon EBS (Elastic Block Store) volumes, Amazon RDS (Relational Database Service) databases and DynamoDB tables. Which service?
Q_ZH:
一家公司想在一个集中的地方统一安排和保存 Amazon EBS（Elastic Block Store，弹性块存储）卷、Amazon RDS（Relational Database Service，关系型数据库服务）数据库和 DynamoDB 表的备份，用哪个服务？
A:
Answer: AWS Backup: one backup plan across many services.
Because: you write one backup plan with a schedule and retention and assign resources by tag, then AWS Backup runs it across services and stores backups in vaults, with no per-service scripts.
Exam: centralize and automate backups across AWS services → ✅ AWS Backup; ❌ RDS automated backups: protect only that one database; ❌ DynamoDB point-in-time recovery: one table, at most 35 days
A_ZH:
答：AWS Backup：一个备份计划管多种服务。
因为：你只写一份带时间表和保留期的备份计划，按标签分配资源，AWS Backup 就跨服务执行，并把备份存进备份保管库（backup vault），不用给每个服务写脚本。
考法：跨 AWS 服务集中、自动化备份（centralize and automate backups）→ ✅ AWS Backup；❌ RDS 自动备份：只保护那一个数据库；❌ DynamoDB 时间点恢复（point-in-time recovery）：只管一张表，最多 35 天
SOURCE: https://docs.aws.amazon.com/aws-backup/latest/devguide/whatisbackup.html
Using this service, you can configure backup policies and monitor activity for your AWS resources in one place. It allows you to automate and consolidate backup tasks that were previously performed service-by-service, and removes the need to create custom scripts and manual processes.

## awsb-iam-cross-account-role | d3
TOPIC: Identity and accounts
Q:
A vendor's AWS account must manage resources in your account without you sharing any long-term keys. What do you create?
Q_ZH:
供应商的 AWS 账户要管理你账户里的资源，而你不能共享任何长期密钥，你该建什么？
A:
Answer: An IAM (Identity and Access Management) role trusting their account: they assume it.
Because: the role's trust policy names the vendor's account and its permissions policy says what it may do, so the vendor calls AWS STS (Security Token Service) AssumeRole and gets temporary credentials.
Exam: another account or vendor must act in yours → ✅ a cross-account IAM role, plus an external ID (identifier) for vendors; ❌ an IAM group of their users: holds only your own users, cannot be a principal
A_ZH:
答：一个信任对方账户的 IAM（Identity and Access Management，身份与访问管理）角色：由对方来扮演。
因为：角色的信任策略（trust policy）写明供应商的账户，权限策略写明它能做什么，供应商调用 AWS STS（Security Token Service，安全令牌服务）AssumeRole 拿到临时凭证。
考法：another account or vendor must act in yours → ✅ 跨账户 IAM 角色，第三方再加 external ID（identifier，外部标识符）；❌ 用一个 IAM 组装供应商的用户：组只能装本账户的用户，也不能当 principal
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_common-scenarios_third-party.html
With IAM roles, you can grant these third parties access to your AWS resources without sharing your AWS security credentials. Instead, the third party can access your AWS resources by assuming a role that you create in your AWS account.

## awsb-iam-role-trust-policy | d2
TOPIC: Identity and accounts
Q:
A second AWS account must be allowed to assume an existing role in your account. Which of the role's policies do you edit?
Q_ZH:
要允许另一个 AWS 账户扮演你账户里已有的一个角色，该改这个角色的哪条策略？
A:
Answer: The trust policy: it names who may assume.
Because: the name says it: the trust policy lists whom the role trusts, and AWS checks it when someone calls AssumeRole, while the permissions policy is checked on each later action.
Exam: who may assume the role → ✅ the role's trust policy; ❌ the role's permissions policy: says what the role may do, not who
A_ZH:
答：信任策略（trust policy）：写明谁能扮演。
因为：名字就是答案：信任策略列出这个角色信任谁，有人调用 AssumeRole 时 AWS 查的就是它；之后每个操作查的才是权限策略。
考法：who may assume the role → ✅ 角色的 trust policy；❌ 角色的权限策略（permissions policy）：规定角色能做什么，不规定谁能扮演
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html
The permissions policy grants the user of the role the needed permissions to carry out the intended tasks on the resource. The trust policy specifies which trusted account members are allowed to assume the role.

## awsb-in-sqs-standard-vs-fifo | d2
TOPIC: Messaging and streaming
Q:
Each account's payment instructions must be processed in the exact order they were sent, and never twice. Which AWS messaging option?
Q_ZH:
每个账户的付款指令必须严格按发送顺序处理，而且绝不能处理两次，用哪种 AWS 消息服务方案？
A:
Answer: FIFO (first-in, first-out) queue in Amazon SQS (Simple Queue Service): strict order, no repeats.
Because: the name says it: first in, first out; within each message group messages leave in the order sent, and a repeat with the same deduplication ID (identifier) within 5 minutes is dropped, so each instruction runs once.
Exam: strict ordering and exactly-once processing → ✅ SQS FIFO queue; ❌ SQS standard queue: best-effort order, at-least-once delivery; ❌ Amazon SNS (Simple Notification Service) standard topic: pushes at once, best-effort order
A_ZH:
答：Amazon SQS（Simple Queue Service，简单队列服务）里的 FIFO（first-in, first-out，先进先出）队列：严格有序、不重复。
因为：名字就是答案：先进先出；在每个消息组内，消息按发送顺序出队，5 分钟内带相同去重 ID（identifier，标识符）的重复消息会被丢弃，所以每条指令只执行一次。
考法：严格顺序、恰好一次处理（exactly-once processing）→ ✅ SQS FIFO 队列；❌ SQS 标准队列：只尽力保序，至少投递一次（可能重复）；❌ Amazon SNS（Simple Notification Service，简单通知服务）标准主题：立刻推送，只尽力保序
SOURCE: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.html
FIFO queues deliver each message once and keep it available until you process and delete it. By using features like MessageDeduplicationId or content-based deduplication, you prevent duplicate messages, even when retrying due to network issues or timeouts.

## awsb-nc-dax-read-cache | d2
TOPIC: Databases
Q:
A read-heavy DynamoDB table needs microsecond reads, and the team cannot rewrite its data-access code. Which cache fits?
Q_ZH:
一张读多写少的 DynamoDB 表需要微秒级读取，团队又不能重写数据访问代码，用哪个缓存？
A:
Answer: DAX (DynamoDB Accelerator): a DynamoDB-compatible in-memory cache.
Because: DAX speaks the same API (application programming interface) as DynamoDB, so the app needs only minimal changes, and eventually consistent reads come from memory in microseconds instead of milliseconds; writes still go to the table.
Exam: microsecond reads on DynamoDB, minimal code change → ✅ DAX; ❌ Amazon ElastiCache: a separate cache whose logic the app must write itself
A_ZH:
答：DAX（DynamoDB Accelerator，DynamoDB 加速器）：兼容 DynamoDB 的内存缓存。
因为：DAX 和 DynamoDB 用同一套 API（application programming interface，应用程序接口），所以应用只需极少改动，最终一致读直接从内存返回，从毫秒降到微秒；写入仍然写到表里。
考法：DynamoDB 要微秒级读、几乎不改代码 → ✅ DAX；❌ Amazon ElastiCache：独立的缓存，缓存逻辑要应用自己写
SOURCE: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DAX.html
As an in-memory cache, DAX reduces the response times of eventually consistent read workloads by an order of magnitude from single-digit milliseconds to microseconds. DAX reduces operational and application complexity by providing a managed service that is API-compatible with DynamoDB.

## awsb-session-state-off-instance | d3
TOPIC: Compute and scaling
Q:
Users get logged out whenever Auto Scaling removes the instance that held their session. Where should the session data live?
Q_ZH:
每当 Auto Scaling 移除保存着用户会话的那台实例，用户就会被登出，会话数据应该放在哪里？
A:
Answer: Amazon ElastiCache or DynamoDB: a shared store off the instances.
Because: when session data sits in a shared store instead of one server's memory, any instance can serve any request, so removing or adding instances loses no sessions.
Exam: keep sessions when instances scale in or fail → ✅ session store in Amazon ElastiCache or DynamoDB; ❌ sticky sessions on the load balancer: the session still dies with its instance
A_ZH:
答：Amazon ElastiCache 或 DynamoDB：放在实例之外的共享存储。
因为：会话数据放在共享存储里而不是某台服务器的内存里，任何实例都能处理任何请求，所以增减实例都不会丢会话。
考法：实例缩容或故障时会话不丢（offload session data）→ ✅ 把会话存进 Amazon ElastiCache 或 DynamoDB；❌ 负载均衡器的 sticky sessions（粘性会话）：实例一没，会话照样没
SOURCE: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_stateless.html
Amazon ElastiCache, Amazon DynamoDB, Amazon Elastic File System (Amazon EFS), and Amazon MemoryDB are examples of AWS services that you can use to offload session data.

## awsb-cr-sse-kms-vs-sse-s3 | d2
TOPIC: Encryption and threat detection
Q:
Auditors want a record of every use of the key that protects objects in an Amazon S3 (Simple Storage Service) bucket. Which SSE (server-side encryption) option?
Q_ZH:
审计人员要求记录保护某个 Amazon S3（Simple Storage Service，简单存储服务）存储桶对象的那把密钥的每一次使用，选哪种 SSE（server-side encryption，服务器端加密）？
A:
Answer: SSE-KMS (server-side encryption with keys in AWS Key Management Service): auditable, policy-controlled key.
Because: S3 gets its data keys from AWS KMS, so key use shows up in CloudTrail and obeys the key policy you write, while SSE-S3 uses keys that S3 manages internally, which you cannot restrict or audit.
Exam: audit key use, own key policy or customer managed key for S3 → ✅ SSE-KMS; ❌ SSE-S3: free and the default, but no key policy or key-use logs
A_ZH:
答：SSE-KMS（server-side encryption with keys in AWS Key Management Service，用 KMS 密钥的服务器端加密）：可审计、可用策略控制。
因为：S3 的数据密钥从 AWS KMS 取得，所以密钥的使用会记录在 CloudTrail 里，并受你写的密钥策略约束；SSE-S3 用的是 S3 内部管理的密钥，你既限制不了也审计不了。
考法：审计密钥使用、自定义密钥策略或要用客户托管密钥的 S3 → ✅ SSE-KMS；❌ SSE-S3：免费且是默认，但没有密钥策略，也没有密钥使用日志
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/serv-side-encryption.html
With AWS KMS, you have more control over your keys. For example, you can view separate keys, edit control policies, and follow the keys in AWS CloudTrail.

## awsb-dns-failover | d3
TOPIC: Edge and DNS
Q:
A second Region runs a scaled-down but working copy of the app and must get users only when the primary fails its health check. Which Route 53 routing policy?
Q_ZH:
第二个区域（Region）里跑着一份缩小规模但能正常工作的应用副本，只有当主站点健康检查失败时才接收用户流量，用哪种 Route 53 路由策略？
A:
Answer: Failover routing: the secondary answers only after the primary fails.
Because: Route 53 answers with the primary record while its health check passes and switches to the secondary record once it fails, so the standby gets users only during an outage and must already be able to serve them.
Exam: active-passive, standby gets users only when the primary's health check fails → ✅ Route 53 failover routing; ❌ weighted routing: always splits users between both, even with a healthy primary
A_ZH:
答：Failover routing（故障转移路由）：主站点失败后才由备用站点应答。
因为：主记录的健康检查通过时，Route 53 用主记录应答；一旦失败就换成备用记录，所以备用站点只在故障期间接收用户，而且它必须当时就能顶上。
考法：主备模式（active-passive），主站点健康检查失败时备用站点才接用户 → ✅ Route 53 failover routing；❌ weighted routing（加权路由）：主站点健康时也一直分一部分用户给备用站点
SOURCE: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover-types.html
When the primary resource is healthy, Route 53 responds to DNS queries using the primary record. When the primary resource is unhealthy, Route 53 responds to DNS queries using the secondary record.

## awsb-dns-geolocation-vs-latency | d2
TOPIC: Edge and DNS
Q:
Users in each country must get the site version made for that country, decided by where they are. Which Route 53 routing policy?
Q_ZH:
每个国家的用户都要访问为本国定制的网站版本，按用户所在地决定，用哪种 Route 53 路由策略？
A:
Answer: Geolocation routing: answers by the user's location.
Because: the name says it: Route 53 maps the query's source IP (Internet Protocol) address to a continent or country and returns the record made for that place, so the choice follows borders, not measured speed.
Exam: route by user country or continent for localized content or distribution rights → ✅ geolocation routing; ❌ latency-based routing: picks the fastest Region, ignores borders
A_ZH:
答：Geolocation routing（地理位置路由）：按用户所在地应答。
因为：名字就是答案：Route 53 把查询来源的 IP（Internet Protocol，互联网协议）地址对应到大洲或国家，返回为那个地方设的记录，所以选择依据是国界，而不是测出来的网速。
考法：按用户所在国家或大洲路由，用于本地化内容或发行版权（distribution rights）→ ✅ geolocation routing；❌ latency-based routing（延迟路由）：选最快的区域（Region），不管国界
SOURCE: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-geo.html
With geolocation routing, you can choose the resources that serve your traffic based on where your users are located, meaning the location that DNS queries come from.

## awsb-ec2-ami-vs-user-data | d2
TOPIC: Compute and scaling
Q:
New instances in an Auto Scaling group spend 20 minutes installing software at boot, so adding instances under load is too slow. Which change fixes it?
Q_ZH:
一个 Auto Scaling group 里新起的实例启动时要花 20 分钟装软件，负载上来时加实例太慢，改哪里能解决？
A:
Answer: A custom AMI (Amazon Machine Image): software baked in.
Because: an AMI already holds the operating system and installed software, so instances launched from it are ready once booted, while a user data script reruns the install on each new instance's first boot.
Exam: slow scale-out because of long installs at boot → ✅ a custom AMI (golden image) in the launch template; ❌ user data script: reruns the full install on each new instance
A_ZH:
答：自定义 AMI（Amazon Machine Image，亚马逊机器镜像）：软件预先装进镜像。
因为：AMI 里已经包含操作系统和装好的软件，从它启动的实例一开机就能用；user data（用户数据）脚本则会在每台新实例第一次启动时把整套安装重做一遍。
考法：启动时安装太久、扩容慢（slow boot, long installs）→ ✅ 在启动模板里用自定义 AMI（golden image，黄金镜像）；❌ user data 脚本：每台新实例都重装一遍
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html
An Amazon Machine Image (AMI) is an image that provides the software that is required to set up and boot an Amazon EC2 instance.

## awsb-ed-global-accelerator-endpoints | d2
TOPIC: Edge and DNS
Q:
A team wants AWS Global Accelerator to send users straight to an Amazon S3 (Simple Storage Service) bucket. Why can't the bucket be its endpoint?
Q_ZH:
一个团队想让 AWS Global Accelerator 把用户直接送到一个 Amazon S3（Simple Storage Service，简单存储服务）存储桶，为什么这个存储桶不能做它的终端节点？
A:
Answer: A bucket is not a Global Accelerator endpoint type.
Because: AWS rule: a standard accelerator sends traffic only to Application Load Balancers, Network Load Balancers, EC2 (Elastic Compute Cloud) instances or Elastic IP (Internet Protocol) addresses in one or more Regions, so a bucket or a CloudFront distribution is not allowed.
Exam: Global Accelerator endpoint types → ✅ an Application or Network Load Balancer, EC2 instance or Elastic IP address per Region; ❌ an S3 bucket or CloudFront distribution: not an endpoint type, serve S3 content through CloudFront
A_ZH:
答：存储桶不是 Global Accelerator 支持的终端节点类型。
因为：AWS 规定，记住即可：标准加速器只能把流量发给一个或多个区域（Region）里的 Application Load Balancer、Network Load Balancer、EC2（Elastic Compute Cloud，弹性计算云）实例或 Elastic IP（Internet Protocol，互联网协议）地址，存储桶和 CloudFront 分配都不行。
考法：Global Accelerator 终端节点类型 → ✅ 每个区域里的 Application 或 Network Load Balancer、EC2 实例或 Elastic IP 地址；❌ S3 存储桶或 CloudFront 分配：不是可用的终端节点类型，S3 内容应通过 CloudFront 分发
SOURCE: https://docs.aws.amazon.com/global-accelerator/latest/dg/about-endpoints.html
Endpoints for standard accelerators in AWS Global Accelerator can be Network Load Balancers, Application Load Balancers, Amazon EC2 instances, or Elastic IP addresses.

## awsb-iam-lambda-roles | d2
TOPIC: Serverless and containers
Q:
A Lambda function's own code must read items from an Amazon DynamoDB table and decrypt data with AWS KMS (Key Management Service). Where do you grant these permissions?
Q_ZH:
一个 Lambda 函数自己的代码要读取 Amazon DynamoDB 表里的数据，还要用 AWS KMS（Key Management Service，密钥管理服务）解密数据，这些权限授予在哪里？
A:
Answer: The function's execution role: what the function may call.
Because: Lambda assumes the execution role, an IAM (Identity and Access Management) role that trusts lambda.amazonaws.com, every time the function runs, so the code's AWS calls carry that role's temporary credentials and no keys are stored.
Exam: what the function itself may call (DynamoDB, kms:Decrypt) → ✅ Lambda execution role; ❌ the function's resource-based policy: decides who may invoke the function
A_ZH:
答：函数的执行角色（execution role）：管函数能调用什么。
因为：函数每次运行时，Lambda 都会代入执行角色，这是一个信任 lambda.amazonaws.com 的 IAM（Identity and Access Management，身份与访问管理）角色，所以代码发出的 AWS 调用带的是这个角色的临时凭证，不用存任何密钥。
考法：函数自己能调用什么（DynamoDB、kms:Decrypt）→ ✅ Lambda 执行角色；❌ 函数的基于资源的策略（resource-based policy）：决定谁可以调用（invoke）这个函数
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html
A Lambda Event Function's execution role is an AWS Identity and Access Management (IAM) role that grants the function permission to access AWS services and resources.

## awsb-in-eventbridge-rules | d2
TOPIC: Messaging and streaming
Q:
Events from a SaaS (software as a service) partner app such as Zendesk must go to different targets depending on fields inside each event. Which AWS service routes them?
Q_ZH:
来自 Zendesk 这类 SaaS（software as a service，软件即服务）合作伙伴应用的事件，要根据事件里的字段分别送到不同的目标，用哪个 AWS 服务来路由？
A:
Answer: An Amazon EventBridge rule: match the pattern, route to targets.
Because: partner events arrive on an EventBridge event bus, where each rule checks every event against its pattern of JSON (JavaScript Object Notation) fields and values and sends matches to up to five targets, so routing takes no code.
Exam: route events by their content, including SaaS partner events → ✅ Amazon EventBridge rule; ❌ Amazon SNS (Simple Notification Service): cannot take events from SaaS partners such as Zendesk
A_ZH:
答：Amazon EventBridge 规则（rule）：按模式匹配，再路由到目标。
因为：合作伙伴的事件进入 EventBridge 事件总线（event bus），每条规则拿自己的事件模式去比对每个事件，模式写的是 JSON（JavaScript Object Notation，一种数据格式）里的字段和取值；匹配的事件发给最多五个目标，路由不用写代码。
考法：按内容路由事件，包括 SaaS 合作伙伴的事件 → ✅ Amazon EventBridge 规则；❌ Amazon SNS（Simple Notification Service，简单通知服务）：接不了 Zendesk 这类 SaaS 合作伙伴的事件
SOURCE: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html
An event source, which can be an AWS service, your own custom application, or a SaaS provider, sends an event to an event bus. EventBridge then evaluates the event against each rule defined for that event bus.

## awsb-org-scp-deny-on-ou | d3
TOPIC: Identity and accounts
Q:
Every account in the organization's Europe business unit must be blocked from using Regions outside Europe, even by account administrators. Which control?
Q_ZH:
组织里欧洲业务部门的所有账户都必须禁止使用欧洲以外的区域（Region），账户管理员也不例外，用什么控制？
A:
Answer: An SCP (service control policy) Deny with aws:RequestedRegion: caps even admins.
Because: an SCP caps every IAM (Identity and Access Management) user and role in member accounts, root user included, so its Deny on aws:RequestedRegion still blocks them even with AdministratorAccess attached.
Exam: stop even account administrators from using other Regions → ✅ an SCP Deny with aws:RequestedRegion; ❌ IAM policies in each account: local admins can edit or remove them; ❌ AWS Service Catalog: offers approved products, blocks nothing else
A_ZH:
答：带 aws:RequestedRegion 的 SCP（service control policy，服务控制策略）Deny：连管理员也拦得住。
因为：SCP 给成员账户里每个 IAM（Identity and Access Management，身份与访问管理）用户和角色设上限，root 用户也不例外，所以就算挂了 AdministratorAccess，基于 aws:RequestedRegion 的 Deny 照样拦得住他们。
考法：连账户管理员也不许用其他区域 → ✅ 带 aws:RequestedRegion 的 SCP Deny；❌ 每个账户各写 IAM 策略：本地管理员能改也能删；❌ AWS Service Catalog：只提供批准过的产品，拦不住别的
SOURCE: https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html
If a permission is blocked at any level above the account, either implicitly (by not being included in an Allow policy statement) or explicitly (by being included in a Deny policy statement), a user or role in the affected account can't use that permission, even if the account administrator attaches the AdministratorAccess IAM policy with */* permissions to the user.

## awsb-org-ou-structure | d2
TOPIC: Identity and accounts
Q:
Twenty of your organization's sixty accounts need the same SCP (service control policy), and accounts added to that group later must get it automatically. Where do you attach it?
Q_ZH:
组织里六十个账户中有二十个需要同一条 SCP（service control policy，服务控制策略），以后加进这一组的账户也要自动带上，该挂在哪里？
A:
Answer: To an OU (organizational unit) holding them: inheritance.
Because: a policy attached to an OU is inherited by every account and child OU under it, so an account created in or moved into that OU is covered at once, with no per-account step.
Exam: same policy for a group of accounts, including future ones → ✅ attach it to their OU; ❌ attaching it to each account: new accounts get missed; ❌ AWS Service Catalog: offers approved products, applies no SCPs
A_ZH:
答：挂到包含它们的 OU（organizational unit，组织单元）上：靠继承。
因为：挂在 OU 上的策略会被它下面所有账户和子 OU 继承，新建到或移进这个 OU 的账户立刻生效，不用逐个账户操作。
考法：一组账户（包括以后新加的）要同一条策略 → ✅ 挂到它们的 OU；❌ 逐个账户挂：新账户会漏掉；❌ AWS Service Catalog：只提供批准过的产品，不下发 SCP
SOURCE: https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_ous.html
For example, you can attach a policy-based control to an OU, and all accounts within the OU automatically inherit the policy.

## awsb-elb-scale-on-sqs-backlog | d2
TOPIC: Compute and scaling
Q:
Worker instances in an Auto Scaling group pull jobs from an Amazon SQS (Simple Queue Service) queue whose length swings widely. Which metric should the target tracking policy follow?
Q_ZH:
一个 Auto Scaling group 里的工作实例从 Amazon SQS（Simple Queue Service，简单队列服务）队列里拉任务，队列长度起伏很大，目标跟踪策略应该跟踪哪个指标？
A:
Answer: Backlog per instance: queue length divided by running instances.
Because: dividing visible messages by in-service instances shows how much work waits per worker, so the policy adds instances in proportion to the backlog, while raw queue length ignores how many workers exist.
Exam: scale queue workers on waiting work → ✅ target tracking on backlog per instance; ❌ raw queue length: ignores instance count, overshoots; ❌ Amazon SNS (Simple Notification Service) instead of the queue: pushes messages, no backlog to measure
A_ZH:
答：每实例积压量（backlog per instance）：队列长度除以运行中的实例数。
因为：用可见消息数除以在服务中的实例数，就能看出每个工作实例要处理多少积压，策略就按积压的比例加实例；只看队列总长度则忽略了已经有多少工作实例。
考法：按等待中的工作量给队列的工作实例扩容（scale on queue backlog）→ ✅ 对 backlog per instance 做 target tracking；❌ 队列总长度：不考虑实例数，容易扩过头；❌ 用 Amazon SNS（Simple Notification Service，简单通知服务）代替队列：消息直接推送，没有积压可量
SOURCE: https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-using-sqs-queue.html
To scale your Auto Scaling group in proportion to the work waiting in your queue, use a backlog per instance metric. Set the target value to the acceptable backlog per instance that you want to maintain.

## awsb-nc-dynamodb-capacity-modes | d2
TOPIC: Databases
Q:
A DynamoDB table's traffic is steady and easy to forecast hour by hour, and the team wants the cheapest throughput. Which capacity mode?
Q_ZH:
一张 DynamoDB 表的流量平稳、每小时都很好预测，团队想要最便宜的吞吐费用，选哪种容量模式？
A:
Answer: Provisioned capacity with auto scaling: capacity set near use.
Because: the name says it: Provisioned means you set reads and writes per second and pay by the hour, so with steady traffic auto scaling keeps that capacity close to real use, with little waste.
Exam: steady, predictable traffic, lowest cost → ✅ provisioned capacity with auto scaling; ❌ on-demand: per-request billing, best for unknown or spiky traffic; ❌ Standard-IA (Standard-Infrequent Access) table class: cheaper storage, pricier reads and writes
A_ZH:
答：预置容量（provisioned）加自动扩缩：容量贴着用量设。
因为：名字就是答案：Provisioned 就是你自己设定每秒读写量、按小时付费，流量平稳时自动扩缩能让容量紧贴实际用量，浪费很少。
考法：流量平稳可预测、成本最低 → ✅ provisioned capacity 加 auto scaling；❌ on-demand（按需）：按请求计费，适合未知或突发流量；❌ Standard-IA（Standard-Infrequent Access，标准-低频访问）表类：存储便宜，读写更贵
SOURCE: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/CostOptimization_TableCapacityMode.html
Since the traffic volumes within a given hour or day are more stable, you can set the provisioned capacity of the table relatively close to the actual consumed capacity of the table.

## awsb-s3-ia-retrieval-fee | d2
TOPIC: S3 storage
Q:
Short-lived files are read many times a day and deleted after one week. Which Amazon S3 (Simple Storage Service) storage class costs least?
Q_ZH:
一批短期文件每天要读很多次，一周后就删除，哪个 Amazon S3（Simple Storage Service，简单存储服务）存储类最便宜？
A:
Answer: S3 Standard: no retrieval fee, no minimums.
Because: Standard has no retrieval fee and no minimum days or size, while Standard-IA (Infrequent Access) charges per GB read and bills each object for at least 30 days and 128 KB, so frequent reads and early deletes cost more there.
Exam: frequently read or short-lived data → ✅ S3 Standard; ❌ S3 Standard-IA: per-GB retrieval fee and a 30-day minimum
A_ZH:
答：S3 Standard：没有取回费，也没有最低计费。
因为：Standard 没有取回费，也没有最短存储时间和最小计费对象大小；Standard-IA（Infrequent Access，低频访问）每读 1 GB 都要收取回费，而且每个对象至少按 30 天、128 KB 计费，所以读得勤、删得早就更贵。
考法：经常读取或存放时间短的数据（frequently read or short-lived data）→ ✅ S3 Standard；❌ S3 Standard-IA：按 GB 收取回费，还有 30 天最低计费
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html
S3 Standard-IA and S3 One Zone-IA objects are available for millisecond access (similar to the S3 Standard storage class). Amazon S3 charges a retrieval fee for these objects, so they are most suitable for infrequently accessed data.

## awsb-s3-replication | d2
TOPIC: S3 storage
Q:
Every new object in a bucket must be copied automatically to a bucket in another Region for disaster recovery. Which Amazon S3 (Simple Storage Service) feature?
Q_ZH:
一个存储桶里的每个新对象都必须自动复制到另一个区域（Region）的存储桶，用于灾难恢复，用哪个 Amazon S3（Simple Storage Service，简单存储服务）功能？
A:
Answer: S3 Cross-Region Replication: asynchronous copies of new objects.
Because: live replication copies each new or updated object to the other bucket in the background; it requires versioning on both buckets and skips objects that existed before setup, which need S3 Batch Replication.
Exam: automatic copies of new objects to another Region → ✅ S3 Cross-Region Replication with versioning on both buckets; ❌ S3 Lifecycle rules: change storage class or delete, never copy
A_ZH:
答：S3 Cross-Region Replication（跨区域复制）：异步复制新对象。
因为：live replication（实时复制）会在后台把每个新写入或更新的对象复制到另一个存储桶；它要求两个存储桶都开启版本控制，并且不复制设置前就已存在的对象，那些要用 S3 Batch Replication。
考法：新对象自动复制到另一个区域（automatic copies of new objects to another Region）→ ✅ S3 Cross-Region Replication（两个存储桶都开版本控制）；❌ S3 Lifecycle rules：只改存储类或删除，从不复制
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html
Live replication – To automatically replicate new and updated objects as they are written to the source bucket, use live replication. Live replication doesn't replicate any objects that existed in the bucket before you set up replication.

## awsb-vpc-session-manager | d2
TOPIC: Compute and scaling
Q:
Admins need shell access to instances in private subnets with no inbound ports open and no SSH (Secure Shell) keys to manage. Which tool?
Q_ZH:
管理员要登录私有子网里实例的命令行，但不能开任何入站端口，也不想管理 SSH（Secure Shell，安全外壳协议）密钥，用哪个工具？
A:
Answer: AWS Systems Manager Session Manager: no open ports.
Because: the Systems Manager agent on the instance keeps an outbound connection to AWS, so admins open sessions through it with IAM (Identity and Access Management) permissions, which can be logged, needing no inbound port, key or extra server.
Exam: shell access with no inbound ports or SSH keys → ✅ Systems Manager Session Manager; ❌ bastion host: a public instance with port 22 open and keys to manage
A_ZH:
答：AWS Systems Manager Session Manager：不用开端口。
因为：实例上的 Systems Manager 代理主动向外连到 AWS，管理员凭 IAM（Identity and Access Management，身份与访问管理）权限通过它开会话，会话可以记录日志，不需要入站端口、密钥或额外的服务器。
考法：不开入站端口、不用 SSH 密钥的命令行访问（no inbound ports, no SSH keys）→ ✅ Systems Manager Session Manager；❌ 堡垒机（bastion host）：放在公有子网，要开 22 端口还要管密钥
SOURCE: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html
Session Manager provides secure node management without the need to open inbound ports, maintain bastion hosts, or manage SSH keys.

## awsb-bf-io2-vs-gp3 | d2
TOPIC: Block and file storage
Q:
A critical database needs 150,000 sustained IOPS (input/output operations per second) on a single Amazon EBS (Elastic Block Store) volume. Which volume type?
Q_ZH:
一个关键数据库要在单个 Amazon EBS（Elastic Block Store，弹性块存储）卷上持续获得 150,000 IOPS（input/output operations per second，每秒读写次数），用哪种卷类型？
A:
Answer: io2 Block Express SSD (solid state drive): up to 256,000 IOPS.
Because: AWS limit: one gp3 volume tops out at 80,000 IOPS (older exam material says 16,000), while one io2 Block Express volume can be provisioned up to 256,000 IOPS with sub-millisecond latency.
Exam: sustained IOPS beyond gp3's ceiling for a critical database (exam material: above 16,000) → ✅ io2 Block Express Provisioned IOPS SSD; ❌ gp3: at most 80,000 IOPS per volume (exam material: 16,000)
A_ZH:
答：io2 Block Express SSD（solid state drive，固态硬盘）：最高 256,000 IOPS。
因为：AWS 规定，记住即可：一个 gp3 卷最多 80,000 IOPS（旧考试资料写 16,000），而一个 io2 Block Express 卷最多可预置 256,000 IOPS，延迟低于 1 毫秒。
考法：关键数据库需要超过 gp3 上限的持续 IOPS（考试资料：超过 16,000）→ ✅ io2 Block Express 预置 IOPS SSD（Provisioned IOPS SSD）；❌ gp3：每卷最多 80,000 IOPS（考试资料：16,000）
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/provisioned-iops.html
io2 Block Express volumes are suited for workloads that benefit from a single volume that provides consistent sub-millisecond latency, and supports higher IOPS and throughput than gp3 volumes.

## awsb-cr-client-side | d2
TOPIC: Encryption and threat detection
Q:
Files stored in Amazon S3 (Simple Storage Service) must stay unreadable even to AWS. Which encryption approach?
Q_ZH:
存放在 Amazon S3（Simple Storage Service，简单存储服务）里的文件必须连 AWS 都看不懂，用哪种加密方式？
A:
Answer: Client-side encryption: encrypt before upload.
Because: the app encrypts each file with its own key before sending it, so S3 only ever stores ciphertext, while with every SSE (server-side encryption) option S3 itself decrypts using a key AWS holds or receives.
Exam: data unreadable even to AWS → ✅ client-side encryption, such as the Amazon S3 Encryption Client; ❌ server-side options like SSE-S3: S3 decrypts with keys AWS holds
A_ZH:
答：客户端加密（client-side encryption）：上传前先加密。
因为：应用在发送前就用自己的密钥把每个文件加密，所以 S3 存下的永远只是密文；而任何 SSE（server-side encryption，服务器端加密）方式都是 S3 自己用 AWS 保管或收到的密钥来解密数据。
考法：数据连 AWS 都不能读（unreadable even to AWS）→ ✅ 客户端加密，例如 Amazon S3 Encryption Client；❌ SSE-S3 之类的服务器端加密：S3 用 AWS 保管的密钥解密
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingClientSideEncryption.html
When your objects are encrypted in this manner, your objects aren't exposed to any third party, including AWS. Amazon S3 receives your objects already encrypted; Amazon S3 does not play a role in encrypting or decrypting your objects.

## awsb-cr-kms-key-policy-primary | d2
TOPIC: Encryption and threat detection
Q:
An IAM (Identity and Access Management) policy grants a role kms:Decrypt on an AWS KMS (Key Management Service) key whose key policy names only the key creator. Why are the role's calls still denied?
Q_ZH:
一条 IAM（Identity and Access Management，身份与访问管理）策略给某个角色授予了对一把 AWS KMS（Key Management Service，密钥管理服务）密钥的 kms:Decrypt，但这把密钥的密钥策略里只写了创建者，为什么这个角色的调用仍被拒绝？
A:
Answer: The key policy does not enable IAM policies.
Because: AWS rule: every KMS key has exactly one key policy, and IAM policies take effect only when that key policy lets the account delegate access through IAM, which the default key policy does.
Exam: IAM allows the key but access is denied → ✅ add the account-delegation statement, or the role itself, to the key policy; ❌ adding more IAM permissions: they stay ineffective without the key policy
A_ZH:
答：密钥策略没有启用 IAM 策略。
因为：AWS 规定，记住即可：每把 KMS 密钥都有且只有一份密钥策略，只有这份策略允许账户通过 IAM 委派访问时，IAM 策略才生效；默认密钥策略就带这一条。
考法：IAM 已允许但访问仍被拒（access denied）→ ✅ 在密钥策略里加上账户委派语句，或直接写入这个角色；❌ 再加 IAM 权限：密钥策略不放行，加多少都无效
SOURCE: https://docs.aws.amazon.com/kms/latest/developerguide/key-policies.html
Unless the key policy explicitly allows it, you cannot use IAM policies to allow access to a KMS key. Without permission from the key policy, IAM policies that allow permissions have no effect.

## awsb-cr-kms-vs-secrets-manager | d2
TOPIC: Encryption and threat detection
Q:
An app must fetch a third-party API (application programming interface) key at runtime instead of keeping it in its code. Which AWS service stores it?
Q_ZH:
一个应用要在运行时取用第三方 API（application programming interface，应用程序接口）密钥，而不是写在代码里，用哪个 AWS 服务来存它？
A:
Answer: AWS Secrets Manager: stores and returns secrets.
Because: AWS recommends Secrets Manager for API keys: it stores each secret encrypted under an AWS KMS (Key Management Service) key and returns it to the app at runtime, so KMS only protects the secret.
Exam: store credentials or API keys and fetch them at runtime → ✅ AWS Secrets Manager; ❌ AWS KMS: holds encryption keys and encrypts data, does not store your secrets
A_ZH:
答：AWS Secrets Manager：存储并返回机密。
因为：AWS 推荐用 Secrets Manager 存 API 密钥：它用一把 AWS KMS（Key Management Service，密钥管理服务）密钥把每个机密（secret）加密保存，并在运行时返回给应用，所以 KMS 只负责保护机密。
考法：存储凭证或 API 密钥并在运行时取用（store credentials, retrieve at runtime）→ ✅ AWS Secrets Manager；❌ AWS KMS：保管加密密钥、加密数据，不替你存机密
SOURCE: https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html
If you manage credentials such as usernames, passwords, or any other secrets, we recommend using AWS Secrets Manager. Secrets Manager is purpose-built for managing secrets such as database credentials, API keys, and supported third-party software-vended secrets.

## awsb-ct-ecs-vs-eks | d2
TOPIC: Serverless and containers
Q:
A company already runs its apps on Kubernetes in its own data center and wants to move them to AWS with the least change to its manifests and tools. Which service?
Q_ZH:
一家公司已经在自己的机房里用 Kubernetes 跑应用，想以对清单文件（manifest）和工具改动最少的方式搬到 AWS，用哪个服务？
A:
Answer: Amazon EKS (Elastic Kubernetes Service): managed Kubernetes.
Because: EKS runs an AWS-managed Kubernetes control plane, so the existing manifests, kubectl and Kubernetes tools keep working, while Amazon ECS (Elastic Container Service) is the simpler AWS-native orchestrator with its own task definitions.
Exam: existing Kubernetes, Kubernetes APIs (application programming interfaces) or tooling, least change → ✅ Amazon EKS; ❌ Amazon ECS: AWS's own orchestrator, manifests must be rewritten; ❌ rewriting the apps for Lambda: a rewrite, not least change
A_ZH:
答：Amazon EKS（Elastic Kubernetes Service，托管 Kubernetes 服务）：托管的 Kubernetes。
因为：EKS 运行由 AWS 托管的 Kubernetes 控制平面，现有的清单文件、kubectl 和 Kubernetes 工具照常可用；而 Amazon ECS（Elastic Container Service，容器服务）是 AWS 自家更简单的编排服务，用的是自己的任务定义（task definition）。
考法：已有 Kubernetes、需要 Kubernetes API（application programming interface，应用程序接口）或工具、改动最少（least change）→ ✅ Amazon EKS；❌ Amazon ECS：AWS 自家的编排服务，清单文件要重写；❌ 把应用改写成 Lambda：这是重写，不是最少改动
SOURCE: https://docs.aws.amazon.com/decision-guides/latest/containers-on-aws-how-to-choose/choosing-aws-container-service.html
Amazon EKS is a managed Kubernetes service with which you can deploy, manage, and scale containerized applications using Kubernetes. It provides a highly available and secure Kubernetes control plane.

## awsb-dns-multivalue | d2
TOPIC: Edge and DNS
Q:
A small app runs on four web servers with no load balancer, and DNS (Domain Name System) answers must leave out any server that is down. Which Route 53 routing policy?
Q_ZH:
一个小应用跑在 4 台 Web 服务器上，没有负载均衡器，DNS（Domain Name System，域名系统）应答必须剔除宕机的服务器，用哪种 Route 53 路由策略？
A:
Answer: Multivalue answer routing: only healthy addresses come back.
Because: each server gets its own multivalue record linked to a health check, and Route 53 returns up to eight records whose checks pass, so a failed server's address drops out of the answers.
Exam: several IP (Internet Protocol) addresses in DNS, health-checked, no load balancer → ✅ multivalue answer routing; ❌ simple routing: returns every value, never health checked
A_ZH:
答：Multivalue answer routing（多值应答路由）：只返回健康的地址。
因为：每台服务器有自己的一条多值记录并关联一个健康检查，Route 53 最多返回 8 条健康检查通过的记录，所以宕机服务器的地址就从应答里消失了。
考法：DNS 返回多个 IP（Internet Protocol，互联网协议）地址、带健康检查、没有负载均衡器 → ✅ multivalue answer routing；❌ simple routing（简单路由）：所有值原样返回，从不做健康检查
SOURCE: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-multivalue.html
You can specify multiple values for almost any record, but with multivalue answer routing, you can also check the health of each resource. Route 53 then returns only values for healthy resources.

## awsb-iam-groups | d1
TOPIC: Identity and accounts
Q:
Ten developers need the same permissions, and new hires must get them just by joining the team. Where do you attach the policy?
Q_ZH:
十个开发人员需要同样的权限，新员工只要加入团队就该自动拿到，策略该挂在哪？
A:
Answer: An IAM (Identity and Access Management) group: members inherit its policies.
Because: a policy attached to a group applies to every IAM user in it, so adding or removing a user changes their permissions with no per-user edits; a group holds only users of its own account.
Exam: same permissions for many IAM users → ✅ an IAM group; ❌ a policy on each IAM user: each new hire needs manual edits; ❌ adding roles or groups to the group: groups hold only users
A_ZH:
答：IAM（Identity and Access Management，身份与访问管理）用户组：成员继承它的策略。
因为：挂在组上的策略作用于组里每个 IAM 用户，加人或减人就改了权限，不用逐个用户改；组里只能放本账户的用户。
考法：same permissions for many IAM users → ✅ IAM 用户组；❌ 给每个 IAM 用户单独挂策略：每来一个新人都要手动改；❌ 往组里放角色或别的组：组里只能放用户
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_groups.html
You can attach an identity-based policy to a user group so that all of the users in the user group receive the policy's permissions.

## awsb-org-ram-resource-sharing | d2
TOPIC: Identity and accounts
Q:
A central networking account owns a VPC (virtual private cloud), and other accounts in the organization must launch instances into its subnets. Which service shares the subnets?
Q_ZH:
一个中心网络账户拥有一个 VPC（virtual private cloud，虚拟私有云），组织里的其他账户要把实例启动到它的子网里，用哪个服务来共享子网？
A:
Answer: AWS RAM (Resource Access Manager): share the subnets.
Because: RAM shares the subnet resource itself, so participant accounts launch their own resources into it while the owner keeps managing the VPC, its route tables and its gateways.
Exam: let other accounts use one central subnet → ✅ AWS RAM (VPC sharing); ❌ VPC peering: links two separate VPCs, shares no subnets; ❌ IAM (Identity and Access Management) Access Analyzer: finds shared resources, shares nothing
A_ZH:
答：AWS RAM（Resource Access Manager，资源访问管理器）：共享子网。
因为：RAM 共享的是子网这个资源本身，参与账户把自己的资源启动进去，VPC、路由表和网关仍由拥有者管理。
考法：其他账户共用一个中心子网 → ✅ AWS RAM（VPC sharing）；❌ VPC 对等连接（VPC peering）：连通两个独立的 VPC，不共享子网；❌ IAM（Identity and Access Management，身份与访问管理）Access Analyzer：只找出被共享的资源，自己不共享
SOURCE: https://docs.aws.amazon.com/ram/latest/userguide/what-is.html
If you have multiple AWS accounts, you can create a resource once and use AWS RAM to make that resource usable by those other accounts.

## awsb-sl-cold-start | d3
TOPIC: Serverless and containers
Q:
The Lambda function behind a checkout API (application programming interface) must answer with steady low latency, even for the first requests after a quiet night. Which Lambda setting?
Q_ZH:
结账 API（application programming interface，应用程序接口）背后的 Lambda 函数必须稳定地低延迟响应，哪怕是安静一夜后的头几个请求也不例外，用 Lambda 的哪个设置？
A:
Answer: Provisioned concurrency: environments initialized in advance.
Because: the name says it: provisioned concurrency sets up a chosen number of execution environments ahead of time, with code downloaded and init code already run, so no request waits for a cold start.
Exam: consistent low latency, no cold starts → ✅ Lambda provisioned concurrency; ❌ reserved concurrency: reserves and caps capacity, pre-warms nothing
A_ZH:
答：预置并发（provisioned concurrency）：执行环境提前初始化好。
因为：名字就是答案：provisioned 就是预先准备好；预置并发提前建好指定数量的执行环境，代码已下载、初始化代码已跑完，所以没有请求需要等冷启动（cold start）。
考法：延迟稳定、不要冷启动 → ✅ Lambda 预置并发；❌ 预留并发（reserved concurrency）：只保留并封顶并发数，不预热任何环境
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/provisioned-concurrency.html
Provisioned concurrency – This is the number of pre-initialized execution environments allocated to your Event Function. These execution environments are ready to respond immediately to incoming function requests.

## awsb-sl-lambda-cold-start | d2
TOPIC: Serverless and containers
Q:
A Lambda function usually answers in 20 ms, but the first request after an idle hour takes over a second. Which Lambda effect causes the slow request?
Q_ZH:
一个 Lambda 函数平时 20 毫秒就能响应，但闲置一小时后的第一个请求要一秒多，是 Lambda 的哪种现象导致这个请求变慢？
A:
Answer: A cold start: a new environment is set up first.
Because: with no environment ready, Lambda must first download the code, start a new execution environment and run the init code outside the handler, so that one request waits; later requests reuse the warm environment.
Exam: occasional slow first request after idle time → ✅ cold start; ❌ throttling: rejects requests over the concurrency limit, does not slow them
A_ZH:
答：冷启动（cold start）：要先搭一个新的执行环境。
因为：没有现成的环境时，Lambda 得先下载代码、启动新的执行环境、运行处理函数（handler）之外的初始化代码，所以这一个请求要等；后面的请求复用已经热好的环境。
考法：闲置后偶尔第一个请求很慢 → ✅ 冷启动；❌ 限流（throttling）：拒绝超出并发上限的请求，而不是让它变慢
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html
When Lambda receives a request to run a function through the Lambda API, the service first prepares an execution environment. During this initialization phase, the service downloads your code, starts the environment, and runs any initialization code outside of the main handler.

## awsb-vpc-interface-endpoint-privatelink | d2
TOPIC: VPC networking
Q:
Servers in your data center reach a VPC (virtual private cloud) over AWS Direct Connect and must use Amazon S3 (Simple Storage Service) privately through that VPC. Which VPC endpoint type?
Q_ZH:
你机房里的服务器通过 AWS Direct Connect 连到一个 VPC（virtual private cloud，虚拟私有云），需要经由这个 VPC 私密地访问 Amazon S3（Simple Storage Service，简单存储服务），用哪种 VPC 终端节点？
A:
Answer: An interface VPC endpoint: private IP (Internet Protocol) addresses in your subnets.
Because: an interface endpoint is a network interface with private addresses in your subnets, so traffic arriving over Direct Connect or VPN (virtual private network) can reach it; a gateway endpoint is a route-table entry that works only inside the VPC.
Exam: reach S3 from on premises over Direct Connect or VPN → ✅ interface VPC endpoint (AWS PrivateLink); ❌ gateway VPC endpoint: free, but unusable from on premises
A_ZH:
答：接口型 VPC 终端节点（interface VPC endpoint）：子网里的私有 IP（Internet Protocol，互联网协议）地址。
因为：接口型终端节点是你子网里一块带私有地址的网卡，所以经 Direct Connect 或 VPN（virtual private network，虚拟专用网络）进来的流量能访问它；网关型终端节点只是路由表里的一条记录，只在 VPC 内部有效。
考法：本地机房经 Direct Connect 或 VPN 访问 S3 → ✅ interface VPC endpoint（AWS PrivateLink）；❌ gateway VPC endpoint：免费，但本地机房用不了
SOURCE: https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html
However, gateway endpoints do not allow access from on-premises networks, from peered VPCs in other AWS Regions, or through a transit gateway. For those scenarios, you must use an interface endpoint, which is available for an additional cost.

## awsb-an-lake-formation | d3
TOPIC: Analytics and ML
Q:
Hundreds of tables in an Amazon S3 (Simple Storage Service) data lake need column-level permissions for many teams, granted with the least effort. Which approach?
Q_ZH:
一个 Amazon S3（Simple Storage Service，简单存储服务）数据湖里有几百张表，要给很多团队授予列级权限，而且要最省事，用哪种做法？
A:
Answer: AWS Lake Formation tag-based access control: grant by tag.
Because: you attach Lake Formation tags to databases, tables or columns, which pass them down, and grant each team a tag value, so a few grants cover every matching resource instead of one grant per team per table.
Exam: fine-grained data lake permissions at scale, least overhead → ✅ Lake Formation tag-based access control; ❌ named-resource grants: one per team per table; ❌ IAM (Identity and Access Management) policies on S3 paths: no column or row control
A_ZH:
答：AWS Lake Formation 基于标签的访问控制（tag-based access control）：按标签授权。
因为：你把 Lake Formation 标签挂到数据库、表或列上（会向下继承），再给每个团队授予某个标签值，所以几次授权就覆盖所有匹配的资源，不必每个团队每张表各授一次。
考法：大规模、细粒度、运维最少的数据湖权限 → ✅ Lake Formation tag-based access control；❌ 按具名资源授权（named-resource grants）：每个团队每张表授一次；❌ 针对 S3 路径的 IAM（Identity and Access Management，身份与访问管理）策略：做不到列或行级控制
SOURCE: https://docs.aws.amazon.com/lake-formation/latest/dg/tag-based-access-control.html
LF-TBAC is the recommended method to use to grant Lake Formation permissions when there is a large number of Data Catalog objects including federated catalogs, databases, tables, and views.

## awsb-an-quicksight-bi | d2
TOPIC: Analytics and ML
Q:
Business users want interactive dashboards and charts over data in Amazon Athena and Amazon Redshift, with no servers to manage. Which service?
Q_ZH:
业务人员想基于 Amazon Athena 和 Amazon Redshift 里的数据做交互式仪表板和图表，而且不用管理服务器，用哪个服务？
A:
Answer: Amazon Quick Sight (formerly QuickSight): BI (business intelligence) dashboards.
Because: Quick Sight connects to data sources such as Athena and Redshift and turns their query results into interactive dashboards people can share or embed, with no infrastructure to provision.
Exam: BI dashboards for business users (older questions say Amazon QuickSight) → ✅ Amazon Quick Sight; ❌ Amazon OpenSearch Service: search and log analytics, not business reporting
A_ZH:
答：Amazon Quick Sight（原 QuickSight）：BI（business intelligence，商业智能）仪表板。
因为：Quick Sight 连接 Athena、Redshift 等数据源，把查询结果做成可分享、可嵌入的交互式仪表板，不用准备任何基础设施。
考法：给业务人员的 BI 仪表板（旧题写 Amazon QuickSight）→ ✅ Amazon Quick Sight；❌ Amazon OpenSearch Service：搜索和日志分析，不做业务报表
SOURCE: https://docs.aws.amazon.com/quicksight/latest/user/welcome.html
Amazon Quick Sight – Interactive data visualization and business intelligence. Connect to data sources, build dashboards, and embed analytics in applications.

## awsb-bf-fsx-nas-migration | d2
TOPIC: Block and file storage
Q:
An on-premises storage system serves the same data over NFS (Network File System), SMB (Server Message Block) and iSCSI (Internet Small Computer Systems Interface), and must move to AWS without application changes. Which service?
Q_ZH:
机房里一套存储系统通过 NFS（Network File System，网络文件系统）、SMB（Server Message Block，Windows 文件共享协议）和 iSCSI（Internet Small Computer Systems Interface，网络块存储协议）提供同一份数据，要在不改应用的前提下搬到 AWS，用哪个服务？
A:
Answer: Amazon FSx for NetApp ONTAP: one file system, all three protocols.
Because: it runs NetApp's own ONTAP file system, so NFS, SMB and iSCSI access, snapshots and NetApp tools such as SnapMirror replication keep working after the move.
Exam: NetApp, or NFS, SMB and iSCSI from one file system → ✅ Amazon FSx for NetApp ONTAP; ❌ Amazon FSx for OpenZFS: NFS only, for ZFS (Zettabyte File System) or Linux servers; ❌ Amazon FSx for Lustre: HPC (high performance computing) file system
A_ZH:
答：Amazon FSx for NetApp ONTAP：一个文件系统，三种协议都支持。
因为：它运行的就是 NetApp 自己的 ONTAP 文件系统，所以迁移后 NFS、SMB、iSCSI 访问、快照以及 SnapMirror 复制等 NetApp 工具照常可用。
考法：NetApp，或一个文件系统同时提供 NFS、SMB 和 iSCSI → ✅ Amazon FSx for NetApp ONTAP；❌ Amazon FSx for OpenZFS：只支持 NFS，给 ZFS（Zettabyte File System，ZFS 文件系统）或 Linux 服务器用；❌ Amazon FSx for Lustre：HPC（high performance computing，高性能计算）文件系统
SOURCE: https://docs.aws.amazon.com/fsx/latest/ONTAPGuide/what-is-fsx-ontap.html
For customers who use NetApp ONTAP on-premises, FSx for ONTAP is an ideal solution to migrate, back up, or burst your file-based applications from on-premises to AWS without the need to change your application code or how you manage your data.

## awsb-cr-cloudhsm-vs-kms | d2
TOPIC: Encryption and threat detection
Q:
Compliance requires single-tenant HSMs (hardware security modules) where only your own staff manage the users and keys. Which AWS service?
Q_ZH:
合规要求使用单租户的 HSM（hardware security module，硬件安全模块），用户和密钥只能由你自己的员工管理，用哪个 AWS 服务？
A:
Answer: AWS CloudHSM: your own dedicated HSM cluster.
Because: CloudHSM gives you HSMs no other customer shares, so only your own staff create and see the users and keys, while AWS KMS (Key Management Service) keeps keys in AWS-run HSMs that you use only through its API (application programming interface).
Exam: single-tenant HSM under your exclusive control → ✅ AWS CloudHSM; ❌ AWS KMS: keys stay in AWS-run HSMs not dedicated to you, though also FIPS (Federal Information Processing Standards) 140-3 Level 3
A_ZH:
答：AWS CloudHSM：你专属的 HSM 集群。
因为：CloudHSM 给你的 HSM 不和其他客户共用，所以用户和密钥只有你自己的员工能创建和看到；而 AWS KMS（Key Management Service，密钥管理服务）把密钥放在 AWS 运营的 HSM 里，你只能通过它的 API（application programming interface，应用程序接口）使用。
考法：单租户、完全由你控制的 HSM（single-tenant HSM）→ ✅ AWS CloudHSM；❌ AWS KMS：密钥留在 AWS 运营、不归你独占的 HSM 里，虽然也通过了 FIPS（Federal Information Processing Standards，美国联邦信息处理标准）140-3 Level 3 验证
SOURCE: https://docs.aws.amazon.com/cloudhsm/latest/userguide/introduction.html
We offer HSMs that are standards-compliant, single-tenant, and are either FIPS 140-2 level-3 or FIPS 140-3 level-3 validated for clusters in FIPS mode.

## awsb-dr-aws-backup-cross-region-copy | d2
TOPIC: Backup and disaster recovery
Q:
Every scheduled backup must also be stored in a second AWS Region for disaster recovery. Which AWS Backup setting does it?
Q_ZH:
每一次计划备份都必须在另一个 AWS 区域（Region）再存一份，用于灾难恢复，用 AWS Backup 的哪个设置？
A:
Answer: Copy to destination in the backup rule: automatic cross-Region copy.
Because: each time the rule finishes a backup, AWS Backup copies that recovery point into a vault in the Region or account you name, so a Regional outage still leaves a usable copy elsewhere.
Exam: copy every backup to another Region or account → ✅ copy action (Copy to destination) in an AWS Backup plan rule; ❌ Amazon S3 (Simple Storage Service) Cross-Region Replication: copies S3 objects only, not volume or database backups
A_ZH:
答：备份规则里的 Copy to destination：自动复制到其他区域。
因为：规则每完成一次备份，AWS Backup 就把这个恢复点复制到你指定的区域或账号里的保管库，所以一个区域整体出故障时，别处还有可用的副本。
考法：每个备份都复制到另一个区域或账号（cross-Region copy）→ ✅ AWS Backup 计划规则里的复制动作（Copy to destination）；❌ Amazon S3（Simple Storage Service，简单存储服务）Cross-Region Replication（跨区域复制）：只复制 S3 对象，不管卷和数据库的备份
SOURCE: https://docs.aws.amazon.com/aws-backup/latest/devguide/cross-region-backup.html
Using AWS Backup, you can copy backups to multiple AWS Regions on demand or automatically as part of a scheduled backup plan. Cross-Region replication is particularly valuable if you have business continuity or compliance requirements to store backups a minimum distance away from your production data.

## awsb-elb-asg-regional | d1
TOPIC: Compute and scaling
Q:
An app must run in two AWS Regions and fail over between them. Why can't one load balancer and one Auto Scaling group cover both Regions?
Q_ZH:
一个应用要跑在两个 AWS 区域（Region）里，并能在两者之间故障切换，为什么不能用一个负载均衡器加一个 Auto Scaling group 覆盖两个区域？
A:
Answer: Both are Regional: each stays inside one Region.
Because: AWS rule: a load balancer and an Auto Scaling group spread only across the Availability Zones of one Region, so each Region needs its own pair and a global service must steer traffic between them.
Exam: spread or fail over traffic across Regions → ✅ Amazon Route 53 or AWS Global Accelerator in front of one load balancer per Region; ❌ a single load balancer spanning Regions: it stays in one Region
A_ZH:
答：两者都是区域级的：各自只在一个区域里。
因为：AWS 规定，记住即可：负载均衡器和 Auto Scaling group 只能跨同一区域内的可用区，所以每个区域都要各配一套，再用全局服务在区域之间分配流量。
考法：跨区域分流或故障切换（multi-Region failover）→ ✅ 每个区域一个负载均衡器，前面放 Amazon Route 53 或 AWS Global Accelerator；❌ 用一个负载均衡器跨区域：它出不了所在的区域
SOURCE: https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html
Amazon EC2 Auto Scaling scales deployment of EC2 instance across Availability Zones within an AWS Region, providing resiliency within that Region.

## awsb-elb-gateway-load-balancer | d2
TOPIC: Compute and scaling
Q:
All traffic entering a VPC (virtual private cloud) must pass transparently through a scalable fleet of third-party firewall appliances. Which load balancer?
Q_ZH:
进入一个 VPC（virtual private cloud，虚拟私有云）的所有流量都必须透明地经过一组可扩展的第三方防火墙设备，用哪种负载均衡器？
A:
Answer: Gateway Load Balancer: a transparent hop through appliances.
Because: the name says it: it acts as a network gateway, so its endpoint becomes the next hop in route tables and every packet passes through an appliance and back, while the fleet scales behind it.
Exam: insert third-party firewalls or inspection appliances into the traffic path → ✅ Gateway Load Balancer; ❌ Network Load Balancer: spreads connections to app servers, cannot sit inline as a next hop
A_ZH:
答：Gateway Load Balancer：让流量透明地穿过安全设备。
因为：名字就是答案：它就是一个网络网关，它的 Gateway Load Balancer 终端节点被设成路由表里的下一跳，每个数据包都先经过一台设备再回来，背后的设备组可以随流量扩展。
考法：把第三方防火墙或检测设备插进流量路径（third-party virtual appliances, inline inspection）→ ✅ Gateway Load Balancer；❌ Network Load Balancer：把连接分给应用服务器，不能作为下一跳串在路径里
SOURCE: https://docs.aws.amazon.com/elasticloadbalancing/latest/gateway/introduction.html
Gateway Load Balancers enable you to deploy, scale, and manage virtual appliances, such as firewalls, intrusion detection and prevention systems, and deep packet inspection systems. It combines a transparent network gateway (that is, a single entry and exit point for all traffic) and distributes traffic while scaling your virtual appliances with the demand.

## awsb-ml-comprehend | d2
TOPIC: Analytics and ML
Q:
Thousands of customer reviews must be labeled positive, negative or neutral automatically, without training a model. Which service?
Q_ZH:
成千上万条客户评论要自动标成正面、负面或中性，而且不训练模型，用哪个服务？
A:
Answer: Amazon Comprehend: pre-trained text analysis.
Because: Comprehend applies NLP (natural language processing) models that AWS already trained on large amounts of text, so one API (application programming interface) call returns a document's sentiment, entities, key phrases or PII (personally identifiable information).
Exam: sentiment, entities or PII in ordinary text → ✅ Amazon Comprehend; ❌ Amazon Comprehend Medical: clinical text such as conditions and medications; ❌ Amazon Rekognition: analyzes images and video, not text
A_ZH:
答：Amazon Comprehend：预训练好的文本分析。
因为：Comprehend 用 AWS 已在海量文本上训练好的 NLP（natural language processing，自然语言处理）模型，一次 API（application programming interface，应用程序接口）调用就返回文档的情感、实体、关键短语或 PII（personally identifiable information，个人身份信息）。
考法：普通文本里的情感、实体或 PII → ✅ Amazon Comprehend；❌ Amazon Comprehend Medical：病历等临床文本里的病症、药物；❌ Amazon Rekognition：分析图片和视频，不分析文本
SOURCE: https://docs.aws.amazon.com/comprehend/latest/dg/what-is.html
Amazon Comprehend uses natural language processing (NLP) to extract insights about the content of documents. It develops insights by recognizing the entities, key phrases, language, sentiments, and other common elements in a document.

## awsb-nc-redis-vs-memcached | d2
TOPIC: Databases
Q:
A web app keeps user sessions in a node-based ElastiCache cluster, and they must survive the loss of one cache node. Which engine?
Q_ZH:
一个 Web 应用把用户会话放在一个基于节点（node-based）的 ElastiCache 集群里，坏掉一个缓存节点时会话也不能丢，选哪个引擎？
A:
Answer: ElastiCache for Valkey or Redis OSS (open source software): replicated nodes.
Because: Valkey and Redis OSS can keep up to 5 read-only replicas of each primary node and fail over to one, so a lost node leaves the sessions on a replica, while node-based Memcached clusters have no replication.
Exam: replication, failover or sorted sets → ✅ Valkey or Redis OSS; ❌ node-based Memcached: simple multithreaded cache, no replication; ❌ ALB (Application Load Balancer) sticky sessions: one server holds the session and loses it if it fails
A_ZH:
答：ElastiCache for Valkey 或 Redis OSS（open source software，开源版）：节点有副本。
因为：Valkey 和 Redis OSS 可以给每个主节点配最多 5 个只读副本，并能故障切换到副本，所以坏掉一个节点，会话仍在副本里；基于节点的 Memcached 集群没有复制。
考法：复制、故障切换或有序集合（sorted sets）→ ✅ Valkey 或 Redis OSS；❌ 基于节点的 Memcached：简单的多线程缓存，没有复制；❌ ALB（Application Load Balancer，应用负载均衡器）粘性会话：会话只在一台服务器上，它一坏会话就没了
SOURCE: https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Replication.html
However, if you're running a Valkey or Redis OSS engine, you can group 2 to 6 nodes into a cluster with replicas where 1 to 5 read-only nodes contain replicate data of the group's single read/write primary node. In this scenario, if one node fails for any reason, you do not lose all your data since it is replicated in one or more other nodes.

## awsb-rds-cross-region-dr | d2
TOPIC: Databases
Q:
An Amazon RDS (Relational Database Service) database needs disaster recovery in a second AWS Region with only minutes of data loss and a fast switch. Which feature?
Q_ZH:
一个 Amazon RDS（Relational Database Service，关系型数据库服务）数据库要在第二个 AWS 区域（Region）做灾难恢复，只允许丢几分钟数据，还要切换得快，用哪个功能？
A:
Answer: A cross-Region read replica: promote it in the other Region.
Because: the replica receives changes asynchronously all the time, so promoting it loses only the latest writes and takes little time, but you pay for a running instance in the second Region.
Exam: disaster recovery in another Region with an RPO (recovery point objective) of minutes → ✅ cross-Region read replica; ❌ cross-Region snapshot copy: cheapest, but hours of data loss and restore time
A_ZH:
答：跨区域只读副本（cross-Region read replica）：在另一个区域提升它。
因为：副本一直在异步接收变更，所以提升它只会丢最新的一点写入，而且很快；代价是要为第二个区域里一直运行的实例付费。
考法：另一个区域做灾难恢复、RPO（recovery point objective，恢复点目标）为分钟级 → ✅ 跨区域只读副本；❌ 跨区域复制快照：最便宜，但会丢几小时数据，恢复也要几小时
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.XRgn.html
With Amazon RDS, you can create a read replica in a different AWS Region from the source DB instance.

## awsb-st-managed-flink | d2
TOPIC: Messaging and streaming
Q:
Sensor readings flowing through a Kinesis data stream must be averaged per minute in real time with SQL (Structured Query Language) queries. Which service?
Q_ZH:
流经 Kinesis 数据流的传感器读数要用 SQL（Structured Query Language，结构化查询语言）查询实时地按分钟求平均值，用哪个服务？
A:
Answer: Amazon Managed Service for Apache Flink: real-time stream analytics.
Because: it runs your Flink or SQL code continuously on AWS-managed compute, processing each record on arrival, so per-minute averages update in real time; it was renamed from Kinesis Data Analytics, whose SQL-only applications are discontinued.
Exam: real-time transforms or aggregations on a stream → ✅ Amazon Managed Service for Apache Flink (formerly Kinesis Data Analytics); ❌ Amazon Data Firehose: buffers and delivers data, runs no stream queries
A_ZH:
答：Amazon Managed Service for Apache Flink：实时流分析。
因为：它在 AWS 托管的计算资源上持续运行你的 Flink 或 SQL 代码，每条记录一到就处理，所以每分钟的平均值实时更新；它由 Kinesis Data Analytics 改名而来，旧的纯 SQL 应用（Kinesis Data Analytics for SQL）已停止服务。
考法：对流数据做实时转换或聚合 → ✅ Amazon Managed Service for Apache Flink（原 Kinesis Data Analytics）；❌ Amazon Data Firehose：只缓冲和投递数据，不运行流查询
SOURCE: https://docs.aws.amazon.com/managed-flink/latest/java/what-is.html
With Amazon Managed Service for Apache Flink, you can use Java, Scala, Python, or SQL to process and analyze streaming data. The service enables you to author and run code against streaming sources and static sources to perform time-series analytics, feed real-time dashboards, and metrics.

## awsb-tr-dms-sct-heterogeneous | d2
TOPIC: Migration and transfer
Q:
An Oracle database is moving to Aurora PostgreSQL, so its tables and stored procedures must first be rewritten for the new engine. Which AWS tool does this?
Q_ZH:
一个 Oracle 数据库要迁到 Aurora PostgreSQL，表和存储过程得先按新引擎改写，用哪个 AWS 工具来做？
A:
Answer: AWS DMS (Database Migration Service) Schema Conversion: rewrites the schema.
Because: it reads the source metadata and converts tables and stored procedures into the target engine's format, but it moves no data, so AWS DMS then copies the rows.
Exam: heterogeneous migration, different database engines → ✅ DMS Schema Conversion or the AWS Schema Conversion Tool, then AWS DMS for the data; ❌ AWS DMS alone: moves data, does not rewrite code
A_ZH:
答：AWS DMS（Database Migration Service，数据库迁移服务）Schema Conversion：改写数据库结构。
因为：它读取源库的元数据，把表和存储过程转换成目标引擎的格式，但它不搬数据，所以之后由 AWS DMS 复制数据行。
考法：异构迁移、换数据库引擎（heterogeneous migration, different database engines）→ ✅ DMS Schema Conversion 或 AWS Schema Conversion Tool，再用 AWS DMS 搬数据；❌ 只用 AWS DMS：只搬数据，不改写代码
SOURCE: https://docs.aws.amazon.com/dms/latest/userguide/CHAP_SchemaConversion.html
DMS Schema Conversion is a feature of AWS Database Migration Service (AWS DMS) that converts your source database schemas to a format compatible with your target database on Aurora, Amazon RDS, or Amazon Redshift.

## awsb-tr-volume-gateway | d2
TOPIC: Migration and transfer
Q:
On-premises servers need iSCSI (Internet Small Computer Systems Interface) block volumes that keep the entire dataset local for low latency, with backups in AWS. Which Volume Gateway mode?
Q_ZH:
机房服务器需要 iSCSI（Internet Small Computer Systems Interface，基于网络的块存储协议）块存储卷，要把整个数据集留在本地保证低延迟，同时在 AWS 里有备份，用 Volume Gateway 的哪种模式？
A:
Answer: Stored volumes: the full copy stays on premises.
Because: the name says it: stored volumes store the whole dataset locally and back up snapshots to Amazon S3 (Simple Storage Service) asynchronously, so every read is local, while cached volumes keep data in S3 and cache only hot data locally.
Exam: entire dataset local with low latency, asynchronous backup to AWS → ✅ Volume Gateway stored volumes; ❌ cached volumes: only frequently used data stays local; ❌ Amazon S3 File Gateway: file shares, not block volumes
A_ZH:
答：Stored volumes（存储卷）：完整数据留在本地。
因为：名字就是答案：stored volumes（存储卷）把整个数据集存在本地，再异步把快照备份到 Amazon S3（Simple Storage Service，简单存储服务），所以每次读取都在本地；cached volumes（缓存卷）则把数据放在 S3，本地只缓存常用部分。
考法：整个数据集放本地、低延迟、异步备份到 AWS（entire dataset local, asynchronous backup to AWS）→ ✅ Volume Gateway stored volumes；❌ cached volumes：本地只留常用数据；❌ Amazon S3 File Gateway：提供文件共享，不是块存储卷
SOURCE: https://docs.aws.amazon.com/storagegateway/latest/vgw/WhatIsStorageGateway.html
Stored volumes – If you need low-latency access to your entire dataset, first configure your on-premises gateway to store all your data locally. Then asynchronously back up point-in-time snapshots of this data to Amazon S3.

## awsb-bf-instance-store | d1
TOPIC: Block and file storage
Q:
An app keeps a cache on an Amazon EC2 (Elastic Compute Cloud) instance store volume. Why is the cache gone after the instance is stopped and started?
Q_ZH:
一个应用把缓存放在 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例存储卷上，为什么实例停止再启动后缓存没了？
A:
Answer: Instance store data does not survive a stop.
Because: instance store disks are physically attached to the host computer, and when the instance stops every block is cryptographically erased, so only a reboot keeps the data.
Exam: temporary or cache data needing the fastest local I/O (input/output) → ✅ instance store on local NVMe (Non-Volatile Memory Express) disks; ❌ Amazon EBS (Elastic Block Store): survives stops, but network-attached and slower
A_ZH:
答：实例存储（instance store）的数据撑不过一次停止。
因为：实例存储是物理连在宿主机上的磁盘，实例一停止，每个块都会被加密擦除，只有重启（reboot）才会保留数据。
考法：需要最快本地 I/O（input/output，输入输出）的临时或缓存数据 → ✅ 本地 NVMe（Non-Volatile Memory Express，高速固态接口）磁盘上的实例存储；❌ Amazon EBS（Elastic Block Store，弹性块存储）：停止后数据还在，但走网络、比本地盘慢
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-store-lifetime.html
However, the data does not persist if the instance is stopped, hibernated, or terminated. When the instance is stopped, hibernated, or terminated, every block of the instance store volume is cryptographically erased.

## awsb-cost-allocation-tags | d1
TOPIC: Monitoring, governance and cost
Q:
Resources carry the tag Project=Alpha, yet Cost Explorer cannot group costs by that tag. Why not?
Q_ZH:
资源都带着 Project=Alpha 标签，可 Cost Explorer 就是不能按这个标签给费用分组，为什么？
A:
Answer: The tag is not activated as a cost allocation tag.
Because: AWS rule: a tag key shows up in Cost Explorer and cost reports only after it is activated in the Billing console, and in an organization only the management account can activate it.
Exam: group or filter costs by tag → ✅ activate it as a cost allocation tag in the management account; ❌ AWS Budgets: tracks spend against amounts, does not activate tags
A_ZH:
答：这个标签还没有激活为成本分配标签（cost allocation tag）。
因为：AWS 规定，记住即可：标签键只有在账单控制台里激活后，才会出现在 Cost Explorer 和费用报告里；在组织里只有管理账户能激活。
考法：按标签分组或筛选费用 → ✅ 在管理账户里把它激活为 cost allocation tag；❌ AWS Budgets：按金额跟踪支出，不负责激活标签
SOURCE: https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html
You must activate both types of tags separately before they can appear in Cost Explorer or on a cost allocation report.

## awsb-cr-acm-public-vs-private | d2
TOPIC: Encryption and threat detection
Q:
A public website on an Application Load Balancer needs an HTTPS (Hypertext Transfer Protocol Secure) certificate that every browser trusts. Which certificate do you use?
Q_ZH:
一个放在 Application Load Balancer 上的公开网站需要一张所有浏览器都信任的 HTTPS（Hypertext Transfer Protocol Secure，安全超文本传输协议）证书，用哪种证书？
A:
Answer: An ACM (AWS Certificate Manager) public certificate: free, browser-trusted.
Because: ACM public certificates chain to Amazon root CAs (certificate authorities) that browsers already trust and cost nothing on integrated services, while a private CA certificate is trusted only by machines you configure to trust that CA.
Exam: public HTTPS on a load balancer or CloudFront → ✅ ACM public certificate; ❌ AWS Private CA certificate: browsers do not trust it, and it costs money
A_ZH:
答：ACM（AWS Certificate Manager，证书管理服务）公有证书：免费、浏览器信任。
因为：ACM 公有证书链到浏览器早已信任的 Amazon 根 CA（certificate authority，证书颁发机构），用在集成服务上不收费；私有 CA 证书只有被你配置成信任该 CA 的机器才认。
考法：负载均衡器或 CloudFront 上的公网 HTTPS（public HTTPS）→ ✅ ACM 公有证书；❌ AWS Private CA 证书：浏览器不信任，而且要收费
SOURCE: https://docs.aws.amazon.com/acm/latest/userguide/acm-public-certificates.html
Use ACM public certificates with integrated AWS services like Elastic Load Balancing, Amazon CloudFront, and Amazon API Gateway.

## awsb-cr-encrypt-existing | d2
TOPIC: Encryption and threat detection
Q:
An Amazon RDS (Relational Database Service) database was created without encryption and must now be encrypted at rest. Which steps get you there?
Q_ZH:
一个 Amazon RDS（Relational Database Service，关系型数据库服务）数据库当初创建时没加密，现在必须做静态加密，要走哪几步？
A:
Answer: Snapshot, copy it with encryption, restore: no in-place switch.
Because: AWS rule: RDS encryption is chosen only when a database is created and an unencrypted snapshot cannot restore as encrypted, so you encrypt a copy of the snapshot and restore a new database from that copy.
Exam: encrypt an existing unencrypted RDS database or EBS (Elastic Block Store) volume → ✅ snapshot, encrypted snapshot copy, restore (RDS also: a blue/green deployment to an encrypted synced copy); ❌ modify the database to turn encryption on: no in-place setting
A_ZH:
答：快照、加密复制、再还原：不能原地开启。
因为：AWS 规定，记住即可：RDS 只能在创建数据库时选择加密，未加密的快照也不能直接还原成加密库，所以要先把快照加密复制一份，再用这份副本还原出新数据库。
考法：给已有的未加密 RDS 数据库或 EBS（Elastic Block Store，弹性块存储）卷加密 → ✅ 打快照、加密复制快照、从副本还原，RDS 现在也可用蓝/绿部署（blue/green deployment）切到同步好的加密副本；❌ 修改数据库直接开启加密：没有原地开启的设置
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html
You can only encrypt an Amazon RDS DB instance when you create it, not after the DB instance is created. However, because you can encrypt a copy of an unencrypted snapshot, you can effectively add encryption to an unencrypted DB instance.

## awsb-cr-ebs-encryption-by-default | d2
TOPIC: Encryption and threat detection
Q:
Every new Amazon EBS (Elastic Block Store) volume in a Region must be encrypted, even when someone forgets to ask for it. Which setting?
Q_ZH:
某个区域里每一个新建的 Amazon EBS（Elastic Block Store，弹性块存储）卷都必须加密，哪怕有人忘了要求加密，用哪个设置？
A:
Answer: EBS encryption by default: one per-Region account setting.
Because: once it is on, every new volume and snapshot copy in that Region is encrypted with your default KMS (Key Management Service) key and nobody can opt out per volume, while existing volumes stay as they are.
Exam: enforce encryption of all new EBS volumes → ✅ EBS encryption by default, turned on in each Region; ❌ AWS Config encrypted-volumes rule: only flags unencrypted volumes after they exist
A_ZH:
答：EBS 默认加密（encryption by default）：按区域生效的账户设置。
因为：一旦打开，这个区域里每个新卷和快照副本都会用你的默认 KMS（Key Management Service，密钥管理服务）密钥加密，谁也不能单独给某个卷关掉；已有的卷保持原样。
考法：强制所有新 EBS 卷加密（enforce encryption）→ ✅ EBS encryption by default，每个区域分别开启；❌ AWS Config 的 encrypted-volumes 规则：只能在卷建好后标出未加密的卷
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/encryption-by-default.html
Encryption by default is a Region-specific setting. If you enable it for a Region, you cannot disable it for individual volumes or snapshots in that Region.

## awsb-ct-ecs-service-auto-scaling | d2
TOPIC: Serverless and containers
Q:
An Amazon ECS (Elastic Container Service) service must run more copies of its task when average CPU (central processing unit) use rises, and fewer when it falls. Which feature?
Q_ZH:
一个 Amazon ECS（Elastic Container Service，容器服务）服务要在平均 CPU（central processing unit，中央处理器）使用率升高时多跑几份任务，降低时少跑，用哪个功能？
A:
Answer: ECS Service Auto Scaling: target tracking on task count.
Because: Service Auto Scaling uses Application Auto Scaling to watch the service's CloudWatch metric, such as average CPU, and raises or lowers the desired task count to hold your target value.
Exam: scale the number of ECS tasks with load (CPU, memory, requests per target) → ✅ ECS Service Auto Scaling with target tracking; ❌ an Amazon EC2 (Elastic Compute Cloud) Auto Scaling group: adds instances, not tasks
A_ZH:
答：ECS 服务自动扩缩（Service Auto Scaling）：按目标跟踪调整任务数。
因为：服务自动扩缩借助 Application Auto Scaling 盯着服务的 CloudWatch 指标（例如平均 CPU），通过调高或调低期望任务数（desired count），让指标保持在你设定的目标值。
考法：按负载（CPU、内存、每个目标的请求数）调整 ECS 任务数量 → ✅ ECS 服务自动扩缩 + 目标跟踪（target tracking）；❌ Amazon EC2（Elastic Compute Cloud，弹性计算云）Auto Scaling 组：加的是实例，不是任务
SOURCE: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html
Automatic scaling is the ability to increase or decrease the desired number of tasks in your Amazon ECS service automatically. Amazon ECS leverages the Application Auto Scaling service to provide this functionality.

## awsb-dr-cheapest-meeting-rpo-rto | d2
TOPIC: Backup and disaster recovery
Q:
A workload can be down for up to a day and lose a few hours of data in a disaster, and disaster recovery spending must be as low as possible. Which strategy?
Q_ZH:
一个工作负载在灾难中最多可以停机一天、丢几个小时的数据，灾难恢复的花费要尽量低，用哪种策略？
A:
Answer: Backup and restore: the cheapest disaster recovery strategy.
Because: the strategies trade cost for recovery speed, and backup and restore keeps only backups in the recovery Region with nothing running, so it costs least while its hours-long rebuild still fits a one-day target.
Exam: lowest cost that meets hours-long RPO (recovery point objective) and RTO (recovery time objective) → ✅ backup and restore; ❌ pilot light: pays for always-on data replication not needed here; ❌ multi-site active/active: full copy running, highest cost
A_ZH:
答：Backup and restore（备份与恢复）：最便宜的灾难恢复策略。
因为：各种策略都是用成本换恢复速度，备份与恢复在恢复区域只放备份、不运行任何资源，所以最省钱，而它几小时的重建时间仍在一天的目标之内。
考法：满足以小时计的 RPO（recovery point objective，恢复点目标）和 RTO（recovery time objective，恢复时间目标）且成本最低 → ✅ backup and restore；❌ pilot light：为用不上的常开数据复制付费；❌ multi-site active/active：整套环境都在跑，成本最高
SOURCE: https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html
Disaster recovery strategies available to you within AWS can be broadly categorized into four approaches, ranging from the low cost and low complexity of making backups to more complex strategies using multiple active Regions.

## awsb-dr-dlm-ami-lifecycle | d2
TOPIC: Backup and disaster recovery
Q:
Amazon EBS (Elastic Block Store) volumes with a backup tag need a daily snapshot kept for 14 days, using the automation built into Amazon EBS with no scripts. Which tool?
Q_ZH:
带备份标签的 Amazon EBS（Elastic Block Store，弹性块存储）卷每天要做一次快照并保留 14 天，要用 Amazon EBS 自带的自动化功能、不写脚本，用哪个工具？
A:
Answer: Amazon Data Lifecycle Manager: tag-based snapshot policies.
Because: a lifecycle policy picks volumes or instances by tag, creates EBS snapshots or EBS-backed AMIs (Amazon Machine Images) on its schedule and deletes those past retention, so the backups manage themselves.
Exam: automate EBS snapshot or AMI creation and deletion by tag → ✅ Amazon Data Lifecycle Manager; ❌ Amazon S3 (Simple Storage Service) Lifecycle rules: act on S3 objects, not EBS snapshots
A_ZH:
答：Amazon Data Lifecycle Manager：按标签执行的快照策略。
因为：生命周期策略按标签选中卷或实例，按时间表创建 EBS 快照或 EBS 支持的 AMI（Amazon Machine Image，亚马逊机器镜像），并删掉超过保留期的旧备份，备份就能自己管理自己。
考法：按标签自动创建和删除 EBS 快照或 AMI（automate snapshot and AMI lifecycle）→ ✅ Amazon Data Lifecycle Manager；❌ Amazon S3（Simple Storage Service，简单存储服务）Lifecycle 规则：只管 S3 对象，不管 EBS 快照
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/snapshot-lifecycle.html
You can use Amazon Data Lifecycle Manager to automate the creation, retention, and deletion of EBS snapshots and EBS-backed AMIs.

## awsb-ed-cloudfront-signed-urls-cookies | d2
TOPIC: Edge and DNS
Q:
Paying subscribers must open hundreds of private CloudFront video files through the links those files already have. Which access method?
Q_ZH:
付费订阅用户要通过这些文件现有的链接，访问 CloudFront 上几百个私有视频文件，用哪种访问方式？
A:
Answer: CloudFront signed cookies: one grant covers many files.
Because: the viewer's browser stores the signed cookies and sends them with every request, so one signature opens all matching files without touching their URLs (uniform resource locators), while a signed URL is made per file.
Exam: access to many restricted files, keep current URLs → ✅ CloudFront signed cookies; ❌ CloudFront signed URLs: one per file, and the link changes
A_ZH:
答：CloudFront signed cookies（签名 Cookie）：一次授权覆盖很多文件。
因为：浏览器保存签名 Cookie，每次请求都会自动带上，所以一个签名就能打开所有匹配的文件，不用改它们的 URL（uniform resource locator，统一资源定位符）；而签名 URL 要一个文件一个地生成。
考法：要访问很多受限文件、保留现有 URL → ✅ CloudFront signed cookies；❌ CloudFront signed URLs：每个文件一个，而且链接会变
SOURCE: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-choosing-signed-urls-cookies.html
Use signed cookies in the following cases: You want to provide access to multiple restricted files, for example, all of the files for a video in HLS format or all of the files in the subscribers' area of website. You don't want to change your current URLs.

## awsb-iam-ad-options | d2
TOPIC: Identity and accounts
Q:
Workloads in AWS need a full Microsoft Active Directory running inside AWS, with a trust to the on-premises domain. Which option?
Q_ZH:
AWS 里的工作负载需要一个在 AWS 内部运行的完整 Microsoft Active Directory，并且要和本地机房的域建立信任，选哪个？
A:
Answer: AWS Managed Microsoft AD (Active Directory): real AD, run by AWS.
Because: it runs real domain controllers in your VPC (virtual private cloud) across two Availability Zones, so instances can join the domain and it can trust your on-premises domain, while AWS handles patching and recovery.
Exam: a real AD inside AWS that trusts on-premises AD → ✅ AWS Managed Microsoft AD; ❌ AD Connector: forwards requests to on-premises AD, stores nothing; ❌ Simple AD: basic AD-compatible directory, no trusts, closed to new customers
A_ZH:
答：AWS Managed Microsoft AD（Active Directory，微软目录服务）：AWS 替你运行的真 AD。
因为：它在你的 VPC（virtual private cloud，虚拟私有云）里跨两个可用区跑真正的域控制器，实例可以加入域，也能和本地域建立信任，补丁和恢复由 AWS 负责。
考法：AWS 里要一个能信任本地 AD 的真 AD → ✅ AWS Managed Microsoft AD；❌ AD Connector：只把请求转发给本地 AD，自己不存数据；❌ Simple AD：简易的 AD 兼容目录，不支持信任，已不再向新客户开放
SOURCE: https://docs.aws.amazon.com/directoryservice/latest/admin-guide/directory_microsoft_ad.html
AWS Directory Service for Microsoft Active Directory, also referred to as AWS Managed Microsoft AD, runs Microsoft Active Directory as a managed service powered by Windows Server 2019. It creates a highly available pair of domain controllers in your Amazon VPC across different Availability Zones, with AWS automatically managing host monitoring, recovery, data replication, snapshots, and software updates.

## awsb-iam-cognito-vs-identity-center | d2
TOPIC: Identity and accounts
Q:
A mobile app's customers must sign up and sign in with their own accounts. Which service?
Q_ZH:
一个手机 App 的客户要用自己的账号注册和登录，用哪个服务？
A:
Answer: Amazon Cognito: sign-up and sign-in for app users.
Because: a Cognito user pool is a user directory that registers your app's customers and signs them in, issuing tokens your app checks, while IAM (Identity and Access Management) Identity Center serves employees reaching AWS accounts.
Exam: customer or app end-user sign-up and sign-in → ✅ Amazon Cognito; ❌ AWS IAM Identity Center: workforce access to AWS accounts and business apps
A_ZH:
答：Amazon Cognito：给应用用户注册和登录。
因为：Cognito 用户池（user pool）是一个用户目录，负责给 App 的客户注册、登录并签发令牌供 App 校验；IAM（Identity and Access Management，身份与访问管理）Identity Center 则是给员工进 AWS 账户用的。
考法：customer or app end-user sign-up and sign-in → ✅ Amazon Cognito；❌ AWS IAM Identity Center：员工（workforce）访问 AWS 账户和企业应用用的
SOURCE: https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html
Amazon Cognito is an identity platform for web and mobile apps. It’s a user directory, an authentication server, and an authorization service for OAuth 2.0 access tokens and AWS credentials.

## awsb-rds-aurora-global-database | d2
TOPIC: Databases
Q:
An Aurora app needs a copy in another Region that stays about one second behind, for Region-wide disaster recovery and fast local reads. Which Aurora feature?
Q_ZH:
一个 Aurora 应用要在另一个区域（Region）有一份只落后约一秒的副本，用于整个区域故障时的灾难恢复和本地快速读取，用 Aurora 的哪个功能？
A:
Answer: Aurora Global Database: storage-level replication across Regions.
Because: Aurora copies changes from the cluster storage volume over dedicated infrastructure, not through the database engine, so secondary Regions usually lag under a second and one can take over if the primary Region fails.
Exam: cross-Region disaster recovery with about one second of lag, or low-latency global reads → ✅ Aurora Global Database; ❌ cross-Region read replica: engine-based copy, more data loss, slower recovery
A_ZH:
答：Aurora Global Database：在存储层跨区域复制。
因为：Aurora 从集群存储卷出发、走专用基础设施复制变更，不经过数据库引擎，所以次要区域（secondary Region）通常落后不到一秒，主区域故障时可以由它接管。
考法：跨区域灾难恢复、延迟约一秒，或全球低延迟读 → ✅ Aurora Global Database；❌ 跨区域只读副本：靠数据库引擎复制，丢的数据更多，恢复更慢
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database.html
After any write operation, Aurora replicates data to the secondary AWS Regions using dedicated infrastructure, with latency typically under a second.

## awsb-rds-multi-az-cluster | d2
TOPIC: Databases
Q:
An Amazon RDS (Relational Database Service) for PostgreSQL database needs standbys that also serve reads, with failover typically under 35 seconds. Which deployment option?
Q_ZH:
一个 Amazon RDS（Relational Database Service，关系型数据库服务）for PostgreSQL 数据库需要备用实例同时能提供读，故障切换通常不超过 35 秒，选哪种部署方式？
A:
Answer: A Multi-AZ (Multi-Availability Zone) DB (database) cluster: one writer plus two readers.
Because: a writer and two reader instances sit in three Availability Zones with semisynchronous replication, so each commit waits for at least one reader, and the readers serve reads and can take over quickly.
Exam: readable standbys, faster failover, MySQL or PostgreSQL only → ✅ Multi-AZ DB cluster; ❌ Multi-AZ DB instance deployment: one passive standby, no reads, failover in 1 to 2 minutes
A_ZH:
答：Multi-AZ（Multi-Availability Zone，多可用区）DB（database，数据库）cluster：一个写实例加两个读实例。
因为：一个写实例和两个读实例分布在三个可用区，用半同步复制，所以每次提交至少等一个读实例确认，读实例平时提供读，出事时能很快接管。
考法：备用实例可读、故障切换更快、只支持 MySQL 或 PostgreSQL → ✅ Multi-AZ DB cluster；❌ Multi-AZ DB instance 部署：只有一个被动备用库，不提供读，切换要 1 到 2 分钟
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts.html
A Multi-AZ DB cluster has a writer DB instance and two reader DB instances in three separate Availability Zones in the same AWS Region. Multi-AZ DB clusters provide high availability, increased capacity for read workloads, and lower write latency when compared to Multi-AZ DB instance deployments.

## awsb-s3-glacier-instant-retrieval | d2
TOPIC: S3 storage
Q:
Medical images are read about once a quarter, but each must open in milliseconds during a patient visit. Which Amazon S3 (Simple Storage Service) storage class costs least?
Q_ZH:
医学影像大约每季度才读一次，但病人就诊时每张都必须毫秒级打开，哪个 Amazon S3（Simple Storage Service，简单存储服务）存储类最便宜？
A:
Answer: S3 Glacier Instant Retrieval: archive price, millisecond reads.
Because: its objects stay online, so a read returns in milliseconds with no restore step, and compared with S3 Standard-IA (Infrequent Access) it costs less to store but more to read, with a 90-day minimum.
Exam: accessed about once a quarter, millisecond retrieval, lowest storage cost → ✅ S3 Glacier Instant Retrieval; ❌ S3 One Zone-IA: one zone, data lost if it fails
A_ZH:
答：S3 Glacier Instant Retrieval：归档的价格，毫秒级读取。
因为：它的对象一直在线，读取不用先恢复，毫秒就返回；和 S3 Standard-IA（Infrequent Access，低频访问）比，存储更便宜但读取更贵，并且至少按 90 天计费。
考法：大约每季度访问一次、毫秒取回、存储成本最低（accessed about once a quarter, millisecond retrieval）→ ✅ S3 Glacier Instant Retrieval；❌ S3 One Zone-IA：只存一个可用区，它一坏数据就没了
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/glacier-storage-classes.html
S3 Glacier Instant Retrieval storage class offers real-time access to your objects with the same latency and throughput performance as the S3 Standard-IA storage class. When compared to S3 Standard-IA, S3 Glacier Instant Retrieval has lower storage costs but higher data access costs.

## awsb-s3-versioning | d2
TOPIC: S3 storage
Q:
Users sometimes delete or overwrite important files in a bucket by mistake, and earlier copies must be recoverable. Which Amazon S3 (Simple Storage Service) feature?
Q_ZH:
用户时常误删或误覆盖存储桶里的重要文件，之前的副本必须能找回来，用哪个 Amazon S3（Simple Storage Service，简单存储服务）功能？
A:
Answer: S3 Versioning: every write keeps its own version.
Because: with versioning on, an overwrite adds a new version and a plain delete only inserts a delete marker on top, so the earlier versions stay in the bucket and can be restored.
Exam: recover from accidental deletes or overwrites → ✅ S3 Versioning; ❌ S3 Lifecycle rules: move or delete by age, keep no earlier copies
A_ZH:
答：S3 Versioning（版本控制）：每次写入都留一个版本。
因为：开启版本控制后，覆盖会新增一个版本，普通删除只是在最上面加一个删除标记（delete marker），所以之前的版本仍在存储桶里，可以恢复。
考法：从误删或误覆盖中恢复（recover from accidental deletes or overwrites）→ ✅ S3 Versioning；❌ S3 Lifecycle rules：按年龄迁移或删除，不保留旧副本
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html
Versioning-enabled buckets can help you recover objects from accidental deletion or overwrite. For example, if you delete an object, Amazon S3 inserts a delete marker instead of removing the object permanently.

## awsb-sl-api-gateway-throttling | d2
TOPIC: Serverless and containers
Q:
Each partner company calling your REST (representational state transfer) API (application programming interface) must be held to its own request rate and monthly quota. Which API Gateway feature?
Q_ZH:
每家调用你 REST（representational state transfer，表述性状态转移）API（application programming interface，应用程序接口）的合作公司，都要有自己单独的请求速率上限和月度配额，用 API Gateway 的哪个功能？
A:
Answer: A usage plan with API keys: limits per client.
Because: each partner sends its own API key, and that key's usage plan sets its rate, burst and quota, so API Gateway counts each client separately and, best effort, rejects the excess with 429 errors.
Exam: limit request rate or quota per client or customer → ✅ API Gateway usage plan with API keys; ❌ Lambda reserved concurrency: one cap shared by all callers
A_ZH:
答：使用计划（usage plan）加 API 密钥（API key）：按客户分别限流。
因为：每个合作方调用时带上自己的 API 密钥，与该密钥关联的使用计划设定速率、突发量和配额，所以 API Gateway 按客户分别计数，超出的部分返回 429 错误（AWS 说明这是尽力而为，不是硬上限）。
考法：按客户限制请求速率或配额（per-client throttling）→ ✅ API Gateway 使用计划 + API 密钥；❌ Lambda 预留并发（reserved concurrency）：所有调用方共用一个上限
SOURCE: https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-usage-plans.html
A usage plan specifies who can access one or more deployed API stages and methods—and optionally sets the target request rate to start throttling requests. The plan uses API keys to identify API clients and who can access the associated API stages for each key.

## awsb-vpc-security-group-defaults | d1
TOPIC: VPC networking
Q:
You create a new security group, add no rules, and attach it to an instance. Which traffic does it let through?
Q_ZH:
你新建一个安全组，不加任何规则就挂到一台实例上，它会放行哪些流量？
A:
Answer: Outbound only: one allow-all outbound rule, no inbound rules.
Because: AWS rule: a new security group starts with no inbound rules and one allow-all outbound rule, and it holds allow rules only, so nobody outside can open a connection until you add an inbound allow rule.
Exam: newly created security group defaults → ✅ deny all inbound, allow all outbound; ❌ the default security group of a VPC (virtual private cloud): also allows inbound from its own members
A_ZH:
答：只出不进：一条全部放行的出站规则，没有入站规则。
因为：AWS 规定，记住即可：新安全组一开始没有入站规则，只有一条放行全部出站流量的规则，而且只能写允许规则，所以在你加入站允许规则之前，外面谁都不能主动连进来。
考法：新建安全组的默认行为 → ✅ 入站全拒、出站全放；❌ VPC（virtual private cloud，虚拟私有云）自带的默认安全组：还允许组内成员之间的入站流量
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html
Therefore, no inbound traffic is allowed until you add inbound rules to the security group. When you first create a security group, it has an outbound rule that allows all outbound traffic from the resource.

## awsb-cost-data-transfer-costs | d1
TOPIC: Monitoring, governance and cost
Q:
Two Amazon EC2 (Elastic Compute Cloud) instances exchange heavy traffic over private IP (Internet Protocol) addresses. Which placement makes that traffic free?
Q_ZH:
两台 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例通过私有 IP（Internet Protocol，互联网协议）地址互传大量数据，放在哪里这部分流量才免费？
A:
Answer: The same Availability Zone: private traffic there is free.
Because: AWS rule: data between instances in one Availability Zone over private IP addresses is free, while traffic that crosses to another zone costs $0.01 per GB in each direction.
Exam: lowest data transfer cost between instances → ✅ the same Availability Zone, private IP addresses; ❌ different Availability Zones: charged per GB both ways; ❌ public or Elastic IP addresses: charged even inside one zone
A_ZH:
答：同一个可用区：那里的私网流量免费。
因为：AWS 规定，记住即可：同一可用区内的实例之间走私有 IP 地址的流量免费；跨到另一个可用区，每个方向每 GB 收 0.01 美元。
考法：实例之间的数据传输费最低 → ✅ 同一可用区、私有 IP 地址；❌ 不同可用区：两个方向都按 GB 收费；❌ 公有 IP 地址或 Elastic IP 地址：即使在同一可用区也收费
SOURCE: https://aws.amazon.com/ec2/pricing/on-demand/
Data transferred between Amazon EC2, Amazon RDS, Amazon Redshift, Amazon ElastiCache instances, and Elastic Network Interfaces in the same Availability Zone is free.

## awsb-cost-rds-reserved-db-instances | d2
TOPIC: Databases
Q:
A production Amazon RDS (Relational Database Service) database will run around the clock on the same instance type for the next three years. Which purchase option cuts its cost most?
Q_ZH:
一个生产用的 Amazon RDS（Relational Database Service，关系型数据库服务）数据库未来三年都会用同一种实例类型全天运行，哪种购买方式最省钱？
A:
Answer: Reserved DB (database) instances: a three-year discount.
Because: AWS rule: you commit to one instance type in one Region for one or three years, and AWS bills matching running instances at a large discount; no physical server is set aside.
Exam: a database that runs steadily for years → ✅ Amazon RDS reserved DB instances; ❌ Compute Savings Plans: EC2 (Elastic Compute Cloud), Fargate and Lambda only; ❌ Database Savings Plans: 1-year term only, up to 20% off provisioned instances
A_ZH:
答：预留 DB（database，数据库）实例：三年期折扣。
因为：AWS 规定，记住即可：你承诺在一个区域（Region）用一种实例类型一年或三年，AWS 就给匹配的运行实例打大折扣；并不会真的给你留一台服务器。
考法：数据库要稳定运行好几年 → ✅ Amazon RDS reserved DB instances；❌ Compute Savings Plans：只覆盖 EC2（Elastic Compute Cloud，弹性计算云）、Fargate 和 Lambda；❌ Database Savings Plans：只有 1 年期，预置实例最多省 20%
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithReservedDBInstances.html
Using reserved DB instances, you can reserve a DB instance for a one- or three-year term. Reserved DB instances provide you with a significant discount compared to on-demand DB instance pricing.

## awsb-cr-kms-key-rotation | d1
TOPIC: Encryption and threat detection
Q:
A customer managed key in AWS KMS (Key Management Service) must get fresh key material every year without breaking old ciphertext. Which feature?
Q_ZH:
AWS KMS（Key Management Service，密钥管理服务）里的一把客户托管密钥要每年换新的密钥材料，又不能让旧密文解不开，用哪个功能？
A:
Answer: Automatic key rotation: same key, new material.
Because: KMS creates new key material on each rotation date but keeps all earlier material and picks the matching one for every decrypt, so applications keep the same key and old data still decrypts.
Exam: rotate a customer managed key yearly with no code changes → ✅ automatic key rotation (not for imported key material: on-demand only); ❌ manual rotation (create a new KMS key and repoint the alias): new key identifier, so apps or aliases must change
A_ZH:
答：自动密钥轮换（automatic key rotation）：密钥不变，材料换新。
因为：KMS 在每个轮换日生成新的密钥材料，但保留所有旧材料，解密时自动挑出对应的那份，所以应用继续用同一把密钥，旧数据照样能解密。
考法：每年轮换客户托管密钥且不改代码 → ✅ automatic key rotation（导入的密钥材料不支持，只能按需轮换）；❌ 手动轮换（新建一把 KMS 密钥再改别名指向）：密钥标识符变了，应用或别名都得改
SOURCE: https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html
Key rotation changes only the current key material, which is the cryptographic secret that is used in encryption operations. When you use the rotated KMS key to decrypt ciphertext, AWS KMS uses the key material that was used to encrypt it.

## awsb-dr-pilot-light-vs-warm-standby | d2
TOPIC: Backup and disaster recovery
Q:
The recovery Region must handle some traffic immediately at reduced capacity, with no servers to switch on first. Which disaster recovery strategy?
Q_ZH:
恢复区域必须能立即以较小的容量处理一部分流量，而且不需要先开启任何服务器，用哪种灾难恢复策略？
A:
Answer: Warm standby: a smaller working copy already running.
Because: warm standby keeps a scaled-down but fully working copy of production running, so failover only needs scaling up, while pilot light keeps the data replicated but the servers off, so they must be started first.
Exam: serve traffic at once, then scale up → ✅ warm standby; ❌ pilot light: data replicated, servers off until failover
A_ZH:
答：Warm standby（温备）：缩小版的完整副本一直在跑。
因为：温备一直运行着一套缩小但完整可用的生产副本，故障切换时只需要扩容；pilot light（指示灯）只把数据复制过去，服务器是关着的，必须先把它们启动。
考法：马上就能接流量，然后再扩容（handle traffic immediately at reduced capacity）→ ✅ warm standby；❌ pilot light：数据已复制，但服务器要等故障切换时才开
SOURCE: https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html
The distinction is that pilot light cannot process requests without additional action taken first, whereas warm standby can handle traffic (at reduced capacity levels) immediately.

## awsb-ed-cloudfront-cache-policies | d2
TOPIC: Edge and DNS
Q:
A CloudFront path serves each user's live account page, which must never come from the cache. Which managed cache policy do you attach?
Q_ZH:
CloudFront 上有一个路径返回每个用户实时的账户页面，绝不能从缓存返回，挂哪个托管缓存策略（managed cache policy）？
A:
Answer: CachingDisabled: every request goes to the origin.
Because: a cache policy sets how long CloudFront keeps copies through its TTL (time to live) values, and CachingDisabled sets all TTLs to 0, so CloudFront stores nothing and forwards each request to the origin.
Exam: dynamic, per-user pages through CloudFront, no caching → ✅ managed cache policy CachingDisabled; ❌ CachingOptimized: caches 24 hours by default, so pages go stale; ❌ moving to AWS Global Accelerator: unneeded, CloudFront serves uncached pages too
A_ZH:
答：CachingDisabled：每个请求都回源。
因为：缓存策略通过 TTL（time to live，缓存存活时间）值决定 CloudFront 把副本保留多久，CachingDisabled 把所有 TTL 设为 0，所以 CloudFront 什么都不存，每个请求都转发到源站。
考法：经 CloudFront 的动态、按用户区分的页面，不缓存 → ✅ 托管缓存策略 CachingDisabled；❌ CachingOptimized：默认缓存 24 小时，用户会看到旧页面；❌ 改用 AWS Global Accelerator：没必要，CloudFront 也能服务不缓存的页面
SOURCE: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html
This policy disables caching. This policy is useful for dynamic content and for requests that are not cacheable.

## awsb-ed-cloudfront-functions-vs-lambda-edge | d2
TOPIC: Edge and DNS
Q:
Every request from users' browsers needs a simple URL (uniform resource locator) rewrite at the edge, with no network calls. Which CloudFront feature?
Q_ZH:
用户浏览器发来的每个请求都要在边缘做一次简单的 URL（uniform resource locator，统一资源定位符）重写，而且不需要任何网络调用，用哪个 CloudFront 功能？
A:
Answer: CloudFront Functions: lightweight code at viewer events.
Because: CloudFront Functions run small JavaScript functions in edge locations on viewer requests and responses, with submillisecond startup and no network access, so simple rewrites scale to millions of requests per second.
Exam: simple header or URL changes at very high scale → ✅ CloudFront Functions; ❌ Lambda@Edge: for heavier code, network calls or origin events; ❌ Application Load Balancer rule: runs in one Region, after the edge
A_ZH:
答：CloudFront Functions：在查看器（viewer）事件上运行轻量代码。
因为：CloudFront Functions 在边缘站点针对查看器请求和响应运行小段 JavaScript，启动时间不到 1 毫秒、不能访问网络，所以简单的重写能扩展到每秒数百万次请求。
考法：大规模的简单请求头或 URL 修改 → ✅ CloudFront Functions；❌ Lambda@Edge：适合更重的代码、网络调用或源站事件；❌ Application Load Balancer 规则：在单个区域（Region）里运行，已经过了边缘
SOURCE: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions.html
You can write lightweight functions in JavaScript for high-scale, latency-sensitive CDN customizations. The CloudFront Functions runtime environment offers submillisecond startup times, scales immediately to handle millions of requests per second, and is highly secure.

## awsb-in-step-functions | d2
TOPIC: Messaging and streaming
Q:
A team wants its multi-step order process, which pauses for a manager's approval, drawn as a visual workflow instead of written as code. Which AWS service runs it?
Q_ZH:
一个团队想把多步骤的订单流程（中间要停下来等经理审批）画成可视化工作流，而不是写成代码，用哪个 AWS 服务来运行它？
A:
Answer: AWS Step Functions: a state machine runs the steps.
Because: you draw the steps as a state machine, each state runs a task or waits, and Step Functions tracks every step, so a Standard workflow can wait up to a year for approval.
Exam: multi-step workflow with waits or human approval, as a visual workflow → ✅ AWS Step Functions; ❌ Lambda durable functions: steps written in function code; ❌ Amazon EventBridge Scheduler: only starts a target on a schedule
A_ZH:
答：AWS Step Functions：用状态机（state machine）跑完各个步骤。
因为：你把步骤画成一个状态机，每个状态执行一项任务或等待，Step Functions 记录每一步，所以标准工作流（Standard workflow）最长可以等审批一年。
考法：用可视化工作流跑多步骤流程，要等待或人工审批 → ✅ AWS Step Functions；❌ Lambda 持久函数（durable functions）：步骤写在函数代码里；❌ Amazon EventBridge Scheduler：只按计划启动一个目标
SOURCE: https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html
With AWS Step Functions, you can create workflows, also called State machines, to build distributed applications, automate processes, orchestrate microservices, and create data and machine learning pipelines.

## awsb-ml-sagemaker-build-train | d2
TOPIC: Analytics and ML
Q:
Data scientists must train a custom model on their own labeled data and host it behind an endpoint. Which service?
Q_ZH:
数据科学家要用自己标注好的数据训练一个定制模型，并把它部署在一个终端节点（endpoint）后面，用哪个服务？
A:
Answer: Amazon SageMaker AI (artificial intelligence): build, train and deploy your own models.
Because: SageMaker AI trains on your data with built-in or your own algorithms on managed compute, then hosts the trained model on a managed endpoint, so the model is yours, unlike a pre-trained AI service you just call.
Exam: build or train your own model (older questions say Amazon SageMaker) → ✅ Amazon SageMaker AI; ❌ a pre-trained AI service such as Amazon Rekognition: ready-made models you call, not a training platform
A_ZH:
答：Amazon SageMaker AI（artificial intelligence，人工智能）：构建、训练和部署你自己的模型。
因为：SageMaker AI 在托管算力上用内置或你自己的算法拿你的数据训练，再把训练好的模型放到托管终端节点上，所以模型是你自己的；预训练的 AI 服务则只能直接调用。
考法：自己构建或训练模型（旧题写 Amazon SageMaker）→ ✅ Amazon SageMaker AI；❌ Amazon Rekognition 这类预训练 AI 服务：现成模型直接调用，不是训练平台
SOURCE: https://docs.aws.amazon.com/sagemaker/latest/dg/whatis.html
Amazon SageMaker AI is a fully managed machine learning (ML) service. With SageMaker AI, data scientists and developers can quickly and confidently build, train, and deploy ML models into a production-ready hosted environment.

## awsb-nc-dynamodb-pitr-backup | d2
TOPIC: Databases
Q:
A faulty batch job overwrote items in a DynamoDB table 40 minutes ago. Which feature restores the table as it was just before the job ran?
Q_ZH:
一个出错的批处理任务 40 分钟前覆盖了一张 DynamoDB 表里的数据，用哪个功能把表恢复成任务运行前一刻的样子？
A:
Answer: PITR (point-in-time recovery): restore to any second.
Because: PITR keeps continuous backups at per-second granularity for up to 35 days, so DynamoDB can rebuild the table as it was at the chosen second, as a new table.
Exam: undo accidental writes or deletes → ✅ DynamoDB PITR; ❌ scheduled AWS Backup backups: restore only to when each backup ran; use them for long-term copies
A_ZH:
答：PITR（point-in-time recovery，时间点恢复）：恢复到任意一秒。
因为：PITR 以秒为粒度做持续备份，最长保留 35 天，所以 DynamoDB 能把表重建成你选的那一秒的样子，恢复成一张新表。
考法：撤销误写或误删 → ✅ DynamoDB PITR；❌ 定时的 AWS Backup 备份：只能恢复到每次备份那一刻，适合长期保留
SOURCE: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Point-in-time-recovery.html
Amazon DynamoDB point-in-time recovery (PITR) provides automatic continuous backups of your DynamoDB table data. Point-in-time recovery (PITR) backups are fully managed by DynamoDB and provide up to 35 days of recovery points at a per second granularity.

## awsb-org-consolidated-billing | d1
TOPIC: Monitoring, governance and cost
Q:
A company runs 10 AWS accounts and wants their usage priced together, as if it were one account. Which feature?
Q_ZH:
一家公司有 10 个 AWS 账户，想让它们的用量合在一起计价，就像一个账户一样，用哪个功能？
A:
Answer: Consolidated billing in AWS Organizations: one payer, combined usage.
Because: the management account pays for all member accounts and AWS adds their usage together, so volume pricing tiers are reached sooner and unused Reserved Instance or Savings Plans discounts can cover matching usage in other accounts.
Exam: share volume, Reserved Instance or Savings Plans discounts across accounts → ✅ consolidated billing (only the management account controls discount sharing); ❌ cost allocation tags: group costs in reports, do not change what you pay
A_ZH:
答：AWS Organizations 的整合账单（consolidated billing）：一个付款方，用量合并计算。
因为：管理账户替所有成员账户付费，AWS 把它们的用量加在一起算，所以更快达到阶梯价的低价档，没用完的预留实例（Reserved Instance）或 Savings Plans 折扣也能抵扣其他账户的匹配用量。
考法：跨账户共享阶梯价、预留实例或 Savings Plans 折扣 → ✅ consolidated billing（只有管理账户能控制折扣共享）；❌ 成本分配标签（cost allocation tags）：只在报表里给费用分组，不改变实际价格
SOURCE: https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/con-bill-blended-rates.html
Using consolidated billing, you can combine usage from multiple accounts into a single invoice, allowing you to reach the tiers with lower prices faster. You can also apply unused reservations from one account to another account's instance usage.

## awsb-org-service-catalog | d2
TOPIC: Identity and accounts
Q:
Developers must launch only company-approved AWS CloudFormation templates (infrastructure defined in code) on their own, without broad AWS permissions. Which service?
Q_ZH:
开发人员只能自助启动公司批准过的 AWS CloudFormation 模板（用代码定义的基础设施），而且不给他们宽泛的 AWS 权限，用哪个服务？
A:
Answer: AWS Service Catalog: self-service approved products.
Because: the name says it: administrators publish a catalog of approved CloudFormation templates as products and grant users access, so users launch those products themselves without direct access to the underlying services.
Exam: self-service launch of pre-approved templates → ✅ AWS Service Catalog; ❌ an SCP (service control policy): blocks actions, offers nothing to launch
A_ZH:
答：AWS Service Catalog：自助启动批准过的产品。
因为：名字就是答案：管理员把批准过的 CloudFormation 模板作为产品放进目录（catalog）并授权给用户，用户自己就能启动这些产品，不需要直接访问底层服务。
考法：self-service launch of pre-approved templates（批准过的模板）→ ✅ AWS Service Catalog；❌ SCP（service control policy，服务控制策略）：只负责拦截操作，不提供可启动的东西
SOURCE: https://docs.aws.amazon.com/servicecatalog/latest/adminguide/introduction.html
Service Catalog allows organizations to centrally manage commonly deployed IT services, and helps organizations achieve consistent governance and meet compliance requirements. End users can quickly deploy only the approved IT services they need, following the constraints set by your organization.

## awsb-rds-aurora-vs-rds | d2
TOPIC: Databases
Q:
A company wants a managed AWS database for an app written for Oracle Database, with no change of engine. Which service?
Q_ZH:
一家公司想给一个基于 Oracle Database 写的应用找个 AWS 托管数据库，而且不换引擎，选哪个服务？
A:
Answer: Amazon RDS (Relational Database Service) for Oracle: the native Oracle engine.
Because: Amazon RDS runs the real Oracle Database engine, so the app's code works unchanged, while Aurora is its own engine built to be compatible only with MySQL or PostgreSQL.
Exam: keep Oracle with no code change → ✅ Amazon RDS for Oracle; ❌ Amazon Aurora: MySQL- and PostgreSQL-compatible only
A_ZH:
答：Amazon RDS（Relational Database Service，关系型数据库服务）for Oracle：原生 Oracle 引擎。
因为：Amazon RDS 跑的是真正的 Oracle Database 引擎，所以应用代码不用改；Aurora 是自己的引擎，只兼容 MySQL 或 PostgreSQL。
考法：保留 Oracle、不改代码 → ✅ Amazon RDS for Oracle；❌ Amazon Aurora：只兼容 MySQL 和 PostgreSQL
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html
You can use database engines that you are already familiar with: IBM Db2, MariaDB, Microsoft SQL Server, MySQL, Oracle Database, and PostgreSQL.

## awsb-s3-vs-efs-ebs-cost | d2
TOPIC: S3 storage
Q:
Petabytes of fast-growing log files must be stored for years at the lowest possible cost. Which AWS storage service?
Q_ZH:
数 PB 快速增长的日志文件要以尽可能低的成本保存好几年，用哪个 AWS 存储服务？
A:
Answer: Amazon S3 (Simple Storage Service): cheapest per GB, no provisioning.
Because: S3 Standard costs a fraction per GB of Amazon EFS (Elastic File System) Standard or an Amazon EBS (Elastic Block Store) volume, needs no capacity set up, and can move older logs to colder classes, so the bill stays lowest.
Exam: huge, growing data kept for years, many readers, lowest cost → ✅ Amazon S3; ❌ Amazon EBS: billed per provisioned GB, one Availability Zone; ❌ Amazon EFS: shared file mount, far pricier per GB in Standard
A_ZH:
答：Amazon S3（Simple Storage Service，简单存储服务）：每 GB 最便宜，不用预置容量。
因为：S3 Standard 每 GB 的价格只有 Amazon EFS（Elastic File System，弹性文件系统）Standard 或 Amazon EBS（Elastic Block Store，弹性块存储）卷的一小部分，不用事先设置容量，旧日志还能转到更冷的存储类，所以账单始终最低。
考法：数据量大、不断增长、保存多年、读取方多、成本最低（huge, growing data kept for years, many readers, lowest cost）→ ✅ Amazon S3；❌ Amazon EBS：按预置的 GB 计费，只在一个可用区；❌ Amazon EFS：共享文件挂载，Standard 每 GB 贵得多
SOURCE: https://aws.amazon.com/s3/pricing/
Pay only for what you use. There is no minimum charge.

## awsb-vpc-privatelink-endpoint-service | d2
TOPIC: VPC networking
Q:
Your API (application programming interface) runs in your VPC (virtual private cloud), and customers in other AWS accounts must call only that API privately, never the rest of your network. Which AWS feature?
Q_ZH:
你的 API（application programming interface，应用程序接口）跑在自己的 VPC（virtual private cloud，虚拟私有云）里，其他 AWS 账户的客户只能私密地调用这一个 API，绝不能碰到你网络的其他部分，用哪个 AWS 功能？
A:
Answer: An AWS PrivateLink endpoint service: one service, nothing else.
Because: you put the API behind a Network Load Balancer and publish it as an endpoint service; each customer creates an interface endpoint in its own subnets, so traffic reaches only that load balancer, never your whole VPC.
Exam: expose one service privately to many VPCs or accounts → ✅ PrivateLink endpoint service with a Network Load Balancer; ❌ VPC peering: opens whole networks and needs non-overlapping CIDR (Classless Inter-Domain Routing) ranges
A_ZH:
答：AWS PrivateLink 终端节点服务（endpoint service）：只开放这一个服务。
因为：你把 API 放在一个 Network Load Balancer 后面，发布成终端节点服务；每个客户在自己的子网里建一个接口型 VPC 终端节点（interface endpoint），流量只能到达那个负载均衡器，碰不到你整个 VPC。
考法：把一个服务私密地开放给很多 VPC 或账户 → ✅ 基于 Network Load Balancer 的 PrivateLink endpoint service；❌ VPC peering：打通的是整个网络，而且 CIDR（Classless Inter-Domain Routing，无类别域间路由）地址不能重叠
SOURCE: https://docs.aws.amazon.com/vpc/latest/privatelink/privatelink-share-your-services.html
As the service provider, you create a Network Load Balancer in your VPC as the service front end. You then select this load balancer when you create the VPC endpoint service configuration.

## awsb-hy-client-vpn | d2
TOPIC: Hybrid networking
Q:
Individual remote employees must connect securely from their own laptops to resources in a VPC (virtual private cloud). Which service?
Q_ZH:
一个个远程员工要从自己的笔记本电脑安全地连到一个 VPC（virtual private cloud，虚拟私有云）里的资源，用哪个服务？
A:
Answer: AWS Client VPN (virtual private network): one tunnel per user.
Because: the name says it: each client laptop runs an OpenVPN-based app that opens its own encrypted TLS (Transport Layer Security) connection to a Client VPN endpoint, so people connect from anywhere with no office hardware.
Exam: individual remote users → ✅ AWS Client VPN; ❌ AWS Site-to-Site VPN: links a whole network through a gateway device
A_ZH:
答：AWS Client VPN（virtual private network，虚拟专用网络）：每个用户一条隧道。
因为：名字就是答案：每台客户端笔记本运行基于 OpenVPN 的程序，各自和 Client VPN 终端节点建立加密的 TLS（Transport Layer Security，传输层安全）连接，在哪都能连，办公室不需要任何硬件。
考法：individual remote users → ✅ AWS Client VPN；❌ AWS Site-to-Site VPN：通过网关设备把整个网络连上来
SOURCE: https://docs.aws.amazon.com/vpn/latest/clientvpn-admin/what-is.html
AWS Client VPN is a managed client-based VPN service that enables you to securely access your AWS resources and resources in your on-premises network. With Client VPN, you can access your resources from any location using an OpenVPN-based VPN client.

## awsb-hy-dx-gateway | d2
TOPIC: Hybrid networking
Q:
One Direct Connect connection must reach VPCs (virtual private clouds) in several AWS Regions. What do you add?
Q_ZH:
一条 Direct Connect 连接要连到多个 AWS 区域里的 VPC（virtual private cloud，虚拟私有云），要加什么？
A:
Answer: A Direct Connect gateway: one link, many Regions.
Because: a Direct Connect gateway is a global resource, so one private virtual interface to it reaches the virtual private gateways of VPCs in any Region and in other accounts, except the China Regions.
Exam: one connection to VPCs in many Regions or accounts → ✅ a Direct Connect gateway; ❌ a private virtual interface straight to one virtual private gateway: reaches one VPC in one Region
A_ZH:
答：Direct Connect gateway：一条线，多个区域。
因为：Direct Connect gateway 是全球资源，一个接到它的私有虚拟接口（private virtual interface）就能到达任意区域、其他账户里 VPC 的虚拟私有网关（中国区域除外）。
考法：一条连接到多个区域或账户的 VPC → ✅ Direct Connect gateway；❌ 私有虚拟接口直连一个虚拟私有网关：只能到一个区域里的一个 VPC
SOURCE: https://docs.aws.amazon.com/directconnect/latest/UserGuide/direct-connect-gateways-intro.html
A Direct Connect gateway is a globally available resource. You can connect to any Region globally using a Direct Connect gateway.

## awsb-hy-dx-transit-vif | d2
TOPIC: Hybrid networking
Q:
On-premises networks must reach many VPCs (virtual private clouds) attached to one transit gateway (a hub router that links networks) over Direct Connect. Which virtual interface do you create?
Q_ZH:
本地网络要通过 Direct Connect 访问挂在同一个中转网关（transit gateway，连接多个网络的中心路由器）上的很多 VPC（virtual private cloud，虚拟私有云），该建哪种虚拟接口？
A:
Answer: A transit virtual interface: via a Direct Connect gateway.
Because: the name says it: a transit virtual interface talks to a transit gateway through a Direct Connect gateway associated with it, so one connection reaches every VPC behind that transit gateway.
Exam: Direct Connect into a transit gateway → ✅ a transit virtual interface plus a Direct Connect gateway; ❌ a private virtual interface: reaches virtual private gateways, not a transit gateway
A_ZH:
答：中转虚拟接口（transit virtual interface）：经由 Direct Connect gateway。
因为：名字就是答案：中转虚拟接口通过一个关联了中转网关的 Direct Connect gateway 和中转网关对话，一条连接就能通到中转网关后面的每个 VPC。
考法：Direct Connect into a transit gateway → ✅ transit virtual interface 加 Direct Connect gateway；❌ private virtual interface：只到虚拟私有网关，接不了中转网关
SOURCE: https://docs.aws.amazon.com/directconnect/latest/UserGuide/direct-connect-transit-gateways.html
You associate a Direct Connect gateway with the Transit Gateway. Then, create a transit virtual interface for your Direct Connect connection to the Direct Connect gateway.

## awsb-hy-dx-dedicated-vs-hosted | d2
TOPIC: Hybrid networking
Q:
A small office needs only 200 Mbps (megabits per second) of Direct Connect capacity. Which connection type fits?
Q_ZH:
一个小办公室只需要 200 Mbps（megabits per second，兆比特每秒）的 Direct Connect 带宽，选哪种连接？
A:
Answer: A hosted connection: ordered through a Direct Connect Partner.
Because: the name says it: a hosted connection is hosted on a partner's link to AWS, from 50 Mbps up, while a dedicated connection is a whole physical port of at least 1 Gbps (gigabits per second).
Exam: below 1 Gbps or through a partner → ✅ a hosted connection; ❌ a dedicated connection: a full physical port of 1, 10, 100 or 400 Gbps
A_ZH:
答：托管连接（hosted connection）：通过 Direct Connect 合作伙伴订购。
因为：名字就是答案：托管连接搭在合作伙伴自己通往 AWS 的链路上，最小 50 Mbps 起；专用连接（dedicated connection）则是整个物理端口，至少 1 Gbps（gigabits per second，吉比特每秒）。
考法：below 1 Gbps or through a partner → ✅ hosted connection；❌ dedicated connection：整个物理端口，只有 1、10、100 或 400 Gbps
SOURCE: https://aws.amazon.com/directconnect/faqs/
A dedicated connection is made through a 1 Gbps, 10 Gbps, 100 Gbps, or 400 Gbps Ethernet port dedicated to a single customer. Hosted connections are sourced from a AWS Direct Connect Partner that has a network link between themselves and AWS.

## awsb-hy-dx-vpn-backup | d2
TOPIC: Hybrid networking
Q:
A Direct Connect link needs a low-cost backup path in case it fails. Which backup?
Q_ZH:
一条 Direct Connect 链路需要一条低成本的备份路径，以防它断掉，用什么做备份？
A:
Answer: AWS Site-to-Site VPN (virtual private network): cheap automatic failover.
Because: the VPN runs over your existing internet line, so it costs little, and when the Direct Connect link fails all VPC (virtual private cloud) traffic moves to the VPN automatically, at lower and less steady performance.
Exam: low-cost failover for Direct Connect → ✅ a Site-to-Site VPN backup; ❌ a second Direct Connect connection at another location: maximum resilience, but much higher cost
A_ZH:
答：AWS Site-to-Site VPN（virtual private network，虚拟专用网络）：便宜，自动故障切换。
因为：VPN 走你现有的互联网线路，所以花费很少；Direct Connect 一断，所有 VPC（virtual private cloud，虚拟私有云）流量会自动故障切换到 VPN 上，只是性能更低、更不稳定。
考法：low-cost failover for Direct Connect → ✅ 用 Site-to-Site VPN 作备份；❌ 在另一个位置再拉一条 Direct Connect：韧性最高，但贵得多
SOURCE: https://aws.amazon.com/directconnect/faqs/
If you have configured a backup IPsec VPN connection instead, all VPC traffic will failover to the VPN connection automatically.

## awsb-sl-api-gateway-lambda | d1
TOPIC: Serverless and containers
Q:
A mobile app needs a highly available HTTPS (Hypertext Transfer Protocol Secure) API (application programming interface) that runs a little code per request, with no servers to patch or scale. Which pairing?
Q_ZH:
一个手机应用需要一个高可用的 HTTPS（Hypertext Transfer Protocol Secure，安全超文本传输协议）API（application programming interface，应用程序接口），每个请求跑一点代码，而且没有要打补丁或扩缩的服务器，用哪种组合？
A:
Answer: Amazon API Gateway with AWS Lambda: a serverless API.
Because: API Gateway accepts each HTTPS request and invokes a Lambda function with it, which runs just for that request on AWS-managed, highly available compute, so you patch and scale nothing.
Exam: managed, highly available API with no servers to run → ✅ Amazon API Gateway + AWS Lambda; ❌ a web server on Amazon EC2 (Elastic Compute Cloud) instances: you patch, scale and keep it up
A_ZH:
答：Amazon API Gateway 搭配 AWS Lambda：无服务器 API。
因为：API Gateway 接收每个 HTTPS 请求，并用它调用一个 Lambda 函数；函数只为这个请求在 AWS 管理的高可用计算资源上运行，所以没有任何东西要你打补丁或扩缩。
考法：托管、高可用、不用运行服务器的 API → ✅ Amazon API Gateway + AWS Lambda；❌ 在 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例上自建 Web 服务器：打补丁、扩缩、保证在线都得你来
SOURCE: https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html
Together with AWS Lambda, API Gateway forms the app-facing part of the AWS serverless infrastructure.

## awsb-hy-dx-encryption | d1
TOPIC: Hybrid networking
Q:
Traffic crossing a Direct Connect connection must be encrypted in transit. Which option works?
Q_ZH:
经过 Direct Connect 连接的流量必须在传输中加密，哪个方案可行？
A:
Answer: An IPsec (Internet Protocol Security) VPN (virtual private network) over Direct Connect: encrypted tunnel.
Because: Direct Connect does not encrypt traffic by default, so you run an IPsec Site-to-Site VPN across it, which encrypts packets between your router and AWS; supported dedicated connections can instead use MACsec (Media Access Control Security).
Exam: encrypt Direct Connect traffic → ✅ an IPsec VPN over Direct Connect, or MACsec on supported dedicated connections; ❌ Direct Connect alone: private, but not encrypted by default
A_ZH:
答：在 Direct Connect 上跑 IPsec（Internet Protocol Security，互联网协议安全）VPN（virtual private network，虚拟专用网络）：加密隧道。
因为：Direct Connect 默认不加密，所以要在它上面跑一条 IPsec Site-to-Site VPN，把你的路由器到 AWS 之间的数据包加密；支持的专用连接也可以改用 MACsec（Media Access Control Security，介质访问控制安全）。
考法：encrypt Direct Connect traffic → ✅ Direct Connect 上的 IPsec VPN，或在支持的专用连接上用 MACsec；❌ 只用 Direct Connect：私有但默认不加密
SOURCE: https://docs.aws.amazon.com/directconnect/latest/UserGuide/encryption-in-transit.html
With AWS Direct Connect and AWS Site-to-Site VPN, you can combine one or more AWS Direct Connect dedicated network connections with the Amazon VPC VPN. This combination provides an IPsec-encrypted private connection that also reduces network costs, increases bandwidth throughput, and provides a more consistent network experience than internet-based VPN connections.

## awsb-an-opensearch-use-case | d2
TOPIC: Analytics and ML
Q:
Shoppers must type keywords and get ranked matches from millions of product descriptions within milliseconds. Which service?
Q_ZH:
顾客输入关键词后，要在几毫秒内从几百万条商品描述里拿到排好序的匹配结果，用哪个服务？
A:
Answer: Amazon OpenSearch Service: indexed full-text search.
Because: OpenSearch indexes the text of every document as it is loaded into the cluster, so a keyword query looks matches up in the index and ranks them instead of scanning raw data.
Exam: full-text search, or log and clickstream analytics with dashboards → ✅ Amazon OpenSearch Service; ❌ Amazon Athena: SQL (Structured Query Language) that scans Amazon S3 (Simple Storage Service) files per query, no search index
A_ZH:
答：Amazon OpenSearch Service：建好索引的全文搜索。
因为：OpenSearch 在数据导入集群时就为每篇文档的文本建立索引，所以关键词查询直接在索引里查找并排序，不用扫描原始数据。
考法：全文搜索，或带仪表板的日志、点击流分析 → ✅ Amazon OpenSearch Service；❌ Amazon Athena：每次查询都扫描 Amazon S3（Simple Storage Service，简单存储服务）文件的 SQL（Structured Query Language，结构化查询语言），没有搜索索引
SOURCE: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/what-is.html
OpenSearch is a fully open-source search and analytics engine for use cases such as log analytics, real-time application monitoring, and clickstream analysis.

## awsb-cr-kms-at-rest-vs-acm-in-transit | d2
TOPIC: Encryption and threat detection
Q:
Data on Amazon EBS (Elastic Block Store) volumes and their snapshots must be encrypted at rest. Which AWS service supplies the key?
Q_ZH:
Amazon EBS（Elastic Block Store，弹性块存储）卷和它们的快照上的数据必须做静态加密，由哪个 AWS 服务提供密钥？
A:
Answer: AWS KMS (Key Management Service): keys for data at rest.
Because: you mark a volume encrypted when you create it and EBS gets a data key from AWS KMS, so the volume and every snapshot made from it stay encrypted, while certificates only protect connections.
Exam: encrypt EBS volumes, RDS (Relational Database Service) databases or Amazon S3 (Simple Storage Service) data at rest → ✅ AWS KMS key on the resource; ❌ ACM (AWS Certificate Manager): TLS (Transport Layer Security) certificates for traffic in transit, encrypts no storage
A_ZH:
答：AWS KMS（Key Management Service，密钥管理服务）：给静态数据提供密钥。
因为：创建卷时你把它设为加密，EBS 会向 AWS KMS 要一把数据密钥，所以这个卷和从它做出的每个快照都保持加密；证书只保护连接。
考法：给 EBS 卷、RDS（Relational Database Service，关系型数据库服务）数据库或 Amazon S3（Simple Storage Service，简单存储服务）数据做静态加密（encrypt at rest）→ ✅ 在资源上启用 AWS KMS 密钥；❌ ACM（AWS Certificate Manager，证书管理服务）：签发 TLS（Transport Layer Security，传输层安全）证书保护传输中的流量，不加密存储
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/ebs-encryption.html
With Amazon EBS encryption, you aren't required to build, maintain, and secure your own key management infrastructure. Amazon EBS encryption uses AWS KMS keys when creating encrypted volumes and snapshots.

## awsb-dt-firewall-manager | d2
TOPIC: Encryption and threat detection
Q:
The same AWS WAF (web application firewall) rules must apply in every account of an AWS Organizations organization, including accounts added later. Which service?
Q_ZH:
同一套 AWS WAF（web application firewall，Web 应用防火墙）规则必须应用到一个 AWS Organizations 组织的所有账户，包括以后新加入的账户，用哪个服务？
A:
Answer: AWS Firewall Manager: one policy, every account.
Because: you define a policy once from the administrator account and Firewall Manager applies it to every in-scope account and resource, so new accounts and resources pick it up automatically.
Exam: enforce WAF, Shield Advanced or security group rules across all organization accounts → ✅ AWS Firewall Manager; ❌ SCPs (service control policies): only limit what accounts may do, deploy no firewall rules
A_ZH:
答：AWS Firewall Manager：一条策略，覆盖所有账户。
因为：你在管理员账户里定义一次策略，Firewall Manager 就把它应用到范围内的每个账户和资源，所以新账户、新资源也会自动套上。
考法：在组织所有账户统一强制 WAF、Shield Advanced 或安全组规则（across all accounts）→ ✅ AWS Firewall Manager；❌ SCP（service control policy，服务控制策略）：只限制账户能做什么，不部署任何防火墙规则
SOURCE: https://docs.aws.amazon.com/waf/latest/developerguide/fms-chapter.html
With Firewall Manager, you set up your protections just once and the service automatically applies them across your accounts and resources, even as you add new accounts and resources.

## awsb-dt-security-hub-standards | d2
TOPIC: Encryption and threat detection
Q:
All accounts must be checked continuously against the CIS (Center for Internet Security) AWS benchmark, with every security finding shown in one place. Which service?
Q_ZH:
所有账户都要持续按 CIS（Center for Internet Security，互联网安全中心）AWS 基准检查，并把所有安全发现集中在一个地方展示，用哪个服务？
A:
Answer: AWS Security Hub CSPM (Cloud Security Posture Management): standards checks plus findings.
Because: it runs automated configuration checks in each account against standards such as CIS and AWS Foundational Security Best Practices and also gathers GuardDuty, Inspector and Macie findings, so posture and alerts share one view.
Exam: continuous CIS or AWS best-practice checks plus aggregated findings → ✅ AWS Security Hub CSPM (older questions say AWS Security Hub); ❌ Amazon Inspector: scans software for CVEs (Common Vulnerabilities and Exposures), not account settings
A_ZH:
答：AWS Security Hub CSPM（Cloud Security Posture Management，云安全态势管理）：标准检查加发现汇总。
因为：它在每个账户里按 CIS、AWS Foundational Security Best Practices 等标准自动检查配置，同时汇集 GuardDuty、Inspector 和 Macie 的发现，所以安全态势和告警都在同一个视图里。
考法：持续做 CIS 或 AWS 最佳实践检查并汇总发现（aggregated findings）→ ✅ AWS Security Hub CSPM（老题里叫 AWS Security Hub）；❌ Amazon Inspector：扫描软件的 CVE（Common Vulnerabilities and Exposures，公开漏洞编号），不查账户配置
SOURCE: https://docs.aws.amazon.com/securityhub/latest/userguide/what-is-securityhub.html
AWS Security Hub Cloud Security Posture Management (AWS Security Hub CSPM) provides you with a comprehensive view of your security state in AWS and helps you assess your AWS environment against security industry standards and best practices.

## awsb-ec2-aws-batch | d2
TOPIC: Compute and scaling
Q:
Thousands of simulation jobs each run for about two hours, and the team does not want to manage servers or a job scheduler. Which service?
Q_ZH:
成千上万个模拟作业每个要跑两个小时左右，团队不想管服务器，也不想管作业调度器，用哪个服务？
A:
Answer: AWS Batch: managed job queues and compute.
Because: you submit jobs to a job queue, and AWS Batch provisions Amazon EC2 (Elastic Compute Cloud) or Fargate capacity, runs them and scales with the queue, so hours-long jobs need no servers managed.
Exam: many long-running batch jobs on managed compute → ✅ AWS Batch; ❌ AWS Lambda: each invocation stops at 15 minutes
A_ZH:
答：AWS Batch：托管的作业队列和计算资源。
因为：你把作业提交到作业队列，AWS Batch 自动准备 Amazon EC2（Elastic Compute Cloud，弹性计算云）或 Fargate 资源来运行，并随队列伸缩，所以作业可以跑好几个小时，也不用管服务器。
考法：大量长时间运行的批处理作业，计算资源托管（batch jobs on managed compute）→ ✅ AWS Batch；❌ AWS Lambda：每次调用最多 15 分钟
SOURCE: https://docs.aws.amazon.com/batch/latest/userguide/what-is-batch.html
AWS Batch automatically provisions compute resources and optimizes the workload distribution based on the quantity and scale of the workloads. With AWS Batch, there's no need to install or manage batch computing software, so you can focus your time on analyzing results and solving problems.

## awsb-ec2-elastic-beanstalk | d2
TOPIC: Compute and scaling
Q:
A team wants to upload its existing Java web app and let AWS set up the servers, load balancer and scaling for it. Which service?
Q_ZH:
一个团队想把现有的 Java Web 应用直接上传，让 AWS 替它搭好服务器、负载均衡器和扩缩容，用哪个服务？
A:
Answer: AWS Elastic Beanstalk: upload code, AWS builds the environment.
Because: you hand Elastic Beanstalk your application code, and it provisions the Amazon EC2 (Elastic Compute Cloud) instances, load balancing, scaling and health monitoring, so the app runs with little or no change.
Exam: deploy existing app code with the infrastructure built for you → ✅ AWS Elastic Beanstalk; ❌ AWS CloudFormation: you write the template for every resource yourself
A_ZH:
答：AWS Elastic Beanstalk：上传代码，环境由 AWS 搭好。
因为：你把应用代码交给 Elastic Beanstalk，它会准备 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例、负载均衡、扩缩容和健康监控，应用几乎不用改就能跑起来。
考法：部署现有应用代码，基础设施替你搭好（deploy code with minimal changes）→ ✅ AWS Elastic Beanstalk；❌ AWS CloudFormation：每个资源的模板都要你自己写
SOURCE: https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/Welcome.html
You build and deploy your applications. Elastic Beanstalk provisions Amazon EC2 instances or EKS clusters, configures load balancing, sets up health monitoring, and dynamically scales your environment.

## awsb-ec2-placement-group-cluster | d2
TOPIC: Compute and scaling
Q:
Tightly coupled HPC (high performance computing) nodes need the lowest possible network latency between one another. Which placement group?
Q_ZH:
紧耦合的 HPC（high performance computing，高性能计算）节点之间需要尽可能低的网络延迟，用哪种置放群组（placement group）？
A:
Answer: Cluster placement group: packed close in one zone.
Because: the name says it: a cluster group packs the instances close together inside one Availability Zone on a high-bandwidth network segment, so traffic between them gets the lowest latency and the highest throughput.
Exam: lowest latency, highest throughput between instances → ✅ cluster placement group; ❌ spread placement group: each instance on separate racks, for isolation, not speed
A_ZH:
答：Cluster placement group（集群置放群组）：在一个可用区里挤在一起。
因为：名字就是答案：集群置放群组把实例紧挨着放在同一个可用区、同一段高带宽网络里，实例之间的流量延迟最低、吞吐最高。
考法：实例之间延迟最低、吞吐最高（low latency, high throughput between instances）→ ✅ cluster placement group；❌ spread placement group：每台实例放在不同机架，为的是隔离而不是速度
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/placement-strategies.html
Cluster placement groups are recommended for applications that benefit from low network latency, high network throughput, or both. They are also recommended when the majority of the network traffic is between the instances in the group.

## awsb-ec2-ssm-patch-manager | d2
TOPIC: Compute and scaling
Q:
Hundreds of Amazon EC2 (Elastic Compute Cloud) instances must get approved operating system patches every Sunday night. Which tool?
Q_ZH:
几百台 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例每周日晚上都要装上经过批准的操作系统补丁，用哪个工具？
A:
Answer: AWS Systems Manager Patch Manager: baselines plus schedules.
Because: a patch baseline says which patches are approved, and a patch policy or maintenance window installs them on the managed nodes on schedule, so the whole fleet is patched without anyone logging in.
Exam: patch a fleet automatically on a schedule → ✅ Systems Manager Patch Manager; ❌ Amazon GuardDuty: detects threats, installs no patches
A_ZH:
答：AWS Systems Manager Patch Manager：补丁基线加时间表。
因为：补丁基线（patch baseline）规定哪些补丁获批，补丁策略或维护时段按时间表把它们装到受管节点上，整个机群不用任何人登录就打好补丁。
考法：按计划自动给一批实例打补丁（patch a fleet on a schedule）→ ✅ Systems Manager Patch Manager；❌ Amazon GuardDuty：只检测威胁，不装补丁
SOURCE: https://docs.aws.amazon.com/systems-manager/latest/userguide/patch-manager.html
Patch Manager automates the process of patching managed nodes with both security-related updates and other types of updates.

## awsb-elb-launch-template | d1
TOPIC: Compute and scaling
Q:
An Auto Scaling group must know which AMI (Amazon Machine Image), instance type and security groups to use for each new instance. Where are these settings defined?
Q_ZH:
一个 Auto Scaling group 需要知道每台新实例用哪个 AMI（Amazon Machine Image，亚马逊机器镜像）、哪种实例类型和哪些安全组，这些设置定义在哪里？
A:
Answer: A launch template: versioned launch settings.
Because: the group launches every instance from the template's settings, and templates keep versions and support newer features, while launch configurations are the legacy form that accounts created since October 2024 cannot create.
Exam: define how an Auto Scaling group launches instances → ✅ launch template; ❌ launch configuration: legacy, no new instance types, no mixed Spot and On-Demand
A_ZH:
答：启动模板（launch template）：带版本的启动设置。
因为：组里每台实例都按模板里的设置启动，模板有版本，还支持较新的功能；launch configuration（启动配置）是旧形式，2024 年 10 月以后创建的账号已经无法再创建。
考法：定义 Auto Scaling group 怎么启动实例（how the group launches instances）→ ✅ launch template；❌ launch configuration：旧方式，不支持新实例类型，也不能混用 Spot 和 On-Demand
SOURCE: https://docs.aws.amazon.com/autoscaling/ec2/userguide/launch-templates.html
A launch template is similar to a launch configuration, in that it specifies instance configuration information. It includes the ID of the Amazon Machine Image (AMI), the instance type, a key pair, security groups, and other parameters used to launch EC2 instances.

## awsb-iam-cognito-user-vs-identity-pool | d2
TOPIC: Identity and accounts
Q:
Signed-in users of a mobile app must upload files straight to Amazon S3 (Simple Storage Service) with temporary AWS credentials. Which Amazon Cognito component issues those credentials?
Q_ZH:
一个手机 App 已登录的用户要用临时 AWS 凭证把文件直接传到 Amazon S3（Simple Storage Service，简单存储服务），由 Amazon Cognito 的哪个组件来发这些凭证？
A:
Answer: A Cognito identity pool: tokens in, AWS credentials out.
Because: the identity pool takes the user's sign-in token and exchanges it for temporary, limited-privilege credentials of an IAM (Identity and Access Management) role, so the app can call Amazon S3 directly.
Exam: app users need AWS credentials to call AWS services directly → ✅ a Cognito identity pool; ❌ a Cognito user pool: signs users in and issues tokens, not AWS credentials
A_ZH:
答：Cognito 身份池（identity pool）：令牌换 AWS 凭证。
因为：身份池拿用户登录得到的令牌，换成某个 IAM（Identity and Access Management，身份与访问管理）角色的临时、受限凭证，App 就能直接调用 Amazon S3。
考法：app users need AWS credentials to call AWS services directly → ✅ Cognito identity pool；❌ Cognito user pool（用户池）：负责登录和签发令牌，不发 AWS 凭证
SOURCE: https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html
An identity pool exchanges a trusted token (from a user pool, a social provider, or a SAML or OIDC provider) for temporary, limited-privilege AWS credentials so that your app can call services like Amazon S3 and Amazon DynamoDB on the user's behalf.

## awsb-in-sqs-visibility-timeout | d1
TOPIC: Messaging and streaming
Q:
Workers reading an Amazon SQS (Simple Queue Service) queue take about 2 minutes per message, and other workers receive the same message again before the first one finishes. Which queue setting do you raise?
Q_ZH:
从 Amazon SQS（Simple Queue Service，简单队列服务）队列取消息的工作进程处理一条要约 2 分钟，可是第一个还没处理完，别的进程又收到了同一条消息，该调大队列的哪个设置？
A:
Answer: The visibility timeout: hides messages during work.
Because: after a consumer receives a message, SQS hides it from others only for the visibility timeout (30 seconds by default, up to 12 hours), so a 2-minute job needs a longer timeout or the message reappears.
Exam: duplicate processing because work outlasts the timeout → ✅ raise the visibility timeout above the processing time; ❌ long polling: waits up to 20 seconds to cut empty receives
A_ZH:
答：可见性超时（visibility timeout）：处理期间把消息藏起来。
因为：消费者收到消息后，SQS 只在可见性超时内对其他消费者隐藏它（默认 30 秒，最长 12 小时），所以要处理 2 分钟的任务必须调大超时，否则消息会重新出现。
考法：处理时间超过超时导致重复处理 → ✅ 把可见性超时调到大于处理时间；❌ 长轮询（long polling）：最多等 20 秒，用来减少空响应
SOURCE: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html
If you don't delete it before the timeout expires, the message becomes visible again in the queue and can be retrieved by another consumer. The default visibility timeout for a queue is 30 seconds, but you can adjust this to match the time your application needs to process and delete a message.

## awsb-ml-rekognition-moderation | d2
TOPIC: Analytics and ML
Q:
Photos that users upload must be checked automatically for unsafe or offensive content, without training a model. Which service?
Q_ZH:
用户上传的照片要自动检查有没有不安全或冒犯性的内容，而且不训练模型，用哪个服务？
A:
Answer: Amazon Rekognition content moderation: pre-trained image checks.
Because: the moderation API (application programming interface) runs a deep learning model AWS already trained, so each image or video comes back with moderation labels and confidence scores, and people review only the flagged items.
Exam: unsafe images or video, labels or faces, no training → ✅ Amazon Rekognition; ❌ Amazon Comprehend: analyzes text, not images
A_ZH:
答：Amazon Rekognition 内容审核（content moderation）：预训练好的图片检查。
因为：审核 API（application programming interface，应用程序接口）用的是 AWS 已训练好的深度学习模型，每张图片或每段视频都会返回审核标签和置信度，人工只需复核被标记的内容。
考法：识别不安全的图片或视频、标签或人脸，无需训练 → ✅ Amazon Rekognition；❌ Amazon Comprehend：分析文本，不分析图片
SOURCE: https://docs.aws.amazon.com/rekognition/latest/dg/moderation.html
You can use Amazon Rekognition to detect content that is inappropriate, unwanted, or offensive.

## awsb-ml-transcribe-vs-polly | d2
TOPIC: Analytics and ML
Q:
A call center wants written transcripts of its recorded customer calls. Which service?
Q_ZH:
一个呼叫中心想把录下来的客户通话变成文字记录，用哪个服务？
A:
Answer: Amazon Transcribe: speech to text.
Because: Transcribe is an automatic speech recognition service whose machine learning models convert audio into text, either streamed live or from files in Amazon S3 (Simple Storage Service), and it can tell speakers apart.
Exam: audio or calls into text → ✅ Amazon Transcribe; ❌ Amazon Polly: the opposite direction, text into lifelike speech
A_ZH:
答：Amazon Transcribe：语音转文字。
因为：Transcribe 是自动语音识别服务，用机器学习模型把音频转成文字，可以实时流式处理，也可以处理 Amazon S3（Simple Storage Service，简单存储服务）里的文件，还能区分不同的说话人。
考法：把音频或通话变成文字 → ✅ Amazon Transcribe；❌ Amazon Polly：方向正好相反，把文字变成逼真的语音
SOURCE: https://docs.aws.amazon.com/transcribe/latest/dg/what-is.html
Amazon Transcribe is an automatic speech recognition service that uses machine learning models to convert audio to text. You can use Amazon Transcribe as a standalone transcription service or to add speech-to-text capabilities to any application.

## awsb-org-tag-policies | d2
TOPIC: Identity and accounts
Q:
Teams in many accounts spell the same tag key three ways, such as CostCenter, costcenter and cost-center. Which policy type sets one standard?
Q_ZH:
多个账户里的团队把同一个标签键写成三种样子，比如 CostCenter、costcenter 和 cost-center，用哪种策略统一标准？
A:
Answer: Tag policies in AWS Organizations: one tagging standard.
Because: a tag policy sets each key's exact case and allowed values for the accounts under it and can report or block noncompliant tags; untagged resources are never checked, so blocking those needs an SCP (service control policy).
Exam: standardize tag keys, case and values across accounts → ✅ tag policies; ❌ an SCP Deny with aws:RequestTag: blocks requests, sets no tag standard
A_ZH:
答：AWS Organizations 的标签策略（tag policy）：一套标签标准。
因为：标签策略为它下面的账户规定每个标签键的大小写和允许的值，既能报告也能拦截不合规的标签；没打标签的资源根本不检查，要拦住它们得靠 SCP（service control policy，服务控制策略）。
考法：standardize tag keys, case and values across accounts → ✅ tag policies；❌ 带 aws:RequestTag 的 SCP Deny：只拦请求，不定义标签标准
SOURCE: https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_tag-policies.html
Tag policies allow you to standardize the tags attached to the AWS resources in your organization's accounts. You can use tag policies to maintain consistent tags, including the preferred case treatment of tag keys and tag values.

## awsb-rds-aurora-replica-auto-scaling | d2
TOPIC: Databases
Q:
Read traffic on an Aurora cluster climbs every evening and falls overnight. Which feature adds and removes Aurora Replicas to match it?
Q_ZH:
一个 Aurora 集群的读流量每晚上升、深夜回落，用哪个功能自动增减 Aurora Replica 来匹配？
A:
Answer: Aurora Auto Scaling: the replica count follows load.
Because: a scaling policy sets a minimum and maximum number of replicas and a target such as average reader CPU (central processing unit), so CloudWatch alarms add replicas above the target and remove them when load drops.
Exam: variable read load on Aurora → ✅ Aurora Auto Scaling for Aurora Replicas; ❌ Amazon RDS (Relational Database Service) read replicas: no autoscaling, added by hand; ❌ Amazon Redshift: analytics warehouse, not app reads
A_ZH:
答：Aurora Auto Scaling：副本数量跟着负载走。
因为：扩缩策略设定副本数的最小值、最大值和一个目标值，比如读实例的平均 CPU（central processing unit，中央处理器），所以 CloudWatch 告警在超过目标时加副本，负载下降时再删掉。
考法：Aurora 读负载起伏 → ✅ 给 Aurora Replica 用 Aurora Auto Scaling；❌ Amazon RDS（Relational Database Service，关系型数据库服务）只读副本：不支持自动扩缩，要手动添加；❌ Amazon Redshift：分析型数据仓库，不服务应用的读请求
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Integrating.AutoScaling.html
To meet your connectivity and workload requirements, Aurora Auto Scaling dynamically adjusts the number of Aurora Replicas (reader DB instances) provisioned for an Aurora DB cluster.

## awsb-s3-presigned-url | d2
TOPIC: S3 storage
Q:
A customer without AWS credentials must download one private Amazon S3 (Simple Storage Service) object, and access must end after one hour. Which S3 mechanism?
Q_ZH:
一位没有 AWS 凭证的客户要下载一个私有 Amazon S3（Simple Storage Service，简单存储服务）对象，而且一小时后访问必须失效，用哪种 S3 机制？
A:
Answer: A presigned URL (uniform resource locator): a time-limited signed link.
Because: the URL carries a signature made with its creator's credentials plus an expiry time, so S3 accepts requests for that object from anyone holding the link until it expires.
Exam: temporary access to one private object without AWS credentials → ✅ presigned URL; ❌ S3 Block Public Access: blocks public grants, gives no one access
A_ZH:
答：预签名的 URL（uniform resource locator，网址），即 presigned URL：限时的签名链接。
因为：这个网址里带着用创建者凭证生成的签名和过期时间，所以在过期前，S3 接受任何持有链接的人对这个对象的请求。
考法：没有 AWS 凭证、临时访问一个私有对象（temporary access to one private object）→ ✅ presigned URL；❌ S3 Block Public Access：阻止公开授权，不给任何人开权限
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html
However, the object owner may share objects with others by creating a presigned URL. A presigned URL uses security credentials to grant time-limited permission to download objects.

## awsb-s3-storage-lens | d2
TOPIC: S3 storage
Q:
A company with 40 accounts wants one dashboard showing storage use and the fastest-growing buckets across every account and Region. Which Amazon S3 (Simple Storage Service) feature?
Q_ZH:
一家公司有 40 个账户，想用一个仪表板看所有账户和区域的存储用量，以及增长最快的存储桶，用哪个 Amazon S3（Simple Storage Service，简单存储服务）功能？
A:
Answer: Amazon S3 Storage Lens: organization-wide storage metrics.
Because: it collects usage and activity metrics daily from the accounts in your AWS Organizations organization into one dashboard that you can drill into by account, Region and bucket, with folder-like prefixes in the paid advanced tier.
Exam: organization-wide storage usage and activity across accounts → ✅ Amazon S3 Storage Lens; ❌ IAM (Identity and Access Management) Access Analyzer: finds shared or unused access, no storage metrics
A_ZH:
答：Amazon S3 Storage Lens：整个组织的存储指标。
因为：它每天从你 AWS Organizations 里的各个账户收集用量和活动指标，汇总到一个仪表板，可以按账户、区域、存储桶逐级下钻；要细到类似文件夹的前缀（prefix）级别，需要付费的高级层（advanced tier）。
考法：跨账户、全组织的存储用量和活动（organization-wide storage usage and activity）→ ✅ Amazon S3 Storage Lens；❌ IAM（Identity and Access Management，身份与访问管理）Access Analyzer：找出被共享或未使用的访问权限，不提供存储指标
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage_lens.html
Amazon S3 Storage Lens is a cloud-storage analytics feature that you can use to gain organization-wide visibility into object storage and activity. S3 Storage Lens also analyzes metrics to deliver contextual recommendations that you can use to optimize storage costs and apply best practices for protecting your data.

## awsb-sl-function-url | d2
TOPIC: Serverless and containers
Q:
One Lambda function needs its own HTTPS (Hypertext Transfer Protocol Secure) endpoint for a webhook, with no usage plans, caching or custom domain. Which option is simplest?
Q_ZH:
一个 Lambda 函数需要一个自己的 HTTPS（Hypertext Transfer Protocol Secure，安全超文本传输协议）终端节点来接收 webhook，不需要使用计划、缓存或自定义域名，哪种方式最简单？
A:
Answer: A Lambda function URL (uniform resource locator): a built-in endpoint.
Because: Lambda itself generates a fixed HTTPS endpoint for that one function, protected by IAM (Identity and Access Management) authentication or left public, so no separate API (application programming interface) service sits in front to build or pay for.
Exam: one function needing only an HTTPS endpoint → ✅ Lambda function URL; ❌ Amazon API Gateway: for usage plans, caching, Cognito or custom authorizers, many routes
A_ZH:
答：Lambda 函数 URL（uniform resource locator，网址）：自带的终端节点。
因为：Lambda 自己为这一个函数生成固定的 HTTPS 终端节点，可以用 IAM（Identity and Access Management，身份与访问管理）认证保护，也可以公开，所以前面不需要再搭一个要付费的 API（application programming interface，应用程序接口）服务。
考法：只有一个函数、只需要一个 HTTPS 终端节点 → ✅ Lambda 函数 URL；❌ Amazon API Gateway：需要使用计划、缓存、Cognito 或自定义授权方、多条路由时才用它
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/furls-http-invoke-decision.html
Lambda function URLs provide a simple, direct HTTP endpoint for a Lambda Event Function. They are optimized for simplicity and cost-effectiveness and provide the fastest path to expose a Lambda Event Function via HTTP.

## awsb-sl-lambda-in-vpc | d3
TOPIC: Serverless and containers
Q:
A Lambda function must query an Amazon RDS (Relational Database Service) database that sits in private subnets of your VPC (virtual private cloud). Which function setting makes this possible?
Q_ZH:
一个 Lambda 函数要查询放在你 VPC（virtual private cloud，虚拟私有云）私有子网里的 Amazon RDS（Relational Database Service，关系型数据库服务）数据库，函数的哪项设置让它能连上？
A:
Answer: A VPC configuration: attach it to your private subnets.
Because: by default a function runs in a Lambda-owned VPC that cannot reach your private subnets; attaching it places network interfaces in your subnets, so its traffic travels inside your VPC to the database.
Exam: Lambda must reach private VPC resources → ✅ attach the function to private subnets with a security group, adding a NAT (network address translation) gateway for internet; ❌ more IAM (Identity and Access Management) permissions: grant rights, not a network path
A_ZH:
答：VPC 配置：把函数挂到你的私有子网。
因为：默认情况下函数运行在 Lambda 自己的 VPC 里，到不了你的私有子网；挂接后 Lambda 会在你的子网里放置网络接口，函数的流量就在你的 VPC 内部直达数据库。
考法：Lambda 要访问 VPC 里的私有资源 → ✅ 把函数挂到私有子网并配置安全组（security group），要上网再加 NAT（network address translation，网络地址转换）网关；❌ 加更多 IAM（Identity and Access Management，身份与访问管理）权限：权限给的是许可，不是网络通路
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html
You can give your Lambda function access to resources hosted in an Amazon VPC by attaching your function to the VPC through the private subnets that contain the resources.

## awsb-vpc-network-firewall | d2
TOPIC: VPC networking
Q:
Instances in a VPC (virtual private cloud) may send web traffic out only to an approved list of domain names, such as updates.example.com. Which AWS service enforces that?
Q_ZH:
一个 VPC（virtual private cloud，虚拟私有云）里的实例只能向一份批准的域名清单（比如 updates.example.com）发出 Web 流量，用哪个 AWS 服务来强制执行？
A:
Answer: AWS Network Firewall: domain allow list rules.
Because: route tables send the VPC's traffic through a firewall endpoint, where a domain list rule group reads the hostname each web request asks for, so only listed domains pass; security groups see only addresses and ports, never names.
Exam: allow outbound traffic only to approved domains → ✅ AWS Network Firewall; ❌ security groups or network ACLs (access control lists): match only IP (Internet Protocol) addresses and ports; ❌ AWS WAF (web application firewall): filters inbound web requests
A_ZH:
答：AWS Network Firewall：按域名放行的规则。
因为：路由表把 VPC 的流量引到防火墙终端节点，那里的域名清单规则组读出每个 Web 请求要访问的主机名，只放行清单里的域名；安全组只看地址和端口，从不看名字。
考法：出站流量只允许访问批准的域名 → ✅ AWS Network Firewall；❌ security group 或 network ACL（access control list，访问控制列表）：只匹配 IP（Internet Protocol，互联网协议）地址和端口，不认域名；❌ AWS WAF（web application firewall，Web 应用防火墙）：过滤进入应用的 Web 请求
SOURCE: https://docs.aws.amazon.com/network-firewall/latest/developerguide/stateful-rule-groups-domain-names.html
AWS Network Firewall supports domain name stateful network traffic inspection. You can create allow lists and deny lists with domain names that the stateful rules engine looks for in network traffic.

## awsb-an-databrew | d2
TOPIC: Analytics and ML
Q:
Business analysts who cannot write code must clean and normalize a dataset by picking transformations in a visual tool. Which service?
Q_ZH:
不会写代码的业务分析师，要在一个可视化工具里点选转换步骤来清洗和规范一份数据集，用哪个服务？
A:
Answer: AWS Glue DataBrew: no-code cleaning recipes.
Because: DataBrew offers more than 250 ready-made transformations that analysts click together into a reusable recipe, and it runs serverless, so there are no clusters and no code.
Exam: no-code visual data preparation for analysts → ✅ AWS Glue DataBrew; ❌ AWS Glue Studio: a visual editor that builds Spark ETL (extract, transform, and load) jobs for data engineers
A_ZH:
答：AWS Glue DataBrew：无需写代码的清洗配方（recipe）。
因为：DataBrew 提供 250 多种现成转换，分析师点选组合成可复用的配方，而且它是无服务器的，没有集群也没有代码。
考法：给分析师用的无代码可视化数据准备 → ✅ AWS Glue DataBrew；❌ AWS Glue Studio：给数据工程师构建 Spark ETL（extract, transform, and load，抽取、转换、加载）作业的可视化编辑器
SOURCE: https://docs.aws.amazon.com/databrew/latest/dg/what-is.html
AWS Glue DataBrew is a visual data preparation tool that enables users to clean and normalize data without writing any code.

## awsb-bf-ebs-recycle-bin-archive | d2
TOPIC: Block and file storage
Q:
Your team wants any Amazon EBS (Elastic Block Store) snapshot deleted by mistake to stay recoverable for 7 days. Which feature?
Q_ZH:
团队希望任何被误删的 Amazon EBS（Elastic Block Store，弹性块存储）快照在 7 天内都能找回，用哪个功能？
A:
Answer: Recycle Bin with a retention rule: deletions stay recoverable.
Because: a retention rule sends matching deleted snapshots, EBS-backed AMIs (Amazon Machine Images) or volumes to the Recycle Bin instead of erasing them, so you can restore them until the retention period you set ends.
Exam: recover accidentally deleted snapshots or AMIs → ✅ Recycle Bin; ❌ Amazon EBS Snapshots Archive: up to 75 percent cheaper long-term storage, no delete protection
A_ZH:
答：设置了保留规则（retention rule）的回收站（Recycle Bin）：误删也能找回。
因为：保留规则让被删除的匹配快照、EBS 支持的 AMI（Amazon Machine Image，亚马逊机器镜像）或卷进入回收站而不是直接清除，在你设定的保留期结束前都能恢复。
考法：找回误删的快照或 AMI → ✅ Recycle Bin；❌ Amazon EBS Snapshots Archive：长期存储最多便宜 75%，不防误删
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/recycle-bin.html
Recycle Bin is a data recovery feature that enables you to restore accidentally deleted EBS volumes, EBS snapshots, and EBS-backed AMIs. When using Recycle Bin, if your resources are deleted, they are retained in the Recycle Bin for a time period that you specify before being permanently deleted.

## awsb-bf-fast-snapshot-restore | d3
TOPIC: Block and file storage
Q:
Volumes created from an Amazon EBS (Elastic Block Store) snapshot must deliver full performance the moment they are created. Which feature?
Q_ZH:
从 Amazon EBS（Elastic Block Store，弹性块存储）快照创建的卷，要在创建那一刻就提供满性能，用哪个功能？
A:
Answer: EBS fast snapshot restore: volumes are fully initialized at creation.
Because: a normally restored volume must download each block from Amazon S3 (Simple Storage Service) the first time it is read, so early reads are slow; fast snapshot restore, enabled per snapshot in each Availability Zone, skips that wait.
Exam: full performance right after a snapshot restore → ✅ fast snapshot restore; ❌ Provisioned Rate for Volume Initialization: predictable 100 to 300 MiB/s (mebibytes per second) fill, not instant; ❌ more IOPS (input/output operations per second): first reads still wait on S3
A_ZH:
答：EBS 快速快照恢复（fast snapshot restore）：卷一创建就已完全初始化。
因为：普通方式恢复的卷，每个块第一次被读时都要先从 Amazon S3（Simple Storage Service，简单存储服务）下载，所以刚开始读得慢；快速快照恢复按快照、按可用区启用，省掉了这段等待。
考法：从快照恢复后立刻要满性能 → ✅ fast snapshot restore；❌ Provisioned Rate for Volume Initialization（预置卷初始化速率）：按 100 到 300 MiB/s（mebibytes per second，每秒兆字节）可预测地填充，不是立刻满速；❌ 预置更多 IOPS（input/output operations per second，每秒读写次数）：第一次读仍要等 S3
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/ebs-fast-snapshot-restore.html
Amazon EBS fast snapshot restore (FSR) enables you to create a volume from a snapshot that is fully initialized at creation. This eliminates the latency of I/O operations on a block when it is accessed for the first time.

## awsb-bf-fsx-windows-multi-az | d1
TOPIC: Block and file storage
Q:
A Windows file share on Amazon FSx for Windows File Server must stay available if one Availability Zone fails. Which deployment type?
Q_ZH:
Amazon FSx for Windows File Server 上的一个 Windows 文件共享，要在一个可用区故障时仍然可用，选哪种部署类型？
A:
Answer: Multi-AZ (Multi-Availability Zone): a standby file server in a second zone.
Because: Multi-AZ runs a cluster of Windows file servers across two Availability Zones with data replicated synchronously, so it fails over to the standby zone automatically, while Single-AZ keeps everything in one zone.
Exam: highly available Windows file shares that survive a zone outage → ✅ Multi-AZ deployment; ❌ Single-AZ deployment: one zone, down during a zone outage; ❌ Amazon EFS (Elastic File System): Linux NFS (Network File System) shares, no SMB (Server Message Block)
A_ZH:
答：Multi-AZ（Multi-Availability Zone，多可用区）：第二个可用区里有备用文件服务器。
因为：Multi-AZ 在两个可用区运行一组 Windows 文件服务器集群，数据同步复制，所以会自动故障切换到备用可用区；Single-AZ 则把一切都放在一个可用区。
考法：可用区故障时也要可用的高可用 Windows 文件共享 → ✅ Multi-AZ deployment；❌ Single-AZ deployment：只在一个可用区，可用区故障就中断；❌ Amazon EFS（Elastic File System，弹性文件系统）：Linux 的 NFS（Network File System，网络文件系统）共享，不支持 SMB（Server Message Block，Windows 文件共享协议）
SOURCE: https://docs.aws.amazon.com/fsx/latest/WindowsGuide/high-availability-multiAZ.html
Data is replicated synchronously within each individual AZ and between the two AZs. Relative to Single-AZ deployment, Multi-AZ deployments provide enhanced durability by further replicating data across AZs, and enhanced availability during planned system maintenance and unplanned service disruption by failing over automatically to the standby AZ.

## awsb-cr-acm-certificate-region | d1
TOPIC: Encryption and threat detection
Q:
A CloudFront distribution needs an ACM (AWS Certificate Manager) certificate for its custom domain. In which Region must you request or import the certificate?
Q_ZH:
一个 CloudFront 分发要给自定义域名配 ACM（AWS Certificate Manager，证书管理服务）证书，必须在哪个区域申请或导入这张证书？
A:
Answer: US East (N. Virginia), us-east-1: CloudFront reads certificates only there.
Because: AWS rule: ACM certificates are Regional and cannot be copied; CloudFront takes certificates only from us-east-1 and spreads them to its edge locations, while an Application Load Balancer needs one in its own Region.
Exam: HTTPS (Hypertext Transfer Protocol Secure) certificate for CloudFront or an edge-optimized API (application programming interface) → ✅ request or import it in us-east-1; ❌ the Region where the origin runs, such as eu-west-1: only serves a load balancer or Regional API there
A_ZH:
答：us-east-1（美国东部，弗吉尼亚北部）：CloudFront 只从那里读取证书。
因为：AWS 规定，记住即可：ACM 证书是区域级资源，不能跨区域复制；CloudFront 只从 us-east-1 取证书，再分发到各边缘站点，而 Application Load Balancer 要用它自己所在区域的证书。
考法：给 CloudFront 或边缘优化（edge-optimized）API（application programming interface，应用程序接口）配 HTTPS（Hypertext Transfer Protocol Secure，安全超文本传输协议）证书 → ✅ 在 us-east-1 申请或导入；❌ 源站所在区域（如 eu-west-1）：只能给那里的负载均衡器或区域级 API 用
SOURCE: https://docs.aws.amazon.com/acm/latest/userguide/acm-overview.html
To use an ACM certificate with Amazon CloudFront, you must request or import the certificate in the US East (N. Virginia) region. ACM certificates in this region that are associated with a CloudFront distribution are distributed to all the geographic locations configured for that distribution.

## awsb-cr-acm-dns-validation | d2
TOPIC: Encryption and threat detection
Q:
An ACM (AWS Certificate Manager) certificate for your domain must keep renewing with no human action. Which validation method?
Q_ZH:
你域名的一张 ACM（AWS Certificate Manager，证书管理服务）证书必须一直自动续期，不需要任何人工操作，用哪种验证方式？
A:
Answer: DNS (Domain Name System) validation: renewal stays automatic.
Because: you add ACM's CNAME (canonical name) record once, so while it stays in place and the certificate is in use, ACM renews by itself, whereas email validation needs the domain owner to click a link every renewal.
Exam: automatic renewal with no manual steps → ✅ DNS validation on an ACM-issued certificate; ❌ an imported certificate: ACM never renews it, you reimport before expiry; ❌ email validation: an owner must approve each renewal
A_ZH:
答：DNS（Domain Name System，域名系统）验证：续期一直自动。
因为：ACM 给你的 CNAME（canonical name，规范名称）记录只需添加一次，所以只要它还在、证书还在使用，ACM 就自己续期；邮件验证则每次续期都要域名所有者点链接。
考法：自动续期、无需人工（automatic renewal）→ ✅ ACM 签发的证书加 DNS 验证；❌ 导入的证书：ACM 从不续期，要你在到期前重新导入；❌ 邮件验证：每次续期都要所有者批准
SOURCE: https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html
The CNAME records must be added to your DNS database only once. ACM automatically renews your certificate as long as the certificate is in use and your CNAME record remains in place.

## awsb-cr-kms-encrypted-queue | d3
TOPIC: Encryption and threat detection
Q:
Producers can no longer send messages after an Amazon SQS (Simple Queue Service) queue switched to a customer managed AWS KMS (Key Management Service) key. Which permissions do they need?
Q_ZH:
一个 Amazon SQS（Simple Queue Service，简单队列服务）队列改用客户托管的 AWS KMS（Key Management Service，密钥管理服务）密钥后，生产者再也发不出消息，它们需要哪些权限？
A:
Answer: kms:GenerateDataKey and kms:Decrypt on that key.
Because: SQS encrypts messages with a data key that the sender's request must create through KMS and decrypt to verify, so producers need both actions, consumers need kms:Decrypt, and the key policy must allow these principals.
Exam: sends fail on a KMS-encrypted SQS queue or SNS (Simple Notification Service) topic → ✅ senders get kms:GenerateDataKey plus kms:Decrypt, SQS consumers get kms:Decrypt; ❌ queue or topic policy alone: grants nothing on the key
A_ZH:
答：对这把密钥的 kms:GenerateDataKey 和 kms:Decrypt。
因为：SQS 用数据密钥加密消息，这把数据密钥要由发送方的请求通过 KMS 生成并解密校验，所以生产者两个操作都要，消费者要 kms:Decrypt，而且密钥策略必须放行这些主体。
考法：KMS 加密的 SQS 队列或 SNS（Simple Notification Service，简单通知服务）主题发送失败 → ✅ 发送方给 kms:GenerateDataKey 加 kms:Decrypt，SQS 消费者给 kms:Decrypt；❌ 只改队列或主题策略：它不授予密钥上的任何权限
SOURCE: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-key-management.html
When the data key reuse period expires, the producer's next call to SendMessage or SendMessageBatch also triggers calls to kms:Decrypt and kms:GenerateDataKey. The call to kms:Decrypt is to verify the integrity of the new data key before using it.

## awsb-cr-kms-multi-region | d3
TOPIC: Encryption and threat detection
Q:
Data encrypted with AWS KMS (Key Management Service) in one Region must be decrypted in a second Region without re-encrypting it. Which key type?
Q_ZH:
在一个区域（Region）用 AWS KMS（Key Management Service，密钥管理服务）加密的数据，要在另一个区域直接解密、不重新加密，用哪种密钥？
A:
Answer: Multi-Region keys: same key material in both Regions.
Because: a standard KMS key exists in one Region, so a key in another Region has different material and cannot decrypt the data, while a multi-Region primary key and its replica share the same material and key identifier.
Exam: encrypt in one Region, decrypt in another with the same key → ✅ multi-Region primary and replica keys; ❌ a separate single-Region key in each Region: different material, cannot decrypt each other's data
A_ZH:
答：多区域密钥（multi-Region keys）：两个区域的密钥材料相同。
因为：普通 KMS 密钥只存在于一个区域，所以另一个区域的密钥材料不同，解不开这份数据；而多区域主密钥和它的副本共享同样的材料和密钥标识符。
考法：一个区域加密、另一个区域用同一把密钥解密 → ✅ multi-Region 主密钥和副本密钥；❌ 每个区域各建一把单区域密钥：材料不同，互相解不开
SOURCE: https://docs.aws.amazon.com/kms/latest/developerguide/multi-region-keys-overview.html
Each set of related multi-Region keys has the same key material and key ID, so you can encrypt data in one AWS Region and decrypt it in a different AWS Region without re-encrypting or making a cross-Region call to AWS KMS.

## awsb-cr-sse-c | d2
TOPIC: Encryption and threat detection
Q:
Your company must keep its encryption keys itself and never let AWS store them, yet wants Amazon S3 (Simple Storage Service) to do the encrypting. Which SSE (server-side encryption) option?
Q_ZH:
公司必须自己保管加密密钥，绝不能让 AWS 存储，但又想让 Amazon S3（Simple Storage Service，简单存储服务）来做加密，选哪种 SSE（server-side encryption，服务器端加密）？
A:
Answer: SSE-C (server-side encryption with customer-provided keys): you send the key.
Because: the key travels over HTTPS (Hypertext Transfer Protocol Secure) with every request and S3 discards it after encrypting or decrypting, so AWS never stores it; since April 2026 new buckets block SSE-C until you enable it.
Exam: keep your own keys, AWS must not store them, S3 encrypts → ✅ SSE-C, enabled on the bucket first; ❌ SSE-KMS (server-side encryption with keys in AWS Key Management Service): the key stays stored in AWS KMS
A_ZH:
答：SSE-C（server-side encryption with customer-provided keys，客户提供密钥的服务器端加密）：密钥由你随请求发送。
因为：密钥随每次请求通过 HTTPS（Hypertext Transfer Protocol Secure，安全超文本传输协议）发过去，S3 加密或解密后就丢弃，所以 AWS 从不存储它；从 2026 年 4 月起，新存储桶默认禁用 SSE-C，要你主动开启。
考法：密钥自己保管、AWS 不得存储、由 S3 加密 → ✅ SSE-C，先在存储桶上开启；❌ SSE-KMS（server-side encryption with keys in AWS Key Management Service，用 KMS 密钥的服务器端加密）：密钥存放在 AWS KMS 里
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/ServerSideEncryptionCustomerKeys.html
S3 never stores the encryption key when you use SSE-C. You must supply the encryption key every time you want anyone to download your SSE-C encrypted data from S3.

## awsb-ct-k8s-autoscaling | d2
TOPIC: Serverless and containers
Q:
On an Amazon EKS (Elastic Kubernetes Service) cluster, new pods stay Pending because every node is already full. Which tool adds the missing capacity?
Q_ZH:
在一个 Amazon EKS（Elastic Kubernetes Service，托管 Kubernetes 服务）集群里，新的 Pod 一直处于 Pending 状态，因为每个节点都已经满了，用哪个工具补上缺的容量？
A:
Answer: Karpenter or Cluster Autoscaler: they add nodes.
Because: Karpenter or the Kubernetes Cluster Autoscaler watches for pods that cannot be scheduled and launches new EC2 (Elastic Compute Cloud) nodes for them, so the pending pods get room; EKS Auto Mode does this for you.
Exam: pods pending because nodes are full → ✅ Karpenter or the Kubernetes Cluster Autoscaler; ❌ Horizontal Pod Autoscaler: adds pods, not nodes
A_ZH:
答：Karpenter 或 Cluster Autoscaler：它们负责加节点。
因为：Karpenter 或 Kubernetes Cluster Autoscaler 发现调度不上去的 Pod，就为它们启动新的 EC2（Elastic Compute Cloud，弹性计算云）节点，Pending 的 Pod 就有地方跑了；EKS Auto Mode 会自动替你做这件事。
考法：节点满了导致 Pod 一直 Pending → ✅ Karpenter 或 Kubernetes Cluster Autoscaler；❌ Horizontal Pod Autoscaler（水平 Pod 自动扩缩器）：只加 Pod，不加节点
SOURCE: https://docs.aws.amazon.com/eks/latest/userguide/autoscaling.html
Karpenter is a flexible, high-performance Kubernetes cluster autoscaler that helps improve application availability and cluster efficiency. Karpenter launches right-sized compute resources (for example, Amazon EC2 instances) in response to changing application load in under a minute.

## awsb-ct-task-pod-role | d3
TOPIC: Serverless and containers
Q:
Two apps run as Amazon ECS (Elastic Container Service) tasks on the same EC2 (Elastic Compute Cloud) host, and each must get only its own AWS permissions. Where do you grant them?
Q_ZH:
两个应用作为 Amazon ECS（Elastic Container Service，容器服务）任务跑在同一台 EC2（Elastic Compute Cloud，弹性计算云）主机上，各自只能拿到自己的 AWS 权限，权限授予在哪里？
A:
Answer: An ECS task IAM (Identity and Access Management) role: one role per task.
Because: ECS hands each task role's temporary credentials only to the containers of that task, so two tasks on one host stay apart, while the host's instance role is shared by everything running on it.
Exam: each task or pod needs its own AWS permissions → ✅ ECS task IAM role, or for Amazon EKS (Elastic Kubernetes Service) pods, EKS Pod Identity; ❌ the host's instance or node role: shared by every task on it
A_ZH:
答：ECS 任务 IAM（Identity and Access Management，身份与访问管理）角色（task IAM role）：每个任务一个角色。
因为：ECS 只把某个任务角色的临时凭证交给该任务里的容器，所以同一台主机上的两个任务互相隔离；而主机的实例角色会被上面运行的所有东西共用。
考法：每个任务或 Pod 都要有自己的 AWS 权限 → ✅ ECS 任务 IAM 角色，在 Amazon EKS（Elastic Kubernetes Service，托管 Kubernetes 服务）上则用 EKS Pod Identity；❌ 主机的实例角色或节点角色：上面所有任务共用
SOURCE: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html
Your Amazon ECS tasks can have an IAM role associated with them. The permissions granted in the IAM role are vended to containers running in the task.

## awsb-dns-alias-vs-cname | d1
TOPIC: Edge and DNS
Q:
The bare domain example.com, with no www in front, must point to an Application Load Balancer. Which Route 53 record type works there?
Q_ZH:
裸域名 example.com（前面没有 www）要指向一个 Application Load Balancer，在 Route 53 里用哪种记录才行？
A:
Answer: An alias record: allowed at the zone apex.
Because: an alias record returns the load balancer's current IP (Internet Protocol) addresses directly instead of pointing to another name, so it is allowed at the zone apex (the bare domain itself), where a CNAME (canonical name) record is not.
Exam: zone apex or root domain pointing to an AWS resource → ✅ Route 53 alias record, free queries to AWS targets; ❌ CNAME record: not allowed at the zone apex, and its queries are billed
A_ZH:
答：别名记录（alias record）：可以放在区域顶点（zone apex）。
因为：别名记录直接返回负载均衡器当前的 IP（Internet Protocol，互联网协议）地址，而不是指向另一个名字，所以可以放在区域顶点（zone apex，也就是裸域名本身）；CNAME（canonical name，规范名称）记录在那里不允许。
考法：区域顶点或根域名指向 AWS 资源 → ✅ Route 53 alias record，指向 AWS 资源的查询免费；❌ CNAME 记录：不能放在区域顶点，而且查询要收费
SOURCE: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-choosing-alias-non-alias.html
Unlike a CNAME record, you can create an alias record at the top node of a DNS namespace, also known as the zone apex. For example, if you register the DNS name example.com, the zone apex is example.com.

## awsb-ec2-capacity-reservation | d2
TOPIC: Compute and scaling
Q:
A one-week event needs guaranteed Amazon EC2 (Elastic Compute Cloud) capacity in one Availability Zone, with no long-term commitment. Which option?
Q_ZH:
一个为期一周的活动需要在一个可用区（Availability Zone）里保证有 Amazon EC2（Elastic Compute Cloud，弹性计算云）容量，而且不想做长期承诺，选哪种方式？
A:
Answer: On-Demand Capacity Reservation: held capacity, no term.
Because: a Capacity Reservation holds capacity for one instance type in one Availability Zone until you cancel it, billed at On-Demand rates, used or not, so the capacity is there but gives no discount by itself.
Exam: guaranteed capacity in one zone for a short time → ✅ On-Demand Capacity Reservation; ❌ regional Reserved Instance or Savings Plan: discount only, no capacity held
A_ZH:
答：On-Demand Capacity Reservation（按需容量预留）：留住容量，不用签期限。
因为：容量预留从创建起到你取消为止，在一个可用区里替你留住某种类型实例的容量，不管用没用都按 On-Demand 价计费，所以容量一定在；它本身不带折扣。
考法：短期内在指定可用区保证有容量（guaranteed capacity, short term）→ ✅ On-Demand Capacity Reservation；❌ 区域级 Reserved Instance 或 Savings Plan：只给折扣，不留容量
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-capacity-reservations.html
Amazon EC2 Capacity Reservations allow you to reserve compute capacity for your Amazon EC2 instances in a specific Availability Zone for any duration. If you have strict capacity requirements for current or future business-critical workloads that require a certain level of long or short-term capacity assurance, we recommend that you create a Capacity Reservation to help ensure that you always have access to Amazon EC2 capacity when you need it, for as long as you need it.

## awsb-ed-cloudfront-oac | d2
TOPIC: Edge and DNS
Q:
Files in a private Amazon S3 (Simple Storage Service) bucket must be reachable only through one CloudFront distribution, never by direct S3 links. Which CloudFront feature?
Q_ZH:
私有 Amazon S3（Simple Storage Service，简单存储服务）存储桶里的文件只能通过某一个 CloudFront 分配访问，绝不能用 S3 直链访问，用哪个 CloudFront 功能？
A:
Answer: OAC (origin access control): CloudFront signs its requests to S3.
Because: with OAC, every edge location signs the requests it sends to the bucket, and the bucket policy allows only the CloudFront service acting for that one distribution, so direct S3 requests are denied.
Exam: S3 content only through CloudFront → ✅ OAC plus a bucket policy for that distribution; ❌ OAI (origin access identity): legacy, no support for objects encrypted with AWS KMS (Key Management Service)
A_ZH:
答：OAC（origin access control，源访问控制）：CloudFront 给发往 S3 的请求签名。
因为：启用 OAC 后，每个边缘站点发往存储桶的请求都带签名，而存储桶策略只允许代表这一个分配的 CloudFront 服务访问，所以直接访问 S3 的请求一律被拒绝。
考法：S3 内容只能经 CloudFront 访问 → ✅ OAC 加上只允许该分配的存储桶策略；❌ OAI（origin access identity，源访问身份）：旧方案，不支持用 AWS KMS（Key Management Service，密钥管理服务）加密的对象
SOURCE: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
CloudFront provides two ways to send authenticated requests to an Amazon S3 origin: origin access control (OAC) and origin access identity (OAI). OAC helps you secure your origins, such as Amazon S3.

## awsb-ed-custom-origin | d3
TOPIC: Edge and DNS
Q:
A web app must stay on servers in the company's own data center, yet users worldwide need faster page loads. Which AWS service speeds it up without moving it?
Q_ZH:
一个 Web 应用必须留在公司自己机房的服务器上，但全球用户需要更快的页面加载，用哪个 AWS 服务能在不搬迁的情况下给它提速？
A:
Answer: Amazon CloudFront with a custom origin: any reachable web server.
Because: a custom origin is any HTTP (Hypertext Transfer Protocol) server CloudFront can reach, in AWS or not; edges cache what they can and keep persistent connections to the origin, so even uncached requests arrive faster.
Exam: origin must stay on premises or on its current servers, global users need lower latency → ✅ CloudFront with a custom origin; ❌ AWS Global Accelerator: no caching, and on-premises servers need a Network Load Balancer in front
A_ZH:
答：Amazon CloudFront 加自定义源（custom origin）：任何可访问的 Web 服务器都行。
因为：自定义源可以是 CloudFront 能访问到的任何 HTTP（Hypertext Transfer Protocol，超文本传输协议）服务器，在不在 AWS 都行；边缘站点能缓存的就缓存，并和源站保持持久连接，所以连没缓存的请求也更快到达。
考法：源站必须留在本地机房或现有服务器、全球用户要更低延迟 → ✅ CloudFront 配自定义源；❌ AWS Global Accelerator：不做缓存，而且本地服务器前面还得先放 Network Load Balancer
SOURCE: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html
If you're serving content over HTTP, your origin server is either an Amazon S3 bucket or an HTTP server, such as a web server. Your HTTP server can run on an Amazon Elastic Compute Cloud (Amazon EC2) instance or on a server that you manage; these servers are also known as custom origins.

## awsb-elb-predictive-scaling | d2
TOPIC: Compute and scaling
Q:
Load rises and falls in the same pattern every day, and nobody wants to maintain a timetable of scaling times. Which scaling method adds capacity before each rise?
Q_ZH:
负载每天都按同样的规律涨落，又没人想维护一张扩缩容时间表，哪种扩缩容方式能在每次上涨前就加好容量？
A:
Answer: Predictive scaling: forecasts load, launches capacity ahead.
Because: predictive scaling studies past load to find daily or weekly patterns, forecasts the coming load and adds capacity before the forecast rise, while dynamic scaling only reacts after load has climbed.
Exam: recurring daily or weekly pattern, capacity ready in advance → ✅ predictive scaling; ❌ target tracking scaling: reacts only after the metric moves
A_ZH:
答：Predictive scaling（预测式扩缩容）：先预测负载，提前加容量。
因为：预测式扩缩容分析历史负载，找出每天或每周的规律，预测接下来的负载，在预测的高峰到来前就加好容量；动态扩缩容要等负载上来了才反应。
考法：每天或每周重复的规律，容量要提前备好（recurring patterns, scale ahead）→ ✅ predictive scaling；❌ target tracking scaling：指标变了才反应
SOURCE: https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-predictive-scaling.html
Predictive scaling works by analyzing historical load data to detect daily or weekly patterns in traffic flows. It uses this information to forecast future capacity needs so Amazon EC2 Auto Scaling can proactively increase the capacity of your Auto Scaling group to match the anticipated load.

## awsb-iam-explicit-deny-wins | d1
TOPIC: Identity and accounts
Q:
A user's identity policy allows s3:DeleteObject, yet the Amazon S3 (Simple Storage Service) bucket policy explicitly denies that user. Why does every delete fail?
Q_ZH:
某用户的身份策略允许 s3:DeleteObject，可 Amazon S3（Simple Storage Service，简单存储服务）存储桶策略对这个用户明确拒绝了它，为什么每次删除都失败？
A:
Answer: Explicit Deny: it overrides every Allow.
Because: AWS rule: every request starts denied, an Allow is needed to permit it, and one explicit Deny in any applicable policy ends the evaluation with a final Deny.
Exam: an Allow and an explicit Deny both apply → ✅ denied; ❌ the more specific Allow wins: no Allow beats an explicit Deny
A_ZH:
答：显式 Deny：它压过所有 Allow。
因为：AWS 规定，记住即可：所有请求默认拒绝，要有 Allow 才放行，而任何一条适用策略里只要有一个显式 Deny，最终结果就是拒绝。
考法：Allow 和显式 Deny 同时适用 → ✅ 拒绝；❌ 写得更具体的 Allow 胜出：没有任何 Allow 能压过显式 Deny
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html
If the enforcement code finds even one explicit deny that applies, the enforcement code returns a final decision of Deny.

## awsb-iam-root-user-protection | d1
TOPIC: Identity and accounts
Q:
You have just created a new AWS account and signed in as its root user. Which protection do you turn on for that user first?
Q_ZH:
你刚创建了一个新的 AWS 账户，并以 root 用户登录，首先要给它开启哪项保护？
A:
Answer: MFA (multi-factor authentication) on the root user: a second factor.
Because: the root user has full access to everything in the account, including billing, so a second sign-in factor stops a stolen password alone from opening it; AWS now requires root MFA.
Exam: protect the root user → ✅ MFA on the root user and no root access keys; ❌ root access keys for daily scripts: a full-power long-term secret
A_ZH:
答：给 root 用户开 MFA（multi-factor authentication，多因素认证）：第二重验证。
因为：root 用户对账户里的一切（包括账单）都有完全权限，加上第二重登录验证，光偷到密码也进不去；AWS 现在已强制 root 用户启用 MFA。
考法：protect the root user → ✅ 给 root 用户开 MFA，且不建 root access key；❌ 给日常脚本建 root access key：权限最大的长期密钥
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html
Because a root user can perform privileged actions, it's crucial to add MFA for the root user as a second authentication factor in addition to the email address and password as sign-in credentials.

## awsb-in-appflow | d2
TOPIC: Messaging and streaming
Q:
Marketing wants Salesforce contact records copied into Amazon S3 (Simple Storage Service) every night without anyone writing code. Which service?
Q_ZH:
市场部想每晚把 Salesforce 里的联系人记录复制到 Amazon S3（Simple Storage Service，简单存储服务），而且没人写代码，用哪个服务？
A:
Answer: Amazon AppFlow: no-code SaaS (software as a service) data flows.
Because: AppFlow's built-in connectors sign in to the SaaS app, pull the chosen records and write them to the AWS destination on demand or on schedule, so you configure a flow instead of writing code.
Exam: no-code transfer between SaaS apps such as Salesforce and S3 or Amazon Redshift → ✅ Amazon AppFlow; ❌ AWS DataSync: moves files and objects between storage systems, not SaaS records
A_ZH:
答：Amazon AppFlow：无代码的 SaaS（software as a service，软件即服务）数据流。
因为：AppFlow 自带的连接器（connector）登录 SaaS 应用，取出选定的记录，按需或按计划写入 AWS 目标，所以你只需配置一个流程（flow），不用写集成代码。
考法：在 Salesforce 等 SaaS 应用和 S3 或 Amazon Redshift 之间无代码传数据 → ✅ Amazon AppFlow；❌ AWS DataSync：在存储系统之间搬文件和对象，搬不了 SaaS 应用里的记录
SOURCE: https://docs.aws.amazon.com/appflow/latest/userguide/what-is-appflow.html
Amazon AppFlow is a fully-managed integration service that enables you to securely exchange data between software as a service (SaaS) applications, such as Salesforce, and AWS services, such as Amazon Simple Storage Service (Amazon S3) and Amazon Redshift.

## awsb-misc-cloudformation-iac | d2
TOPIC: Compute and scaling
Q:
The same VPC (virtual private cloud), subnets and servers must be built identically in three accounts from version-controlled files. Which service?
Q_ZH:
同一套 VPC（virtual private cloud，虚拟私有云）、子网和服务器，要在三个账号里按受版本管理的文件一模一样地建出来，用哪个服务？
A:
Answer: AWS CloudFormation: infrastructure as code templates.
Because: a CloudFormation template describes every resource and its settings, and each stack created from it builds exactly those resources, so one reviewed, versioned file gives identical environments everywhere.
Exam: repeatable, version-controlled infrastructure → ✅ AWS CloudFormation templates; ❌ AWS Elastic Beanstalk: runs one app's environment, not any infrastructure you define
A_ZH:
答：AWS CloudFormation：用模板写基础设施即代码。
因为：CloudFormation 模板描述了每个资源和它的设置，从模板创建的每个堆栈（stack）都会建出完全一样的资源，所以一份经过审核、有版本的文件就能在各处得到相同的环境。
考法：可重复、可版本管理的基础设施（infrastructure as code）→ ✅ AWS CloudFormation 模板；❌ AWS Elastic Beanstalk：只管一个应用的运行环境，不能定义任意基础设施
SOURCE: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/Welcome.html
Reuse your CloudFormation template to create your resources in a consistent and repeatable manner. To reuse your template, describe your resources once and then provision the same resources over and over in multiple regions.

## awsb-ml-textract | d2
TOPIC: Analytics and ML
Q:
Scanned invoices must have their form fields and tables extracted automatically, without building a model. Which service?
Q_ZH:
扫描的发票要自动提取出表单字段和表格，而且不自己建模型，用哪个服务？
A:
Answer: Amazon Textract: pre-trained document text extraction.
Because: Textract's pre-trained models detect typed and handwritten text and understand page layout, so one API (application programming interface) call returns form key-value pairs and table cells, not just raw characters.
Exam: text, forms or tables from scanned documents → ✅ Amazon Textract; ❌ Amazon SageMaker AI (artificial intelligence): you would build and train your own model
A_ZH:
答：Amazon Textract：预训练好的文档文字提取。
因为：Textract 的预训练模型能识别印刷体和手写文字并理解版面，所以一次 API（application programming interface，应用程序接口）调用就返回表单的键值对和表格单元格，而不只是一串字符。
考法：从扫描文档里提取文字、表单或表格 → ✅ Amazon Textract；❌ Amazon SageMaker AI（artificial intelligence，人工智能）：得自己构建和训练模型
SOURCE: https://docs.aws.amazon.com/textract/latest/dg/what-is.html
Amazon Textract is based on the same proven, highly scalable, deep-learning technology that was developed by Amazon's computer vision scientists to analyze billions of images and videos daily. You don't need any machine learning expertise to use it, as Amazon Textract includes simple, easy-to-use API operations that can analyze image files and PDF files.

## awsb-nc-dynamodb-export-to-s3 | d2
TOPIC: Databases
Q:
Analysts must query a full DynamoDB table with SQL (Structured Query Language) without using any of the table's read capacity. Which approach?
Q_ZH:
分析师要用 SQL（Structured Query Language，结构化查询语言）查询一整张 DynamoDB 表，又不能占用这张表的任何读容量，用哪种做法？
A:
Answer: DynamoDB export to Amazon S3 (Simple Storage Service), then Athena: no read capacity used.
Because: the export reads from the table's PITR (point-in-time recovery) backups, not the live table, so it uses no read capacity, and Amazon Athena then runs SQL on the exported files.
Exam: analyze table data with no read-capacity impact → ✅ DynamoDB export to Amazon S3 (needs PITR), then Amazon Athena; ❌ a Scan of the live table: uses read capacity and competes with the app
A_ZH:
答：DynamoDB export 到 Amazon S3（Simple Storage Service，简单存储服务），再用 Athena：不占读容量。
因为：导出读的是表的 PITR（point-in-time recovery，时间点恢复）备份，不是线上表，所以不占读容量；然后由 Amazon Athena 对导出的文件跑 SQL。
考法：分析表数据又不影响读容量 → ✅ DynamoDB export 到 Amazon S3（需开启 PITR），再用 Amazon Athena；❌ 对线上表做 Scan：消耗读容量，和应用抢资源
SOURCE: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/S3DataExport.HowItWorks.html
Exports are asynchronous, they don't consume read capacity units (RCUs) and have no impact on table performance and availability.

## awsb-nc-dynamodb-global-tables | d2
TOPIC: Databases
Q:
Users in Europe and Asia must both write to the same DynamoDB data with low latency in their own Region. Which DynamoDB feature?
Q_ZH:
欧洲和亚洲的用户都要在各自的区域（Region）低延迟地写同一份 DynamoDB 数据，用 DynamoDB 的哪个功能？
A:
Answer: DynamoDB global tables: every Region reads and writes.
Because: every replica table in the Regions you choose accepts reads and writes, and DynamoDB copies each change to the other replicas, so users write in their own Region and no Region is the single primary.
Exam: multi-Region, active-active reads and writes → ✅ DynamoDB global tables; ❌ Aurora Global Database: only the primary Region performs writes
A_ZH:
答：DynamoDB global tables（全局表）：每个区域都能读写。
因为：你选的每个区域里的副本表都接受读写，DynamoDB 把每次变更复制到其他副本，所以用户在自己的区域就能写，没有哪个区域是唯一的主库。
考法：多区域（multi-Region）、双活读写（active-active）→ ✅ DynamoDB global tables；❌ Aurora Global Database：只有主区域执行写入
SOURCE: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html
Amazon DynamoDB global tables is a fully managed, multi-Region, and multi-active database feature that provides easy to use data replication and fast local read and write performance for globally scaled applications.

## awsb-org-control-tower | d2
TOPIC: Identity and accounts
Q:
A company must set up a new governed multi-account environment quickly, with ready-made guardrails. Which service?
Q_ZH:
公司要快速搭好一个受治理的多账户环境，并自带现成的防护规则（guardrail），用哪个服务？
A:
Answer: AWS Control Tower: a ready-made landing zone with controls.
Because: Control Tower uses AWS Organizations to build a landing zone (a multi-account environment based on security best practices) in under an hour, then applies controls, also called guardrails, to the accounts in it.
Exam: fast multi-account setup with guardrails → ✅ AWS Control Tower; ❌ AWS Config rules: detect noncompliant resources, build no accounts or landing zone
A_ZH:
答：AWS Control Tower：现成的着陆区，自带控制项。
因为：Control Tower 借助 AWS Organizations，不到一小时就搭好着陆区（landing zone，按安全最佳实践建好的多账户环境），再给其中的账户套上控制项，也就是防护规则（guardrail）。
考法：fast multi-account setup with guardrails → ✅ AWS Control Tower；❌ AWS Config 规则：只检测不合规的资源，不建账户也不建着陆区
SOURCE: https://docs.aws.amazon.com/controltower/latest/userguide/what-is-control-tower.html
AWS Control Tower offers a straightforward way to set up and govern an AWS multi-account environment, following prescriptive best practices. AWS Control Tower orchestrates the capabilities of several other AWS services, including AWS Organizations, AWS Service Catalog, and AWS IAM Identity Center, to build a landing zone in less than an hour.

## awsb-s3-block-public-access | d2
TOPIC: S3 storage
Q:
Company policy says no bucket in the account may ever be public, even if someone later writes a public bucket policy. Which Amazon S3 (Simple Storage Service) setting?
Q_ZH:
公司规定账户里的任何存储桶都不能公开，即使以后有人写了公开的存储桶策略也不行，用哪个 Amazon S3（Simple Storage Service，简单存储服务）设置？
A:
Answer: Account-level S3 Block Public Access: overrides public grants.
Because: S3 checks this setting on every request and rejects any public access that a bucket policy or ACL (access control list) would grant, for all current and future buckets in the account.
Exam: nothing in the account may ever be public → ✅ account-level S3 Block Public Access, or an organization-level policy for many accounts; ❌ IAM (Identity and Access Management) Access Analyzer: reports public access, does not block it
A_ZH:
答：账户级 S3 Block Public Access：压过任何公开授权。
因为：S3 每次处理请求都会检查这个设置，拒绝存储桶策略或 ACL（access control list，访问控制列表）想要授予的任何公开访问，对账户里现有和以后新建的存储桶都生效。
考法：账户里任何东西都不能公开（nothing in the account may ever be public）→ ✅ 账户级 S3 Block Public Access，账户多时用组织级（organization-level）策略；❌ IAM（Identity and Access Management，身份与访问管理）Access Analyzer：只报告公开访问，不会阻止
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html
However, users can modify bucket policies, access point policies, or object permissions to allow public access. S3 Block Public Access settings override these policies and permissions so that you can limit public access to these resources.

## awsb-s3-bucket-policy-vpce-condition | d2
TOPIC: S3 storage
Q:
A bucket must accept requests only when they arrive through one VPC (virtual private cloud) endpoint. Which bucket policy statement enforces this?
Q_ZH:
一个存储桶只能接受经由某个 VPC（virtual private cloud，虚拟私有云）终端节点进来的请求，用哪种存储桶策略语句来强制？
A:
Answer: A Deny statement with an aws:SourceVpce condition.
Because: the statement denies any request whose aws:SourceVpce value is not your endpoint, and an explicit Deny beats every Allow, so requests from anywhere else fail; aws:SourceVpc does the same for a whole VPC.
Exam: restrict bucket access to a VPC endpoint or VPC → ✅ bucket policy that denies unless aws:SourceVpce matches; ❌ IAM (Identity and Access Management) user access keys in app code: leakable secrets, not a network control
A_ZH:
答：带 aws:SourceVpce 条件的 Deny 语句。
因为：这条语句拒绝所有 aws:SourceVpce 不是你那个终端节点的请求，而显式 Deny 压过任何 Allow，所以从别处来的请求都会失败；aws:SourceVpc 对整个 VPC 做同样的事。
考法：只允许通过某个 VPC 终端节点或 VPC 访问存储桶（restrict bucket access to a VPC endpoint or VPC）→ ✅ 存储桶策略：aws:SourceVpce 不匹配就拒绝；❌ 把 IAM（Identity and Access Management，身份与访问管理）用户访问密钥写进代码：密钥会泄露，也不是网络控制
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/example-bucket-policies-vpc-endpoint.html
If the specified endpoint is not used, the policy denies all access to the bucket. The aws:SourceVpce condition specifies the endpoint.

## awsb-s3-inventory-batch-operations | d2
TOPIC: S3 storage
Q:
Tags must be added to 300 million objects that already sit in a bucket. Which Amazon S3 (Simple Storage Service) approach does it in one managed job?
Q_ZH:
存储桶里已经有 3 亿个对象，要给它们全部加上标签，用哪种 Amazon S3（Simple Storage Service，简单存储服务）方式在一个托管作业里完成？
A:
Answer: An S3 Inventory list plus an S3 Batch Operations job.
Because: S3 Inventory writes a report listing every object, and a Batch Operations job takes that report as its manifest and runs the same operation on each listed object, tracking progress and writing a completion report.
Exam: one action on millions of existing objects → ✅ S3 Inventory report plus S3 Batch Operations; ❌ S3 Event Notifications: fire on new events, not existing objects
A_ZH:
答：S3 Inventory 报告 + S3 Batch Operations 作业。
因为：S3 Inventory 生成一份列出所有对象的报告，Batch Operations 作业把这份报告当作清单（manifest），对每个列出的对象执行同一个操作，并跟踪进度、生成完成报告。
考法：对数百万个已有对象执行同一个操作（one action on millions of existing objects）→ ✅ S3 Inventory 报告 + S3 Batch Operations；❌ S3 Event Notifications：只对新事件触发，管不了已有对象
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/batch-ops.html
S3 Batch Operations can perform a single operation on lists of Amazon S3 objects that you specify. A single job can perform a specified operation on billions of objects containing exabytes of data.

## awsb-s3-mfa-delete | d1
TOPIC: S3 storage
Q:
Permanently deleting any object version must require a one-time code from the bucket owner's authentication device. Which Amazon S3 (Simple Storage Service) setting?
Q_ZH:
永久删除任何对象版本时，都必须输入存储桶所有者认证设备上的一次性验证码，用哪个 Amazon S3（Simple Storage Service，简单存储服务）设置？
A:
Answer: MFA (multi-factor authentication) Delete: a code to delete.
Because: AWS rule: with MFA Delete on, permanently deleting a version or changing the versioning state needs a valid MFA code, and only the bucket owner's root user can turn it on, not from the console.
Exam: extra protection against permanent version deletes → ✅ MFA Delete on a versioned bucket; ❌ S3 Versioning alone: anyone with permission can still delete versions
A_ZH:
答：MFA（multi-factor authentication，多因素认证）Delete：删除要验证码。
因为：AWS 规定，记住即可：开启 MFA Delete 后，永久删除某个版本或更改版本控制状态都要提供有效的 MFA 验证码，而且只有存储桶所有者的 root 用户能开启它，控制台里开不了。
考法：防止对象版本被永久删除的额外保护（extra protection against permanent version deletes）→ ✅ 开了版本控制的存储桶 + MFA Delete；❌ 只开 S3 Versioning：有权限的人仍然能删除版本
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/MultiFactorAuthenticationDelete.html
The bucket owner, the AWS account that created the bucket (root account), and all authorized users can enable versioning. However, only the bucket owner (root account) can enable MFA delete.

## awsb-s3-multi-region-access-point | d2
TOPIC: S3 storage
Q:
Apps worldwide must use one global Amazon S3 (Simple Storage Service) endpoint that sends each request to the nearest of several replicated buckets in different Regions. Which S3 feature?
Q_ZH:
全球各地的应用要用同一个全球 Amazon S3（Simple Storage Service，简单存储服务）终端节点，每个请求都送到分布在不同区域、互相复制的几个存储桶中最近的那个，用哪个 S3 功能？
A:
Answer: S3 Multi-Region Access Point: one global endpoint.
Because: requests to its global endpoint travel through AWS Global Accelerator over the AWS global network to the closest bucket with active routing, while Cross-Region Replication keeps the buckets in sync.
Exam: single global endpoint, nearest of several Regional buckets, failover → ✅ S3 Multi-Region Access Point; ❌ S3 Transfer Acceleration: speeds transfers to one bucket only
A_ZH:
答：S3 Multi-Region Access Point：一个全球终端节点。
因为：发到它全球终端节点的请求经 AWS Global Accelerator 走 AWS 全球网络，送到最近的、路由状态为 active 的存储桶，各存储桶之间由 Cross-Region Replication 保持同步。
考法：一个全球终端节点、就近访问多个区域的存储桶、故障切换（single global endpoint, nearest of several Regional buckets）→ ✅ S3 Multi-Region Access Point；❌ S3 Transfer Acceleration：只加速传到单个存储桶
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/MultiRegionAccessPoints.html
Amazon S3 Multi-Region Access Points provides a global endpoint that applications can use to fulfill requests from S3 buckets that are located in multiple AWS Regions.

## awsb-vpc-flow-logs | d2
TOPIC: VPC networking
Q:
The security team must record which addresses and ports talked to each instance and whether each connection was accepted or rejected. Which VPC (virtual private cloud) feature?
Q_ZH:
安全团队要记录每台实例和哪些地址、端口通信过，以及每个连接是被接受还是被拒绝，用哪个 VPC（virtual private cloud，虚拟私有云）功能？
A:
Answer: VPC Flow Logs: one record per traffic flow.
Because: Flow Logs write one metadata record per traffic flow through each network interface, noting who connected on which port and whether it was accepted, so audits see who talked to whom but never packet contents.
Exam: log who talked to whom and accept or reject, for audits → ✅ VPC Flow Logs; ❌ VPC Traffic Mirroring: copies whole packets to an inspection appliance
A_ZH:
答：VPC Flow Logs：每个流量流一条记录。
因为：Flow Logs 为经过每个网卡的每个流量流写一条元数据记录，记下谁在哪个端口连接、是否被接受，所以审计能看到谁和谁通信过，但从不记录数据包内容。
考法：为审计记录谁和谁通信、接受还是拒绝 → ✅ VPC Flow Logs；❌ VPC Traffic Mirroring（流量镜像）：把完整数据包复制给检测设备
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html
VPC Flow Logs is a feature that enables you to capture information about the IP traffic going to and from network interfaces in your VPC. Flow log data can be published to the following locations: Amazon CloudWatch Logs, Amazon S3, or Amazon Data Firehose.

## awsb-vpc-nat-gateway-per-az | d1
TOPIC: VPC networking
Q:
Private subnets in three Availability Zones all send internet traffic through one NAT (network address translation) gateway in zone A. Why do the subnets in the other two zones lose internet access when zone A fails?
Q_ZH:
三个可用区（Availability Zone）里的私有子网都经可用区 A 里的同一个 NAT（network address translation，网络地址转换）网关出网，为什么可用区 A 故障时，另外两个可用区的子网也断网了？
A:
Answer: A zonal NAT gateway is redundant only inside its zone.
Because: AWS builds each zonal NAT gateway with redundancy inside its one Availability Zone only, so when that zone goes down, every subnet in other zones that routes through it loses its internet path.
Exam: highly available outbound internet for private subnets → ✅ one NAT gateway per Availability Zone with same-zone routes, or one Regional NAT gateway that spreads across zones by itself; ❌ one shared NAT gateway: its zone is a single point of failure
A_ZH:
答：可用区级（zonal）NAT 网关只在自己的可用区内冗余。
因为：AWS 只在每个可用区级 NAT 网关所在的那一个可用区内做冗余，所以这个可用区一挂，其他可用区里经它出网的子网就都断网了。
考法：私有子网高可用的出站上网 → ✅ 每个可用区一个 NAT gateway，各子网走本可用区的网关，或用一个会自动扩展到各可用区的 Regional NAT gateway；❌ 共用一个 NAT gateway：它所在的可用区是单点故障
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html
If you have resources in multiple Availability Zones and they share one NAT gateway, and if the NAT gateway's Availability Zone is down, resources in the other Availability Zones lose internet access. To improve resiliency, create a NAT gateway in each Availability Zone, and configure your routing to ensure that resources use the NAT gateway in the same Availability Zone.

## awsb-bf-ebs-gp3-vs-gp2 | d2
TOPIC: Block and file storage
Q:
A new 200 GiB general-purpose SSD (solid state drive) volume needs a steady 3,000 IOPS (input/output operations per second) at the lowest price. Which volume type?
Q_ZH:
一个新的 200 GiB 通用 SSD（solid state drive，固态硬盘）卷需要稳定的 3,000 IOPS（input/output operations per second，每秒读写次数），还要价格最低，用哪种卷类型？
A:
Answer: gp3: 3,000 IOPS baseline at any size.
Because: gp3 includes a 3,000 IOPS baseline in its storage price and costs 20 percent less per GiB, while gp2 gives only 3 IOPS per GiB, so 600 IOPS at 200 GiB unless it bursts on credits.
Exam: general-purpose SSD at the lowest cost, IOPS set apart from size → ✅ gp3; ❌ gp2: IOPS grow with size, higher price per GiB; ❌ io2 Block Express: costly, for critical high-IOPS databases
A_ZH:
答：gp3：任何大小都有 3,000 IOPS 基线。
因为：gp3 的存储价里已包含 3,000 IOPS 基线，每 GiB 还便宜 20%；gp2 每 GiB 只给 3 IOPS，200 GiB 只有 600 IOPS，除非靠积分突发。
考法：最低成本的通用 SSD、IOPS 与容量分开设定 → ✅ gp3；❌ gp2：IOPS 随容量增长，每 GiB 更贵；❌ io2 Block Express：昂贵，给关键的高 IOPS 数据库用
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/general-purpose.html
gp3 volumes deliver a consistent baseline IOPS performance of 3,000 IOPS, which is included with the price of storage.

## awsb-cost-cost-anomaly-detection | d2
TOPIC: Monitoring, governance and cost
Q:
You want an alert whenever spending suddenly behaves unusually, without picking a dollar threshold in advance. Which feature?
Q_ZH:
你希望支出一出现异常波动就收到提醒，又不想事先定一个金额阈值，用哪个功能？
A:
Answer: AWS Cost Anomaly Detection: machine learning learns normal spend.
Because: it runs machine learning models over your spending history, including weekly or monthly seasonality, so it flags patterns that break from normal and ranks root causes by dollar impact, with no fixed amount needed.
Exam: catch unusual or unexpected spend automatically → ✅ AWS Cost Anomaly Detection; ❌ AWS Budgets: alerts only at an amount you set in advance
A_ZH:
答：AWS Cost Anomaly Detection：用机器学习认识你的正常支出。
因为：它用机器学习模型分析你的支出历史，连每周、每月的季节性都考虑在内，所以能标出偏离常态的支出，并按金额影响排出根因，不需要固定金额。
考法：自动发现异常或意外的支出 → ✅ AWS Cost Anomaly Detection；❌ AWS Budgets：只在你事先设定的金额处告警
SOURCE: https://docs.aws.amazon.com/cost-management/latest/userguide/manage-ad.html
AWS Cost Anomaly Detection is a feature that uses machine learning models to detect and alert on anomalous spend patterns in your deployed AWS services.

## awsb-cr-kms-imported-key-material | d2
TOPIC: Encryption and threat detection
Q:
Your key material must be generated in your own on-premises HSM (hardware security module), but AWS services must keep using it through AWS KMS (Key Management Service) even when your data center is offline. Which option?
Q_ZH:
公司规定密钥材料必须在你自己机房的 HSM（hardware security module，硬件安全模块）里生成，但即使机房离线，AWS 服务也要能继续通过 AWS KMS（Key Management Service，密钥管理服务）使用它，选哪种方式？
A:
Answer: Imported key material in a KMS key: bring your own.
Because: you upload a copy of your key material into a KMS key and AWS KMS keeps that copy, so AWS services can use it while your data center is offline; you keep the original as backup.
Exam: generate key material yourself but use KMS integrations → ✅ KMS key with imported key material; ❌ a standard KMS key: AWS generates the material; ❌ an external key store: fails while your key manager is offline
A_ZH:
答：把密钥材料导入 KMS 密钥（imported key material）：自带密钥。
因为：你把自己密钥材料的一份副本上传进一把 KMS 密钥，由 AWS KMS 保存这份副本，所以机房离线时 AWS 服务照样能用；原件你自己留着做备份。
考法：密钥材料自己生成、又要用 KMS 集成（use KMS integrations）→ ✅ 导入了密钥材料的 KMS 密钥；❌ 普通 KMS 密钥：材料由 AWS 生成；❌ 外部密钥存储（external key store）：你的密钥管理器一离线就用不了
SOURCE: https://docs.aws.amazon.com/kms/latest/developerguide/importing-keys.html
When you create a KMS key, by default, AWS KMS generates the key material for that KMS key. But you can create a KMS key without key material and then import your own key material into that KMS key, a feature often known as "bring your own key" (BYOK).

## awsb-cr-kms-key-per-tenant | d2
TOPIC: Encryption and threat detection
Q:
A SaaS (software as a service) app must be able to cut off or audit one customer's encrypted data without touching any other customer's data. Which key design?
Q_ZH:
一个 SaaS（software as a service，软件即服务）应用必须能单独切断或审计某一个客户的加密数据，而不影响其他客户，用哪种密钥设计？
A:
Answer: One customer managed key per tenant (customer): isolated, auditable.
Because: each tenant's data is encrypted under its own KMS (Key Management Service) key with its own key policy, so you can scope, disable or delete one tenant's key alone, and CloudTrail logs each key's use separately.
Exam: separate encryption per customer with central control → ✅ one customer managed key per tenant; ❌ one shared key for all tenants: disabling it cuts off every tenant at once
A_ZH:
答：每个租户（客户）一把客户托管密钥：隔离、可审计。
因为：每个租户的数据都用它自己的 KMS（Key Management Service，密钥管理服务）密钥和密钥策略加密，所以能单独限制、停用或删除某个租户的密钥，CloudTrail 也分别记录每把密钥的使用。
考法：按客户分别加密、集中管控（per-tenant encryption）→ ✅ 每个租户一把 customer managed key；❌ 所有租户共用一把密钥：一停用就切断所有租户
SOURCE: https://aws.amazon.com/blogs/architecture/simplify-multi-tenant-encryption-with-a-cost-conscious-aws-kms-key-strategy/
The solution lies in implementing a centralized key management strategy. One KMS key per tenant, maintained in a central AWS account.

## awsb-ct-anywhere | d3
TOPIC: Serverless and containers
Q:
A factory must run its containers on its own on-premises servers, yet manage them from the same Amazon ECS (Elastic Container Service) control plane it uses in AWS. Which option?
Q_ZH:
一家工厂必须在自己机房的服务器上跑容器，但又想用它在 AWS 上使用的同一个 Amazon ECS（Elastic Container Service，容器服务）控制平面来管理，用哪个方案？
A:
Answer: Amazon ECS Anywhere: your servers join an ECS cluster.
Because: the name says it: Anywhere means the ECS control plane in AWS can run tasks on any server you register, so each on-premises server runs the ECS agent as an external instance of your cluster.
Exam: containers on your own servers, managed from Amazon ECS → ✅ Amazon ECS Anywhere (for Kubernetes: Amazon EKS (Elastic Kubernetes Service) Anywhere); ❌ AWS Fargate: runs only on AWS infrastructure
A_ZH:
答：Amazon ECS Anywhere：你的服务器加入 ECS 集群。
因为：名字就是答案：Anywhere 就是“哪里都行”，AWS 里的 ECS 控制平面可以在你注册的任何服务器上运行任务，所以每台本地服务器装上 ECS 代理（agent），作为集群里的外部实例（external instance）。
考法：在自己的服务器上跑容器，用 Amazon ECS 管理 → ✅ Amazon ECS Anywhere（Kubernetes 场景用 Amazon EKS（Elastic Kubernetes Service，托管 Kubernetes 服务）Anywhere）；❌ AWS Fargate：只在 AWS 的基础设施上运行
SOURCE: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-anywhere.html
Amazon ECS Anywhere provides support for registering an external instance such as an on-premises server or virtual machine (VM), to your Amazon ECS cluster.

## awsb-dns-geoproximity-routing | d2
TOPIC: Edge and DNS
Q:
You must pull more users toward one Region's servers by growing the geographic area it serves. Which Route 53 routing policy?
Q_ZH:
你要扩大某个区域（Region）的服务器所覆盖的地理范围，把更多用户拉到那里，用哪种 Route 53 路由策略？
A:
Answer: Geoproximity routing: distance plus an adjustable bias.
Because: Route 53 sends each user to the closest resource by geographic distance, and a positive bias from 1 to 99 makes a resource's area larger while a negative bias shrinks it, so traffic shifts by changing one number.
Exam: route by the location of users and resources, shift traffic with a bias → ✅ geoproximity routing; ❌ geolocation routing: fixed country or continent mapping, no bias
A_ZH:
答：Geoproximity routing（地理邻近路由）：按距离，再加可调的偏移值（bias）。
因为：Route 53 按地理距离把每个用户送到最近的资源，正的 bias（1 到 99）扩大某个资源覆盖的地理范围，负的 bias 缩小它，所以改一个数字就能挪动流量。
考法：按用户和资源的位置路由，用 bias 调整流量 → ✅ geoproximity routing；❌ geolocation routing（地理位置路由）：按国家或大洲固定对应，没有 bias
SOURCE: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-geoproximity.html
It sends traffic to the closest available resource. You can also choose to send more or less traffic to a given resource by setting a value called a bias.

## awsb-dns-weighted-routing | d2
TOPIC: Edge and DNS
Q:
A new app version must get about 10 percent of users while the old version keeps the other 90 percent. Which Route 53 routing policy?
Q_ZH:
新版本应用要分到约 10% 的用户，旧版本保留其余 90%，用哪种 Route 53 路由策略？
A:
Answer: Weighted routing: traffic split by the weights you set.
Because: records with the same name each get a weight, and Route 53 sends each one its weight divided by the total, so weights 10 and 90 give a 10/90 split and a weight of 0 stops traffic.
Exam: send a set share of traffic to a new version, canary or blue/green → ✅ weighted routing; ❌ multivalue answer routing: random healthy answers, no set shares
A_ZH:
答：Weighted routing（加权路由）：按你设定的权重分流。
因为：同名的每条记录各有一个权重，Route 53 按“该记录权重 ÷ 总权重”分配流量，所以权重 10 和 90 就是 10/90 分流，权重设为 0 就不再给它流量。
考法：给新版本固定比例的流量，金丝雀（canary）或蓝绿（blue/green）发布 → ✅ weighted routing；❌ multivalue answer routing：随机返回健康记录，没有固定比例
SOURCE: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-weighted.html
With weighted routing, you can link multiple resources to a single domain name (example.com) or subdomain name (acme.example.com) and choose how much traffic goes to each resource. This can be useful for load balancing and testing new versions of software.

## awsb-dt-waf-rate-based-rule | d2
TOPIC: Encryption and threat detection
Q:
A few clients flood a login page behind CloudFront with thousands of requests a minute each. Which AWS WAF (web application firewall) rule type limits them?
Q_ZH:
几个客户端各自每分钟向 CloudFront 后面的登录页发送几千个请求，用哪种 AWS WAF（web application firewall，Web 应用防火墙）规则来限制它们？
A:
Answer: A rate-based rule: caps requests per client.
Because: the rule counts requests from each IP (Internet Protocol) address, or another key you choose, over a time window and blocks or challenges that client once it passes your limit, so normal users keep access.
Exam: block or throttle addresses that send too many requests → ✅ AWS WAF rate-based rule; ❌ an IP set match rule: a fixed address list, counts nothing
A_ZH:
答：基于速率的规则（rate-based rule）：按客户端限制请求数。
因为：这条规则在一个时间窗口内统计每个 IP（Internet Protocol，互联网协议）地址（或你选的其他键）的请求数，超过上限就拦截或质询该客户端，所以正常用户不受影响。
考法：拦截或限流请求过多的地址（too many requests）→ ✅ AWS WAF rate-based rule；❌ IP set match 规则：固定的地址列表，不计数
SOURCE: https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based.html
A rate-based rule counts incoming requests and rate limits requests when they are coming at too fast a rate. The rule aggregates requests according to your criteria, and counts and rate limits the aggregate groupings, based on the rule's evaluation window, request limit, and action settings.

## awsb-ec2-placement-group-spread-vs-partition | d2
TOPIC: Compute and scaling
Q:
A 100-node HDFS (Hadoop Distributed File System) cluster must keep groups of nodes on separate racks so that one rack failure hits only one group. Which placement group?
Q_ZH:
一个 100 节点的 HDFS（Hadoop Distributed File System，Hadoop 分布式文件系统）集群要把节点分组放在不同机架上，让一个机架坏了只影响一组，用哪种置放群组（placement group）？
A:
Answer: Partition placement group: separate racks per partition.
Because: the name says it: Amazon EC2 (Elastic Compute Cloud) divides the group into partitions that never share racks, network or power, so a hardware fault stays in one partition, and HDFS can place replicas in different partitions.
Exam: large distributed systems such as HDFS or Cassandra on separate racks → ✅ partition placement group; ❌ spread placement group: at most seven running instances per Availability Zone
A_ZH:
答：Partition placement group（分区置放群组）：每个分区用自己的机架。
因为：名字就是答案：Amazon EC2（Elastic Compute Cloud，弹性计算云）把群组分成若干分区，分区之间不共用机架、网络和电源，硬件故障只影响一个分区，HDFS 也能把副本放到不同分区。
考法：HDFS、Cassandra 这类大型分布式系统要分机架放置（large distributed and replicated workloads）→ ✅ partition placement group；❌ spread placement group：每个可用区最多只能运行 7 台实例
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/placement-strategies.html
Partition placement groups can be used to deploy large distributed and replicated workloads, such as HDFS, HBase, and Cassandra, across distinct racks.

## awsb-ed-geo-block | d2
TOPIC: Edge and DNS
Q:
Your distribution rights cover only some countries, so viewers anywhere else must be refused every file in a CloudFront distribution. Which built-in CloudFront feature?
Q_ZH:
你的发行版权只覆盖部分国家，其他地方的观众访问 CloudFront 分配里的任何文件都要被拒绝，用哪个 CloudFront 自带的功能？
A:
Answer: CloudFront geographic restrictions: a country allow list or block list.
Because: the edge location looks up each viewer's country from their IP (Internet Protocol) address and returns HTTP (Hypertext Transfer Protocol) 403 Forbidden when that country is not allowed, and the rule covers the whole distribution.
Exam: block whole countries from all content of a distribution → ✅ CloudFront geographic restrictions; ❌ AWS WAF (web application firewall) geo match rule: a separate service, for country plus other conditions
A_ZH:
答：CloudFront 地理限制（geographic restrictions）：国家允许列表或阻止列表。
因为：边缘站点根据观众的 IP（Internet Protocol，互联网协议）地址查出所在国家，国家不被允许时返回 HTTP（Hypertext Transfer Protocol，超文本传输协议）403 Forbidden，而且规则作用于整个分配。
考法：让某些国家访问不了某个分配的全部内容 → ✅ CloudFront geographic restrictions；❌ AWS WAF（web application firewall，Web 应用防火墙）geo match 规则：是另一项服务，适合“国家 + 其他条件”一起判断
SOURCE: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/georestrictions.html
You can use geographic restrictions, sometimes known as geo blocking, to prevent users in specific geographic locations from accessing content that you're distributing through an Amazon CloudFront distribution.

## awsb-ed-local-zones-vs-wavelength | d2
TOPIC: Edge and DNS
Q:
Video editors in one large city need very low latency to EC2 (Elastic Compute Cloud) instances, and the nearest AWS Region is far away. Which AWS infrastructure?
Q_ZH:
某个大城市的视频剪辑师需要以极低延迟访问 EC2（Elastic Compute Cloud，弹性计算云）实例，而最近的 AWS 区域（Region）离得很远，用哪种 AWS 基础设施？
A:
Answer: An AWS Local Zone: a Region extension in that city.
Because: a Local Zone places AWS compute and storage close to a large population center, and you extend your VPC (virtual private cloud) into it by creating a subnet there, so local users reach instances with low latency.
Exam: low latency for users in one metro area → ✅ AWS Local Zones; ❌ AWS Wavelength Zones: inside carriers' 5G (fifth-generation mobile) networks, for mobile devices
A_ZH:
答：AWS Local Zone（本地扩展区）：区域在那个城市的延伸。
因为：Local Zone 把 AWS 的计算和存储放到大型人口中心附近，你在里面建一个子网就把 VPC（virtual private cloud，虚拟私有云）延伸过去，所以当地用户能低延迟访问实例。
考法：为某个都市圈的用户提供低延迟 → ✅ AWS Local Zones；❌ AWS Wavelength Zones：部署在运营商的 5G（fifth-generation mobile，第五代移动通信）网络里，服务移动设备
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-regions-availability-zones.html
A Local Zone is an extension of an AWS Region in geographic proximity to your users. Local Zones have their own connections to the internet and support Direct Connect, so that resources created in a Local Zone can serve local users with low-latency communications.

## awsb-elb-asg-min-max-one | d2
TOPIC: Compute and scaling
Q:
A legacy app can run on only one instance at a time but must come back by itself if that instance or its Availability Zone fails. Which setup?
Q_ZH:
一个老应用同一时间只能跑在一台实例上，但这台实例或它所在的可用区（Availability Zone）出故障时，必须自己恢复过来，用哪种配置？
A:
Answer: An Auto Scaling group sized 1 across two zones: self-healing.
Because: with minimum, maximum and desired capacity all 1, the group keeps exactly one healthy instance, so when it fails the group launches a replacement, using the other zone's subnet if its zone is down.
Exam: self-heal a single instance across Availability Zones → ✅ Auto Scaling group with minimum = maximum = 1 over subnets in two zones; ❌ EC2 (Elastic Compute Cloud) automatic instance recovery: keeps the same Availability Zone
A_ZH:
答：容量为 1、跨两个可用区的 Auto Scaling group：能自愈。
因为：最小、最大和期望容量都设成 1，组里永远只保留一台健康实例；这台实例坏了，组就启动一台替代实例，如果它所在的可用区挂了，就用另一个可用区的子网。
考法：单台实例跨可用区自愈（self-healing single instance）→ ✅ 最小 = 最大 = 1、子网跨两个可用区的 Auto Scaling group；❌ EC2（Elastic Compute Cloud，弹性计算云）自动实例恢复：恢复后仍在原来的可用区
SOURCE: https://docs.aws.amazon.com/autoscaling/ec2/userguide/auto-scaling-benefits.html
You can also configure Amazon EC2 Auto Scaling to use multiple Availability Zones. If one Availability Zone becomes unavailable, Amazon EC2 Auto Scaling can launch instances in another one to compensate.

## awsb-iam-access-analyzer | d2
TOPIC: Identity and accounts
Q:
Security must find every Amazon S3 (Simple Storage Service) bucket and IAM (Identity and Access Management) role that someone outside the organization can access. Which tool?
Q_ZH:
安全团队要找出组织外部的人能访问到的每一个 Amazon S3（Simple Storage Service，简单存储服务）桶和 IAM（Identity and Access Management，身份与访问管理）角色，用哪个工具？
A:
Answer: IAM Access Analyzer: finds external access.
Because: the name says it: Access Analyzer analyzes who can access each resource, using logic-based reasoning over resource-based policies against your zone of trust, and writes a finding for each outside principal that can reach it.
Exam: resources shared publicly or outside the account or organization → ✅ IAM Access Analyzer; ❌ Amazon Macie: scans only S3 data and bucket exposure, never IAM roles
A_ZH:
答：IAM Access Analyzer：找出外部访问。
因为：名字就是答案：Access Analyzer 分析谁能访问每个资源，它用基于逻辑的推理，对照你的信任区（zone of trust）分析基于资源的策略，外部主体能访问到的每个资源都生成一条发现（finding）。
考法：resources shared publicly or outside the account or organization → ✅ IAM Access Analyzer；❌ Amazon Macie：只扫描 S3 里的敏感数据和公开的桶，完全不检查 IAM 角色
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/what-is-access-analyzer.html
IAM Access Analyzer helps you identify the resources in your organization and accounts, such as Amazon S3 buckets or IAM roles, shared with an external entity.

## awsb-iam-source-ip-condition | d1
TOPIC: Identity and accounts
Q:
A user's only policy allows s3:GetObject with an aws:SourceIp condition for the office address range. Why does the same call fail from home?
Q_ZH:
某用户唯一的一条策略只在 aws:SourceIp 条件匹配办公室地址段时允许 s3:GetObject，为什么同样的调用在家里会失败？
A:
Answer: Implicit deny: the Allow's condition does not match.
Because: the Allow counts only when the request comes from a listed CIDR (Classless Inter-Domain Routing) range, so from any other address it does not apply, nothing else allows the call, and the default deny stands.
Exam: an Allow with aws:SourceIp, call from another address → ✅ implicit deny; ❌ allowed because the action matches: the condition must match too
A_ZH:
答：隐式拒绝：这条 Allow 的条件不匹配。
因为：这条 Allow 只在请求来自列出的 CIDR（Classless Inter-Domain Routing，无类别域间路由）地址段时才算数，别的地址来的请求它不适用，也没有别的策略放行，于是默认拒绝。
考法：带 aws:SourceIp 的 Allow，从别的地址调用 → ✅ 隐式拒绝（implicit deny）；❌ 操作匹配就放行：条件也必须匹配
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html
The aws:SourceIp condition key can be used in a policy to allow principals to make requests only from within a specified IP range.

## awsb-in-amazon-mq | d2
TOPIC: Messaging and streaming
Q:
An app talks to its on-premises message broker over JMS (Java Message Service) and AMQP (Advanced Message Queuing Protocol), and must move to AWS without rewriting its messaging code. Which service?
Q_ZH:
一个应用通过 JMS（Java Message Service，Java 消息服务）和 AMQP（Advanced Message Queuing Protocol，高级消息队列协议）跟本地机房的消息代理（message broker）通信，要搬到 AWS 且不改写消息相关代码，用哪个服务？
A:
Answer: Amazon MQ (message queuing): managed ActiveMQ or RabbitMQ brokers.
Because: Amazon MQ runs real Apache ActiveMQ or RabbitMQ brokers that support the same messaging standards, such as JMS and AMQP, so the app usually just points at the new broker endpoint.
Exam: migrate apps that use messaging standards such as JMS or AMQP without code changes → ✅ Amazon MQ; ❌ Amazon SQS (Simple Queue Service): its own AWS API (application programming interface), so code must change
A_ZH:
答：Amazon MQ（message queuing，消息队列）：托管的 ActiveMQ 或 RabbitMQ 代理。
因为：Amazon MQ 运行的是真正的 Apache ActiveMQ 或 RabbitMQ 代理，支持同样的消息标准（如 JMS 和 AMQP），所以应用通常只需改连新代理的终端节点（endpoint）。
考法：使用 JMS、AMQP 等消息标准的应用迁移且不改代码 → ✅ Amazon MQ；❌ Amazon SQS（Simple Queue Service，简单队列服务）：用的是 AWS 自己的 API（application programming interface，应用程序接口），代码必须改
SOURCE: https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/welcome.html
You can create a new Amazon MQ broker using industry standard messaging protocols, or migrate existing message brokers to Amazon MQ without rewriting messaging code.

## awsb-in-ses-email | d2
TOPIC: Messaging and streaming
Q:
An online shop's app must send order confirmations and HTML (HyperText Markup Language) newsletters to customers through an API (application programming interface). Which service?
Q_ZH:
一家网店的应用要通过 API（application programming interface，应用程序接口）给顾客发订单确认邮件和 HTML（HyperText Markup Language，超文本标记语言）格式的新闻简报，用哪个服务？
A:
Answer: Amazon SES (Simple Email Service): email sending for applications.
Because: the app hands each message to the SES API or SMTP (Simple Mail Transfer Protocol) interface, and SES sends it from your own verified domain on AWS-run email servers, so you run no mail servers.
Exam: applications sending transactional, marketing or bulk email → ✅ Amazon SES; ❌ an Amazon SNS (Simple Notification Service) email subscription: plain alerts, no custom message body; ❌ Amazon WorkMail: mailboxes for people, support ends March 2027
A_ZH:
答：Amazon SES（Simple Email Service，简单邮件服务）：给应用发邮件。
因为：应用把每封邮件交给 SES 的 API 或 SMTP（Simple Mail Transfer Protocol，简单邮件传输协议）接口，SES 用 AWS 运行的邮件服务器、以你验证过的域名发出，所以你不用自己运行邮件服务器。
考法：应用发送事务类、营销类或批量邮件 → ✅ Amazon SES；❌ Amazon SNS（Simple Notification Service，简单通知服务）邮件订阅：只发简单通知，不能自定义邮件正文；❌ Amazon WorkMail：给人用的邮箱服务，2027 年 3 月停止支持
SOURCE: https://docs.aws.amazon.com/ses/latest/dg/Welcome.html
Amazon Simple Email Service (SES) is an email platform that provides an easy, cost-effective way for you to send and receive email using your own email addresses and domains. For example, you can send marketing emails such as special offers, transactional emails such as order confirmations, and other types of correspondence such as newsletters.

## awsb-in-sns-message-filtering | d2
TOPIC: Messaging and streaming
Q:
One Amazon SNS (Simple Notification Service) topic carries every order event, but the shipping queue should receive only events whose status is "paid". Which SNS feature?
Q_ZH:
一个 Amazon SNS（Simple Notification Service，简单通知服务）主题承载所有订单事件，但发货队列只应收到状态为 "paid" 的事件，用 SNS 的哪个功能？
A:
Answer: A subscription filter policy: each subscriber gets its subset.
Because: SNS compares each message's attributes or JSON (JavaScript Object Notation) body with the filter policy on every subscription and delivers it only where the policy matches, so the shipping queue never sees other events.
Exam: each subscriber should get only some of a topic's messages → ✅ SNS subscription filter policy; ❌ filtering inside each consumer's code: every message is still delivered everywhere
A_ZH:
答：订阅过滤策略（subscription filter policy）：每个订阅者只拿自己那部分。
因为：SNS 把每条消息的属性或 JSON（JavaScript Object Notation，一种数据格式）正文，和每个订阅上的过滤策略比对，只投递给匹配的订阅，所以发货队列根本收不到其他事件。
考法：每个订阅者只要主题里的一部分消息 → ✅ SNS 订阅过滤策略；❌ 在每个消费者的代码里过滤：所有消息照样投递给每个订阅者
SOURCE: https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html
By default, an Amazon SNS topic subscriber receives every message that's published to the topic. To receive only a subset of the messages, a subscriber must assign a filter policy to the topic subscription.

## awsb-in-sqs-retention | d1
TOPIC: Messaging and streaming
Q:
A downstream system may be offline for up to 10 days, and its Amazon SQS (Simple Queue Service) queue must still hold every message for it. Which queue setting do you change?
Q_ZH:
一个下游系统可能离线长达 10 天，它的 Amazon SQS（Simple Queue Service，简单队列服务）队列必须把所有消息都留到它回来，要改队列的哪个设置？
A:
Answer: The message retention period: raise it to 14 days.
Because: AWS limit: SQS deletes a message once it has been in the queue longer than the retention period, which is 4 days by default and can be set from 60 seconds to 14 days.
Exam: keep unprocessed messages longer than the 4-day default, up to 14 days → ✅ raise the SQS message retention period; ❌ visibility timeout: hides messages during processing, at most 12 hours
A_ZH:
答：消息保留期（message retention period）：调到 14 天。
因为：AWS 规定，记住即可：消息在队列里待的时间超过保留期，SQS 就把它删掉；保留期默认 4 天，可设为 60 秒到 14 天。
考法：未处理的消息要保留超过默认的 4 天，最长 14 天 → ✅ 调大 SQS 消息保留期；❌ 可见性超时（visibility timeout）：只在处理期间隐藏消息，最长 12 小时
SOURCE: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html
The default message retention period is 4 days. However, you can set the message retention period to a value from 60 seconds to 1,209,600 seconds (14 days) using the SetQueueAttributes action.

## awsb-misc-resource-groups | d1
TOPIC: Monitoring, governance and cost
Q:
You want to view and manage every resource tagged Project=Alpha in one Region as a single collection. Which feature?
Q_ZH:
你想把一个区域里所有带 Project=Alpha 标签的资源当成一个整体来查看和管理，用哪个功能？
A:
Answer: A tag-based group in AWS Resource Groups: membership by tag query.
Because: the group saves a query of resource types and tags, so every resource in that Region carrying the tag is a member, and you can view it or run tasks on the whole group at once.
Exam: find, group or bulk-manage resources by tag → ✅ AWS Resource Groups and Tag Editor; ❌ tag policies in AWS Organizations: standardize tag rules, do not group resources
A_ZH:
答：AWS Resource Groups 里基于标签的资源组：按标签查询决定成员。
因为：资源组保存的是一条“资源类型加标签”的查询，所以该区域里带这个标签的资源都是成员，可以一次查看整组或对整组执行任务。
考法：按标签查找、分组或批量管理资源 → ✅ AWS Resource Groups 和 Tag Editor；❌ AWS Organizations 的标签策略（tag policies）：统一标签规范，不负责把资源分组
SOURCE: https://docs.aws.amazon.com/ARG/latest/userguide/resource-groups.html
A resource group is a collection of AWS resources that are all in the same AWS Region, and that match the criteria specified in the group's query.

## awsb-nc-neptune | d2
TOPIC: Databases
Q:
A bank must find fraud rings by following links between accounts, devices and payments many hops deep. Which AWS database?
Q_ZH:
一家银行要顺着账户、设备和付款之间的关联一层层往下追，找出欺诈团伙，用哪个 AWS 数据库？
A:
Answer: Amazon Neptune: a graph database for connected data.
Because: Neptune stores items as nodes and relationships as edges, so a query walks from link to link in milliseconds, instead of joining tables again for every hop.
Exam: highly connected data, social graphs, fraud rings, recommendations → ✅ Amazon Neptune; ❌ Amazon RDS (Relational Database Service): needs another join for every hop
A_ZH:
答：Amazon Neptune：给关联数据用的图数据库。
因为：Neptune 把对象存成节点、把关系存成边，所以查询能在毫秒内顺着关系一跳一跳走下去，不用每多一层就再 join 一次表。
考法：高度关联的数据、社交关系图、欺诈团伙、推荐 → ✅ Amazon Neptune；❌ Amazon RDS（Relational Database Service，关系型数据库服务）：每多一层关系就要多一次 join
SOURCE: https://docs.aws.amazon.com/neptune/latest/userguide/intro.html
Amazon Neptune is a fast, reliable, fully managed graph database service that makes it easy to build and run applications that work with highly connected datasets.

## awsb-rds-aurora-cloning | d2
TOPIC: Databases
Q:
Testers need a full copy of a 5 TB production Aurora database quickly, paying extra storage only for the data they change. Which feature?
Q_ZH:
测试人员要很快拿到一个 5 TB 生产 Aurora 数据库的完整副本，而且只为自己改动的数据多付存储费，用哪个功能？
A:
Answer: Aurora cloning: copy-on-write, shared data pages.
Because: a clone first shares the source's data pages and stores a new page only when either side changes it, so it is ready fast and adds storage only for changes, unlike restoring a full snapshot.
Exam: fast, cheap copy of production for testing → ✅ Aurora clone; ❌ restore from a snapshot: copies all the data, slower, full storage cost
A_ZH:
答：Aurora 克隆（cloning）：写时复制，共享数据页。
因为：克隆一开始和源库共用数据页，只有某一方改动某页时才另存一份新页，所以很快就能用，而且只为改动部分加存储；从快照完整恢复则做不到。
考法：快速、便宜地复制一份生产库做测试 → ✅ Aurora clone；❌ 从快照恢复：要复制全部数据，更慢，存储费用全额
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Managing.Clone.html
Creating a clone is faster and more space-efficient than physically copying the data using other techniques, such as restoring a snapshot.

## awsb-rds-stop-instance-7-day-restart | d1
TOPIC: Databases
Q:
A team stops an Amazon RDS (Relational Database Service) test database to save money during a one-month break. Why is it running again a week later?
Q_ZH:
一个团队在一个月的假期里把 Amazon RDS（Relational Database Service，关系型数据库服务）测试数据库停掉省钱，为什么一周后它又在运行了？
A:
Answer: RDS restarts a stopped instance after 7 days.
Because: AWS limit: a database instance can stay stopped for at most 7 consecutive days, then RDS starts it so it does not miss maintenance; while stopped you still pay for storage and backups.
Exam: idle for longer than 7 days → ✅ take a snapshot, delete the instance, restore when needed; ❌ stopping the instance: RDS starts it again after 7 days
A_ZH:
答：停止的实例 7 天后会被 RDS 自动启动。
因为：AWS 规定，记住即可：数据库实例最多连续停止 7 天，之后 RDS 会自动启动它，免得错过维护更新；停止期间存储和备份照样收费。
考法：闲置超过 7 天 → ✅ 拍快照、删除实例，需要时再恢复；❌ 停止实例：7 天后 RDS 会自动把它启动
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html
If you don't manually start your DB instance after it is stopped for seven consecutive days, RDS automatically starts your DB instance for you. This way, your instance doesn't fall behind any required maintenance updates.

## awsb-s3-access-points | d2
TOPIC: S3 storage
Q:
Twenty apps share one bucket, each needing different permissions, and the single bucket policy has become hard to manage. Which Amazon S3 (Simple Storage Service) feature?
Q_ZH:
20 个应用共用一个存储桶，各自需要不同权限，唯一的那份存储桶策略已经很难管理了，用哪个 Amazon S3（Simple Storage Service，简单存储服务）功能？
A:
Answer: S3 Access Points: one endpoint and policy per app.
Because: each access point is a named endpoint attached to the bucket with its own access point policy, so each app connects through its own point and S3 applies that policy, together with the bucket policy, to its requests.
Exam: many apps or teams need different access to one shared bucket → ✅ S3 Access Points; ❌ S3 Multi-Region Access Point: routes across Regions, not per-app permissions
A_ZH:
答：S3 Access Points（访问点）：每个应用一个终端节点和策略。
因为：每个访问点都是挂在存储桶上的一个具名终端节点，有自己的访问点策略，所以每个应用走自己的访问点，S3 用这份策略连同存储桶策略来判断它的请求。
考法：许多应用或团队对同一个共享存储桶需要不同权限（many apps or teams need different access to one shared bucket）→ ✅ S3 Access Points；❌ S3 Multi-Region Access Point：在多个区域之间路由，不是按应用分权限
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-points.html
Each access point has distinct permissions and network controls that S3 applies for any request that is made through that access point. Each endpoint enforces a customized access point policy that allow you to control use by resource, user, or other conditions.

## awsb-s3-multipart | d2
TOPIC: S3 storage
Q:
A 20 GB video must be uploaded to Amazon S3 (Simple Storage Service) quickly over an unreliable network. Which upload method?
Q_ZH:
一个 20 GB 的视频要通过不稳定的网络尽快上传到 Amazon S3（Simple Storage Service，简单存储服务），用哪种上传方式？
A:
Answer: Multipart upload: parallel parts, retry only failed parts.
Because: the file is split into parts that upload in parallel, a failed part is resent alone, and S3 joins the parts into one object at the end; a single upload request is capped at 5 GB.
Exam: large objects (AWS recommends 100 MB or more), faster and more resilient transfers → ✅ multipart upload, plus parallel byte-range fetches for downloads; ❌ a single upload request: capped at 5 GB, a failure restarts it
A_ZH:
答：Multipart upload（分段上传）：并行传分段，只重传失败的段。
因为：文件被切成多个分段并行上传，哪段失败就单独重传，最后由 S3 拼成一个对象；单次上传请求最大只能 5 GB。
考法：大对象（AWS 建议 100 MB 以上）、更快更稳的传输（large objects, faster and more resilient transfers）→ ✅ multipart upload，下载时再用并行的 byte-range fetches（按字节范围分段下载）；❌ 单次上传请求：上限 5 GB，失败就得从头再来
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html
If transmission of any part fails, you can retransmit that part without affecting other parts. After all parts of your object are uploaded, Amazon S3 assembles them to create the object.

## awsb-sl-api-authorizers | d2
TOPIC: Serverless and containers
Q:
Every REST (representational state transfer) API (application programming interface) call must carry an Amazon Cognito sign-in token that API Gateway checks itself, running no authorization code of yours. Which authorizer type?
Q_ZH:
每次 REST（representational state transfer，表述性状态转移）API（application programming interface，应用程序接口）调用都要带上 Amazon Cognito 的登录令牌，由 API Gateway 自己检查，不运行你写的任何授权代码，用哪种授权方（authorizer）？
A:
Answer: A Cognito user pool authorizer: it checks Cognito tokens.
Because: the client signs the user in to the user pool, gets an identity or access token and sends it in the Authorization header, and API Gateway validates that token itself, running none of your code.
Exam: only signed-in Cognito user pool users may call the API → ✅ Amazon Cognito user pool authorizer; ❌ Lambda authorizer: your own code for custom token or request checks
A_ZH:
答：Cognito 用户池授权方（Cognito user pool authorizer）：直接校验 Cognito 令牌。
因为：客户端先让用户登录用户池，拿到身份令牌或访问令牌，放进 Authorization 请求头发过来，API Gateway 自己校验这个令牌，所以不用运行你的任何代码。
考法：只有登录过 Cognito 用户池的用户才能调用 API → ✅ Amazon Cognito 用户池授权方；❌ Lambda 授权方（Lambda authorizer）：用你自己的代码做自定义令牌或请求检查
SOURCE: https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-integrate-with-cognito.html
After the API is deployed, the client must first sign the user in to the user pool, obtain an identity or access token for the user, and then call the API method with one of the tokens, which are typically set to the request's Authorization header. The API call succeeds only if the required token is supplied and the supplied token is valid, otherwise, the client isn't authorized to make the call because the client did not have credentials that could be authorized.

## awsb-sl-api-gateway-custom-domain | d1
TOPIC: Serverless and containers
Q:
Customers must call your API (application programming interface) at api.example.com instead of the random default execute-api hostname. Which API Gateway feature?
Q_ZH:
客户要用 api.example.com 来调用你的 API（application programming interface，应用程序接口），而不是默认那个随机生成的 execute-api 主机名，用 API Gateway 的哪个功能？
A:
Answer: A custom domain name: your hostname, ACM (AWS Certificate Manager) certificate.
Because: API Gateway serves your hostname with the ACM certificate and maps it to the API's stage, and a DNS (Domain Name System) record points the hostname at API Gateway, so the friendly name reaches your API.
Exam: friendly or branded hostname for an API, wildcards allowed → ✅ API Gateway custom domain name with an ACM certificate; ❌ renaming the stage: changes only the URL (uniform resource locator) path, not the hostname
A_ZH:
答：自定义域名（custom domain name）：你的主机名，加 ACM（AWS Certificate Manager，证书管理服务）证书。
因为：API Gateway 用这张 ACM 证书为你的主机名提供服务，并把它映射到 API 的某个阶段（stage），再由一条 DNS（Domain Name System，域名系统）记录把主机名指向 API Gateway，所以好记的域名就能访问到你的 API。
考法：给 API 一个好记或品牌化的主机名，可用通配符 → ✅ API Gateway 自定义域名 + ACM 证书；❌ 改阶段（stage）名称：只改变 URL（uniform resource locator，网址）的路径部分，不改主机名
SOURCE: https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-custom-domains.html
With custom domain names, you can set up your API's hostname, and choose a base path (for example, myservice) to map the alternative URL to your API.

## awsb-sl-api-gateway-endpoint-types | d1
TOPIC: Serverless and containers
Q:
An internal REST (representational state transfer) API (application programming interface) must be callable only from inside your VPC (virtual private cloud), never from the public internet. Which API Gateway endpoint type?
Q_ZH:
一个内部用的 REST（representational state transfer，表述性状态转移）API（application programming interface，应用程序接口）只能从你的 VPC（virtual private cloud，虚拟私有云）内部调用，绝不能从公网访问，用 API Gateway 的哪种终端节点类型？
A:
Answer: A private endpoint: reached through an interface VPC endpoint.
Because: a private REST API accepts calls only through an interface VPC endpoint, a network interface you create in your VPC, so callers use private IP (Internet Protocol) addresses and the traffic never touches the public internet.
Exam: API reachable only from a VPC or over Direct Connect → ✅ private endpoint type; ❌ Regional endpoint: public, for same-Region clients; ❌ edge-optimized endpoint: public, through CloudFront edge locations
A_ZH:
答：私有（private）终端节点：通过接口型 VPC 终端节点（interface VPC endpoint）访问。
因为：私有 REST API 只接受经由接口型 VPC 终端节点进来的调用，这个终端节点是你在自己 VPC 里创建的网络接口，所以调用方用私有 IP（Internet Protocol，互联网协议）地址，流量从不经过公网。
考法：API 只能从 VPC 内或经 Direct Connect 访问 → ✅ API Gateway 私有终端节点类型；❌ 区域（Regional）终端节点：公网可访问，面向同一区域的客户端；❌ 边缘优化（edge-optimized）终端节点：公网可访问，经 CloudFront 边缘站点路由
SOURCE: https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-private-apis.html
A private API is a REST API that is only callable from within an Amazon VPC. You can access your API using an interface VPC endpoint, which is an endpoint network interface that you create in your VPC.

## awsb-sl-lambda-multi-az-builtin | d1
TOPIC: Serverless and containers
Q:
A Lambda function must keep working if one Availability Zone fails. Which Lambda setting makes it run across several zones?
Q_ZH:
一个 Lambda 函数要在某个可用区（Availability Zone）故障时照常工作，要打开 Lambda 的哪个设置才能让它跨多个可用区运行？
A:
Answer: No setting: Lambda already runs across zones.
Because: AWS rule: Lambda runs every function in multiple Availability Zones of its Region for you; only a function attached to a VPC (virtual private cloud) needs subnets in two or more zones.
Exam: highly available Lambda across Availability Zones → ✅ nothing extra, it is built in (VPC-attached: subnets in several zones); ❌ deploying a copy of the function in each zone: Lambda already spreads it
A_ZH:
答：不用设置：Lambda 本来就跨可用区运行。
因为：AWS 规定，记住即可：Lambda 会自动在所在区域（Region）的多个可用区里运行每个函数；只有挂接到 VPC（virtual private cloud，虚拟私有云）的函数，才需要选两个或更多可用区的子网。
考法：让 Lambda 跨可用区高可用 → ✅ 什么都不用加，本来就内置（挂 VPC 的函数要选多个可用区的子网）；❌ 在每个可用区各部署一份函数：Lambda 本来就会分散运行
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/security-resilience.html
High availability – Lambda runs your function in multiple Availability Zones to ensure that it is available to process events in case of a service interruption in a single zone. If you configure your function to connect to a virtual private cloud (VPC) in your account, specify subnets in multiple Availability Zones to ensure high availability.

## awsb-sl-lambda-reserved-concurrency | d1
TOPIC: Serverless and containers
Q:
A Lambda function writes to a small database that accepts only 50 connections at once. Which Lambda setting caps the function at 50 concurrent runs?
Q_ZH:
一个 Lambda 函数要写入一个小数据库，这个数据库同时只接受 50 个连接，用 Lambda 的哪个设置把函数的并发上限卡在 50？
A:
Answer: Reserved concurrency of 50: a guaranteed, hard cap.
Because: reserved concurrency is both the minimum held for the function and the maximum it may use, so Lambda throttles requests beyond 50 concurrent executions; it pre-initializes nothing, so cold starts still happen.
Exam: cap a function's concurrency or guarantee it capacity → ✅ reserved concurrency; ❌ provisioned concurrency: pre-warms environments, does not cap the function
A_ZH:
答：把预留并发（reserved concurrency）设为 50：既保底又封顶。
因为：预留并发同时是为这个函数留出的下限和它能用的上限，所以超过 50 个并发执行时 Lambda 会限流（throttle）；它不预先初始化任何环境，所以冷启动照样会发生。
考法：给函数的并发封顶或保留容量 → ✅ 预留并发；❌ 预置并发（provisioned concurrency）：只是预热执行环境，并不封顶
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/provisioned-concurrency.html
Additionally, reserved concurrency can be used for limiting concurrency to prevent overwhelming downstream resources, like database connections. Reserved concurrency acts as both a lower and upper bound - it reserves the specified capacity exclusively for your function while also preventing it from scaling beyond that limit.

## awsb-st-kinesis-shard-capacity | d1
TOPIC: Messaging and streaming
Q:
Producers send 5 MB per second into a provisioned Kinesis data stream with 2 shards, and their writes are throttled. Why can't the stream take that rate?
Q_ZH:
生产者每秒向一个预置模式、只有 2 个分片（shard）的 Kinesis 数据流写入 5 MB，写入被限流了，为什么这个流吃不下这个速率？
A:
Answer: Each shard accepts only 1 MB of writes per second.
Because: AWS limit: each shard takes up to 1 MB/s or 1,000 records per second of writes and serves up to 2 MB/s of reads, so 2 shards accept only 2 MB/s in total.
Exam: write throttling (ProvisionedThroughputExceededException) → ✅ add shards, or switch to on-demand capacity mode; ❌ adding more consumers: reading never raises write capacity
A_ZH:
答：每个分片每秒只能写入 1 MB。
因为：AWS 规定，记住即可：每个分片每秒最多写入 1 MB 或 1,000 条记录，读取最多 2 MB，所以 2 个分片总共每秒只能写入 2 MB。
考法：写入被限流（ProvisionedThroughputExceededException）→ ✅ 增加分片，或改用按需（on-demand）容量模式；❌ 增加消费者：读得再多也不会提高写入容量
SOURCE: https://docs.aws.amazon.com/streams/latest/dev/service-sizes-and-limits.html
Each shard can support up to 1 MB/sec or 1,000 records/sec write throughput or up to 2 MB/sec or 2,000 records/sec read throughput. If you need more ingest capacity, you can easily scale up the number of shards in the stream using the AWS Management Console or the UpdateShardCount API.

## awsb-tr-tape-gateway | d2
TOPIC: Migration and transfer
Q:
Backup software writes to a physical tape library, and the tapes must go away without changing any backup jobs. Which AWS service?
Q_ZH:
备份软件一直往物理磁带库里写，现在要淘汰磁带，但不能改动任何备份作业，用哪个 AWS 服务？
A:
Answer: Tape Gateway: a virtual tape library backed by AWS.
Because: the gateway shows the backup software a virtual tape library over iSCSI (Internet Small Computer Systems Interface), so jobs keep writing tapes, which are stored in Amazon S3 (Simple Storage Service) and, when ejected, archived to S3 Glacier Flexible Retrieval or Deep Archive.
Exam: replace physical tapes, keep the existing backup software → ✅ AWS Storage Gateway Tape Gateway; ❌ Volume Gateway: block volumes, not a tape library
A_ZH:
答：Tape Gateway：由 AWS 承载的虚拟磁带库。
因为：网关通过 iSCSI（Internet Small Computer Systems Interface，基于网络的块存储协议）给备份软件呈现一个虚拟磁带库，备份作业照常写磁带，磁带存在 Amazon S3（Simple Storage Service，简单存储服务）里，弹出后归档到 S3 Glacier Flexible Retrieval 或 Deep Archive。
考法：替换物理磁带、保留现有备份软件（replace physical tapes, keep the existing backup software）→ ✅ AWS Storage Gateway Tape Gateway；❌ Volume Gateway：提供块存储卷，不是磁带库
SOURCE: https://docs.aws.amazon.com/storagegateway/latest/tgw/StorageGatewayConcepts.html
With its virtual tape library (VTL) interface, you use your existing tape-based backup infrastructure to store data on virtual tape cartridges that you create on your Tape Gateway.

## awsb-cr-enforce-tls-securetransport | d1
TOPIC: Encryption and threat detection
Q:
Every request to an Amazon S3 (Simple Storage Service) bucket must use HTTPS (Hypertext Transfer Protocol Secure), and plain HTTP (Hypertext Transfer Protocol) calls must fail. Which bucket policy condition?
Q_ZH:
对一个 Amazon S3（Simple Storage Service，简单存储服务）存储桶的每个请求都必须走 HTTPS（Hypertext Transfer Protocol Secure，安全超文本传输协议），普通 HTTP（Hypertext Transfer Protocol，超文本传输协议）请求必须失败，用哪个存储桶策略条件？
A:
Answer: Deny when aws:SecureTransport is false.
Because: each request's context carries aws:SecureTransport, true only over TLS (Transport Layer Security), so a Deny on false rejects every plain HTTP call; SQS (Simple Queue Service) and SNS (Simple Notification Service) resource policies work the same way.
Exam: force encryption in transit to S3, SQS or SNS → ✅ resource policy Deny with aws:SecureTransport false; ❌ S3 default encryption: protects stored objects, not the connection
A_ZH:
答：当 aws:SecureTransport 为 false 时 Deny。
因为：每个请求的上下文都带着 aws:SecureTransport，只有经 TLS（Transport Layer Security，传输层安全）到达时才为 true，所以对 false 写 Deny 就能拒绝所有普通 HTTP 请求；SQS（Simple Queue Service，简单队列服务）和 SNS（Simple Notification Service，简单通知服务）的资源策略同样适用。
考法：强制 S3、SQS 或 SNS 传输加密（encryption in transit）→ ✅ 资源策略里对 aws:SecureTransport 为 false 的请求 Deny；❌ S3 默认加密：保护存储的对象，不管连接
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingEncryptionInTransit.html
You can use the aws:SecureTransport global condition key in your S3 bucket policy to check whether the request was sent through HTTPS (TLS).

## awsb-cr-rds-ssl-tls-in-transit | d2
TOPIC: Encryption and threat detection
Q:
Connections from an app to an Amazon RDS (Relational Database Service) for PostgreSQL database must be encrypted, and unencrypted logins must be refused. Which setting enforces this?
Q_ZH:
应用到 Amazon RDS（Relational Database Service，关系型数据库服务）for PostgreSQL 数据库的连接必须加密，未加密的登录必须被拒绝，用哪个设置来强制？
A:
Answer: rds.force_ssl = 1: TLS (Transport Layer Security) required.
Because: each RDS database has a server certificate from an AWS certificate authority, so clients use TLS with the AWS certificate bundle, and rds.force_ssl rejects unencrypted connections; it defaults to 1 from PostgreSQL 15.
Exam: encrypt app-to-RDS traffic → ✅ TLS with the AWS certificate bundle, enforced by rds.force_ssl, or require_secure_transport on MySQL; ❌ RDS encryption with an AWS KMS (Key Management Service) key: protects stored data only
A_ZH:
答：rds.force_ssl = 1：强制 TLS（Transport Layer Security，传输层安全）。
因为：每个 RDS 数据库都有一张由 AWS 证书颁发机构签发的服务器证书，所以客户端用 AWS 证书包走 TLS 连接，rds.force_ssl 会拒绝未加密的连接；PostgreSQL 15 起它默认就是 1。
考法：加密应用到 RDS 的流量（encrypt in transit）→ ✅ 用 AWS 证书包走 TLS，用 rds.force_ssl 强制，MySQL 则用 require_secure_transport；❌ 用 AWS KMS（Key Management Service，密钥管理服务）密钥的 RDS 加密：只保护存储的数据
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html
You can require that connections to your PostgreSQL DB instance use SSL by using the rds.force_ssl parameter. The rds.force_ssl parameter default value is 1 (on) for RDS for PostgreSQL version 15 and later.

## awsb-ct-eks-secrets-kms-encryption | d2
TOPIC: Serverless and containers
Q:
Kubernetes Secrets that an Amazon EKS (Elastic Kubernetes Service) cluster keeps in etcd, its internal database, must be encrypted under a key your team controls, with no app changes. Which feature?
Q_ZH:
Amazon EKS（Elastic Kubernetes Service，托管 Kubernetes 服务）集群存在 etcd（集群内部数据库）里的 Kubernetes Secret，必须用你团队自己掌控的密钥加密，而且应用不做任何改动，用哪个功能？
A:
Answer: EKS envelope encryption: with your own customer managed KMS (Key Management Service) key.
Because: the Kubernetes API (application programming interface) server encrypts each object with a single-use data key before writing it to etcd, and your KMS key protects the seed those data keys come from, so etcd holds only ciphertext under your key.
Exam: encrypt Kubernetes Secrets in etcd under your own key → ✅ EKS envelope encryption, customer managed KMS key; ❌ the default AWS owned key: automatic, but AWS owns it; ❌ AWS Secrets Manager: separate store, apps must change
A_ZH:
答：EKS 信封加密（envelope encryption）：用你自己的客户托管 KMS（Key Management Service，密钥管理服务）密钥。
因为：Kubernetes API（application programming interface，应用程序接口）服务器先用一次性的数据密钥加密每个对象再写进 etcd，而这些数据密钥的种子由你的 KMS 密钥保护，所以 etcd 里只有受你的密钥保护的密文。
考法：用自己的密钥加密 etcd 里的 Kubernetes Secret → ✅ EKS 信封加密 + 客户托管 KMS 密钥（customer managed key）；❌ 默认的 AWS 自有密钥（AWS owned key）：自动开启，但密钥归 AWS 所有；❌ AWS Secrets Manager：另一个存储，应用要改代码去读
SOURCE: https://docs.aws.amazon.com/eks/latest/userguide/envelope-encryption.html
Amazon EKS uses AWS Key Management Service (KMS) with Kubernetes KMS provider v2 for this additional layer of security with an Amazon Web Services owned key, and the option for you to bring your own customer managed key (CMK) from AWS KMS.

## awsb-ct-fargate-efs-storage | d1
TOPIC: Serverless and containers
Q:
Many AWS Fargate tasks spread across Availability Zones must read and write the same files, and the files must outlive every task. Which storage do the tasks mount?
Q_ZH:
许多分布在不同可用区（Availability Zone）的 AWS Fargate 任务要读写同一批文件，而且文件要比任何任务都活得久，这些任务挂载哪种存储？
A:
Answer: Amazon EFS (Elastic File System): a shared, persistent file system.
Because: one EFS file system stores data redundantly across Availability Zones and every task mounts it over the network, so all tasks see the same files while tasks stop and start.
Exam: Fargate tasks need shared, persistent file storage → ✅ an Amazon EFS volume; ❌ the task's own ephemeral storage: deleted when the task stops, not shared between tasks
A_ZH:
答：Amazon EFS（Elastic File System，弹性文件系统）：共享、持久的文件系统。
因为：一个 EFS 文件系统把数据冗余存放在多个可用区，每个任务都通过网络挂载它，所以任务停了又起，大家看到的始终是同一批文件。
考法：Fargate 任务需要共享、持久的文件存储 → ✅ Amazon EFS 卷；❌ 任务自带的临时存储：任务一停就删除，任务之间也不共享
SOURCE: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_data_volumes.html
Amazon EFS volumes provide simple, scalable, and persistent shared file storage for use with your Amazon ECS tasks that grows and shrinks automatically as you add and remove files. Amazon EFS volumes support concurrency and are useful for containerized applications that scale horizontally and need storage functionalities like low latency, high throughput, and read-after-write consistency.

## awsb-dns-route53-managed-dns | d2
TOPIC: Edge and DNS
Q:
A company runs its own DNS (Domain Name System) servers for its public domain and wants AWS to answer those internet queries instead. Which Route 53 resource holds the records?
Q_ZH:
一家公司用自建的 DNS（Domain Name System，域名系统）服务器解析自己的公网域名，想改由 AWS 来回答这些互联网查询，记录放在 Route 53 的哪种资源里？
A:
Answer: A Route 53 public hosted zone: AWS runs the name servers.
Because: importing the old zone file recreates the records in a public hosted zone, and pointing the domain at its four Route 53 name servers makes AWS answer the internet's queries, so you run no DNS servers.
Exam: move public DNS off self-managed servers → ✅ Route 53 public hosted zone, loaded from the zone file; ❌ Route 53 private hosted zone: answers only inside associated VPCs (virtual private clouds)
A_ZH:
答：Route 53 公有托管区域（public hosted zone）：名称服务器由 AWS 来跑。
因为：你把旧的区域文件（zone file）导入公有托管区域，自动重建所有记录，再把域名指向这个托管区域的 4 台 Route 53 名称服务器，之后由 AWS 回答互联网上的查询，你不再需要自己的 DNS 服务器。
考法：把公网 DNS 从自建服务器迁走 → ✅ Route 53 public hosted zone，用区域文件导入；❌ Route 53 private hosted zone（私有托管区域）：只在关联的 VPC（virtual private cloud，虚拟私有云）内应答
SOURCE: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/migrate-dns-domain-in-use.html
When you migrate DNS service from another provider to Route 53, you reproduce your current DNS configuration in Route 53. In Route 53, you create a hosted zone that has the same name as your domain, and you create records in the hosted zone.

## awsb-dr-aws-backup-vault-lock | d2
TOPIC: Backup and disaster recovery
Q:
Backups must be impossible to delete or shorten before their retention ends, even by the root user. Which AWS Backup feature and mode?
Q_ZH:
备份在保留期结束前绝不能被删除，也不能缩短保留期，连 root 用户也做不到，用 AWS Backup 的哪个功能和模式？
A:
Answer: AWS Backup Vault Lock in compliance mode: nobody can delete.
Because: once the grace time ends, a compliance-mode lock can't be changed or removed by any user or by AWS, and AWS Backup refuses to delete any recovery point before its retention period ends.
Exam: immutable backups, even against admins or the root user → ✅ AWS Backup Vault Lock in compliance mode; ❌ governance mode: users with enough IAM (Identity and Access Management) permissions can remove the lock
A_ZH:
答：compliance 模式的 AWS Backup Vault Lock：谁也删不掉。
因为：宽限期（grace time）一过，compliance 模式的锁任何用户、甚至 AWS 都改不了也删不掉，保留期结束前 AWS Backup 会拒绝删除任何恢复点。
考法：备份不可变，连管理员和 root 用户也不行（immutable backups）→ ✅ AWS Backup Vault Lock，compliance mode；❌ governance mode（治理模式）：有足够 IAM（Identity and Access Management，身份与访问管理）权限的用户可以解除锁
SOURCE: https://docs.aws.amazon.com/aws-backup/latest/devguide/vault-lock.html
A vault lock in Compliance mode cannot be altered or deleted by any user or by AWS. A vault lock in compliance mode has a grace time period you set before it locks and the contents and vault lock become immutable.

## awsb-dt-waf-ip-set-match | d2
TOPIC: Encryption and threat detection
Q:
A web app behind an Application Load Balancer must block about 3,000 known bad address ranges, and the list changes weekly. Which AWS WAF (web application firewall) rule type?
Q_ZH:
一个在 Application Load Balancer 后面的 Web 应用要拦截大约 3,000 个已知恶意地址段，而且名单每周都变，用哪种 AWS WAF（web application firewall，Web 应用防火墙）规则？
A:
Answer: An IP (Internet Protocol) set match rule: one shared address list.
Because: the rule checks each request's source address against an IP set holding up to 10,000 addresses or CIDR (Classless Inter-Domain Routing) ranges, so updating the set changes every rule that uses it, without touching the app.
Exam: allow or block a long list of IP ranges at CloudFront or an Application Load Balancer → ✅ AWS WAF IP set match rule; ❌ security groups: allow rules only, they cannot block addresses
A_ZH:
答：IP（Internet Protocol，互联网协议）集匹配规则（IP set match）：一份共享的地址名单。
因为：规则把每个请求的来源地址和一个 IP 集比对，一个 IP 集最多放 10,000 个地址或 CIDR（Classless Inter-Domain Routing，无类别域间路由）地址段，所以更新这个集合就同时更新所有引用它的规则，不用动应用。
考法：在 CloudFront 或 Application Load Balancer 处允许或拦截一长串 IP 地址段 → ✅ AWS WAF IP set match rule；❌ 安全组：只有允许规则，拦不了地址
SOURCE: https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-ipset-match.html
The IP set match statement inspects the IP address of a web request against a set of IP addresses and address ranges. Use this to allow or block web requests based on the IP addresses that the requests originate from.

## awsb-ec2-enhanced-networking-efa | d2
TOPIC: Compute and scaling
Q:
A tightly coupled HPC (high performance computing) job uses MPI (Message Passing Interface) and needs OS (operating system) bypass networking between its instances. Which network device?
Q_ZH:
一个紧耦合的 HPC（high performance computing，高性能计算）作业使用 MPI（Message Passing Interface，消息传递接口），实例之间需要 OS（operating system，操作系统）旁路网络，用哪种网络设备？
A:
Answer: Elastic Fabric Adapter: kernel-bypass networking for HPC.
Because: its bypass path lets MPI libraries hand packets straight to the adapter instead of through the operating system kernel, so latency between instances is lower and steadier than with ordinary networking.
Exam: tightly coupled HPC or MPI needing OS bypass and very low latency → ✅ Elastic Fabric Adapter; ❌ Elastic Network Adapter: enhanced networking, but traffic still goes through the kernel
A_ZH:
答：Elastic Fabric Adapter（弹性结构适配器）：绕过内核的 HPC 网络。
因为：它的旁路通道让 MPI 库把数据包直接交给网卡，不经过操作系统内核，所以实例之间的延迟比普通网络更低、更稳定。
考法：紧耦合 HPC 或 MPI，需要 OS 旁路、极低延迟（OS-bypass）→ ✅ Elastic Fabric Adapter；❌ Elastic Network Adapter：属于增强联网，但流量仍要经过内核
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/efa.html
The Libfabric API bypasses the operating system kernel and communicates directly with the EFA device to put packets on the network. This reduces overhead and enables AI/ML and HPC applications to run more efficiently.

## awsb-ec2-ssm-automation-runbooks | d2
TOPIC: Compute and scaling
Q:
When AWS Config flags a noncompliant instance, a fixed multi-step fix must run on it automatically. Which tool runs those steps?
Q_ZH:
当 AWS Config 标出一台不合规的实例时，必须自动在它上面执行一套固定的多步修复，用哪个工具来执行这些步骤？
A:
Answer: Systems Manager Automation runbook: scripted multi-step fixes.
Because: a runbook lists the steps, such as patching an instance and restarting it, and Automation runs them in order when AWS Config remediation or an Amazon EventBridge rule starts it, with no manual fix.
Exam: automated remediation or multi-step operations on AWS resources → ✅ AWS Systems Manager Automation runbook; ❌ Session Manager: opens a shell, so a person types the fix
A_ZH:
答：Systems Manager Automation runbook（运行手册）：脚本化的多步修复。
因为：runbook 写好了每一步，比如先给实例打补丁再重启，只要 AWS Config 的修复动作或 Amazon EventBridge 规则一触发，Automation 就按顺序执行，不用人手动修。
考法：自动修复或对 AWS 资源执行多步操作（automated remediation）→ ✅ AWS Systems Manager Automation runbook；❌ Session Manager：只是打开命令行，修复还得人来敲
SOURCE: https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-automation.html
Automation simplifies common maintenance, deployment, and remediation tasks for AWS services like Amazon Elastic Compute Cloud (Amazon EC2), Amazon Relational Database Service (Amazon RDS), Amazon Redshift, Amazon Simple Storage Service (Amazon S3), and many more.

## awsb-ed-cloudfront-invalidation | d2
TOPIC: Edge and DNS
Q:
You replaced style.css at the origin, but CloudFront edge locations will keep serving the old copy until tomorrow. Which action removes the old copy from the edge caches now?
Q_ZH:
你在源站替换了 style.css，但 CloudFront 边缘站点会一直返回旧副本到明天，用什么操作能现在就把旧副本从边缘缓存中清掉？
A:
Answer: A CloudFront invalidation: removes the cached copy early.
Because: edge locations keep a file until its TTL (time to live) expires; an invalidation removes it from edge caches before then, so the next request makes CloudFront fetch the new file from the origin.
Exam: changed files must appear right away → ✅ CloudFront invalidation, or versioned file names that keep long TTLs; ❌ deleting the file at the origin: edges keep serving cached copies until they expire
A_ZH:
答：CloudFront 失效（invalidation）：提前清掉缓存副本。
因为：边缘站点会一直保留文件直到 TTL（time to live，缓存存活时间）到期；失效操作在此之前把它从边缘缓存中删掉，于是下一个请求会让 CloudFront 回源取新文件。
考法：改过的文件要马上生效 → ✅ CloudFront invalidation，或用带版本号的文件名（可保留长 TTL）；❌ 在源站删除文件：边缘站点仍会返回缓存副本直到过期
SOURCE: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html
Invalidate the file from edge caches. The next time a viewer requests the file, CloudFront returns to the origin to fetch the latest version of the file.

## awsb-hy-outposts | d2
TOPIC: Hybrid networking
Q:
AWS services must run inside the company's own data center so local systems get low latency. Which service?
Q_ZH:
AWS 服务必须跑在公司自己的机房里，让本地系统获得低延迟，用哪个服务？
A:
Answer: AWS Outposts: AWS racks in your building.
Because: AWS installs and runs its own racks or servers at your site as part of a Region, so Amazon EC2 (Elastic Compute Cloud) and other services run locally through the same APIs (application programming interfaces).
Exam: AWS services on premises, in your own facility → ✅ AWS Outposts; ❌ AWS Local Zones: AWS-run sites near big cities, not in your building
A_ZH:
答：AWS Outposts：把 AWS 机柜放进你的机房。
因为：AWS 把自己的机柜或服务器装到你的场地，作为某个 AWS 区域的一部分来管理，Amazon EC2（Elastic Compute Cloud，弹性计算云）等服务就能在本地运行，用的 API（application programming interface，应用程序接口）也一样。
考法：AWS services on premises, in your own facility → ✅ AWS Outposts；❌ AWS Local Zones：AWS 在大城市附近运营的站点，不在你的机房里
SOURCE: https://docs.aws.amazon.com/outposts/latest/userguide/what-is-outposts.html
AWS Outposts is a fully managed service that extends AWS infrastructure, services, APIs, and tools to customer premises.

## awsb-iam-identity-center-ad-two-way-trust | d2
TOPIC: Identity and accounts
Q:
IAM (Identity and Access Management) Identity Center must sign in on-premises domain users through AWS Managed Microsoft AD (Active Directory). Which trust do you create?
Q_ZH:
IAM（Identity and Access Management，身份与访问管理）Identity Center 要通过 AWS Managed Microsoft AD（Active Directory，微软目录服务）让本地域用户登录，要建哪种信任？
A:
Answer: A two-way trust: Identity Center must read your users.
Because: AWS rule: Identity Center must read your domain's users and groups to sync them, and only a two-way trust gives it that permission; a one-way trust does not work.
Exam: Identity Center with on-premises AD users → ✅ AWS Managed Microsoft AD with a two-way trust, or AD Connector; ❌ a one-way trust: Identity Center cannot read the users
A_ZH:
答：双向信任（two-way trust）：Identity Center 要读取你的用户。
因为：AWS 规定，记住即可：Identity Center 要读取你域里的用户和组来同步，只有双向信任才给它这个权限；单向信任不行。
考法：Identity Center with on-premises AD users → ✅ AWS Managed Microsoft AD 加双向信任，或用 AD Connector；❌ 单向信任（one-way trust）：Identity Center 读不到用户
SOURCE: https://docs.aws.amazon.com/singlesignon/latest/userguide/connectonpremad.html
AWS IAM Identity Center requires a two-way trust so that it has permissions to read user and group information from your domain to synchronize user and group metadata.

## awsb-in-amazon-mq-multi-az | d2
TOPIC: Messaging and streaming
Q:
An Amazon MQ (message queuing) broker for ActiveMQ must keep serving clients if one Availability Zone fails. Which deployment mode?
Q_ZH:
一个 Amazon MQ（message queuing，消息队列）的 ActiveMQ 代理要在某个可用区（Availability Zone）故障时继续为客户端服务，用哪种部署模式？
A:
Answer: An active/standby broker: a pair across two zones.
Because: Amazon MQ runs two brokers in two different Availability Zones on shared storage; if the active broker fails, the standby becomes active and clients reconnect to it, so losing one zone does not stop messaging.
Exam: highly available Amazon MQ across Availability Zones → ✅ ActiveMQ active/standby broker (RabbitMQ: three-node cluster deployment); ❌ single-instance broker: one broker in one Availability Zone
A_ZH:
答：主备（active/standby）代理：两个代理分处两个可用区。
因为：Amazon MQ 在两个不同的可用区各运行一个代理，共用同一份存储；主代理出故障时，备用代理接手成为主代理，客户端重新连上它，所以丢一个可用区也不会中断消息收发。
考法：Amazon MQ 跨可用区高可用 → ✅ ActiveMQ 主备代理（RabbitMQ 用三节点集群部署）；❌ 单实例代理（single-instance broker）：一个代理放在一个可用区
SOURCE: https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/amazon-mq-broker-architecture.html
An active/standby broker is comprised of two brokers in two different Availability Zones, configured in a redundant pair.

## awsb-mo-container-insights | d2
TOPIC: Monitoring, governance and cost
Q:
You need CPU (central processing unit), memory and restart data for every Amazon ECS (Elastic Container Service) task and Amazon EKS (Elastic Kubernetes Service) pod, summarized per cluster and service in one place. Which feature?
Q_ZH:
你需要每个 Amazon ECS（Elastic Container Service，容器服务）任务和 Amazon EKS（Elastic Kubernetes Service，托管 Kubernetes 服务）Pod 的 CPU（central processing unit，中央处理器）、内存和重启数据，并按集群和服务汇总在一处，用哪个功能？
A:
Answer: Amazon CloudWatch Container Insights: container metrics and logs together.
Because: it collects performance log events from your clusters, and CloudWatch turns them into metrics at the cluster, node, pod, task and service level, shown on automatic dashboards you can alarm on.
Exam: monitor ECS, EKS or Kubernetes container performance in one place → ✅ CloudWatch Container Insights; ❌ AWS CloudTrail: records API (application programming interface) calls, not container performance
A_ZH:
答：Amazon CloudWatch Container Insights：容器的指标和日志集中在一起。
因为：它从你的集群收集性能日志事件，CloudWatch 再把它们汇总成集群、节点、Pod、任务和服务级别的指标，显示在自动仪表板上，还能设置告警。
考法：在一个地方监控 ECS、EKS 或 Kubernetes 容器性能 → ✅ CloudWatch Container Insights；❌ AWS CloudTrail：记录 API（application programming interface，应用程序接口）调用，不管容器性能
SOURCE: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ContainerInsights.html
Use CloudWatch Container Insights to collect, aggregate, and summarize metrics and logs from your containerized applications and microservices.

## awsb-nc-dynamodb-ttl | d2
TOPIC: Databases
Q:
Session items in a DynamoDB table should expire 24 hours after they are created and be removed automatically, without paying for the deletes. Which feature?
Q_ZH:
DynamoDB 表里的会话数据应在创建 24 小时后过期并被自动清掉，而且删除不花钱，用哪个功能？
A:
Answer: TTL (Time to Live): a per-item expiry timestamp.
Because: the name says it: each item carries its own expiry time as a Unix epoch timestamp (seconds since 1 January 1970), so DynamoDB deletes expired items in the background, usually within a few days, using no write throughput.
Exam: delete items automatically after a set time at no cost → ✅ DynamoDB TTL; ❌ a scheduled Lambda scan-and-delete job: uses read and write capacity
A_ZH:
答：TTL（Time to Live，存活时间）：每条数据自带过期时间戳。
因为：名字就是答案：每条数据带一个 Unix 纪元时间戳（从 1970 年 1 月 1 日起算的秒数）作为过期时间，所以 DynamoDB 在后台删除过期数据，通常在几天之内，不消耗写吞吐。
考法：到时间自动删除数据、不花钱 → ✅ DynamoDB TTL；❌ 定时跑 Lambda 扫描再删除：要消耗读写容量
SOURCE: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html
TTL allows you to define a per-item expiration timestamp that indicates when an item is no longer needed. DynamoDB automatically deletes expired items within a few days of their expiration time, without consuming write throughput.

## awsb-nc-lazy-loading-vs-write-through | d2
TOPIC: Databases
Q:
Cached product prices must match the database right after every price update. Which caching strategy?
Q_ZH:
缓存里的商品价格必须在每次改价之后立刻和数据库一致，用哪种缓存策略？
A:
Answer: Write-through: update the cache on every write.
Because: the name says it: every write passes through to the cache too, so the app updates the database and the cached copy together, at the cost of two writes per update.
Exam: cached data must never be stale → ✅ write-through; ❌ lazy loading: fills the cache only on a miss, so data can go stale
A_ZH:
答：Write-through（写穿）：每次写入都更新缓存。
因为：名字就是答案：每次写入都同时写到缓存，所以应用一起更新数据库和缓存里的那份，代价是每次更新要写两次。
考法：缓存数据绝不能过期（never stale）→ ✅ write-through；❌ lazy loading（延迟加载）：只在未命中时才写缓存，数据可能过期
SOURCE: https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Strategies.html
The write-through strategy adds data or updates data in the cache whenever data is written to the database.

## awsb-org-account-alternate-contacts | d2
TOPIC: Identity and accounts
Q:
AWS security notices about a member account must reach the security team, not only the root user's email. What do you set on the account?
Q_ZH:
AWS 关于某个成员账户的安全通知必须送到安全团队，而不只是 root 用户的邮箱，该在账户上设置什么？
A:
Answer: The security alternate contact: a team distribution list.
Because: each account has one billing, one operations and one security alternate contact that AWS emails in addition to the root address, and the management account can set them centrally for every member account.
Exam: notices must reach the right team → ✅ billing, operations and security alternate contacts, each a team list; ❌ one person's inbox as the root email: notices stop when they leave
A_ZH:
答：安全备用联系人（security alternate contact）：填一个团队邮件组。
因为：每个账户各有一个账单、运维和安全备用联系人，AWS 除了发给 root 邮箱，还会发给他们；管理账户可以集中替所有成员账户设置。
考法：通知要送到对的团队 → ✅ 账单、运维、安全三个备用联系人，各填一个团队邮件组；❌ root 邮箱用某个人的个人邮箱：人一走，通知就没人收
SOURCE: https://docs.aws.amazon.com/accounts/latest/reference/manage-acct-update-contact-alternate.html
An alternate contact doesn't have to be a specific person. You could instead add an email distribution list if you have a team that manages billing, operations and security related issues.

## awsb-rds-custom | d2
TOPIC: Databases
Q:
A packaged app needs a managed Oracle database, but its vendor requires the team to install software on the database host's operating system. Which service?
Q_ZH:
一个套装软件需要托管的 Oracle 数据库，但厂商要求团队在数据库主机的操作系统上安装软件，选哪个服务？
A:
Answer: Amazon RDS (Relational Database Service) Custom: managed, with host access.
Because: standard Amazon RDS keeps the underlying host closed to deliver a managed service, while RDS Custom still automates database administration but gives you administrator rights to the database and its operating system.
Exam: managed Oracle that still needs operating system or host access → ✅ Amazon RDS Custom for Oracle; ❌ Amazon RDS for Oracle: no access to the underlying host
A_ZH:
答：Amazon RDS（Relational Database Service，关系型数据库服务）Custom：托管，又能进主机。
因为：普通的 Amazon RDS 为了做成托管服务，不让你进底层主机；RDS Custom 仍然自动做数据库运维，但给你数据库和操作系统的管理员权限。
考法：托管的 Oracle，但仍需操作系统或主机权限 → ✅ Amazon RDS Custom for Oracle；❌ Amazon RDS for Oracle：进不了底层主机
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-custom.html
If you need administrative rights to the database and underlying operating system to make dependent applications available, Amazon RDS Custom is the better choice.

## awsb-rds-deletion-protection | d1
TOPIC: Databases
Q:
A production Amazon RDS (Relational Database Service) database must survive a mistaken delete from a console click or a script. Which setting blocks it?
Q_ZH:
一个生产 Amazon RDS（Relational Database Service，关系型数据库服务）数据库要扛得住控制台误点或脚本误删，用哪个设置挡住删除？
A:
Answer: Deletion protection: deletes fail until it is turned off.
Because: AWS rule: RDS refuses to delete a database instance while deletion protection is on; turning it off is a separate modify step, which causes no outage.
Exam: prevent accidental deletion of a database → ✅ deletion protection; ❌ a final snapshot: keeps a copy, but the delete still happens
A_ZH:
答：删除保护（deletion protection）：不关掉就删不了。
因为：AWS 规定，记住即可：开着删除保护时，RDS 拒绝删除数据库实例；关掉它要单独做一次修改，这个修改不会造成停机。
考法：防止误删数据库 → ✅ 删除保护；❌ 最终快照（final snapshot）：留了一份拷贝，但删除照样发生
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_DeleteInstance.html
You can't delete a DB instance when deletion protection is turned on.

## awsb-rds-modify-to-multi-az | d1
TOPIC: Databases
Q:
An existing Single-AZ (Single-Availability Zone) Amazon RDS (Relational Database Service) database must become highly available, and the app's connection string cannot change. Which action?
Q_ZH:
一个现有的 Single-AZ（Single-Availability Zone，单可用区）Amazon RDS（Relational Database Service，关系型数据库服务）数据库要改成高可用，而且应用的连接字符串不能变，怎么做？
A:
Answer: Modify it to Multi-AZ (Multi-Availability Zone): same instance, same endpoint.
Because: modifying keeps the same database instance and its endpoint, so the app connects as before, while RDS builds a standby in another Availability Zone from a snapshot and turns on synchronous replication without downtime.
Exam: make an existing database highly available with no app change → ✅ modify the instance and turn on Multi-AZ; ❌ add a read replica and point the app at it: new endpoint, asynchronous copy
A_ZH:
答：把它修改为 Multi-AZ（Multi-Availability Zone，多可用区）：同一实例，同一终端节点。
因为：修改操作保留的是同一个数据库实例和它的终端节点（endpoint），所以应用照旧连接；RDS 则用快照在另一个可用区建出备用实例，再开启同步复制，整个过程不停机。
考法：现有数据库改成高可用、应用不改 → ✅ 修改实例、开启 Multi-AZ；❌ 加一个只读副本再把应用指过去：终端节点变了，而且是异步拷贝
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.Migrating.html
Creating a standby DB instance from a snapshot during a Single-AZ to Multi-AZ conversion avoids downtime but might impact performance, particularly for write-sensitive workloads.

## awsb-s3-abort-incomplete-multipart | d1
TOPIC: S3 storage
Q:
Failed large uploads keep leaving their uploaded parts behind in a bucket, and the storage bill keeps growing. Which lifecycle action cleans them up?
Q_ZH:
失败的大文件上传不断在存储桶里留下已上传的分段，存储账单一直在涨，用哪个生命周期动作来清理？
A:
Answer: AbortIncompleteMultipartUpload: deletes parts of unfinished uploads.
Because: AWS rule: Amazon S3 (Simple Storage Service) keeps and bills the parts of a multipart upload until it is completed or stopped, so this action stops uploads not finished a set number of days after they start and deletes their parts.
Exam: storage billed for unfinished multipart uploads → ✅ a lifecycle rule with AbortIncompleteMultipartUpload; ❌ an Expiration action: deletes objects, not upload parts
A_ZH:
答：AbortIncompleteMultipartUpload：删除未完成上传的分段。
因为：AWS 规定，记住即可：分段上传在完成或中止之前，Amazon S3（Simple Storage Service，简单存储服务）会一直保存并计费它的分段，所以这个动作会在上传开始后设定天数仍未完成时中止它，并删除它的分段。
考法：未完成的分段上传在产生存储费（storage billed for unfinished multipart uploads）→ ✅ 带 AbortIncompleteMultipartUpload 的生命周期规则；❌ Expiration（过期）动作：删除对象，不删上传分段
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html
Amazon S3 supports a bucket lifecycle rule that you can use to direct Amazon S3 to stop multipart uploads that aren't completed within a specified number of days after being initiated. When a multipart upload isn't completed within the specified time frame, it becomes eligible for an abort operation.

## awsb-s3-durability-multi-az | d1
TOPIC: S3 storage
Q:
A startup uploads objects without choosing a storage class and needs them to survive the loss of a whole Availability Zone. Which Amazon S3 (Simple Storage Service) storage class already does this?
Q_ZH:
一家初创公司上传对象时不选存储类，并要求对象扛得住整个可用区（Availability Zone）失效，哪个 Amazon S3（Simple Storage Service，简单存储服务）存储类本身就能做到？
A:
Answer: S3 Standard: the default, copies in three or more zones.
Because: S3 Standard is the default class for uploads and stores each object on multiple devices across at least three Availability Zones, repairing lost copies itself, so it is designed for 99.999999999% (eleven nines) durability.
Exam: highly durable by default, survives losing an Availability Zone → ✅ S3 Standard; ❌ S3 One Zone-IA (Infrequent Access): one zone, lost if it fails
A_ZH:
答：S3 Standard：默认存储类，在三个或更多可用区存副本。
因为：S3 Standard 是上传时的默认存储类，它把每个对象存放在至少三个可用区的多台设备上，丢了副本会自己修复，所以设计耐久性达到 99.999999999%（11 个 9）。
考法：默认高耐久、扛得住一个可用区失效（highly durable by default, survives losing an Availability Zone）→ ✅ S3 Standard；❌ S3 One Zone-IA（Infrequent Access，低频访问）：只存一个可用区，它一坏数据就没了
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/DataDurability.html
S3 Standard, S3 Intelligent-Tiering, S3 Standard-IA, S3 Glacier Instant Retrieval, S3 Glacier Flexible Retrieval, and S3 Glacier Deep Archive redundantly store objects on multiple devices across a minimum of three Availability Zones in an AWS Region.

## awsb-sl-api-gateway-service-integration | d2
TOPIC: Serverless and containers
Q:
Every request to your REST (representational state transfer) API (application programming interface) must go straight into an Amazon SQS (Simple Queue Service) queue, with no compute of your own in between. Which integration type?
Q_ZH:
发到你 REST（representational state transfer，表述性状态转移）API（application programming interface，应用程序接口）的每个请求都要直接写进 Amazon SQS（Simple Queue Service，简单队列服务）队列，中间不经过任何你自己的计算资源，用哪种集成类型？
A:
Answer: An AWS service integration: API Gateway calls SQS directly.
Because: API Gateway maps each request into an SQS SendMessage call and signs it with an IAM (Identity and Access Management) role you give it, so no function or server runs between the client and the queue.
Exam: API requests straight into an AWS service such as SQS or DynamoDB, no compute → ✅ AWS service integration with an IAM role; ❌ Lambda proxy integration: adds a function to run and pay for
A_ZH:
答：AWS 服务集成（AWS service integration）：API Gateway 直接调用 SQS。
因为：API Gateway 把每个请求映射成一次 SQS SendMessage 调用，并用你给它的 IAM（Identity and Access Management，身份与访问管理）角色签名，所以客户端和队列之间不运行任何函数或服务器。
考法：把 API 请求直接写进 SQS 或 DynamoDB 这类 AWS 服务，不用计算资源 → ✅ API Gateway 的 AWS 服务集成 + IAM 角色；❌ Lambda 代理集成（Lambda proxy integration）：多了一个要运行、要付费的函数
SOURCE: https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-integration-types.html
This type of integration lets an API expose AWS service actions.

## awsb-tr-transfer-family-identity-providers | d2
TOPIC: Migration and transfer
Q:
Partners must sign in to your AWS Transfer Family SFTP (Secure File Transfer Protocol) server with accounts from your company's existing third-party identity provider. Which identity provider type?
Q_ZH:
合作方要用你们公司现有第三方身份提供商里的账号，登录你的 AWS Transfer Family SFTP（Secure File Transfer Protocol，安全文件传输协议）服务器，选哪种身份提供商类型？
A:
Answer: A custom identity provider: a Lambda function authenticates users.
Because: on each sign-in, Transfer Family calls your Lambda function, which authenticates the user against your identity provider and tells Transfer Family what access to grant.
Exam: SFTP users from your existing third-party identity provider → ✅ a custom identity provider backed by AWS Lambda; ❌ service managed users: credentials stored inside Transfer Family itself; ❌ AWS DataSync: copies between storage systems, no user sign-ins
A_ZH:
答：自定义身份提供商（custom identity provider）：由 Lambda 函数认证用户。
因为：每次登录时，Transfer Family 都调用你的 Lambda 函数，由它到你的身份提供商那里认证用户，并告诉 Transfer Family 该给什么访问权限。
考法：SFTP 用户来自你现有的第三方身份提供商（SFTP users from your existing third-party identity provider）→ ✅ 由 AWS Lambda 支撑的 custom identity provider；❌ service managed（服务托管）用户：凭证存在 Transfer Family 内部；❌ AWS DataSync：在存储系统之间复制，不负责用户登录
SOURCE: https://docs.aws.amazon.com/transfer/latest/userguide/custom-idp-intro.html
To authenticate your users, you can use your existing identity provider with AWS Transfer Family. You integrate your identity provider using an AWS Lambda function, which authenticates and authorizes your users for access to Amazon S3 or Amazon Elastic File System (Amazon EFS).

## awsb-an-parquet | d3
TOPIC: Analytics and ML
Q:
Athena queries use only 3 of 40 columns in large JSON (JavaScript Object Notation) log files in Amazon S3 (Simple Storage Service), yet each query is billed for scanning whole files. Which change cuts the data scanned the most?
Q_ZH:
Athena 查询只用到 Amazon S3（Simple Storage Service，简单存储服务）里大型 JSON（JavaScript Object Notation，一种文本数据格式）日志文件 40 列中的 3 列，却每次都按扫描整份文件计费，哪种改动能最大幅度减少扫描的数据量？
A:
Answer: Convert the logs to Apache Parquet: a columnar format.
Because: Parquet stores and compresses each column separately, so Athena reads only the 3 columns a query uses instead of every row's full text, and Athena bills by data scanned.
Exam: queries read a few columns of wide log files, cut data scanned most → ✅ columnar Parquet or ORC (Optimized Row Columnar), for example converted by Amazon Data Firehose; ❌ gzip-compressed JSON: cheaper, but every column is still read
A_ZH:
答：把日志转成 Apache Parquet：列式格式。
因为：Parquet 按列分开存储和压缩，所以 Athena 只读查询用到的那 3 列，而不是每一行的全部文本，而 Athena 正是按扫描的数据量计费。
考法：查询只读宽日志文件里的少数几列，要最大幅度减少扫描量 → ✅ 列式的 Parquet 或 ORC（Optimized Row Columnar，优化行列式格式），例如用 Amazon Data Firehose 转换；❌ gzip 压缩的 JSON：会便宜一些，但每一列仍要整份读完
SOURCE: https://aws.amazon.com/athena/pricing/
If you compress your file and also convert it to a columnar format like Apache Parquet, achieving 3:1 compression, you would still end up with 1 TB of data on S3. But, in this case, because Parquet is columnar, Athena can read only the column that is relevant for the query being run.

## awsb-mo-cloudwatch-agent-memory | d1
TOPIC: Monitoring, governance and cost
Q:
An Amazon EC2 (Elastic Compute Cloud) instance's memory use is missing from its CloudWatch metrics. Why?
Q_ZH:
一台 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例的 CloudWatch 指标里没有内存用量，为什么？
A:
Answer: Memory needs the CloudWatch agent inside the instance.
Because: memory use is an operating system-level metric that EC2's default metrics do not include, so the CloudWatch agent must run inside the instance to collect it, and the same goes for disk-space use.
Exam: monitor memory or disk-space use on EC2 → ✅ install the CloudWatch agent; ❌ detailed monitoring: the same default metrics every minute, still no memory
A_ZH:
答：内存指标要靠装在实例里的 CloudWatch agent（代理）。
因为：内存用量是操作系统层面的指标，EC2 的默认指标里没有，所以必须在实例里运行 CloudWatch agent 来采集，磁盘空间用量也一样。
考法：监控 EC2 的内存或磁盘空间用量 → ✅ 安装 CloudWatch agent；❌ 详细监控（detailed monitoring）：还是那些默认指标，只是每分钟一次，仍然没有内存
SOURCE: https://docs.aws.amazon.com/autoscaling/ec2/userguide/enable-as-instance-metrics.html
To collect operating system-level metrics like available and used memory, you must install the CloudWatch agent. Additional fees may apply.

## awsb-mo-cloudwatch-logs-metric-filter | d2
TOPIC: Monitoring, governance and cost
Q:
You must be alerted whenever the word error appears more than 5 times in 5 minutes in an application's CloudWatch Logs. Which setup?
Q_ZH:
应用的 CloudWatch Logs 里，5 分钟内单词 error 出现超过 5 次就要通知你，怎么设置？
A:
Answer: A metric filter plus a CloudWatch alarm: matches become a metric.
Because: the metric filter checks log events for your pattern as they arrive and turns each match into a number in a CloudWatch metric, so an ordinary alarm can watch that count.
Exam: alert on a pattern or error count in logs → ✅ a metric filter on CloudWatch Logs with an alarm; ❌ AWS CloudTrail: records API (application programming interface) calls, not application log lines
A_ZH:
答：指标筛选器（metric filter）加 CloudWatch 告警：匹配次数变成一个指标。
因为：指标筛选器在日志事件进来时按你的模式查找，把每次匹配变成 CloudWatch 指标里的一个数值，这样普通告警就能盯住这个计数。
考法：日志里出现某种模式或错误次数时告警 → ✅ CloudWatch Logs 上的 metric filter 加告警；❌ AWS CloudTrail：记录 API（application programming interface，应用程序接口）调用，不是应用日志
SOURCE: https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/MonitoringLogData.html
Metric filters define the terms and patterns to look for in log data as it is sent to CloudWatch Logs. CloudWatch Logs uses these metric filters to turn log data into numerical CloudWatch metrics that you can graph or set an alarm on.

## awsb-ops-quotas-per-region | d3
TOPIC: Serverless and containers
Q:
During sudden bursts, Lambda invocations across an account's functions fail with throttling errors, though no function has its own limit set. Why?
Q_ZH:
流量突然暴增时，一个账号里各个 Lambda 函数的调用纷纷因限流（throttling）报错，可是没有任何函数单独设置过上限，为什么？
A:
Answer: The Regional concurrency quota: 1,000 by default.
Because: AWS limit: by default all Lambda functions in one account share 1,000 concurrent executions per Region, and requests beyond that shared pool are throttled until you get a quota increase.
Exam: Lambda bursts throttled above the Regional quota → ✅ request a quota increase and put an Amazon SQS (Simple Queue Service) queue in front to absorb bursts; ❌ provisioned concurrency: counts against the same quota, adds none
A_ZH:
答：区域级并发配额：默认 1,000。
因为：AWS 规定，记住即可：默认情况下，一个账号里所有 Lambda 函数在每个区域共用 1,000 个并发执行，超出这个共享池的请求会被限流，直到你申请提高配额。
考法：Lambda 突发流量超过区域配额被限流（throttled above the Regional concurrency quota）→ ✅ 申请提高配额，并在前面放 Amazon SQS（Simple Queue Service，简单队列服务）队列吸收突发；❌ provisioned concurrency（预置并发）：也占用同一份配额，不会增加总量
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html
By default, Lambda provides your account with a total concurrency limit of 1,000 concurrent executions across all Event Functions in an AWS Region. To support your specific account needs, you can request a quota increase and configure function-level concurrency controls so that your critical Event Functions don't experience throttling.

## awsb-tr-mgn | d2
TOPIC: Migration and transfer
Q:
A company must lift-and-shift 200 servers to Amazon EC2 (Elastic Compute Cloud) unchanged, with each cutover taking only minutes of downtime. Which service?
Q_ZH:
一家公司要把 200 台服务器原样迁到 Amazon EC2（Elastic Compute Cloud，弹性计算云），每次切换只能停机几分钟，用哪个服务？
A:
Answer: AWS Transform MGN (formerly AWS Application Migration Service): block-level replication.
Because: an agent on each source server copies its disks block by block to AWS and keeps sending new writes, so you launch test instances first, then stop the source briefly and launch the cutover instance.
Exam: rehost whole servers to EC2 with minimal downtime → ✅ AWS Transform MGN; ❌ AWS DMS (Database Migration Service): migrates databases, not whole servers
A_ZH:
答：AWS Transform MGN（原名 AWS Application Migration Service，应用迁移服务）：块级复制。
因为：每台源服务器上装一个 agent（代理），它把磁盘按块复制到 AWS，并持续发送新的写入，所以你先启动测试实例验收，再短暂停掉源服务器，启动切换（cutover）实例。
考法：把整台服务器原样迁到 EC2、停机最短（rehost whole servers to EC2 with minimal downtime）→ ✅ AWS Transform MGN；❌ AWS DMS（Database Migration Service，数据库迁移服务）：迁移数据库，不迁整台服务器
SOURCE: https://docs.aws.amazon.com/mgn/latest/ug/what-is-application-migration-service.html
AWS Transform MGN (MGN) automates the migration of physical, virtual, and cloud servers to AWS with minimal downtime, typically cutover windows of minutes. MGN performs continuous block-level replication of your source servers and converts them for launch on AWS, allowing you to migrate large numbers of servers without compatibility issues or performance disruption.

## awsb-bf-ebs-hdd | d2
TOPIC: Block and file storage
Q:
A log-processing job reads large files sequentially and needs high throughput at a low cost per GB on Amazon EBS (Elastic Block Store). Which volume type?
Q_ZH:
一个日志处理任务顺序读取大文件，需要在 Amazon EBS（Elastic Block Store，弹性块存储）上以较低的每 GB 成本获得高吞吐，用哪种卷类型？
A:
Answer: st1 Throughput Optimized HDD (hard disk drive): cheap sequential throughput.
Because: the name says it: Throughput Optimized means st1 is low-cost magnetic storage rated in throughput, not IOPS (input/output operations per second), so large sequential reads run fast, while small random I/O (input/output) is slow and it cannot be a boot volume.
Exam: big sequential throughput, data warehouses, log processing → ✅ st1; ❌ sc1 Cold HDD: lowest cost, for rarely accessed data, lower throughput; ❌ gp3: SSD (solid state drive), higher price per GB
A_ZH:
答：st1 Throughput Optimized HDD（hard disk drive，机械硬盘）：便宜的顺序吞吐。
因为：名字就是答案：Throughput Optimized（吞吐优化）说明 st1 是按吞吐量而不是 IOPS（input/output operations per second，每秒读写次数）定性能的低成本磁性存储，所以大块顺序读很快，小块随机 I/O（input/output，输入输出）很慢，也不能当启动卷。
考法：大块顺序吞吐、数据仓库、日志处理 → ✅ st1；❌ sc1 Cold HDD：成本最低，给很少访问的数据，吞吐更低；❌ gp3：SSD（solid state drive，固态硬盘），每 GB 更贵
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/hdd-vols.html
Throughput Optimized HDD (st1) volumes provide low-cost magnetic storage that defines performance in terms of throughput rather than IOPS. This volume type is a good fit for large, sequential workloads such as Amazon EMR, ETL, data warehouses, and log processing.

## awsb-cost-nonprod-schedule | d3
TOPIC: Compute and scaling
Q:
Development Amazon EC2 (Elastic Compute Cloud) and Amazon RDS (Relational Database Service) instances should run only during office hours, without writing custom code. Which AWS solution?
Q_ZH:
开发用的 Amazon EC2（Elastic Compute Cloud，弹性计算云）和 Amazon RDS（Relational Database Service，关系型数据库服务）实例只该在上班时间运行，而且不想写自定义代码，用哪个 AWS 方案？
A:
Answer: Instance Scheduler on AWS: tag-based start and stop.
Because: you tag each instance with a schedule, and the solution's Lambda functions stop and start the instances at those times, so compute is billed only for office hours.
Exam: run instances only during set hours with no custom code → ✅ Instance Scheduler on AWS; ❌ Reserved Instances: billed every hour of the term, used or not
A_ZH:
答：Instance Scheduler on AWS：按标签自动开关机。
因为：你给每台实例打上时间表标签，这个方案里的 Lambda 函数就按时停止和启动实例，计算费用只花在上班时间。
考法：不写代码、只在设定时间段运行实例（start and stop on a schedule）→ ✅ Instance Scheduler on AWS；❌ Reserved Instances：整个期限内每小时都计费，用不用都收
SOURCE: https://docs.aws.amazon.com/solutions/latest/instance-scheduler-on-aws/solution-overview.html
Instance Scheduler on AWS leverages Amazon Web Services (AWS) resource tags and AWS Lambda to automatically stop and restart instances across multiple AWS Regions and accounts on a customer-defined schedule.

## awsb-dns-active-active | d2
TOPIC: Edge and DNS
Q:
Two Regions must both serve users all the time, and a Region that fails its health check must drop out of DNS (Domain Name System) answers. Which Route 53 setup?
Q_ZH:
两个区域（Region）要一直同时服务用户，健康检查失败的区域要从 DNS（Domain Name System，域名系统）应答里剔除，用哪种 Route 53 配置？
A:
Answer: Active-active: latency or weighted records with health checks.
Because: in active-active, every record with the same name and routing policy stays eligible to answer unless its health check fails, so both Regions serve users and a failed one simply drops out.
Exam: all Regions serve traffic, unhealthy ones removed → ✅ active-active with latency or weighted records plus health checks; ❌ failover routing: active-passive, the secondary idles until the primary fails
A_ZH:
答：主主模式（active-active）：延迟或加权记录加健康检查。
因为：在主主模式下，同名、同路由策略的每条记录都可以被用来应答，除非它的健康检查失败，所以两个区域都在服务，坏掉的那个直接被剔除。
考法：所有区域都承接流量、不健康的剔除 → ✅ 主主模式：延迟或加权记录加健康检查；❌ failover routing（故障转移路由）：主备模式，备用站点要等主站点失败才启用
SOURCE: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover-types.html
In active-active failover, all the records that have the same name, the same type (such as A or AAAA), and the same routing policy (such as weighted or latency) are active unless Route 53 considers them unhealthy. Route 53 can respond to a DNS query using any healthy record.

## awsb-dt-detective | d2
TOPIC: Encryption and threat detection
Q:
A security finding flags a role making unusual API (application programming interface) calls, and you must trace what that role did over past weeks to find the root cause. Which service?
Q_ZH:
一条安全发现指出某个角色在发起异常的 API（application programming interface，应用程序接口）调用，你要追查这个角色过去几周做了什么、找出根因，用哪个服务？
A:
Answer: Amazon Detective: investigates findings with behavior graphs.
Because: Detective collects logs such as CloudTrail and VPC (virtual private cloud) Flow Logs and links them into a behavior graph of who did what, so you can follow one role back through up to a year of activity.
Exam: find the root cause or scope of a finding → ✅ Amazon Detective; ❌ Amazon GuardDuty: raises the finding, does not build the investigation graph
A_ZH:
答：Amazon Detective：用行为图调查安全发现。
因为：Detective 收集 CloudTrail、VPC（virtual private cloud，虚拟私有云）Flow Logs（流日志）等日志，把它们连成一张“谁做了什么”的行为图，所以你能顺着一个角色回看最长一年的活动。
考法：查清某条发现的根因或影响范围（root cause）→ ✅ Amazon Detective；❌ Amazon GuardDuty：负责发出发现，不建调查用的行为图
SOURCE: https://docs.aws.amazon.com/detective/latest/userguide/what-is-detective.html
Amazon Detective helps you analyze, investigate, and quickly identify the root cause of security findings or suspicious activities. Detective automatically collects log data from your AWS resources.

## awsb-ec2-hibernate | d2
TOPIC: Compute and scaling
Q:
An instance needs 15 minutes to rebuild its in-memory cache after every start, and each morning it must resume with that memory intact after being paused overnight. Which option?
Q_ZH:
一台实例每次启动后要花 15 分钟重建内存缓存，夜里暂停后，第二天早上必须带着原来的内存内容恢复，用哪种方式？
A:
Answer: EC2 (Elastic Compute Cloud) hibernation: memory saved to the root volume.
Because: hibernation writes the instance's RAM (random access memory) to its encrypted Amazon EBS (Elastic Block Store) root volume and reloads it at start, so processes resume where they were, while a normal stop clears memory.
Exam: resume fast with in-memory state kept → ✅ hibernate the instance; ❌ stop and start: memory is cleared, so the cache warms up again
A_ZH:
答：EC2（Elastic Compute Cloud，弹性计算云）休眠：把内存存到根卷上。
因为：休眠会把实例的 RAM（random access memory，内存）内容写到加密的 Amazon EBS（Elastic Block Store，弹性块存储）根卷，启动时再读回来，进程从原处继续；普通的停止会清空内存。
考法：快速恢复并保留内存状态（keep in-memory state）→ ✅ 让实例休眠（hibernate）；❌ 停止再启动：内存清空，缓存要重新预热
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Hibernate.html
When you hibernate an instance, Amazon EC2 signals the operating system to perform hibernation (suspend-to-disk). Hibernation saves the contents from the instance memory (RAM) to your Amazon Elastic Block Store (Amazon EBS) root volume.

## awsb-iam-mfa-condition | d3
TOPIC: Identity and accounts
Q:
ec2:StopInstances must work only for users who signed in with MFA (multi-factor authentication), while their other actions keep working. Which policy statement do you add?
Q_ZH:
ec2:StopInstances 只能让用 MFA（multi-factor authentication，多因素认证）登录的用户执行，他们的其他操作照常，要加哪条策略语句？
A:
Answer: A Deny with BoolIfExists aws:MultiFactorAuthPresent false: no MFA, no stop.
Because: the key is missing on long-term access-key calls and false on sessions without MFA, so BoolIfExists makes the Deny catch both, and it covers only the listed action, leaving other allowed actions working.
Exam: require MFA for chosen actions → ✅ Deny with BoolIfExists aws:MultiFactorAuthPresent false; ❌ Deny with plain Bool false: misses access-key calls, where the key is absent
A_ZH:
答：用 BoolIfExists 判断 aws:MultiFactorAuthPresent 为 false 时 Deny：没 MFA 就不能停。
因为：用长期 access key 调用时这个键根本不存在，没用 MFA 的会话里它是 false，BoolIfExists 让 Deny 两种都拦住；而且只针对列出的操作，其他已允许的操作照常能用。
考法：require MFA for chosen actions → ✅ Deny 加 BoolIfExists aws:MultiFactorAuthPresent false；❌ Deny 加普通 Bool false：漏掉用 access key 的调用，因为那时这个键不存在
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html
This combination of Deny, BoolIfExists, and false denies requests that are not authenticated using MFA. Specifically, it denies requests from temporary credentials that do not include MFA.

## awsb-nc-compatible-engine | d2
TOPIC: Databases
Q:
An app already uses MongoDB drivers and queries, and the team wants a managed AWS database that keeps that code. Which service?
Q_ZH:
一个应用已经在用 MongoDB 的驱动和查询，团队想换成 AWS 托管数据库又保留这些代码，选哪个服务？
A:
Answer: Amazon DocumentDB (with MongoDB compatibility): same drivers, same code.
Because: the name says it: DocumentDB stores documents like JSON (JavaScript Object Notation) and accepts the MongoDB API (application programming interface), so existing drivers and tools connect unchanged.
Exam: managed MongoDB-compatible database → ✅ Amazon DocumentDB; ❌ Amazon Keyspaces: the managed Apache Cassandra-compatible service
A_ZH:
答：Amazon DocumentDB（with MongoDB compatibility，兼容 MongoDB）：驱动和代码都不用换。
因为：名字就是答案：DocumentDB 存的是类似 JSON（JavaScript Object Notation，JavaScript 对象表示法）的文档，接受 MongoDB 的 API（application programming interface，应用程序接口），所以现有驱动和工具直接就能连。
考法：托管的兼容 MongoDB 的数据库 → ✅ Amazon DocumentDB；❌ Amazon Keyspaces：托管的兼容 Apache Cassandra 的服务
SOURCE: https://docs.aws.amazon.com/documentdb/latest/developerguide/what-is.html
With Amazon DocumentDB, you can run the same application code and use the same drivers and tools that you use with MongoDB.

## awsb-s3-small-objects-bundle | d3
TOPIC: S3 storage
Q:
Millions of 10 KB log files are about to be archived for years in S3 (Simple Storage Service) Glacier Deep Archive. Why should they be bundled into larger files first?
Q_ZH:
数百万个 10 KB 的日志文件要在 S3（Simple Storage Service，简单存储服务）Glacier Deep Archive 里归档好几年，为什么应该先把它们打包成更大的文件？
A:
Answer: Each archived object adds about 40 KB of billed overhead.
Because: AWS rule: every object in Glacier Flexible Retrieval or Deep Archive is billed for 40 KB of extra metadata, and each transition is a paid request, so for tiny objects the overhead can exceed the savings.
Exam: archive millions of tiny objects cheaply → ✅ bundle them into larger files before archiving; ❌ S3 Standard-IA (Infrequent Access) or Glacier Instant Retrieval: bill each object as 128 KB or more; ❌ a lifecycle rule alone: skips objects under 128 KB by default
A_ZH:
答：每个归档对象都要多计约 40 KB 的开销。
因为：AWS 规定，记住即可：Glacier Flexible Retrieval 或 Deep Archive 里的每个对象都要额外按 40 KB 元数据计费，而且每次转换都是一次收费请求，所以对小对象来说，这些开销可能比省下的钱还多。
考法：便宜地归档数百万个小对象（archive millions of tiny objects cheaply）→ ✅ 先打包成大文件再归档；❌ S3 Standard-IA（Infrequent Access，低频访问）或 Glacier Instant Retrieval：每个对象至少按 128 KB 计费；❌ 只靠生命周期规则：默认跳过小于 128 KB 的对象
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-transition-general-considerations.html
If you are archiving small objects, consider these storage charges. Also consider aggregating many small objects into a smaller number of large objects to reduce overhead costs.

## awsb-sl-amplify-hosting | d2
TOPIC: Serverless and containers
Q:
A team's React single-page web app should build and deploy automatically on every Git push and be served worldwide, with no servers to run. Which service?
Q_ZH:
一个团队的 React 单页 Web 应用要在每次 Git push 后自动构建和部署，并面向全球提供访问，而且不运行任何服务器，用哪个服务？
A:
Answer: AWS Amplify Hosting: Git-based build, deploy and hosting.
Because: Amplify Hosting connects to your Git repository, runs the build on each commit and publishes the output to the AWS global CDN (content delivery network), so continuous deployment and worldwide hosting come in one managed service.
Exam: host a static or single-page web front end with Git-based CI/CD (continuous integration and continuous delivery) → ✅ AWS Amplify Hosting; ❌ Amazon S3 (Simple Storage Service) static website hosting: stores the files, builds nothing from Git
A_ZH:
答：AWS Amplify Hosting：基于 Git 的构建、部署和托管。
因为：Amplify Hosting 连接你的 Git 仓库，每次提交都自动构建，再把产物发布到 AWS 全球 CDN（content delivery network，内容分发网络），所以持续部署和全球托管一个托管服务就全包了。
考法：托管静态或单页 Web 前端，并要基于 Git 的 CI/CD（continuous integration and continuous delivery，持续集成与持续交付）→ ✅ AWS Amplify Hosting；❌ Amazon S3（Simple Storage Service，简单存储服务）静态网站托管：只存文件，不会从 Git 构建
SOURCE: https://docs.aws.amazon.com/amplify/latest/userguide/welcome.html
Amplify Hosting provides a Git-based workflow for hosting full-stack serverless web applications with continuous deployment. Amplify deploys your app to the AWS global content delivery network (CDN).

## awsb-sl-api-http-vs-rest | d2
TOPIC: Serverless and containers
Q:
An API (application programming interface) only passes requests through to Lambda functions and must cost as little as possible. Which API Gateway API type?
Q_ZH:
一个 API（application programming interface，应用程序接口）只是把请求转给 Lambda 函数，要求成本尽可能低，用 API Gateway 的哪种 API 类型？
A:
Answer: HTTP (Hypertext Transfer Protocol) API: fewer features, lower price.
Because: HTTP APIs leave out extras such as API keys, caching and request validation, so AWS offers them at a lower price, and plain proxying to Lambda needs none of those extras.
Exam: simple proxy to Lambda or HTTP backends at the lowest cost → ✅ HTTP API; ❌ REST (representational state transfer) API: adds API keys, caching and AWS WAF (web application firewall), costs more
A_ZH:
答：HTTP（Hypertext Transfer Protocol，超文本传输协议）API：功能少，价格低。
因为：HTTP API 去掉了 API 密钥、缓存、请求校验这类附加功能，所以 AWS 能以更低的价格提供；而单纯转发给 Lambda 根本用不到这些功能。
考法：简单转发到 Lambda 或 HTTP 后端、成本最低 → ✅ HTTP API；❌ REST（representational state transfer，表述性状态转移）API：多了 API 密钥、缓存和 AWS WAF（web application firewall，Web 应用防火墙），价格更高
SOURCE: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html
REST APIs support more features than HTTP APIs, while HTTP APIs are designed with minimal features so that they can be offered at a lower price.

## awsb-vpc-elastic-ip | d1
TOPIC: VPC networking
Q:
Partners allow-list your server's public address, and it must stay the same even when you replace the instance. Which AWS feature?
Q_ZH:
合作方把你服务器的公网地址加进了白名单，即使你更换实例，这个地址也必须保持不变，用哪个 AWS 功能？
A:
Answer: An Elastic IP (Internet Protocol) address: static and yours to remap.
Because: an Elastic IP address is a static public IPv4 (Internet Protocol version 4) address that stays in your account until you release it, so you remap it to the new instance and partners see no change.
Exam: static public IPv4 address that survives instance stop or replacement → ✅ Elastic IP address; ❌ auto-assigned public IPv4 address: released when the instance stops or terminates
A_ZH:
答：Elastic IP（Internet Protocol，互联网协议）地址：固定不变，可以随时改绑。
因为：Elastic IP 地址是静态的公有 IPv4（Internet Protocol version 4，第 4 版互联网协议）地址，在你释放之前一直留在你的账户里，所以把它改绑到新实例即可，合作方看到的地址不变。
考法：实例停止或更换后仍不变的静态公有 IPv4 地址 → ✅ Elastic IP 地址；❌ 自动分配的公有 IPv4 地址：实例停止或终止时就被释放
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html
An Elastic IP address is a static IPv4 address designed for dynamic cloud computing. An Elastic IP address is allocated to your AWS account, and is yours until you release it.

## awsb-ec2-compute-optimized | d2
TOPIC: Compute and scaling
Q:
A video-encoding fleet is limited by processor power, not by memory. Which instance family?
Q_ZH:
一组视频编码服务器的瓶颈在处理器算力，而不在内存，选哪种实例系列？
A:
Answer: Compute optimized (C family): high-performance processors.
Because: the name says it: compute optimized instances are built around high-performance processors, so processor-bound work such as media transcoding or batch processing finishes faster than on memory-heavy types.
Exam: CPU (central processing unit)-bound batch, encoding or HPC (high performance computing) → ✅ compute optimized (C family); ❌ memory optimized (R family): pays for memory the job does not use
A_ZH:
答：计算优化型（compute optimized，C 系列）：高性能处理器。
因为：名字就是答案：计算优化型实例围绕高性能处理器设计，媒体转码或批处理这类吃处理器的活，跑得比偏内存的类型更快。
考法：受 CPU（central processing unit，中央处理器）限制的批处理、编码或 HPC（high performance computing，高性能计算）→ ✅ compute optimized（C 系列）；❌ memory optimized（R 系列）：为用不上的内存付钱
SOURCE: https://docs.aws.amazon.com/ec2/latest/instancetypes/co.html
Compute optimized instances are designed for compute intensive applications that benefit from high performance processors. These instances are ideal for batch processing workloads, media transcoding, high performance web servers, high performance computing (HPC), scientific modeling, dedicated gaming servers, ad server engines, and machine learning inference.

## awsb-ec2-memory-optimized | d2
TOPIC: Compute and scaling
Q:
A self-managed in-memory database must hold a very large dataset in memory on each node. Which instance family?
Q_ZH:
一个自己管理的内存数据库要在每个节点的内存里放下非常大的数据集，选哪种实例系列？
A:
Answer: Memory optimized (R or X family): large memory per core.
Because: the name says it: memory optimized instances pair each processor core with more memory than general purpose types, so large in-memory datasets fit and are read from memory quickly.
Exam: in-memory databases or caches → ✅ memory optimized (R or X family); ❌ general purpose (M family): balanced, less memory per core
A_ZH:
答：内存优化型（memory optimized，R 或 X 系列）：每个核配更多内存。
因为：名字就是答案：内存优化型实例给每个处理器核心配的内存比通用型多，大型内存数据集放得下，从内存读取也快。
考法：内存数据库或缓存（in-memory databases or caches）→ ✅ memory optimized（R 或 X 系列）；❌ general purpose（通用型，M 系列）：配比均衡，每核内存较少
SOURCE: https://docs.aws.amazon.com/ec2/latest/instancetypes/mo.html
Memory optimized instances are designed to deliver fast performance for workloads that process large data sets in memory.

## awsb-mo-health-dashboard | d2
TOPIC: Monitoring, governance and cost
Q:
You want an automatic email whenever AWS schedules maintenance on one of your Amazon EC2 (Elastic Compute Cloud) instances. Which service?
Q_ZH:
每当 AWS 给你的某台 Amazon EC2（Elastic Compute Cloud，弹性计算云）实例安排计划维护时，你都想自动收到邮件，用哪个服务？
A:
Answer: AWS Health events through Amazon EventBridge: AWS-side events about your resources.
Because: AWS Health publishes events about AWS changes that affect your account, such as scheduled updates to your instances, and an EventBridge rule that matches those events can send the email or start an automated fix.
Exam: be told about AWS outages or scheduled maintenance affecting your resources → ✅ AWS Health (the AWS Health Dashboard, automated with EventBridge); ❌ a CloudWatch alarm: watches your own metrics, not AWS-side events
A_ZH:
答：通过 Amazon EventBridge 接收的 AWS Health 事件：AWS 一侧影响你资源的事件。
因为：AWS Health 会发布影响你账户的 AWS 变更事件，例如你实例的计划更新；匹配这些事件的 EventBridge 规则就能发邮件或触发自动修复。
考法：得知影响你资源的 AWS 故障或计划维护 → ✅ AWS Health（AWS Health Dashboard，用 EventBridge 自动化）；❌ CloudWatch 告警：只盯你自己的指标，不是 AWS 一侧的事件
SOURCE: https://docs.aws.amazon.com/health/latest/ug/cloudwatch-events-health.html
Depending on the type of event, you can capture event information, initiate additional events, send notifications, take corrective action, or perform other actions. For example, you can use AWS Health to receive email notifications if you have AWS resources in your AWS account that are scheduled for updates, such as Amazon Elastic Compute Cloud (Amazon EC2) instances.

## awsb-ops-auto-scaling-plans | d2
TOPIC: Compute and scaling
Q:
One application uses an Auto Scaling group, an Amazon ECS (Elastic Container Service) service and a DynamoDB table, and the team wants to set up scaling for all of them in one place. Which service?
Q_ZH:
一个应用用到了一个 Auto Scaling group、一个 Amazon ECS（Elastic Container Service，容器服务）服务和一张 DynamoDB 表，团队想在一个地方给它们统一设置扩缩容，用哪个服务？
A:
Answer: AWS Auto Scaling scaling plan: one plan, many services.
Because: a scaling plan finds the application's scalable resources by tag or CloudFormation stack and creates scaling policies on each one, so scaling is configured once instead of separately in each service.
Exam: one scaling plan across several services → ✅ AWS Auto Scaling; ❌ Amazon EC2 (Elastic Compute Cloud) Auto Scaling alone: scales only groups of EC2 instances
A_ZH:
答：AWS Auto Scaling 的 scaling plan（扩缩容计划）：一个计划管多个服务。
因为：扩缩容计划按标签或 CloudFormation 堆栈找出应用里所有可扩缩的资源，并给每个资源建好扩缩容策略，只需配置一次，不用在每个服务里分别设置。
考法：一个计划管多个服务的扩缩容（one scaling plan for multiple services）→ ✅ AWS Auto Scaling；❌ 只用 Amazon EC2（Elastic Compute Cloud，弹性计算云）Auto Scaling：只能扩缩 EC2 实例组成的组
SOURCE: https://docs.aws.amazon.com/autoscaling/plans/userguide/what-is-a-scaling-plan.html
Use a scaling plan to configure auto scaling for related or associated scalable resources in a matter of minutes. For example, you can use tags to group resources in categories such as production, testing, or development.

## awsb-ops-immutable-infra | d3
TOPIC: Compute and scaling
Q:
A team wants zero configuration drift between servers, so no change may ever be made to a running server. Which deployment practice?
Q_ZH:
一个团队希望服务器之间完全没有配置漂移，所以运行中的服务器上绝不允许做任何改动，用哪种部署做法？
A:
Answer: Immutable infrastructure: replace servers, never patch them in place.
Because: every change is built into a new AMI (Amazon Machine Image) or template and released as new instances, then the old ones are terminated, so every running server matches a known, tested version.
Exam: no in-place changes, no drift → ✅ immutable infrastructure: new instances from a new AMI; ❌ in-place patching or manual logins: servers slowly drift apart
A_ZH:
答：不可变基础设施（immutable infrastructure）：替换服务器，绝不原地打补丁。
因为：每次改动都做进新的 AMI（Amazon Machine Image，亚马逊机器镜像）或模板，以新实例的方式发布，再终止旧实例，所以每台运行中的服务器都对应一个已知、测试过的版本。
考法：不做原地修改、不产生漂移（no in-place changes）→ ✅ immutable infrastructure：用新 AMI 启动新实例；❌ 原地打补丁或手动登录改配置：服务器会慢慢变得各不相同
SOURCE: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_tracking_change_management_immutable_infrastructure.html
Immutable infrastructure is a model that mandates that no updates, security patches, or configuration changes happen in-place on production workloads. When a change is needed, the architecture is built onto new infrastructure and deployed into production.

## awsb-sec-artifact | d2
TOPIC: Monitoring, governance and cost
Q:
An auditor asks for AWS's own SOC (System and Organization Controls) 2 report covering the AWS infrastructure. Where do you download it?
Q_ZH:
审计员要 AWS 自己的、覆盖 AWS 基础设施的 SOC（System and Organization Controls，系统与组织控制）2 报告，去哪里下载？
A:
Answer: AWS Artifact: AWS compliance reports on demand.
Because: the report covers controls that AWS runs, so only AWS can supply it, and Artifact is where AWS publishes its SOC, PCI (Payment Card Industry) and ISO (International Organization for Standardization) reports for download.
Exam: download AWS compliance reports, or accept an agreement such as the BAA (Business Associate Addendum) → ✅ AWS Artifact; ❌ AWS Audit Manager: collects evidence about your own controls (closed to new customers)
A_ZH:
答：AWS Artifact：随时下载 AWS 的合规报告。
因为：报告覆盖的是 AWS 自己运行的控制措施，只有 AWS 能提供，而 Artifact 就是 AWS 发布 SOC、PCI（Payment Card Industry，支付卡行业）和 ISO（International Organization for Standardization，国际标准化组织）报告供下载的地方。
考法：下载 AWS 合规报告，或接受 BAA（Business Associate Addendum，商业伙伴附加协议）等协议 → ✅ AWS Artifact；❌ AWS Audit Manager：收集关于你自己控制措施的证据（已不对新客户开放）
SOURCE: https://docs.aws.amazon.com/artifact/latest/ug/what-is-aws-artifact.html
AWS Artifact provides on-demand downloads of AWS security and compliance documents. For example, reports on compliance with International Organization for Standardization (ISO) standards and Payment Card Industry (PCI) Security Standards, and System and Organization Controls (SOC) reports.

## awsb-bf-efs-provisioned-vs-bursting | d2
TOPIC: Block and file storage
Q:
An Amazon EFS (Elastic File System) file system holds only 100 GB but must deliver a steady, known 300 MiB/s (mebibytes per second) all day. Which throughput mode?
Q_ZH:
一个 Amazon EFS（Elastic File System，弹性文件系统）只存了 100 GB，却要全天稳定提供已知的 300 MiB/s（mebibytes per second，每秒兆字节）吞吐，用哪种吞吐模式？
A:
Answer: Provisioned: you set the number.
Because: the name says it: Provisioned means you set the throughput yourself, apart from how much is stored, while Bursting ties the baseline to stored size (about 5 MiB/s for 100 GB) and only goes higher while burst credits last.
Exam: steady, known throughput beyond what the storage size gives → ✅ Provisioned throughput; ❌ Bursting throughput: baseline grows with size, bursts only on credits
A_ZH:
答：Provisioned（预置）：数字你自己定。
因为：名字就是答案：Provisioned 是你自己设定吞吐，和存了多少无关；Bursting（突发）的基线跟着存储量走（100 GB 约 5 MiB/s），只有攒下积分时才能冲高。
考法：稳定、已知、超过存储量所能给的吞吐 → ✅ Provisioned throughput；❌ Bursting throughput：基线随容量增长，只能靠积分短时冲高
SOURCE: https://docs.aws.amazon.com/efs/latest/ug/performance.html
With Provisioned throughput, you specify a level of throughput that the file system can drive independent of the file system's size or burst credit balance. Use Provisioned throughput if you know your workload's performance requirements, or if your application drives throughput at 5% or more of the average-to-peak ratio.

## awsb-bf-efs-elastic-throughput | d2
TOPIC: Block and file storage
Q:
An Amazon EFS (Elastic File System) file system sees short, unpredictable spikes of heavy traffic and sits nearly idle the rest of the day. Which throughput mode?
Q_ZH:
一个 Amazon EFS（Elastic File System，弹性文件系统）会出现短暂、不可预测的流量高峰，其余时间几乎闲着，用哪种吞吐模式？
A:
Answer: Elastic throughput: scales automatically, pay per use.
Because: Elastic scales throughput up and down with the workload, so you never size it in advance and pay only for the data read and written, while Provisioned charges all month for a fixed amount you set.
Exam: spiky or unpredictable throughput that is hard to forecast (AWS's recommended default) → ✅ Elastic throughput; ❌ Provisioned throughput: you pay for a fixed amount even when idle
A_ZH:
答：Elastic（弹性）吞吐：自动伸缩，用多少付多少。
因为：Elastic 随负载自动升降吞吐，所以不用事先定规格，只按读写的数据量付费；Provisioned 则按你设定的固定吞吐整月收费。
考法：突发、不可预测、难以预估的吞吐（AWS 推荐的默认模式）→ ✅ Elastic throughput；❌ Provisioned throughput：闲着也要为固定吞吐付费
SOURCE: https://docs.aws.amazon.com/efs/latest/ug/performance.html
Elastic throughput is the best throughput mode for spiky or unpredictable workloads with performance requirements that are difficult to forecast, or for applications that drive throughput at 5% or less of the peak throughput on average (the average-to-peak ratio). Because throughput performance for file systems with Elastic throughput scales automatically, you don't need to specify or provision the throughput capacity to meet your application needs.

## awsb-bf-efs-general-purpose-vs-max-io | d2
TOPIC: Block and file storage
Q:
A new Amazon EFS (Elastic File System) file system serves a latency-sensitive web application. Which performance mode should it use?
Q_ZH:
一个新建的 Amazon EFS（Elastic File System，弹性文件系统）要服务一个对延迟敏感的 Web 应用，该用哪种性能模式？
A:
Answer: General Purpose: lowest latency per operation.
Because: the name misleads: Max I/O (input/output) sounds faster, but it is a previous-generation mode with higher latency per operation that cannot be used with Elastic throughput, so AWS recommends General Purpose for all file systems.
Exam: lowest latency, or any new file system → ✅ General Purpose performance mode; ❌ Max I/O performance mode: previous generation, higher latency, not available with Elastic throughput
A_ZH:
答：General Purpose（通用）：每次操作延迟最低。
因为：名字有误导：Max I/O（input/output，输入输出）听着更快，其实是上一代模式，每次操作延迟更高，也不能和 Elastic 吞吐一起用，所以 AWS 建议所有文件系统都用 General Purpose。
考法：最低延迟，或任何新建的文件系统 → ✅ General Purpose performance mode；❌ Max I/O performance mode：上一代、延迟更高、不支持 Elastic 吞吐
SOURCE: https://docs.aws.amazon.com/efs/latest/ug/performance.html
General Purpose mode has the lowest per-operation latency and is the default performance mode for file systems.

## awsb-cost-zonal-ri-capacity | d1
TOPIC: Compute and scaling
Q:
You are buying Reserved Instances and also need AWS to hold capacity for them in one Availability Zone. Which scope do you choose?
Q_ZH:
你正在购买预留实例（Reserved Instance），还需要 AWS 在一个可用区（Availability Zone）里替它们留好容量，选哪种范围？
A:
Answer: A zonal Reserved Instance: it names the zone.
Because: capacity means real servers in one Availability Zone; a zonal Reserved Instance names that zone, so AWS holds servers there, while a regional one names no zone and only discounts, for the same price.
Exam: reserve capacity in a specific Availability Zone → ✅ zonal Reserved Instance; ❌ regional Reserved Instance: discount in any zone, no capacity held
A_ZH:
答：可用区级预留实例（zonal Reserved Instance）：它写明了是哪个可用区。
因为：容量就是某个可用区里实实在在的服务器；可用区级预留实例写明了可用区，AWS 才能在那里替你留住机器；区域级预留实例没写可用区，只给折扣，而两者价格相同。
考法：在指定可用区预留容量（reserve capacity）→ ✅ 可用区级预留实例（zonal Reserved Instance）；❌ 区域级预留实例（regional Reserved Instance）：任何可用区都打折，但不留容量
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/reserved-instances-scope.html
A regional Reserved Instance does not reserve capacity. A zonal Reserved Instance reserves capacity in the specified Availability Zone.
