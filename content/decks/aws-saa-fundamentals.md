# deck: aws-saa-fundamentals

## awsf-net-01-cidr | d1
TOPIC: 3.4 网络连接 · 基础
Q:
10.0.0.0/16 和 10.0.0.0/24，哪个 IP 段更大？
A:
答：/16 更大：约 6.5 万个地址；/24 只有约 256 个。
因为："/" 后面的数字是固定不变的二进制位数（共 32 位）；固定得越多，能变的越少，范围越小。
考法：10.0.0.0/16 和 10.0.5.0/24 两个 VPC 要互连 → ✅ 认出 IP 段重叠；❌ 以为写法不同就不重叠

## awsf-net-02-region-az | d1
TOPIC: 3.4 网络连接 · 基础
Q:
一个可用区停电了，为什么同一区域另一个可用区不受影响？
A:
答：可用区之间互相独立，供电和网络各自一套。
因为：区域（Region）是一个地理位置，里面有多个可用区；每个可用区是一组独立的数据中心。
考法：要扛住一个可用区故障（highly available）→ ✅ 部署到多个可用区（Multi-AZ）；❌ 只放在一个可用区

## awsf-net-03-vpc | d1
TOPIC: 3.4 网络连接 · 基础
Q:
同一个账号里新建两个 VPC，要互相访问，还缺什么？
A:
答：缺一条连接：VPC 之间默认不通。
因为：VPC 是你在 AWS 里的一块私有网络，有自己的 IP 段，建在一个区域里；要和别的 VPC 或公司机房通，得另外建连接。
考法：两个 VPC，或 VPC 和机房要通 → ✅ 另外选一种连接；❌ 以为同一个账号里的 VPC 默认就通

## awsf-net-04-route-table | d1
TOPIC: 3.4 网络连接 · 基础
Q:
子网的路由表里没有去某个 IP 段的路由，发往那里的流量会怎样？
A:
答：发不出去。路由表里没写的目的地，就到不了。
因为：子网是 VPC 在一个可用区里切出的一小段，各绑一张路由表，每条路由写着"目的地 → 下一跳"；同一个 VPC 的子网间自带 local 路由，默认互通。
考法：连接建好了还是不通 → ✅ 先查路由表有没有去对方的路由；❌ 先去换一种连接

## awsf-net-05-public-private-subnet | d1
TOPIC: 3.4 网络连接 · 基础
Q:
一个子网是公有还是私有，看哪里判断？
A:
答：看路由表：有指向互联网网关的路由（通常是 0.0.0.0/0）就是公有，没有就是私有。
因为：0.0.0.0/0 指其他所有地址，也就是互联网；互联网网关是 VPC 进出互联网的大门；公有子网里的机器还要有公网 IP 才能直接上网。
考法：数据库这类不该被外部访问的资源 → ✅ 放私有子网（private subnet）；❌ 放公有子网

## awsf-net-07-vgw-vs-tgw | d1
TOPIC: 3.4 网络连接 · 基础
Q:
虚拟私有网关（VGW）和 Transit Gateway，哪个能同时连很多个 VPC？
A:
答：Transit Gateway。VGW 只挂在一个 VPC 上。
因为：VGW 只连它所在的那个 VPC 和机房；Transit Gateway 是区域里的中转站，很多 VPC 和机房都能连到它。
考法：题目里同时出现 virtual private gateway 和 transit gateway → ✅ 先分清：一个只管一个 VPC，一个是中转站；❌ 看到 gateway 就当成一回事

## awsf-net-08-nat-gateway | d1
TOPIC: 3.4 网络连接 · 基础
Q:
私有子网里的服务器要上网下载补丁，又不能让外面主动连进来，用什么？
A:
答：NAT 网关：只出不进。
因为：NAT 网关一般放在公有子网，替内部机器换上自己的公网地址出去，只放回包进来。
考法：只允许出站、外面不能主动连进来（IPv4，outbound only）→ ✅ NAT gateway；❌ 给私有子网加去互联网网关的路由（那它就成了公有子网）

## awsf-net-09-on-premises | d1
TOPIC: 3.4 网络连接 · 基础
Q:
题目里 on-premises 的服务器要和 VPC 用内网地址互通，可以选哪两种连接？
A:
答：Site-to-Site VPN 或 Direct Connect；Peering 不行，它只连 VPC。
因为：on-premises 指公司自己的机房，不在 AWS 里；VPN 加密走公网，Direct Connect 是专线。
考法：机房（on-premises / data center）要和 VPC 互通 → ✅ Site-to-Site VPN 或 Direct Connect；❌ VPC Peering

