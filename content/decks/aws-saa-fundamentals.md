# deck: aws-saa-fundamentals

## awsf-net-01-cidr | d1
TOPIC: 3.4 网络连接 · 基础
Q:
IP 段（CIDR）是什么？
A:
答：一整片连续的 IP 地址。
因为：10.0.0.0/16 约有 6.5 万个地址；"/" 后面的数字越大，范围越小。
考法：比较 10.0.0.0/16 和 10.0.0.0/24 → ✅ /24 范围更小（约 256 个地址）；❌ 以为数字越大范围越大

## awsf-net-02-region-az | d1
TOPIC: 3.4 网络连接 · 基础
Q:
区域（Region）和可用区（AZ）是什么？
A:
答：区域是地理位置；可用区是区域里互相独立的一组 AWS 数据中心。
因为：每个可用区有独立的供电和网络，一个出事不影响另一个。
考法：要扛住一个可用区故障（highly available）→ ✅ 部署到多个可用区（Multi-AZ）；❌ 只放在一个可用区

## awsf-net-03-vpc | d1
TOPIC: 3.4 网络连接 · 基础
Q:
VPC 是什么？
A:
答：你在 AWS 里的一块私有网络。
因为：它有自己的 IP 段，建在一个区域里，默认和别的 VPC、公司机房都不通。
考法：两个 VPC 或 VPC 和机房要通 → ✅ 另外选一种连接；❌ 以为默认就通

## awsf-net-04-route-table | d1
TOPIC: 3.4 网络连接 · 基础
Q:
路由表（route table）是干什么的？
A:
答：指路：去哪个 IP 段，走哪个出口。
因为：每条路由写着"目的地 → 下一跳"，没有对应的路由，流量就发不出去；VPC 切出的每一小段（子网）绑一张；同一个 VPC 里的子网自带一条 local 路由，默认互通。
考法：同一个 VPC 里两个子网要互通 → ✅ 默认就通（自带 local 路由）；❌ 再给它们建一条连接

## awsf-net-05-public-private-subnet | d1
TOPIC: 3.4 网络连接 · 基础
Q:
公有子网和私有子网差在哪？
A:
答：差在有没有直通互联网网关的路由。
因为：每个子网只在一个可用区里；它的路由表里有"0.0.0.0/0（去互联网）→ 互联网网关"，就是公有子网，没有就是私有子网（互联网网关：VPC 进出互联网的大门）。
考法：数据库这类不该被外部访问的资源 → ✅ 放私有子网（private subnet）；❌ 放公有子网

## awsf-net-06-routes-both-sides | d1
TOPIC: 3.4 网络连接 · 基础
Q:
Peering 连好了，只有一边加了路由，为什么还是不通？
A:
答：两边的路由表都得加上对方的 IP 段。
因为：Peering 把两个 VPC 一对一直接连起来，但路由要两边自己加，不会自动出现；没有对方的 IP 段，流量就不知道走这条连接。
考法：只有一边加了路由、收不到回复 → ✅ 另一边也加上；❌ 再建一条连接

## awsf-net-07-vgw-vs-tgw | d1
TOPIC: 3.4 网络连接 · 基础
Q:
VGW 和 Transit Gateway 都叫网关，差在哪？
A:
答：VGW 管一个 VPC，Transit Gateway 管很多网络。
因为：虚拟私有网关（VGW）挂在一个 VPC 上，只连这个 VPC 和机房；Transit Gateway 是中转站，很多 VPC 和机房都连到它。
考法：题目里同时出现 virtual private gateway 和 transit gateway → ✅ 先分清：一个只管一个 VPC，一个是中转站；❌ 看到 gateway 就当成一回事

## awsf-net-08-nat-gateway | d1
TOPIC: 3.4 网络连接 · 基础
Q:
NAT 网关做什么？
A:
答：只出不进：让私有子网的机器能出去，外面连不进来。
因为：它一般放在公有子网，替内部机器换上自己的公网地址出去，只放回包进来。
考法：只允许出站、外面不能主动连进来（IPv4，outbound only）→ ✅ NAT gateway；❌ 互联网网关（它是双向的）

