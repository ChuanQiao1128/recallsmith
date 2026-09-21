# aws-saa-c03 full deck: assembly report (2026-09-21)

Deliverables (all under `content/decks/`): `aws-saa-c03.md` (the file to paste into the console), `aws-saa-c03.ledger.csv` (every fact/source row merged), this report. Inputs: `aws-saa-c03.base.md` (154 live cards in server order, working tree `main@8a99cc2`), the 21 fragments `aws/*.md` with their `*.ledger.csv`, `docs/aws-saa-c03-card-backlog-2026-09-19.csv` (492 rows: 217 new, 172 partial, 103 exists), `FORMAT.md`. Assembler: scratchpad `assemble/assemble.mjs` (deterministic; re-running it reproduces the file byte for byte). Round-trip/compare: scratchpad `assemble/compare.mjs`, built on the Prep `check-roundtrip.mjs` (bundles the working-tree `frontend/src/lib/deckImport.ts` and runs the console's own `planImport` against the live `deck.json` build `20260916T151907Z-e973860b`).

## 1. Summary

| metric | value |
| --- | --- |
| cards in file | 371 = 154 existing (server order kept) + 217 new |
| layout | existing at positions 0-153; new Q/A at 154..242 (89, P0 then P1 then P2, grouped by task); new MCQ at 243..370 (128, same ordering) - MCQ last as the plan requires |
| lint | `371 cards, 165 mcq, 0 issues` (exit 0) - full file and each of the 21 fragments |
| planImport vs live deck | creates=217, updates=154 (100 content-changed, 54 topic-only), unchanged=0, conflicts=0 |
| partial-row replacements | 93 distinct live uids replaced in place (all 172 partial rows covered); no-op edits: **0** |
| MCQ | 165 total: 128 new + 37 live cards converted in place; choose-two 21, choose-three 0, single 144 |
| TOPIC | every card carries one of the 17 labels used (18-label vocabulary, `D1 services` unused as the backlog has no D1 rows); 0 off-vocabulary |
| banned-word scan | 0 hits in the deck file and 0 in the merged ledger (5 card-text and 5 ledger-note rewrites, listed in section 6) |
| ledger | 911 rows (850 from fragments + 61 assembler rows for live cards kept as-is); 830 in-deck, 81 marked as unused alternate replacement blocks |

## 2. Counts

### 2.1 By status (vs the live deck)

| status | cards |
| --- | --- |
| changed (content) | 100 |
| changed (topic only) | 54 |
| new | 217 |

Changed-field histogram over the 100 content-changed existing cards: realWorldUsage 40, explanation 96, question 90, difficulty 32, mcq 37 (plus `topic` on all 154 and `orderInDeck` on 1, see section 5).

### 2.2 By kind x status

| kind | changed (content) | changed (topic only) | new | total |
| --- | --- | --- | --- | --- |
| concept | 25 | 3 | 25 | 53 |
| pattern | 18 | 22 | 20 | 60 |
| service | 18 | 17 | 44 | 79 |
| mcq | 37 | 0 | 128 | 165 |
| live (no row) | 2 | 12 | 0 | 14 |
| **total** | 100 | 54 | 217 | 371 |

`kind` is the backlog row's kind (`mcq` = any card with options, including the 37 converted live cards); `live (no row)` = live cards no backlog row names (14; TOPIC mapped by service, section 4).

### 2.3 By topic

| TOPIC | existing | new | total | of which MCQ |
| --- | --- | --- | --- | --- |
| 1.1 Secure access | 8 | 21 | 29 | 15 |
| 1.2 Secure workloads | 19 | 24 | 43 | 17 |
| 1.3 Data security controls | 14 | 23 | 37 | 19 |
| 2.1 Loosely coupled architectures | 8 | 26 | 34 | 19 |
| 2.2 HA and fault tolerance | 17 | 22 | 39 | 21 |
| 3.1 High-performing storage | 7 | 2 | 9 | 5 |
| 3.2 Elastic compute | 10 | 3 | 13 | 7 |
| 3.3 High-performing databases | 14 | 1 | 15 | 10 |
| 3.4 Scalable network | 11 | 2 | 13 | 8 |
| 3.5 Data ingestion and transformation | 5 | 8 | 13 | 7 |
| 4.1 Cost-optimized storage | 6 | 20 | 26 | 13 |
| 4.2 Cost-optimized compute | 6 | 14 | 20 | 9 |
| 4.3 Cost-optimized database | 4 | 8 | 12 | 5 |
| 4.4 Cost-optimized network | 4 | 11 | 15 | 7 |
| D2 services | 12 | 16 | 28 | 0 |
| D3 services | 2 | 14 | 16 | 1 |
| D4 services | 7 | 2 | 9 | 2 |

### 2.4 By difficulty

| difficulty | Q/A | MCQ | total |
| --- | --- | --- | --- |
| d0 | 0 | 0 | 0 |
| d1 | 104 | 32 | 136 |
| d2 | 94 | 105 | 199 |
| d3 | 8 | 28 | 36 |
| d4 | 0 | 0 | 0 |

### 2.5 MCQ shape

| measure | value |
| --- | --- |
| choose-N | single 144, choose two 21, choose three 0 |
| options per card | 4 options: 144, 5 options: 11, 6 options: 10 |
| qualifiers | LEAST operational overhead 39; MOST cost-effective 38; LEAST amount of change 23; MOST secure 18; (none) 13; MOST performant 9; HIGHEST availability 7; FASTEST 7; MOST resilient 3; MOST highly available 2; LOWEST latency 1; HIGHEST performance 1; MOST efficient 1; MOST quickly 1; MOST effectively 1; LEAST downtime 1 |
| no QUALIFIER: line | 13 = 11 choose-two cards (a choose-N phrase may not be a QUALIFIER, FORMAT §1.5) + 2 single-answer cards flagged in section 7 |
| cards with USAGE | 371/371; every new card and every MCQ has one |
| cards with CODE | 7 |

New-card explanation length: 0 under 40 words, 0 over 120 words. New cards by priority: P0 64, P1 108, P2 45 (backlog: P0 64, P1 108, P2 45). Duplicate question stems: 0.

## 3. Lint and compare output

```
$ node frontend/scripts/lint-deck.mts content/decks/aws-saa-c03.md
371 cards, 165 mcq, 0 issues
lint exit=0

$ node frontend/scripts/lint-deck.mts content/decks/aws/*.md
B1 5/5 mcq, B2.1 12/12, B2.2 12/12, B2.3 12/12, B2.4 12/9, B2.5 12/0, B3a 23/1, B3b 25/9, B3c 24/15, B3d 24/8, B3e 18/5, B3f 19/0,
B4.1 20/20, B4.2 20/20, B4.3 20/20, B4.4 20/14, B4.5 20/0, B4.6 8/0, B5.1 20/5, B5.2 20/0, B5.3 5/0  (cards/mcq) - 0 issues each

$ node assemble/compare.mjs   (planImport of the file against the live deck.json, topic=null/mcq=null on the server side)
deckSlug=aws-saa-c03 parserIssues=0 parsedCards=371 liveCards=154
existing order preserved (file positions 0..153 == live order): true
live cards missing from file: 0 
planImport: creates=217 updates=154 unchanged=0 conflicts=0
existing: content-changed=100 topic-only=54 unchanged=0; new=217; orderInDeck deltas=1 aws-s3-storage-classes (5 -> 0)
mcq: new=128 converted-existing=37
new card orderInDeck range: 1540..3700 (live max 1530)
```

Per-card status for all 371 cards is in section 9.

## 4. Existing cards: how each got its replacement block and TOPIC

- **93 replaced in place** by a partial-row block (same uid, same file position). 62 uids had exactly one candidate block. **31 uids had blocks from two or more fragments** (the 172 partial rows name only 93 distinct live uids, so several tasks fixed the same card). The assembler picked one per uid by: lowest backlog priority of the partial rows that block serves (P0 < P1 < P2) -> block whose TOPIC equals the card's home task (its own `exists` row) -> MCQ over Q/A -> fragment name. The losing blocks stay in the ledger with `in_deck = no: alternate replacement block not used` (81 rows) so their verified facts are not lost. Decisions:

| uid | chosen (fragment, kind, d, topic, rows) | alternates |
| --- | --- | --- |
| `aws-organizations-scp` | B3a Q/A d2 [1.1 Secure access] aws-organizations-service (P0); aws-multi-account-access-management (P1) | B3e Q/A d2 [1.1 Secure access] aws-organizations-service (P0); aws-multi-account-access-management (P1) |
| `aws-vpc-private-subnet-nat` | B3a Q/A d1 [1.2 Secure workloads] aws-public-private-subnet-segmentation (P0) | B3d Q/A d2 [3.4 Scalable network] aws-network-design-subnets-routing-ip (P0) |
| `aws-vpc-peering-vs-transit-gateway` | B3d MCQ d2 [3.4 Scalable network] aws-hybrid-hub-topology-mcq-24 (P0) | B3a Q/A d2 [1.2 Secure workloads] aws-route-tables-pattern (P0)<br>B3f Q/A d2 [4.4 Cost-optimized network] aws-d4-network-routing-topology-peering-cost (P1); aws-d4-pat-vpc-peering-vs-tgw-pricing (P1) |
| `aws-backup-service` | B3a Q/A d2 [1.3 Data security controls] aws-data-recovery-concept (P1) | B3e Q/A d2 [1.3 Data security controls] aws-data-recovery-concept (P1) |
| `aws-api-gateway-caching-and-throttling` | B3a Q/A d2 [2.1 Loosely coupled architectures] aws-api-management-lifecycle (P1) | B3f Q/A d2 [4.4 Cost-optimized network] aws-d4-pat-throttling-strategy (P1) |
| `aws-global-accelerator-vs-cloudfront` | B3d Q/A d1 [3.4 Scalable network] aws-global-accelerator-service-card (P1) | B3a Q/A d2 [2.1 Loosely coupled architectures] aws-edge-accelerator-offload (P1) |
| `aws-sqs-sns-eventbridge-choice` | B3a Q/A d2 [2.1 Loosely coupled architectures] aws-event-driven-architecture (P0) | B3c Q/A d2 [3.2 Elastic compute] aws-queuing-messaging-concepts-scaling (P1) |
| `aws-alb-vs-nlb` | B3d MCQ d2 [3.4 Scalable network] aws-lb-strategy-microservices-mcq-29 (P1); aws-nlb-scale-static-ip-mcq-26 (P0) | B3e Q/A d2 [3.4 Scalable network] aws-lb-strategy-microservices-mcq-29 (P1); aws-nlb-scale-static-ip-mcq-26 (P0)<br>B3b Q/A d1 [2.1 Loosely coupled architectures] aws-load-balancing-scaling-angle (P1); aws-alb-routing-and-targets (P0) |
| `aws-lambda-limits-timeout-payload` | B3c MCQ d2 [3.2 Elastic compute] aws-compute-option-batch-vs-lambda-mcq-09 (P0) | B3b Q/A d1 [2.1 Loosely coupled architectures] aws-serverless-stack-decision (P0) |
| `aws-ebs-vs-efs-vs-instance-store` | B3b Q/A d1 [2.1 Loosely coupled architectures] aws-storage-type-characteristics (P1) | B3c Q/A d1 [3.1 High-performing storage] aws-storage-types-object-file-block (P1) |
| `aws-s3-durability-availability` | B3b Q/A d1 [2.2 HA and fault tolerance] aws-durability-by-storage-service (P1) | B3e Q/A d2 [2.2 HA and fault tolerance] aws-durability-by-storage-service (P1) |
| `aws-rds-proxy` | B3c MCQ d2 [3.3 High-performing databases] aws-db-connection-storm-mcq-15 (P0) | B3b Q/A d2 [2.2 HA and fault tolerance] aws-rds-proxy-pattern (P1)<br>B3d Q/A d2 [3.3 High-performing databases] aws-db-connections-and-proxies (P1)<br>B3f Q/A d2 [4.3 Cost-optimized database] aws-d4-database-connections-proxies (P1) |
| `aws-eks-vs-ecs` | B3b Q/A d1 [D2 services] aws-eks-service (P1) | B3c Q/A d1 [3.2 Elastic compute] aws-container-orchestration-ecs-eks (P1) |
| `aws-ebs-volume-types` | B3b MCQ d2 [3.1 High-performing storage] aws-ebs-iops-database-mcq-01 (P0) | B3d Q/A d2 [3.3 High-performing databases] aws-provisioned-iops-pattern (P1) |
| `aws-fsx-windows-vs-lustre-vs-ontap` | B3c Q/A d2 [3.1 High-performing storage] aws-storage-services-use-case-matrix (P0) | B3b MCQ d2 [3.1 High-performing storage] aws-hpc-storage-scale-mcq-04 (P1) |
| `aws-s3-performance-prefixes-multipart` | B3b MCQ d3 [3.1 High-performing storage] aws-s3-hot-prefix-scaling-mcq-03 (P1) | B3e Q/A d2 [3.1 High-performing storage] aws-s3-hot-prefix-scaling-mcq-03 (P1) |
| `aws-asg-scaling-policies` | B3c MCQ d2 [3.2 Elastic compute] aws-asg-scaling-metric-choice-mcq-07 (P0) | B3e Q/A d2 [4.2 Cost-optimized compute] aws-d4-scaling-strategies-cost (P1); aws-d4-pat-scheduled-predictive-scaling-cost (P1)<br>B3f Q/A d2 [4.2 Cost-optimized compute] aws-d4-scaling-strategies-cost (P1); aws-d4-pat-scheduled-predictive-scaling-cost (P1) |
| `aws-redshift-vs-athena-vs-emr` | B3e MCQ d2 [D3 services] aws-redshift-service-card (P1, exists/home) | B3d MCQ d2 [3.5 Data ingestion and transformation] aws-data-processing-spark-choice-mcq-37 (P1); aws-data-processing-sql-only-mcq-38 (P1)<br>B3c Q/A d2 [3.2 Elastic compute] aws-emr-service-card (P1) |
| `aws-elasticache-lazy-loading-vs-write-through` | B3c MCQ d2 [3.3 High-performing databases] aws-cache-integration-stale-reads-mcq-21 (P0) | B3d Q/A d2 [3.3 High-performing databases] aws-caching-tier-placement (P1)<br>B3f Q/A d2 [4.3 Cost-optimized database] aws-d4-caching-strategies-cost (P1) |
| `aws-purpose-built-databases-selection` | B3c MCQ d2 [3.3 High-performing databases] aws-db-type-graph-timeseries-mcq-20 (P1) | B3d Q/A d1 [3.3 High-performing databases] aws-database-types-and-services-map (P1)<br>B3e Q/A d1 [3.3 High-performing databases] aws-database-types-and-services-map (P1) |
| `aws-aurora-vs-dynamodb-choice` | B3c MCQ d2 [3.3 High-performing databases] aws-db-type-serverless-keyvalue-mcq-19 (P0) | B3f Q/A d2 [4.3 Cost-optimized database] aws-d4-database-types-relational-vs-nosql-cost (P1); aws-d4-pat-relational-vs-nonrelational-cost (P1) |
| `aws-dynamodb-capacity-and-keys` | B3c MCQ d3 [3.3 High-performing databases] aws-dynamodb-hot-partition-design-mcq-16 (P0) | B3d Q/A d2 [3.3 High-performing databases] aws-database-capacity-planning (P0); aws-dynamodb-capacity-units-pattern (P0)<br>B3f Q/A d2 [4.3 Cost-optimized database] aws-d4-database-capacity-planning-units (P1); aws-d4-pat-dynamodb-capacity-modes-reserved (P1) |
| `aws-dynamodb-dax` | B3c MCQ d2 [3.3 High-performing databases] aws-dynamodb-microsecond-reads-mcq-22 (P0) | B3d Q/A d2 [3.3 High-performing databases] aws-in-memory-database-pattern (P1) |
| `aws-dms-and-sct` | B3c MCQ d2 [3.3 High-performing databases] aws-engine-choice-oracle-migration-mcq-17 (P1) | B3d Q/A d2 [3.3 High-performing databases] aws-db-engines-hetero-vs-homo-migration (P1)<br>B3f Q/A d2 [4.3 Cost-optimized database] aws-d4-database-engines-migration-types (P1) |
| `aws-rds-multi-az-vs-read-replica` | B3d Q/A d1 [3.3 High-performing databases] aws-database-replication-read-replicas (P0) | B3f Q/A d2 [4.3 Cost-optimized database] aws-d4-database-replication-read-replicas-cost (P1); aws-d4-pat-read-replica-vs-scale-up (P1) |
| `aws-multi-az-vs-multi-region` | B3e Q/A d1 [2.2 HA and fault tolerance] aws-global-infrastructure-az-region (P1, exists/home) | B3d Q/A d1 [3.3 High-performing databases] aws-global-infra-az-region-for-databases (P1); aws-availability-zones-pattern (P1) |
| `aws-cloudfront-lambda-edge-vs-functions` | B3d MCQ d3 [3.4 Scalable network] aws-edge-compute-placement-mcq-27 (P1) | B3f Q/A d2 [4.2 Cost-optimized compute] aws-d4-pat-edge-functions-cost (P2) |
| `aws-outposts-local-zones-wavelength` | B3d MCQ d2 [3.4 Scalable network] aws-metro-latency-placement-mcq-28 (P1) | B3e Q/A d2 [D4 services] aws-svc-outposts (P2, exists/home) |
| `aws-site-to-site-vpn-vs-direct-connect` | B3d Q/A d2 [3.4 Scalable network] aws-network-connection-options (P0) | B3f Q/A d2 [4.4 Cost-optimized network] aws-d4-network-connectivity-cost (P1); aws-d4-pat-dx-vs-vpn-vs-internet-pricing (P1) |
| `aws-s3-select-and-athena` | B3d MCQ d2 [3.5 Data ingestion and transformation] aws-csv-to-parquet-cost-mcq-41 (P1) | B3e Q/A d2 [3.5 Data ingestion and transformation] aws-csv-to-parquet-pattern (P1) |
| `aws-datasync-vs-transfer-family` | B3e MCQ d2 [D4 services] aws-svc-transfer-family (P1) | B3f Q/A d2 [D4 services] aws-svc-transfer-family (P1) |

- **61 kept from the base file** with a `TOPIC:` line inserted after the header: 47 whose backlog row is `exists` (TOPIC = that row's task) and 14 that no backlog row names at all (mapped by service; the choice is recorded in each ledger row's `changes` column):

| uid (no backlog row) | TOPIC |
| --- | --- |
| `aws-lambda-vpc-access` | 1.2 Secure workloads |
| `aws-asg-health-checks-elb-vs-ec2` | 2.2 HA and fault tolerance |
| `aws-elb-deregistration-delay` | 2.2 HA and fault tolerance |
| `aws-lambda-retries-and-destinations` | 2.1 Loosely coupled architectures |
| `aws-cloudfront-origin-failover` | 2.2 HA and fault tolerance |
| `aws-ebs-multi-attach-io2` | 3.1 High-performing storage |
| `aws-s3-transfer-acceleration` | 3.1 High-performing storage |
| `aws-cloudfront-signed-urls-vs-cookies` | 1.2 Secure workloads |
| `aws-appsync-graphql` | D2 services |
| `aws-ec2-dedicated-hosts-vs-instances` | 4.2 Cost-optimized compute |
| `aws-dynamodb-standard-ia-table-class` | 4.3 Cost-optimized database |
| `aws-cloudwatch-logs-metric-filters-and-insights` | D2 services |
| `aws-codedeploy-blue-green-lambda-ecs` | D2 services |
| `aws-route53-resolver-hybrid-dns` | 3.4 Scalable network |

- **Backlog section 3 fixes** ("线上卡要修的, 进 B3, 不新增 uid": 27 uids). 21 were covered by a partial-row block. The 6 that no block covered were applied by the assembler exactly as section 3 words them:

| uid | fix applied |
| --- | --- |
| `aws-s3-storage-classes` | usage rewritten to the generic lifecycle line (was self-referential) |
| `aws-s3-cloudfront-oac` | usage rewritten to the SPA 403/404 -> index.html line (was self-referential) |
| `aws-cloudwatch-alarm-vs-eventbridge-rule` | usage rewritten to the EMF/alarm vs EventBridge-rule line (was self-referential, described unfinished internal work) |
| `aws-ec2-purchase-options` | difficulty d2 -> d1; usage added ("Buy the Savings Plan for the floor you have measured over 30 days...") |
| `aws-vpc-endpoints-gateway-vs-interface` | explanation: the "cost-optimal"/"billed hourly" clauses reduced to one "no additional charge" mention; distractor sentence now names both directions (interface endpoint for in-VPC traffic, gateway endpoint for a client outside it) |
| `aws-route53-resolver-hybrid-dns` | stem 301 -> 217 chars: the "why does the .2 address fail" sub-question dropped from the stem (the explanation already carries the point) |

## 5. No-op partial edits

**None.** Every one of the 93 replacement blocks differs from its base card in at least one comparable field (question / difficulty / explanation / code / usage / mcq) before the `TOPIC:` line is even counted: 100 existing cards are content-changed (93 replaced + 6 section-3 fixes + 1 banned-word rewrite on `aws-cloudfront-signed-urls-vs-cookies`); the other 54 change only because `TOPIC:` is new (the server holds `topic = null` for every live card, so all 154 plan as `update`; none is `unchanged`).

`orderInDeck`: the file assigns position x 10. The live deck already sits at 0..1530 in steps of 10 except the first card, `aws-s3-storage-classes`, which the server holds at 5; its update rewrites that to 0 (no other row uses 0, so no `uq_cards_deck_order` collision). New cards take 1540..3700, above the live maximum 1530, so the create-then-update run cannot collide.

## 6. Wording rewrites the assembler applied (banned-word list)

The wave forbids five words in anything it writes. Two base cards and one new card used one of them, and five fragment ledger notes quoted AWS identifiers or phrases containing one. Rewrites (the underlying AWS fact is unchanged; the IAM action for governance-mode override is referred to descriptively):

| file | uid | from | to |
| --- | --- | --- | --- |
| deck | `aws-s3-cloudfront-oac` | nobody can bypass them with a direct S3 URL | nobody can skip them with a direct S3 URL |
| deck | `aws-cloudfront-signed-urls-vs-cookies` | what stops a user bypassing it? | what stops a user getting around it? |
| deck | `aws-cloudfront-signed-urls-vs-cookies` | the direct S3 URL bypasses everything | the direct S3 URL sidesteps everything |
| deck | `aws-object-lock-compliance-vs-governance-mcq-47` | any principal granted s3:BypassGovernanceRetention can shorten the retention | any principal granted the S3 governance-retention override permission can shorten the retention |
| deck | `aws-object-lock-compliance-vs-governance-mcq-47` | Governance mode can be overridden by anyone holding s3:BypassGovernanceRetention, | Governance mode can be overridden by anyone holding the governance-retention override permission, |
| ledger (fact_checked) | `aws-object-lock-compliance-vs-governance-mcq-47` | s3:BypassGovernanceRetention + x-amz-bypass-governance-retention:true header | the S3 governance-retention override permission + the matching x-amz- governance-retention request header |
| ledger (fact_checked) | `aws-ec2-enhanced-networking-efa` | OS-bypass (kernel not involved) | kernel-free networking (the OS network stack is not involved) |
| ledger (changes) | `aws-rds-proxy` | 'bypassing DNS caches' | 'not depending on DNS caches' |
| ledger (fact_checked) | `aws-d4-backup-archival-selection-mcq-07` | s3:BypassGovernanceRetention | the S3 governance-retention override permission |
| ledger (fact_checked) | `aws-d4-network-connection-choice-mcq-29` | private path bypassing internet service providers | private path that avoids internet service providers |

## 7. Review notes for the authors (not changed by the assembler)

These pass the lint and the format, but fall outside the wave's quality bar or deserve a look before the import. None blocks the import.

1. **Two single-answer MCQs have no `QUALIFIER:`** although their backlog rows carry one: `aws-helm-charts-portable-cluster-mcq-13` (row qualifier `least-change`; stem ends "Which AWS service should host the containers?") and `aws-bi-dashboard-choice-mcq-36` (`least-ops`; "Which AWS service should the company use?"). The stems are plain "which service" questions, so adding the marker would require rewording the stem; left for the B2.3 / B3d authors.
2. **Replaced live cards with explanations over 160 words** (bar is 40-120 for new cards; these are edits of live cards): `aws-ebs-vs-efs-vs-instance-store` (166), `aws-route53-health-checks-failover` (182), `aws-dynamodb-global-tables` (165), `aws-s3-cross-region-replication` (180), `aws-s3-durability-availability` (168), `aws-lambda-concurrency-reserved-provisioned` (169), `aws-ecs-fargate-vs-ec2-launch` (173), `aws-eks-vs-ecs` (161), `aws-eventbridge-archive-replay` (175), `aws-rds-multi-az-cluster-vs-instance` (182), `aws-elastic-beanstalk-deployment-policies` (215).
3. **Three ledger rows say "kept from live card, not re-verified this session"** for content the replacement block carried over: `aws-glue-etl-and-catalog`, `aws-purpose-built-databases-selection`, `aws-alb-vs-nlb`. The rest of each card is verified on its listed URL.
4. **37 live Q/A cards become MCQ in place** (backlog partial/mcq rows). They keep their position, so the deck's MCQs are not all at the tail: 128 new MCQs are at the end as required, and 37 sit among the first 154. Learners who already learned those cards will see them again only if Revision is raised by hand (section 8, step 7).
5. **`aws-vpc-peering-vs-transit-gateway`, `aws-rds-proxy`, `aws-asg-scaling-policies`, `aws-dynamodb-capacity-and-keys`** and the other multi-candidate uids in section 4 each had a Q/A alternate that a different task wrote; if the owner prefers the Q/A form for a card, the alternate block is intact in its fragment file and the ledger rows are already merged.
6. **Source hosts**: 18 ledger rows cite the AWS price-list API (`pricing.us-east-1.amazonaws.com/offers/...`, `b0.p.awsstatic.com/pricing/...`) for exact prices and one cites `github.com/aws-samples/service-control-policy-examples` for an SCP; all are AWS-published primary sources.

## 8. Console import steps (exact)

The console is the React app at https://d12pfy1rhi3ekm.cloudfront.net (README). The runner writes serially, creates first then updates, and stops on the first MCQ write if the API echoes the card without its `mcq` blob (`SERVER_NOT_READY_MCQ`), so the API build that stores `mcq` must be deployed before step 5.

1. Confirm the deployed API accepts the `mcq` field (the MCQ plan's server change). If it does not, the run stops at its first MCQ write: creates run first, so that is the first new MCQ (`aws-abac-tag-based-access-mcq-05`, file position 243); the runner reports `SERVER_NOT_READY_MCQ`, lists every later card as not written, and the 154 updates (which include the 37 converted MCQs, the first at position 4, `aws-sqs-visibility-timeout-dlq`) are never attempted.
2. Take a JSON snapshot of the live deck first: Decks list -> `aws-saa-c03` -> Cards -> **Preview JSON** (save the response; it is the rollback reference).
3. Open Decks -> `aws-saa-c03` -> Cards -> **Import Markdown** (route `/decks/cards/import?deckId=<id of aws-saa-c03>`).
4. Load `content/decks/aws-saa-c03.md` with the file picker (accepts `.md`) or paste its whole content into the textarea, then click **Preview import**. Nothing is written yet.
5. Check the badges: **create 217, update 154, unchanged 0, conflict 0, parse errors 0**, and no slug-mismatch banner (file slug `aws-saa-c03` must equal the opened deck). Any other numbers mean the live deck moved since build `20260916T151907Z-e973860b`; stop and re-run the compare.
6. Click **Import 371 cards**. The run is serial; the progress counter should reach 371/371 with **created 217, updated 154, failed 0**. If a card fails, the page offers **Retry N failed** (the failure list is re-runnable as is) and **Re-preview**.
7. Revision: the import never touches `revision`. For the 100 content-changed live cards (section 9, status `changed (content)`), raise Revision by hand in **Edit Card** if learners who already learned them should see them again; the 54 topic-only cards do not need it.
8. Re-run **Preview import** with the same file: it must now show **unchanged 371** (idempotence check). Then Decks list -> **Publish** for `aws-saa-c03`, wait for the publish job to finish, and spot-check one new MCQ and one converted MCQ on the phone.
9. Keep the base snapshot (`aws-saa-c03.base.md`) and the JSON from step 2 until the publish is verified; a rollback is "import the base file" (154 updates, no deletes: the import never deletes, so the 217 new cards would have to be retired in the console).

## 9. Per-card status vs the live deck (file order)

`changed (...)` lists the comparable fields that differ from the live row besides `topic` (every existing card) and `orderInDeck` (only the first card). `new` = uid not on the server.

```
  0  aws-s3-storage-classes                                     Q/A  d1  4.1 Cost-optimized storage             changed (realWorldUsage)
  1  aws-s3-cloudfront-oac                                      Q/A  d2  1.2 Secure workloads                   changed (explanation,realWorldUsage)
  2  aws-iam-roles-vs-users                                     Q/A  d1  1.1 Secure access                      changed (question,explanation,realWorldUsage)
  3  aws-lambda-cold-start-init                                 Q/A  d2  3.2 Elastic compute                    changed (question,explanation,realWorldUsage)
  4  aws-sqs-visibility-timeout-dlq                             MCQ  d2  3.2 Elastic compute                    changed (question,difficulty,explanation,realWorldUsage,mcq)
  5  aws-sqs-sns-eventbridge-choice                             Q/A  d2  2.1 Loosely coupled architectures      changed (question,explanation,realWorldUsage)
  6  aws-rds-multi-az-vs-read-replica                           Q/A  d1  3.3 High-performing databases          changed (question,difficulty,explanation,realWorldUsage)
  7  aws-vpc-private-subnet-nat                                 Q/A  d1  1.2 Secure workloads                   changed (question,difficulty,explanation,realWorldUsage)
  8  aws-vpc-security-group-vs-nacl                             Q/A  d2  1.2 Secure workloads                   changed (question,difficulty,explanation,realWorldUsage)
  9  aws-ec2-purchase-options                                   Q/A  d1  4.2 Cost-optimized compute             changed (difficulty,realWorldUsage)
 10  aws-ebs-vs-efs-vs-instance-store                           Q/A  d1  2.1 Loosely coupled architectures      changed (question,explanation,realWorldUsage)
 11  aws-alb-vs-nlb                                             MCQ  d2  3.4 Scalable network                   changed (question,difficulty,explanation,realWorldUsage,mcq)
 12  aws-dynamodb-capacity-and-keys                             MCQ  d3  3.3 High-performing databases          changed (question,difficulty,explanation,realWorldUsage,mcq)
 13  aws-kms-envelope-encryption                                Q/A  d2  1.3 Data security controls             changed (question,difficulty,explanation,realWorldUsage)
 14  aws-cloudwatch-alarm-vs-eventbridge-rule                   Q/A  d2  D2 services                            changed (realWorldUsage)
 15  aws-iam-policy-evaluation-explicit-deny                    Q/A  d2  1.1 Secure access                      changed (question,explanation)
 16  aws-iam-permissions-boundary                               Q/A  d3  1.1 Secure access                      changed (topic only)
 17  aws-sts-assume-role-cross-account                          Q/A  d2  1.1 Secure access                      changed (question,explanation)
 18  aws-organizations-scp                                      Q/A  d2  1.1 Secure access                      changed (question,explanation)
 19  aws-iam-identity-center                                    Q/A  d2  1.1 Secure access                      changed (question,difficulty,explanation)
 20  aws-s3-bucket-policy-vs-iam-policy                         Q/A  d2  1.1 Secure access                      changed (topic only)
 21  aws-s3-block-public-access                                 Q/A  d1  1.3 Data security controls             changed (topic only)
 22  aws-s3-object-lock-worm                                    Q/A  d2  1.3 Data security controls             changed (question,explanation)
 23  aws-s3-encryption-options-sse                              Q/A  d2  1.3 Data security controls             changed (topic only)
 24  aws-s3-presigned-urls                                      Q/A  d1  1.2 Secure workloads                   changed (topic only)
 25  aws-kms-key-rotation-and-multi-region                      Q/A  d2  1.3 Data security controls             changed (question,explanation)
 26  aws-acm-certificates-and-cloudfront-region                 Q/A  d2  1.3 Data security controls             changed (topic only)
 27  aws-cognito-user-pool-vs-identity-pool                     Q/A  d2  1.2 Secure workloads                   changed (topic only)
 28  aws-guardduty-inspector-macie-detective                    Q/A  d1  1.2 Secure workloads                   changed (difficulty,explanation)
 29  aws-vpc-endpoints-gateway-vs-interface                     Q/A  d2  1.2 Secure workloads                   changed (explanation)
 30  aws-vpc-peering-vs-transit-gateway                         MCQ  d2  3.4 Scalable network                   changed (question,explanation,mcq)
 31  aws-vpc-flow-logs                                          Q/A  d1  1.2 Secure workloads                   changed (topic only)
 32  aws-ssm-session-manager-vs-bastion                         Q/A  d2  1.2 Secure workloads                   changed (topic only)
 33  aws-site-to-site-vpn-vs-direct-connect                     Q/A  d2  3.4 Scalable network                   changed (question,explanation)
 34  aws-direct-connect-encryption                              Q/A  d2  1.2 Secure workloads                   changed (difficulty,explanation,realWorldUsage)
 35  aws-cloudhsm-vs-kms                                        Q/A  d2  1.3 Data security controls             changed (topic only)
 36  aws-ec2-imdsv2                                             Q/A  d3  1.2 Secure workloads                   changed (topic only)
 37  aws-rds-encryption-and-iam-auth                            Q/A  d2  1.3 Data security controls             changed (topic only)
 38  aws-ebs-encryption-default                                 Q/A  d2  1.3 Data security controls             changed (topic only)
 39  aws-security-group-referencing                             Q/A  d1  3.4 Scalable network                   changed (question,difficulty,explanation)
 40  aws-alb-authentication-cognito-oidc                        Q/A  d2  1.2 Secure workloads                   changed (question,explanation)
 41  aws-api-gateway-auth-options                               Q/A  d2  1.2 Secure workloads                   changed (topic only)
 42  aws-lambda-vpc-access                                      Q/A  d2  1.2 Secure workloads                   changed (topic only)
 43  aws-privatelink-expose-service                             Q/A  d2  1.2 Secure workloads                   changed (topic only)
 44  aws-iam-access-analyzer-credential-report                  Q/A  d2  1.3 Data security controls             changed (question,difficulty,explanation,realWorldUsage)
 45  aws-route53-routing-policies                               MCQ  d3  3.4 Scalable network                   changed (question,difficulty,explanation,mcq)
 46  aws-route53-health-checks-failover                         Q/A  d2  2.2 HA and fault tolerance             changed (question,explanation)
 47  aws-route53-alias-vs-cname                                 Q/A  d1  4.4 Cost-optimized network             changed (question,explanation)
 48  aws-asg-scaling-policies                                   MCQ  d2  3.2 Elastic compute                    changed (question,explanation,realWorldUsage,mcq)
 49  aws-asg-lifecycle-hooks-and-warm-pools                     Q/A  d3  3.2 Elastic compute                    changed (question,explanation)
 50  aws-asg-health-checks-elb-vs-ec2                           Q/A  d2  2.2 HA and fault tolerance             changed (topic only)
 51  aws-elb-cross-zone-and-sticky-sessions                     MCQ  d2  3.4 Scalable network                   changed (question,explanation,realWorldUsage,mcq)
 52  aws-elb-deregistration-delay                               Q/A  d1  2.2 HA and fault tolerance             changed (topic only)
 53  aws-aurora-vs-rds                                          MCQ  d2  3.3 High-performing databases          changed (question,explanation,mcq)
 54  aws-aurora-global-database                                 MCQ  d2  2.2 HA and fault tolerance             changed (question,explanation,mcq)
 55  aws-rds-backups-snapshots-pitr                             Q/A  d2  4.3 Cost-optimized database            changed (question,explanation,realWorldUsage)
 56  aws-rds-cross-region-read-replica-dr                       MCQ  d2  3.3 High-performing databases          changed (question,explanation,mcq)
 57  aws-dynamodb-global-tables                                 Q/A  d3  2.2 HA and fault tolerance             changed (question,difficulty,explanation)
 58  aws-dynamodb-streams-and-ttl                               Q/A  d2  4.3 Cost-optimized database            changed (question,explanation,realWorldUsage)
 59  aws-s3-cross-region-replication                            Q/A  d2  2.2 HA and fault tolerance             changed (question,explanation)
 60  aws-s3-versioning-and-mfa-delete                           Q/A  d1  1.3 Data security controls             changed (topic only)
 61  aws-s3-durability-availability                             Q/A  d1  2.2 HA and fault tolerance             changed (question,explanation)
 62  aws-sqs-fifo-vs-standard                                   Q/A  d2  D2 services                            changed (topic only)
 63  aws-sqs-long-polling                                       Q/A  d1  2.1 Loosely coupled architectures      changed (topic only)
 64  aws-sqs-message-retention-and-size                         Q/A  d1  2.1 Loosely coupled architectures      changed (topic only)
 65  aws-sns-fanout-filtering                                   MCQ  d2  3.2 Elastic compute                    changed (question,explanation,mcq)
 66  aws-lambda-retries-and-destinations                        Q/A  d3  2.1 Loosely coupled architectures      changed (topic only)
 67  aws-lambda-concurrency-reserved-provisioned                Q/A  d2  2.2 HA and fault tolerance             changed (question,explanation)
 68  aws-dr-strategies-rpo-rto                                  Q/A  d2  2.2 HA and fault tolerance             changed (topic only)
 69  aws-backup-service                                         Q/A  d2  1.3 Data security controls             changed (question,difficulty,explanation)
 70  aws-multi-az-vs-multi-region                               Q/A  d1  2.2 HA and fault tolerance             changed (question,explanation)
 71  aws-cloudfront-origin-failover                             Q/A  d2  2.2 HA and fault tolerance             changed (topic only)
 72  aws-ecs-fargate-vs-ec2-launch                              Q/A  d2  D2 services                            changed (question,explanation)
 73  aws-eks-vs-ecs                                             Q/A  d1  D2 services                            changed (question,explanation)
 74  aws-elastic-ip-and-eni-failover                            MCQ  d2  2.2 HA and fault tolerance             changed (question,explanation,mcq)
 75  aws-eventbridge-archive-replay                             Q/A  d2  D2 services                            changed (question,explanation)
 76  aws-rds-multi-az-cluster-vs-instance                       Q/A  d3  D2 services                            changed (question,explanation)
 77  aws-elasticache-redis-cluster-mode-and-multi-az            MCQ  d2  2.2 HA and fault tolerance             changed (question,explanation,mcq)
 78  aws-ebs-snapshot-cross-region-copy-and-dlm                 Q/A  d2  4.1 Cost-optimized storage             changed (topic only)
 79  aws-ec2-auto-recovery-and-status-checks                    MCQ  d2  2.2 HA and fault tolerance             changed (question,difficulty,explanation,mcq)
 80  aws-aurora-backtrack-and-cloning                           MCQ  d1  2.2 HA and fault tolerance             changed (question,difficulty,explanation,realWorldUsage,mcq)
 81  aws-ebs-volume-types                                       MCQ  d2  3.1 High-performing storage            changed (question,explanation,mcq)
 82  aws-ebs-multi-attach-io2                                   Q/A  d3  3.1 High-performing storage            changed (topic only)
 83  aws-efs-performance-and-throughput-modes                   MCQ  d2  3.1 High-performing storage            changed (question,explanation,mcq)
 84  aws-fsx-windows-vs-lustre-vs-ontap                         Q/A  d2  3.1 High-performing storage            changed (question,explanation)
 85  aws-s3-performance-prefixes-multipart                      MCQ  d3  3.1 High-performing storage            changed (question,difficulty,explanation,mcq)
 86  aws-s3-transfer-acceleration                               Q/A  d1  3.1 High-performing storage            changed (topic only)
 87  aws-s3-select-and-athena                                   MCQ  d2  3.5 Data ingestion and transformation  changed (question,explanation,realWorldUsage,mcq)
 88  aws-cloudfront-caching-ttl-and-invalidation                Q/A  d1  3.4 Scalable network                   changed (question,difficulty,explanation)
 89  aws-cloudfront-signed-urls-vs-cookies                      Q/A  d2  1.2 Secure workloads                   changed (question,explanation)
 90  aws-cloudfront-lambda-edge-vs-functions                    MCQ  d3  3.4 Scalable network                   changed (question,explanation,mcq)
 91  aws-global-accelerator-vs-cloudfront                       Q/A  d1  3.4 Scalable network                   changed (difficulty,explanation)
 92  aws-elasticache-redis-vs-memcached                         Q/A  d2  3.3 High-performing databases          changed (topic only)
 93  aws-elasticache-lazy-loading-vs-write-through              MCQ  d2  3.3 High-performing databases          changed (question,explanation,mcq)
 94  aws-dynamodb-dax                                           MCQ  d2  3.3 High-performing databases          changed (question,explanation,realWorldUsage,mcq)
 95  aws-dynamodb-gsi-vs-lsi                                    Q/A  d2  3.3 High-performing databases          changed (question,difficulty,explanation)
 96  aws-rds-proxy                                              MCQ  d2  3.3 High-performing databases          changed (question,explanation,mcq)
 97  aws-aurora-reader-endpoint-and-autoscaling                 MCQ  d2  3.3 High-performing databases          changed (question,explanation,mcq)
 98  aws-ec2-instance-families                                  Q/A  d2  3.2 Elastic compute                    changed (question,difficulty,explanation,realWorldUsage)
 99  aws-ec2-placement-groups                                   Q/A  d2  3.2 Elastic compute                    changed (question,explanation)
100  aws-kinesis-data-streams-vs-firehose                       MCQ  d3  3.5 Data ingestion and transformation  changed (question,difficulty,explanation,realWorldUsage,mcq)
101  aws-kinesis-shards-and-partition-keys                      MCQ  d3  3.5 Data ingestion and transformation  changed (question,explanation,realWorldUsage,mcq)
102  aws-api-gateway-caching-and-throttling                     Q/A  d2  2.1 Loosely coupled architectures      changed (question,explanation,realWorldUsage)
103  aws-api-gateway-rest-vs-http-vs-websocket                  Q/A  d2  D2 services                            changed (topic only)
104  aws-lambda-performance-memory-and-layers                   MCQ  d2  3.2 Elastic compute                    changed (question,explanation,mcq)
105  aws-lambda-event-source-mappings-sqs-batching              MCQ  d2  2.1 Loosely coupled architectures      changed (question,explanation,mcq)
106  aws-step-functions-standard-vs-express                     Q/A  d2  2.1 Loosely coupled architectures      changed (explanation)
107  aws-opensearch-use-cases                                   Q/A  d1  D3 services                            changed (topic only)
108  aws-redshift-vs-athena-vs-emr                              MCQ  d2  D3 services                            changed (question,explanation,realWorldUsage,mcq)
109  aws-glue-etl-and-catalog                                   Q/A  d1  3.5 Data ingestion and transformation  changed (question,explanation,realWorldUsage)
110  aws-aurora-vs-dynamodb-choice                              MCQ  d2  3.3 High-performing databases          changed (question,explanation,mcq)
111  aws-lambda-limits-timeout-payload                          MCQ  d2  3.2 Elastic compute                    changed (question,difficulty,explanation,mcq)
112  aws-appsync-graphql                                        Q/A  d1  D2 services                            changed (topic only)
113  aws-s3-glacier-retrieval-tiers                             Q/A  d2  D4 services                            changed (topic only)
114  aws-s3-requester-pays-and-data-transfer                    Q/A  d2  4.1 Cost-optimized storage             changed (question,difficulty,explanation,realWorldUsage)
115  aws-savings-plans-vs-reserved-instances                    Q/A  d2  4.2 Cost-optimized compute             changed (explanation,realWorldUsage)
116  aws-spot-fleet-and-interruption-handling                   Q/A  d2  4.2 Cost-optimized compute             changed (topic only)
117  aws-ec2-dedicated-hosts-vs-instances                       Q/A  d2  4.2 Cost-optimized compute             changed (topic only)
118  aws-nat-gateway-cost-vs-vpc-endpoint                       Q/A  d2  4.4 Cost-optimized network             changed (question,explanation,realWorldUsage)
119  aws-data-transfer-costs-az-region                          Q/A  d2  4.4 Cost-optimized network             changed (topic only)
120  aws-cloudfront-cost-reduction                              Q/A  d1  4.4 Cost-optimized network             changed (topic only)
121  aws-aurora-serverless-v2                                   Q/A  d1  3.3 High-performing databases          changed (question,difficulty,explanation)
122  aws-dynamodb-standard-ia-table-class                       Q/A  d1  4.3 Cost-optimized database            changed (topic only)
123  aws-lambda-pricing-and-graviton                            Q/A  d1  4.2 Cost-optimized compute             changed (question,explanation,realWorldUsage)
124  aws-fargate-spot-and-compute-savings-plans                 Q/A  d2  4.2 Cost-optimized compute             changed (topic only)
125  aws-cost-explorer-budgets-cur                              Q/A  d1  D4 services                            changed (question,explanation,realWorldUsage)
126  aws-trusted-advisor                                        Q/A  d1  D4 services                            changed (topic only)
127  aws-compute-optimizer-and-rightsizing                      Q/A  d1  D4 services                            changed (topic only)
128  aws-ebs-gp3-vs-gp2-and-snapshot-archive                    Q/A  d2  4.1 Cost-optimized storage             changed (topic only)
129  aws-efs-ia-and-lifecycle                                   Q/A  d1  4.1 Cost-optimized storage             changed (topic only)
130  aws-rds-reserved-and-stop-start                            Q/A  d1  4.3 Cost-optimized database            changed (topic only)
131  aws-cloudwatch-logs-metric-filters-and-insights            Q/A  d2  D2 services                            changed (topic only)
132  aws-cloudwatch-agent-custom-metrics                        Q/A  d1  2.2 HA and fault tolerance             changed (question,explanation)
133  aws-cloudtrail-vs-config-vs-cloudwatch                     Q/A  d1  1.3 Data security controls             changed (question,difficulty,explanation)
134  aws-systems-manager-run-command-patch-and-parameters       Q/A  d2  1.2 Secure workloads                   changed (topic only)
135  aws-snow-family-selection                                  MCQ  d3  D4 services                            changed (question,difficulty,explanation,realWorldUsage,mcq)
136  aws-storage-gateway-modes                                  Q/A  d2  3.1 High-performing storage            changed (question,explanation,realWorldUsage)
137  aws-dms-and-sct                                            MCQ  d2  3.3 High-performing databases          changed (question,explanation,realWorldUsage,mcq)
138  aws-application-migration-service-mgn                      Q/A  d1  D4 services                            changed (topic only)
139  aws-migration-strategies-7rs                               Q/A  d1  3.5 Data ingestion and transformation  changed (topic only)
140  aws-cloudformation-vs-cdk-vs-elastic-beanstalk             Q/A  d1  D2 services                            changed (topic only)
141  aws-elastic-beanstalk-deployment-policies                  Q/A  d2  2.2 HA and fault tolerance             changed (question,explanation)
142  aws-codedeploy-blue-green-lambda-ecs                       Q/A  d2  D2 services                            changed (topic only)
143  aws-config-rules-remediation                               Q/A  d2  1.3 Data security controls             changed (topic only)
144  aws-resource-access-manager                                Q/A  d1  1.1 Secure access                      changed (topic only)
145  aws-well-architected-pillars                               Q/A  d1  D2 services                            changed (topic only)
146  aws-outposts-local-zones-wavelength                        MCQ  d2  3.4 Scalable network                   changed (question,explanation,realWorldUsage,mcq)
147  aws-secrets-manager-vs-parameter-store                     Q/A  d2  1.2 Secure workloads                   changed (question,explanation)
148  aws-waf-vs-shield                                          Q/A  d1  1.2 Secure workloads                   changed (question,difficulty,explanation)
149  aws-ec2-enhanced-networking-efa                            MCQ  d3  3.2 Elastic compute                    changed (question,difficulty,explanation,mcq)
150  aws-datasync-vs-transfer-family                            MCQ  d2  D4 services                            changed (question,explanation,realWorldUsage,mcq)
151  aws-purpose-built-databases-selection                      MCQ  d2  3.3 High-performing databases          changed (question,difficulty,explanation,mcq)
152  aws-route53-resolver-hybrid-dns                            Q/A  d2  3.4 Scalable network                   changed (question)
153  aws-s3-lifecycle-rules-minimums                            Q/A  d2  4.1 Cost-optimized storage             changed (topic only)
154  aws-least-privilege-pattern                                Q/A  d1  1.1 Secure access                      new
155  aws-mfa-pattern                                            Q/A  d2  1.1 Secure access                      new
156  aws-vpc-service                                            Q/A  d1  1.2 Secure workloads                   new
157  aws-network-traffic-control-concept                        Q/A  d2  1.2 Secure workloads                   new
158  aws-kms-key-policy-grants                                  Q/A  d2  1.3 Data security controls             new
159  aws-tls-in-transit-pattern                                 Q/A  d2  1.3 Data security controls             new
160  aws-stateless-vs-stateful-workloads                        Q/A  d1  2.1 Loosely coupled architectures      new
161  aws-dr-pilot-light                                         Q/A  d2  2.2 HA and fault tolerance             new
162  aws-dr-warm-standby                                        Q/A  d2  2.2 HA and fault tolerance             new
163  aws-d4-storage-services-use-cases                          Q/A  d2  4.1 Cost-optimized storage             new
164  aws-d4-pat-s3-intelligent-tiering                          Q/A  d1  4.1 Cost-optimized storage             new
165  aws-d4-compute-utilization-optimization                    Q/A  d2  4.2 Cost-optimized compute             new
166  aws-d4-pat-nat-single-vs-per-az                            Q/A  d2  4.4 Cost-optimized network             new
167  aws-svc-ec2-when-and-when-not                              Q/A  d1  D4 services                            new
168  aws-svc-s3-when-and-when-not                               Q/A  d1  D4 services                            new
169  aws-control-tower-service                                  Q/A  d1  1.1 Secure access                      new
170  aws-directory-service                                      Q/A  d2  1.1 Secure access                      new
171  aws-global-infrastructure-security-concept                 Q/A  d1  1.1 Secure access                      new
172  aws-shared-responsibility-model                            Q/A  d1  1.1 Secure access                      new
173  aws-ddos-mitigation-pattern                                Q/A  d2  1.2 Secure workloads                   new
174  aws-sqli-owasp-waf-pattern                                 Q/A  d1  1.2 Secure workloads                   new
175  aws-containerize-migration-path                            Q/A  d2  2.1 Loosely coupled architectures      new
176  aws-horizontal-vs-vertical-scaling                         Q/A  d1  2.1 Loosely coupled architectures      new
177  aws-managed-vs-self-hosted-rule                            Q/A  d2  2.1 Loosely coupled architectures      new
178  aws-microservice-design-principles                         Q/A  d2  2.1 Loosely coupled architectures      new
179  aws-multi-tier-architecture                                Q/A  d1  2.1 Loosely coupled architectures      new
180  aws-cdn-edge-caching-pattern                               Q/A  d1  2.1 Loosely coupled architectures      new
181  aws-rest-api-on-api-gateway                                Q/A  d2  2.1 Loosely coupled architectures      new
182  aws-distributed-design-patterns                            Q/A  d2  2.2 HA and fault tolerance             new
183  aws-route-tables-ha-angle                                  Q/A  d2  2.2 HA and fault tolerance             new
184  aws-dr-backup-and-restore                                  Q/A  d1  2.2 HA and fault tolerance             new
185  aws-batch-service-card                                     Q/A  d1  3.2 Elastic compute                    new
186  aws-db-instance-types-pattern                              Q/A  d1  3.3 High-performing databases          new
187  aws-lake-formation-service-card                            Q/A  d1  3.5 Data ingestion and transformation  new
188  aws-quick-service-card                                     Q/A  d1  3.5 Data ingestion and transformation  new
189  aws-data-ingestion-patterns-frequency                      Q/A  d1  3.5 Data ingestion and transformation  new
190  aws-secure-ingestion-access-points                         Q/A  d2  3.5 Data ingestion and transformation  new
191  aws-d4-cost-features-storage-tags-billing                  Q/A  d1  4.1 Cost-optimized storage             new
192  aws-d4-hybrid-storage-options                              Q/A  d2  4.1 Cost-optimized storage             new
193  aws-d4-storage-types-object-file-block                     Q/A  d1  4.1 Cost-optimized storage             new
194  aws-d4-pat-cost-allocation-tags                            Q/A  d1  4.1 Cost-optimized storage             new
195  aws-d4-pat-storage-auto-scaling                            Q/A  d1  4.1 Cost-optimized storage             new
196  aws-d4-cost-features-compute-tags-sharing                  Q/A  d2  4.2 Cost-optimized compute             new
197  aws-d4-cost-tools-compute-angle                            Q/A  d2  4.2 Cost-optimized compute             new
198  aws-d4-pat-ec2-hibernation                                 Q/A  d2  4.2 Cost-optimized compute             new
199  aws-d4-pat-aurora-io-optimized-and-licensing               Q/A  d2  4.3 Cost-optimized database            new
200  aws-d4-pat-vpn-bandwidth-ecmp-dx-speed                     Q/A  d3  4.4 Cost-optimized network             new
201  aws-amazon-mq-service                                      Q/A  d1  D2 services                            new
202  aws-x-ray-service                                          Q/A  d1  D2 services                            new
203  aws-client-vpn-service                                     Q/A  d1  1.2 Secure workloads                   new
204  aws-firewall-manager-service                               Q/A  d2  1.2 Secure workloads                   new
205  aws-network-firewall-service                               Q/A  d2  1.2 Secure workloads                   new
206  aws-artifact-service                                       Q/A  d1  1.3 Data security controls             new
207  aws-security-hub-service                                   Q/A  d1  1.3 Data security controls             new
208  aws-managed-ai-services-map                                Q/A  d1  2.2 HA and fault tolerance             new
209  aws-auto-scaling-service-card                              Q/A  d1  3.2 Elastic compute                    new
210  aws-d4-distributed-compute-edge                            Q/A  d2  4.2 Cost-optimized compute             new
211  aws-d4-cost-features-database-tags                         Q/A  d1  4.3 Cost-optimized database            new
212  aws-d4-cost-tools-database-angle                           Q/A  d1  4.3 Cost-optimized database            new
213  aws-d4-cost-features-network-tags                          Q/A  d1  4.4 Cost-optimized network             new
214  aws-d4-cost-tools-network-angle                            Q/A  d1  4.4 Cost-optimized network             new
215  aws-appflow-service                                        Q/A  d1  D2 services                            new
216  aws-cli-service                                            Q/A  d1  D2 services                            new
217  aws-comprehend-service                                     Q/A  d1  D2 services                            new
218  aws-ecr-service                                            Q/A  d1  D2 services                            new
219  aws-ecs-anywhere-service                                   Q/A  d1  D2 services                            new
220  aws-eks-anywhere-service                                   Q/A  d1  D2 services                            new
221  aws-eks-distro-service                                     Q/A  d1  D2 services                            new
222  aws-health-dashboard-service                               Q/A  d1  D2 services                            new
223  aws-license-manager-service                                Q/A  d1  D2 services                            new
224  aws-managed-grafana-service                                Q/A  d1  D2 services                            new
225  aws-managed-prometheus-service                             Q/A  d1  D2 services                            new
226  aws-management-console-service                             Q/A  d1  D2 services                            new
227  aws-polly-service                                          Q/A  d1  D2 services                            new
228  aws-service-catalog-service                                Q/A  d1  D2 services                            new
229  aws-amplify-service-card                                   Q/A  d1  D3 services                            new
230  aws-data-exchange-service-card                             Q/A  d1  D3 services                            new
231  aws-device-farm-service-card                               Q/A  d1  D3 services                            new
232  aws-elastic-transcoder-service-card                        Q/A  d1  D3 services                            new
233  aws-kinesis-video-streams-service-card                     Q/A  d1  D3 services                            new
234  aws-lex-service-card                                       Q/A  d1  D3 services                            new
235  aws-msk-service-card                                       Q/A  d1  D3 services                            new
236  aws-rekognition-service-card                               Q/A  d1  D3 services                            new
237  aws-sagemaker-service-card                                 Q/A  d1  D3 services                            new
238  aws-serverless-app-repository-service-card                 Q/A  d1  D3 services                            new
239  aws-textract-service-card                                  Q/A  d1  D3 services                            new
240  aws-transcribe-service-card                                Q/A  d1  D3 services                            new
241  aws-translate-service-card                                 Q/A  d1  D3 services                            new
242  aws-vmware-cloud-on-aws-service-card                       Q/A  d1  D3 services                            new
243  aws-abac-tag-based-access-mcq-05                           MCQ  d2  1.1 Secure access                      new
244  aws-cross-account-s3-two-policies-mcq-13                   MCQ  d2  1.1 Secure access                      new
245  aws-iam-groups-shared-permissions-mcq-04                   MCQ  d1  1.1 Secure access                      new
246  aws-iam-mfa-for-destructive-api-mcq-02                     MCQ  d2  1.1 Secure access                      new
247  aws-root-user-hardening-mcq-01                             MCQ  d1  1.1 Secure access                      new
248  aws-scp-restrict-regions-mcq-10                            MCQ  d2  1.1 Secure access                      new
249  aws-third-party-cross-account-role-mcq-07                  MCQ  d2  1.1 Secure access                      new
250  aws-block-single-ip-nacl-mcq-18                            MCQ  d1  1.2 Secure workloads                   new
251  aws-db-password-rotation-no-code-mcq-28                    MCQ  d1  1.2 Secure workloads                   new
252  aws-nat-gateway-per-az-mcq-20                              MCQ  d2  1.2 Secure workloads                   new
253  aws-private-egress-to-s3-dynamodb-mcq-22                   MCQ  d2  1.2 Secure workloads                   new
254  aws-rds-publicly-accessible-fix-mcq-23                     MCQ  d1  1.2 Secure workloads                   new
255  aws-three-tier-security-group-chain-mcq-19                 MCQ  d2  1.2 Secure workloads                   new
256  aws-waf-rate-based-http-flood-mcq-26                       MCQ  d2  1.2 Secure workloads                   new
257  aws-acm-cert-region-for-cloudfront-mcq-39                  MCQ  d1  1.3 Data security controls             new
258  aws-kms-cross-account-decrypt-mcq-42                       MCQ  d2  1.3 Data security controls             new
259  aws-object-lock-compliance-vs-governance-mcq-47            MCQ  d2  1.3 Data security controls             new
260  aws-rds-encrypt-existing-instance-mcq-37                   MCQ  d2  1.3 Data security controls             new
261  aws-s3-deny-non-tls-mcq-41                                 MCQ  d2  1.3 Data security controls             new
262  aws-s3-sse-kms-audit-revoke-mcq-36                         MCQ  d2  1.3 Data security controls             new
263  aws-45-minute-job-not-lambda-mcq-15                        MCQ  d2  2.1 Loosely coupled architectures      new
264  aws-asg-predictable-daily-spike-mcq-05                     MCQ  d2  2.1 Loosely coupled architectures      new
265  aws-helm-charts-portable-cluster-mcq-13                    MCQ  d1  2.1 Loosely coupled architectures      new
266  aws-order-queue-between-tiers-mcq-01                       MCQ  d2  2.1 Loosely coupled architectures      new
267  aws-rds-reporting-read-replica-mcq-07                      MCQ  d2  2.1 Loosely coupled architectures      new
268  aws-s3-upload-fanout-processing-mcq-02                     MCQ  d2  2.1 Loosely coupled architectures      new
269  aws-scale-to-zero-low-traffic-api-mcq-16                   MCQ  d1  2.1 Loosely coupled architectures      new
270  aws-single-az-three-tier-to-ha-mcq-04                      MCQ  d3  2.1 Loosely coupled architectures      new
271  aws-spiky-container-api-no-hosts-mcq-12                    MCQ  d1  2.1 Loosely coupled architectures      new
272  aws-sqs-fifo-per-product-order-mcq-08                      MCQ  d2  2.1 Loosely coupled architectures      new
273  aws-central-backups-cross-region-mcq-34                    MCQ  d1  2.2 HA and fault tolerance             new
274  aws-dr-rto-1h-rpo-minutes-mcq-37                           MCQ  d2  2.2 HA and fault tolerance             new
275  aws-dr-rto-minutes-rpo-seconds-mcq-38                      MCQ  d2  2.2 HA and fault tolerance             new
276  aws-route53-failover-to-static-page-mcq-27                 MCQ  d2  2.2 HA and fault tolerance             new
277  aws-s3-survive-delete-and-region-loss-mcq-35               MCQ  d3  2.2 HA and fault tolerance             new
278  aws-single-az-asg-make-regional-ha-mcq-26                  MCQ  d1  2.2 HA and fault tolerance             new
279  aws-single-nat-gateway-spof-mcq-31                         MCQ  d2  2.2 HA and fault tolerance             new
280  aws-single-rds-instance-az-failure-mcq-32                  MCQ  d1  2.2 HA and fault tolerance             new
281  aws-two-region-active-writes-mcq-25                        MCQ  d2  2.2 HA and fault tolerance             new
282  aws-shared-posix-across-azs-mcq-18                         MCQ  d1  3.1 High-performing storage            new
283  aws-tcp-static-ip-load-balancer-mcq-19                     MCQ  d1  3.4 Scalable network                   new
284  aws-d4-s3-lifecycle-management-mcq-05                      MCQ  d2  4.1 Cost-optimized storage             new
285  aws-d4-storage-service-cheapest-mcq-01                     MCQ  d2  4.1 Cost-optimized storage             new
286  aws-d4-storage-tier-selection-mcq-03                       MCQ  d2  4.1 Cost-optimized storage             new
287  aws-d4-compute-mixed-workload-choose-two-mcq-14            MCQ  d3  4.2 Cost-optimized compute             new
288  aws-d4-compute-service-choice-mcq-13                       MCQ  d2  4.2 Cost-optimized compute             new
289  aws-d4-dynamodb-vs-rds-cost-mcq-24                         MCQ  d2  4.3 Cost-optimized database            new
290  aws-d4-nat-single-vs-per-az-mcq-28                         MCQ  d2  4.4 Cost-optimized network             new
291  aws-d4-transfer-cost-routes-mcq-30                         MCQ  d2  4.4 Cost-optimized network             new
292  aws-control-tower-new-landing-zone-mcq-11                  MCQ  d1  1.1 Secure access                      new
293  aws-identity-account-hub-roles-mcq-09                      MCQ  d2  1.1 Secure access                      new
294  aws-identity-center-with-ad-connector-mcq-16               MCQ  d2  1.1 Secure access                      new
295  aws-managed-vs-inline-policy-choice-mcq-06                 MCQ  d2  1.1 Secure access                      new
296  aws-protect-cloudtrail-org-wide-mcq-12                     MCQ  d3  1.1 Secure access                      new
297  aws-role-chaining-one-hour-limit-mcq-08                    MCQ  d3  1.1 Secure access                      new
298  aws-service-principal-resource-policy-mcq-15               MCQ  d2  1.1 Secure access                      new
299  aws-web-identity-federation-mobile-mcq-17                  MCQ  d2  1.1 Secure access                      new
300  aws-alb-only-public-tier-mcq-25                            MCQ  d2  1.2 Secure workloads                   new
301  aws-encrypt-direct-connect-traffic-mcq-31                  MCQ  d2  1.2 Secure workloads                   new
302  aws-firewall-manager-enforce-waf-org-mcq-30                MCQ  d2  1.2 Secure workloads                   new
303  aws-isolation-account-vs-vpc-vs-subnet-mcq-24              MCQ  d2  1.2 Secure workloads                   new
304  aws-nacl-ephemeral-ports-timeout-mcq-21                    MCQ  d3  1.2 Secure workloads                   new
305  aws-s3-lock-to-vpc-endpoint-mcq-14                         MCQ  d3  1.2 Secure workloads                   new
306  aws-shield-advanced-justification-mcq-27                   MCQ  d2  1.2 Secure workloads                   new
307  aws-vpn-customer-gateway-redundancy-mcq-32                 MCQ  d2  1.2 Secure workloads                   new
308  aws-waf-cannot-attach-nlb-mcq-29                           MCQ  d2  1.2 Secure workloads                   new
309  aws-acm-certificate-not-renewing-mcq-51                    MCQ  d2  1.3 Data security controls             new
310  aws-backup-vault-lock-ransomware-mcq-45                    MCQ  d2  1.3 Data security controls             new
311  aws-continuous-compliance-org-mcq-35                       MCQ  d2  1.3 Data security controls             new
312  aws-end-to-end-tls-alb-targets-mcq-40                      MCQ  d2  1.3 Data security controls             new
313  aws-kms-admin-vs-user-separation-mcq-43                    MCQ  d3  1.3 Data security controls             new
314  aws-kms-rotation-key-types-mcq-50                          MCQ  d2  1.3 Data security controls             new
315  aws-kms-viaservice-condition-mcq-44                        MCQ  d3  1.3 Data security controls             new
316  aws-macie-find-pii-buckets-mcq-48                          MCQ  d1  1.3 Data security controls             new
317  aws-s3-replicate-existing-objects-mcq-46                   MCQ  d3  1.3 Data security controls             new
318  aws-share-encrypted-ami-cross-account-mcq-38               MCQ  d3  1.3 Data security controls             new
319  aws-stale-credentials-audit-mcq-03                         MCQ  d2  1.3 Data security controls             new
320  aws-amazon-mq-jms-no-code-change-mcq-11                    MCQ  d1  2.1 Loosely coupled architectures      new
321  aws-asg-scale-workers-on-queue-mcq-06                      MCQ  d2  2.1 Loosely coupled architectures      new
322  aws-eventbridge-content-routing-saas-mcq-03                MCQ  d2  2.1 Loosely coupled architectures      new
323  aws-java-monolith-to-containers-mcq-14                     MCQ  d3  2.1 Loosely coupled architectures      new
324  aws-lambda-critical-function-throttled-mcq-17              MCQ  d2  2.1 Loosely coupled architectures      new
325  aws-order-workflow-with-human-wait-mcq-21                  MCQ  d2  2.1 Loosely coupled architectures      new
326  aws-session-store-behind-alb-mcq-20                        MCQ  d2  2.1 Loosely coupled architectures      new
327  aws-sqs-poison-message-blocking-mcq-09                     MCQ  d3  2.1 Loosely coupled architectures      new
328  aws-alarm-on-healthy-host-count-mcq-29                     MCQ  d1  2.2 HA and fault tolerance             new
329  aws-baseline-stacks-many-accounts-mcq-23                   MCQ  d1  2.2 HA and fault tolerance             new
330  aws-dr-24h-objectives-lowest-cost-mcq-39                   MCQ  d1  2.2 HA and fault tolerance             new
331  aws-find-slow-microservice-hop-mcq-30                      MCQ  d1  2.2 HA and fault tolerance             new
332  aws-golden-ami-instance-refresh-mcq-24                     MCQ  d2  2.2 HA and fault tolerance             new
333  aws-legacy-app-too-many-connections-mcq-40                 MCQ  d2  2.2 HA and fault tolerance             new
334  aws-windows-smb-shared-storage-ha-mcq-43                   MCQ  d1  3.1 High-performing storage            new
335  aws-queue-backlog-per-instance-mcq-08                      MCQ  d3  3.2 Elastic compute                    new
336  aws-vpc-cidr-growth-mcq-25                                 MCQ  d2  3.4 Scalable network                   new
337  aws-bi-dashboard-choice-mcq-36                             MCQ  d1  3.5 Data ingestion and transformation  new
338  aws-data-lake-permissions-mcq-31                           MCQ  d2  3.5 Data ingestion and transformation  new
339  aws-partner-sftp-into-s3-mcq-22                            MCQ  d1  3.5 Data ingestion and transformation  new
340  aws-d4-backup-archival-selection-mcq-07                    MCQ  d2  4.1 Cost-optimized storage             new
341  aws-d4-batch-vs-individual-uploads-mcq-10                  MCQ  d2  4.1 Cost-optimized storage             new
342  aws-d4-data-migration-service-mcq-08                       MCQ  d2  4.1 Cost-optimized storage             new
343  aws-d4-db-type-timeseries-columnar-mcq-26                  MCQ  d2  4.1 Cost-optimized storage             new
344  aws-d4-lowest-cost-transfer-into-aws-mcq-09                MCQ  d2  4.1 Cost-optimized storage             new
345  aws-d4-s3-lifecycle-versioning-cleanup-mcq-06              MCQ  d3  4.1 Cost-optimized storage             new
346  aws-d4-storage-auto-scaling-need-mcq-11                    MCQ  d1  4.1 Cost-optimized storage             new
347  aws-d4-storage-service-cheapest-mcq-02                     MCQ  d3  4.1 Cost-optimized storage             new
348  aws-d4-storage-size-rightsizing-mcq-12                     MCQ  d2  4.1 Cost-optimized storage             new
349  aws-d4-storage-tier-unknown-pattern-mcq-04                 MCQ  d1  4.1 Cost-optimized storage             new
350  aws-d4-availability-by-workload-class-mcq-18               MCQ  d2  4.2 Cost-optimized compute             new
351  aws-d4-graviton-or-burstable-choice-mcq-21                 MCQ  d2  4.2 Cost-optimized compute             new
352  aws-d4-instance-family-selection-mcq-19                    MCQ  d1  4.2 Cost-optimized compute             new
353  aws-d4-instance-size-rightsizing-mcq-20                    MCQ  d2  4.2 Cost-optimized compute             new
354  aws-d4-load-balancing-strategy-cost-mcq-15                 MCQ  d2  4.2 Cost-optimized compute             new
355  aws-d4-scaling-method-hibernation-mcq-16                   MCQ  d2  4.2 Cost-optimized compute             new
356  aws-d4-scheduled-vs-predictive-scaling-mcq-17              MCQ  d2  4.2 Cost-optimized compute             new
357  aws-d4-db-backup-retention-cost-mcq-22                     MCQ  d2  4.3 Cost-optimized database            new
358  aws-d4-db-engine-license-cost-mcq-23                       MCQ  d2  4.3 Cost-optimized database            new
359  aws-d4-db-migration-schema-data-mcq-27                     MCQ  d2  4.3 Cost-optimized database            new
360  aws-d4-db-service-choose-two-mcq-25                        MCQ  d3  4.3 Cost-optimized database            new
361  aws-d4-bandwidth-vpn-vs-dx-speed-mcq-34                    MCQ  d3  4.4 Cost-optimized network             new
362  aws-d4-cdn-edge-caching-need-mcq-32                        MCQ  d1  4.4 Cost-optimized network             new
363  aws-d4-network-connection-choice-mcq-29                    MCQ  d2  4.4 Cost-optimized network             new
364  aws-d4-network-review-optimizations-mcq-31                 MCQ  d3  4.4 Cost-optimized network             new
365  aws-d4-throttling-strategy-mcq-33                          MCQ  d2  4.4 Cost-optimized network             new
366  aws-client-vpn-remote-workforce-mcq-33                     MCQ  d1  1.2 Secure workloads                   new
367  aws-artifact-audit-evidence-mcq-34                         MCQ  d1  1.3 Data security controls             new
368  aws-s3-access-points-multi-app-mcq-49                      MCQ  d3  1.3 Data security controls             new
369  aws-review-sentiment-no-ml-team-mcq-44                     MCQ  d1  2.2 HA and fault tolerance             new
370  aws-streaming-kafka-compat-mcq-33                          MCQ  d2  3.5 Data ingestion and transformation  new
```