## awsf-net-10-site-to-site-vpn | d1
TOPIC: 3.4 网络连接 · 基础
Q:
机房要连 VPC，不想等几周拉专线，先用什么？
A:
答：Site-to-Site VPN：加密隧道走公网，不用拉线。
因为：数据先加密（IPsec）再走公网，到对面再解密；一条 VPN 自带两条隧道，AWS 那头坏一条还有另一条。
考法：机房连 VPC + 要尽快开通（quickly）→ ✅ Site-to-Site VPN；❌ Direct Connect（拉线通常要几周）

## awsf-net-11-customer-gateway | d1
TOPIC: 3.4 网络连接 · 基础
Q:
Site-to-Site VPN 有两条隧道。机房那头的 VPN 设备坏了，还能连上吗？
A:
答：不能。两条隧道都接在这台设备上，会一起断。
因为：这台设备叫客户网关（customer gateway），在机房那头，AWS 里也要建一条同名记录代表它；两条隧道防的是 AWS 那头出事。
考法：题目出现 customer gateway → ✅ 认出是机房那头的设备；❌ 当成 AWS 那头的网关（VGW）

## awsf-net-12-client-vpn | d1
TOPIC: 3.4 网络连接 · 基础
Q:
员工在家要用自己的电脑连进 VPC，用什么 VPN？
A:
答：AWS Client VPN：每个人的电脑各接一条。
因为：Client VPN 的 client 是员工自己的电脑，一人一条；Site-to-Site VPN 连的是整个机房网络。
考法：远程员工、个人电脑接入（remote users）→ ✅ Client VPN；❌ Site-to-Site VPN

## awsf-net-13-alb-vs-nlb | d1
TOPIC: 3.4 网络连接 · 基础
Q:
要一个有固定 IP 的负载均衡器，选 ALB 还是 NLB？
A:
答：NLB。它只看连接，能有固定 IP；ALB 的 IP 会变。
因为：ALB 看得懂 HTTP，能按路径、域名分请求；NLB 处理 TCP/UDP 连接，不看内容。
考法：要固定 IP（static IP）→ ✅ NLB；❌ ALB（它的 IP 会变）

## awsf-net-14-multi-account | d1
TOPIC: 3.4 网络连接 · 基础
Q:
同一家公司的两个 AWS 账号，资源要互相访问，得做什么？
A:
答：显式共享或授权：账号之间默认隔开。
因为：公司用多个账号把团队和环境（开发、生产）隔开；每个账号的资源和权限默认互不相通，费用也能按账号分开看。
考法：资源分在不同账号（different accounts）→ ✅ 要显式共享或授权；❌ 以为同一家公司的账号默认互通

## awsf-net-15-regional-vs-global | d1
TOPIC: 3.4 网络连接 · 基础
Q:
IAM 用户要在 3 个区域用，要建几次？
A:
答：一次。IAM 是全局的，所有区域通用。
因为：全局资源哪里都能用；VPC、Transit Gateway 这类区域资源只在建它的区域里。
考法：IAM 用户要在多个区域用 → ✅ 建一次，所有区域通用；❌ 每个区域各建一套

## awsf-net-18-peering-basics | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
东京和新加坡各有一个 VPC，还属于不同账号，要一对一直连，用什么？
A:
答：VPC Peering：跨区域、跨账号都能连。
因为：Peering 是两个 VPC 之间的私有连接，跨区域时也走 AWS 自己的网络、不走公网。
考法：两个 VPC 在不同账号或不同区域，要直连 → ✅ Peering 照样能连；❌ 以为 Peering 只能同账号、同区域

## awsf-net-06-routes-both-sides | d1
TOPIC: 3.4 网络连接 · VPC 之间
Q:
Peering 连好了，只有一边加了路由，为什么还是不通？
A:
答：两边的路由表都得加上对方的 IP 段。
因为：Peering 把两个 VPC 一对一直接连起来，但路由要两边自己加，不会自动出现；没有对方的 IP 段，流量就不知道走这条连接。
考法：只有一边加了路由、收不到回复 → ✅ 另一边也加上；❌ 再建一条连接