## awsf-net-09-on-premises | d1
TOPIC: 3.4 网络连接 · 基础
Q:
题目里的 on-premises / data center 指什么？
A:
答：公司自己的机房，不在 AWS 里。
因为：很多公司一部分系统在机房、一部分在 AWS，两边要互相访问（混合云）。
考法：机房要和 VPC 用内网地址互通 → ✅ 想到 Site-to-Site VPN（加密走公网）或 Direct Connect（专线）；❌ 想到 Peering（它只连 VPC）

## awsf-net-10-site-to-site-vpn | d1
TOPIC: 3.4 网络连接 · 基础
Q:
Site-to-Site VPN 是什么？
A:
答：机房和 AWS 之间的加密隧道（IPsec），一般走公网。
因为：数据先加密再走公网，到对面再解密；一条 VPN 自带两条隧道，AWS 那头坏一条还有另一条。
考法：机房连 VPC + 要尽快开通（quickly）→ ✅ Site-to-Site VPN；❌ 等几周拉专线（Direct Connect）

## awsf-net-11-customer-gateway | d1
TOPIC: 3.4 网络连接 · 基础
Q:
Site-to-Site VPN 在机房那头接的是什么？
A:
答：客户网关（customer gateway）：机房里的 VPN 设备，在 AWS 里也要建一条同名记录代表它。
因为：一条 VPN 的两条隧道都接在这台设备上；它坏了，两条隧道一起断。
考法：题目出现 customer gateway → ✅ 认出是机房那头的设备，一条 VPN 的两条隧道都靠它；❌ 当成 AWS 那头的网关（VGW）

## awsf-net-12-client-vpn | d1
TOPIC: 3.4 网络连接 · 基础
Q:
员工在家要用自己的电脑连进 VPC，用什么 VPN？
A:
答：AWS Client VPN：每个人的电脑各接一条。
因为：Client VPN 连的是一个个用户的设备；Site-to-Site VPN 连的是整个机房网络。
考法：远程员工、个人电脑接入（remote users）→ ✅ Client VPN；❌ Site-to-Site VPN

## awsf-net-13-alb-vs-nlb | d1
TOPIC: 3.4 网络连接 · 基础
Q:
ALB 和 NLB 怎么分？
A:
答：ALB 看网页内容分请求，NLB 只看连接。
因为：ALB 能按路径、域名分 HTTP 请求；NLB 处理 TCP/UDP 连接，还能有固定 IP。
考法：要固定 IP（static IP）→ ✅ NLB；❌ ALB（它的 IP 会变）

## awsf-net-14-multi-account | d1
TOPIC: 3.4 网络连接 · 基础
Q:
为什么公司会有好几个 AWS 账号？
A:
答：用账号把团队和环境隔开。
因为：每个账号的资源和权限默认互不相通，费用也能按账号分开看。
考法：资源分在不同账号（different accounts）→ ✅ 默认不通，要显式共享或授权；❌ 以为同一公司的账号默认互通

## awsf-net-15-regional-vs-global | d1
TOPIC: 3.4 网络连接 · 基础
Q:
区域资源和全局资源差在哪？
A:
答：区域资源只在一个区域；全局资源哪里都能用。
因为：VPC、Transit Gateway 建在某个区域里；IAM 的用户和权限是全局的。
考法：IAM 用户要在多个区域用 → ✅ 建一次，所有区域通用；❌ 每个区域各建一套

## awsf-net-16-scenario-five-options | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
题目出现"VPC 之间""机房""只访问某个服务""IP 段重叠"，在考什么？
A:
答：在考选哪种连接：VPC 之间 3 种，连机房 2 种。
因为：VPC 之间：Peering（两个直连）、Transit Gateway（中转站）、PrivateLink（只开放一个服务）；连机房：Site-to-Site VPN（加密走公网）、Direct Connect（专线）。
考法：认出这类题 → ✅ 先分"VPC 之间"还是"连机房"；❌ 凭名字猜

## awsf-net-17-three-questions | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
分开这五种连接，问哪三个问题？
A:
答：三问：连谁？全网还是一个服务？要便宜、要快，还是要省事、要稳？
因为："连谁"分出 VPC 之间和连机房；"范围"分出 PrivateLink；第三问：VPC 少选 Peering，VPC 多选 Transit Gateway；VPN 开通快、临时或流量小时便宜，Direct Connect 稳，长期大流量反而更省。
考法：每个选项过三问 → ✅ 一问不对就排除；❌ 只看服务名

## awsf-net-18-peering-basics | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
VPC Peering 连的是什么？
A:
答：两个 VPC，一对一。
因为：它是两个 VPC 之间的私有连接，可以跨账号、跨区域；两边都要加对方的路由。
考法：两个 VPC 在不同账号或不同区域 → ✅ Peering 照样能连；❌ 以为 Peering 只能同账号、同区域

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
A 和 B 用 Peering 相连，A 能借 B 的 VPN、专线或 NAT 网关出去吗？
A:
答：不能。Peering 不借道。
因为：Peering 上的流量一头必须在 A、一头必须在 B，去机房或互联网的流量会被丢掉。
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
VPC 越来越多，为什么 Peering 越来越难管？
A:
答：Peering 要两两相连，条数爆炸；Transit Gateway 每个 VPC 只连一次。
因为：n 个 VPC 全互通要 n×(n−1)÷2 条 Peering（6 个就要 15 条），每加一个 VPC 又要连一遍；Transit Gateway 只要 n 个连接（attachment），还能集中管路由。
考法：VPC 很多（many VPCs）→ ✅ Transit Gateway；❌ 两两 Peering

## awsf-net-23-tgw-ram-share | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
不同账号的 VPC 能接同一个 Transit Gateway 吗？
A:
答：能，用 AWS RAM 共享过去。
因为：Transit Gateway 建在一个账号里，用 RAM（Resource Access Manager）共享给其他账号，对方再把自己的 VPC 接上来。
考法：别的账号的 VPC 要接你的 Transit Gateway → ✅ 先用 RAM 共享过去；❌ 以为跨账号接不了

## awsf-net-24-vpc-sharing | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
VPC 共享（shared VPC）是什么？
A:
答：一个账号的 VPC，把子网用 RAM 共享给同一个组织（AWS Organizations）里的其他账号。
因为：VPC 仍归一个账号管；别的账号拿到共享的子网后，能在里面建自己的服务器，大家在同一个网络里。
考法：多个账号要共用同一个 VPC → ✅ 用 RAM 共享子网；❌ 以为一个 VPC 只能给一个账号用

## awsf-net-25-only-tgw-transits | d3
TOPIC: 3.4 网络连接 · VPC 之间
Q:
VPC 之间的流量，谁能帮忙中转？
A:
答：在这几种连接里，只有 Transit Gateway。
因为：Peering 只连两头、不中转；VGW 也不在 VPC 之间转发。
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
PrivateLink 能让两个 VPC 整个互通吗？
A:
答：不能。它只开放指定的服务，而且只能由使用方发起。
因为：使用方 VPC 里多出一个入口（interface endpoint，就是一块带私有 IP 的网卡 ENI），只通那一个服务，两边不加对方的 IP 段。
考法：只让别人访问一个服务（expose a service）→ ✅ PrivateLink；❌ Peering（会开放整个网络）

## awsf-net-29-privatelink-endpoints | d2
TOPIC: 3.4 网络连接 · VPC 之间
Q:
endpoint service 和 interface endpoint 各是什么、归谁？
A:
答：endpoint service 是服务方发布的服务，interface endpoint 是使用方 VPC 里的入口（看名字结尾分归属）。
因为：服务方把服务放在 NLB 后面，发布成 endpoint service；使用方在自己 VPC 里建 interface endpoint 当入口（ALB 不能直接绑 endpoint service）。
考法：NLB + endpoint service + interface endpoint → ✅ 认出是 PrivateLink；❌ 以为用 ALB 直接发布

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
Direct Connect（DX）是什么？
A:
答：从机房拉到 AWS 接入点的专线，不走公网。
因为：不走公网所以稳定；但要找运营商拉线，开通通常要几周。
考法：要稳定的网络性能（consistent network performance）→ ✅ Direct Connect；❌ 走公网的 VPN（不稳定）