## awsf-net-19-peering-not-transitive | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
A–B、B–C 各有一条 Peering，A 能到 C 吗？
A:
答：不能。Peering 只连两头，不中转（not transitive）。
因为：A 发往 C 的包到了 B 就被丢掉，加路由也没用。
考法：A 要到 C → ✅ A–C 再建一条，或改用 Transit Gateway；❌ 在 A 加一条去 C 的路由

## awsf-net-20-peering-no-edge-routing | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
A 和 B 用 Peering 相连，A 想借 B 的 NAT 网关上网，为什么不行？
A:
答：Peering 不借道：流量一头必须在 A，一头必须在 B。
因为：去互联网或机房的流量到了 B 会被丢掉；A 要上网，就自己建出口，或改用 Transit Gateway。
考法：其他 VPC 想经一个 VPC 的专线或 NAT 出去 → ✅ 各建出口，或改用 Transit Gateway；❌ 靠 Peering 借道

## awsf-net-21-few-vpcs-cheapest | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
只有两三个 VPC 要互通，要最便宜，选什么？
A:
答：Peering。
因为：Peering 不按小时收费，只收跨可用区或跨区域的流量费；Transit Gateway 每个连接按小时收费，还按流量收处理费。
考法：少量 VPC + 最便宜（MOST cost-effective）→ ✅ Peering；❌ Transit Gateway（按小时收费）

## awsf-net-22-peering-vs-tgw-scale | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
6 个 VPC 要全部互通，用 Peering 要连几条？
A:
答：15 条：两两相连，每加一个 VPC 又要连一遍。
因为：n 个 VPC 全互通要 n×(n−1)÷2 条 Peering；换成 Transit Gateway，每个 VPC 只连一次（6 个连接，attachment），还能集中管路由。
考法：VPC 很多（many VPCs）→ ✅ Transit Gateway；❌ 两两 Peering

## awsf-net-23-tgw-ram-share | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
别的账号的 VPC 要接你的 Transit Gateway，先做什么？
A:
答：用 AWS RAM 把 Transit Gateway 共享过去。
因为：RAM（Resource Access Manager）是 AWS 的资源共享服务，不是内存；共享后，对方把自己的 VPC 接上来。
考法：别的账号的 VPC 要接你的 Transit Gateway → ✅ 先用 RAM 共享 Transit Gateway；❌ 以为跨账号接不了

## awsf-net-24-vpc-sharing | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
几个账号想把服务器建在同一个 VPC 里，要用 RAM 共享什么？
A:
答：共享子网（VPC 共享）：VPC 仍归原来的账号管。
因为：同一组织（AWS Organizations）里的其他账号拿到共享的子网，就能在里面建自己的服务器，大家在同一个网络里。
考法：多个账号要共用同一个 VPC（shared VPC）→ ✅ 用 RAM 共享子网；❌ 以为一个 VPC 只能给一个账号用

## awsf-net-25-only-tgw-transits | d3
TOPIC: 3.4 网络连接 · VPC 之间
Q:
Peering、VGW、Transit Gateway 里，谁能让 VPC 之间的流量中转？
A:
答：只有 Transit Gateway。
因为：Peering 只连两头、不中转；VGW 只挂在一个 VPC 上，不在 VPC 之间转发。
考法：方案要流量"从 A 经过 B 到 C" → ✅ 中转靠 Transit Gateway；❌ B 是只靠 Peering 相连的普通 VPC，或 VGW

## awsf-net-26-tgw-route-tables | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
同一个 Transit Gateway 上，怎么让开发 VPC 和生产 VPC 互相不通？
A:
答：用多张 Transit Gateway 路由表把它们分开。
因为：每个连接（attachment）只关联一张路由表；两组 VPC 用不同的表，表里没有对方的路由，就不通。
考法：同一个 Transit Gateway 上要隔离几组 VPC → ✅ 多张 Transit Gateway 路由表；❌ 以为接上同一个 Transit Gateway 就一定全通

## awsf-net-27-tgw-peering | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
两个区域各有一个 Transit Gateway，两边的 VPC 要互通，怎么连？
A:
答：建 Transit Gateway peering（不是 VPC Peering）。
因为：Transit Gateway 是区域资源，只接本区域的 VPC；跨区域各建一个再互连，路由要手动加。
考法：很多 VPC 分在多个区域，都要互通 → ✅ 每个区域一个 Transit Gateway，再互相 peering；❌ 把别的区域的 VPC 直接接到一个 Transit Gateway

## awsf-net-28-privatelink-one-service | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
只想让对方访问你的一个服务，不开放整个网络，用什么？
A:
答：PrivateLink：只开放指定的服务，由使用方发起。
因为：使用方 VPC 里多出一个入口（interface endpoint，就是一块带私有 IP 的网卡 ENI），只通那一个服务，两边不加对方的 IP 段。
考法：只让别人访问一个服务（expose a service）→ ✅ PrivateLink；❌ Peering（会开放整个网络）

## awsf-net-29-privatelink-endpoints | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
服务方要用 PrivateLink 把服务发布出去，服务前面要放哪种负载均衡器？
A:
答：NLB（网络负载均衡器），再发布成 endpoint service。
因为：服务方把服务放在 NLB 后面，发布成 endpoint service；使用方在自己 VPC 里建 interface endpoint 当入口。
考法：NLB + endpoint service + interface endpoint → ✅ 认出是 PrivateLink；❌ 以为两边还要互加对方 IP 段的路由

## awsf-net-30-overlapping-cidr | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
两个 VPC 的 IP 段重叠，哪些连接还能用？
A:
答：Peering 和 Transit Gateway 都不能直接打通；PrivateLink 能用。
因为：IP 重叠时路由分不清发往哪边；PrivateLink 两边都只用自己 VPC 里的地址。
考法：题目出现 overlapping CIDR → ✅ 先排除直接用 Peering 或 Transit Gateway 打通整网的选项；❌ 以为加路由就能解决

## awsf-net-31-direct-connect | d2
TOPIC: 3.4 网络连接 · 机房连 AWS
Q:
机房连 AWS，要网络稳定、不受公网波动影响，用什么？
A:
答：Direct Connect（DX）：拉到 AWS 的专线，不走公网。
因为：不走公网，所以带宽和延迟稳定；但要找运营商把线拉到 AWS 的接入点，开通通常要几周。
考法：要稳定的网络性能（consistent network performance）→ ✅ Direct Connect；❌ 走公网的 VPN（不稳定）

## awsf-net-32-vgw | d2
TOPIC: 3.4 网络连接 · 机房连 AWS
Q:
一个 VPC 要同时接 VPN 和专线，要挂几个虚拟私有网关（VGW）？
A:
答：一个就够：VPN 和专线都接在同一个 VGW 上。
因为：VGW 是 VPC 这头连机房的入口；一个 VPC 同时只能挂一个 VGW（AWS 规定）。
考法：一个 VPC 同时接 VPN 和专线 → ✅ 都接在它唯一的 VGW 上；❌ 再挂第二个 VGW

## awsf-net-33-route-propagation | d2
TOPIC: 3.4 网络连接 · 机房连 AWS
Q:
机房网段经常变，怎么让 VPC 路由表自动跟着更新？
A:
答：开启路由传播（route propagation）：VGW 学到的机房网段自动写进来。
因为：VPN 和专线可以用 BGP 把机房网段告诉 AWS；在 VPC 路由表上为 VGW 开启路由传播，就不用一条条手动加。
考法：机房网段经常变、不想手动维护路由 → ✅ BGP 动态路由 + 路由传播；❌ 每次手动加静态路由

## awsf-net-34-vif | d2
TOPIC: 3.4 网络连接 · 机房连 AWS
Q:
一根 dedicated 专线要同时连 VPC 和 S3，流量怎么分开？
A:
答：开两条 VIF（虚拟接口）：private VIF 去 VPC，public VIF 去 S3。
因为：VIF 是一根专线上分出的通道，看名字知去处；第三种 transit VIF 去 Transit Gateway。
考法：一根 dedicated 专线要连几种目的地 → ✅ 每种开一条 VIF；❌ 每种再拉一根专线

## awsf-net-35-dedicated-vs-hosted | d2
TOPIC: 3.4 网络连接 · 机房连 AWS
Q:
公司只要 100 Mbps 的专线，选 dedicated 还是 hosted connection？
A:
答：hosted。dedicated 最小 1 Gbps。
因为：dedicated 独占一个端口（1 Gbps 起），能开很多条 VIF，部分支持 MACsec 加密；hosted 由合作伙伴分一段带宽给你，可以更小，一条只能开一个 VIF。
考法：要的带宽不到 1 Gbps（如 100 Mbps）→ ✅ hosted connection；❌ dedicated connection（最小 1 Gbps）