## awsf-net-32-vgw | d2
TOPIC: 3.4 网络连接 · 机房连 AWS
Q:
虚拟私有网关（VGW）是什么？
A:
答：一个 VPC 连机房的入口，VPN 和专线都能接。
因为：一个 VPC 只能挂一个 VGW；VPN 和专线都接在它上面。
考法：一个 VPC 连机房、要最简单（simplest）→ ✅ VGW；❌ 为一个 VPC 专门上 Transit Gateway

## awsf-net-33-route-propagation | d2
TOPIC: 3.4 网络连接 · 机房连 AWS
Q:
VPN 或专线接在 VGW 上时，机房网段要一条条手动加进 VPC 路由表吗？
A:
答：不用：开启路由传播（route propagation），会自动加。
因为：VPN 和专线可以用 BGP 把机房的网段告诉 AWS；在 VPC 路由表上为 VGW 开启路由传播，这些网段就会自动写进来。
考法：机房网段经常变、不想手动维护路由 → ✅ BGP 动态路由 + 路由传播；❌ 每次手动加静态路由

## awsf-net-34-vif | d2
TOPIC: 3.4 网络连接 · 机房连 AWS
Q:
Direct Connect 上的 VIF 是什么？
A:
答：一根专线上分出的通道；看名字就知道去哪。
因为：一根独占端口的专线（dedicated）可以开好几条 VIF：private VIF 去 VPC，transit VIF 去 Transit Gateway，public VIF 去 S3 这类公共服务。
考法：一根 dedicated 专线要同时连 VPC 和 Transit Gateway → ✅ 再开一条 VIF；❌ 再拉一根专线

## awsf-net-35-dedicated-vs-hosted | d2
TOPIC: 3.4 网络连接 · 机房连 AWS
Q:
Direct Connect 的 dedicated 和 hosted 连接差在哪？
A:
答：dedicated 独占一个端口；hosted 从合作伙伴那里分到一段带宽。
因为：dedicated 是 1 Gbps 起的整端口，能开很多条 VIF，部分支持 MACsec 加密；hosted 带宽可以更小，一条只能开一个 VIF。
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
private VIF 接什么？
A:
答：接 VGW，或先接 DX 网关再到各 VGW；名字对名字：private 配 virtual private gateway。
因为：直接接 VGW 只能连同区域的一个 VPC；多个 VPC 就接 DX 网关。
考法：专线连一个或几个 VPC → ✅ private VIF；❌ private VIF 直接接 Transit Gateway

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
因为：VPN 走公网，不用拉线，便宜、开通快，但不稳定；两条都通时 AWS 优先走专线，专线断了自动切到 VPN。
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
只拉一条专线，算高可用吗？
A:
答：不算，一个接入点坏了就全断。
因为：AWS 建议拉两条线，接在两个不同的接入点（Direct Connect location）。
考法：要扛住一个接入点故障 → ✅ 在另一个接入点再拉一条；❌ 在同一个接入点再拉一条

## awsf-net-44-impossible-combos | d2
TOPIC: 3.4 网络连接 · 收尾
Q:
这一类题里，哪三类接法根本不存在？
A:
答：三类不存在：VIF 接错、DX 网关站两边、VPC Peering 中转或借道。
因为：private VIF 只接 VGW 或 DX 网关，transit VIF 只经 DX 网关到 Transit Gateway；一个 DX 网关只能一种接法；Peering 只连两头。
考法：选项里出现这三类组合 → ✅ 直接排除；❌ 还去比价格或运维