## awsf-net-36-dx-gateway | d2
TOPIC: 3.4 网络连接 · 机房连 AWS
Q:
一条专线要连多个 VPC，甚至跨区域，用什么？
A:
答：Direct Connect 网关（DX 网关）。
因为：它是全局资源：private VIF 接到它，它再关联各 VPC 的 VGW，哪个区域、别的账号都行；它不在 VPC 之间转发。
考法：一条专线 + 多个 VPC 或多个区域 → ✅ DX 网关；❌ 每个区域再拉一条专线

## awsf-net-37-private-vif | d2
TOPIC: 3.4 网络连接 · 机房连 AWS
Q:
专线要连 VPC 的虚拟私有网关（VGW），开哪种 VIF？
A:
答：private VIF：名字对名字，private 配 virtual private gateway。
因为：直接接 VGW 只连同区域的一个 VPC；要连多个 VPC，就先接 DX 网关，再由它关联各 VGW。
考法：专线连多个 VPC（经 VGW）→ ✅ private VIF 接 DX 网关；❌ public VIF（它去 S3 这类公共服务）

## awsf-net-38-dx-gateway-one-side | d2
TOPIC: 3.4 网络连接 · 机房连 AWS
Q:
一个 DX 网关能同时接 VGW 和 Transit Gateway 吗？
A:
答：不能，只能站一边：private 那边或 transit 那边。
因为：接 private VIF 的连各 VPC 的 VGW，接 transit VIF 的连 Transit Gateway（AWS 规定）。
考法：选项让同一个 DX 网关既接 VGW 又接 Transit Gateway → ✅ 直接排除；❌ 当成可行方案

## awsf-net-39-transit-vif | d2
TOPIC: 3.4 网络连接 · 机房连 AWS
Q:
专线要接 Transit Gateway，怎么接？
A:
答：中间必须隔一个 DX 网关：transit VIF → DX 网关 → Transit Gateway。
因为：AWS 规定 Transit Gateway 不能直接接 VIF；名字对名字，transit VIF 配 Transit Gateway。
考法：DX + Transit Gateway → ✅ transit VIF 经 DX 网关；❌ transit VIF 直接接 Transit Gateway 或 VGW

## awsf-net-40-vpn-backup | d2
TOPIC: 3.4 网络连接 · 机房连 AWS
Q:
专线的便宜备份用什么？
A:
答：Site-to-Site VPN。
因为：VPN 走公网，不用拉线，便宜、开通快，但不稳定；配好 BGP 后平时走专线，专线断了自动切到 VPN。
考法：DX + 便宜备份（low-cost backup）→ ✅ Site-to-Site VPN；❌ 再拉一条 DX（贵，备份也要同样稳时才选）

## awsf-net-41-vpn-ecmp | d2
TOPIC: 3.4 网络连接 · 机房连 AWS
Q:
一条 Site-to-Site VPN 带宽不够，还想继续用 VPN，怎么加大？
A:
答：多建几条 VPN 接到 Transit Gateway，用 ECMP 把带宽叠起来。
因为：每条普通隧道最多 1.25 Gbps；Transit Gateway 支持 ECMP（VPN 要用 BGP 动态路由），能让多条隧道同时跑流量，VGW 不能。
考法：VPN 带宽不够、还要继续用 VPN（不拉专线）→ ✅ 多条 VPN + Transit Gateway（ECMP）；❌ 在 VGW 上多加几条 VPN

## awsf-net-42-dx-not-encrypted | d2
TOPIC: 3.4 网络连接 · 机房连 AWS
Q:
Direct Connect 专线，数据默认加密吗？
A:
答：不加密。专线管稳定，加密要另外做。
因为：专线只是私有线路，数据原样传输；要加密，可以在专线上再跑一条 VPN，或在支持的 dedicated 端口开 MACsec。
考法：题目说 private VIF 或 dedicated connection → ✅ 只说明线路私有，不说明加密；❌ 把 private 当成 encrypted

## awsf-net-43-dx-resiliency | d2
TOPIC: 3.4 网络连接 · 机房连 AWS
Q:
专线要扛住一个接入点故障，第二条线该拉到哪？
A:
答：另一个接入点（Direct Connect location）。
因为：两条线在同一个接入点，那个接入点出事就一起断；AWS 建议两条线接在两个不同的接入点。
考法：要扛住一个接入点故障 → ✅ 在另一个接入点再拉一条；❌ 在同一个接入点再拉一条
