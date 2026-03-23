教你在 AWS 中配置 SQS 和 Lambda 联动
这套事件驱动的架构在 AWS 控制台（Console）配置非常简单，主要分为 4 个步骤。如果你使用的是 IaC（比如 CDK 或 SAM），逻辑也是完全一样的。

第一步：创建 SQS 队列 (SQS Queue)
登录 AWS Console，搜索进入 SQS (Simple Queue Service) 控制台。
点击 Create queue。
Type: 选择 Standard (标准队列)。注：虽然之前代码里写了 MessageGroupId 适配 FIFO 队列，但对于单纯的后台构建任务，Standard 队列吞吐量更高且更便宜。如果你选择 Standard，请把之前 publish.js 中的 MessageGroupId 字段删掉。
Name: 取名为 RecallSmith-PublishJobs。
Configuration:
Visibility timeout (可见性超时): 这是一个非常关键的设置！它代表 Lambda 拿到任务后，SQS 等待多久认为任务失败并重试。因为构建可能会比较久，建议设置为 2 分钟 (2 Minutes) 或以上。
Message retention period: 默认 4 天即可。
其他保持默认，点击右下角 Create queue。
创建成功后，复制页面上的 URL（例如 https://sqs.ap-southeast-2.amazonaws.com/123456789012/RecallSmith-PublishJobs），保存备用。
第二步：配置 Lambda 的环境变量 (Environment Variables)
进入 Lambda 控制台，找到你的入口函数（比如 core-vpc）。
选择 Configuration 选项卡，然后点击左侧的 Environment variables。
点击 Edit，新增一条：
Key: PUBLISH_SQS_QUEUE_URL
Value: 刚刚复制的 SQS URL。
点击 Save 保存。
第三步：赋予 Lambda 读写 SQS 的权限 (IAM Role)
Lambda 默认只有写日志的权限，我们必须让它能向 SQS 发送消息，并从 SQS 拉取消息。

在你的 Lambda 页面，点击 Configuration -> Permissions。
找到 Execution role（执行角色），点击角色名称（会跳转到 IAM 控制台）。
在 IAM 页面，点击 Add permissions -> Attach policies。
为了简单，你可以直接搜索并添加 AWS 托管策略：AmazonSQSFullAccess。 (或者，如果你想遵循最小权限原则，可以创建一个 Inline Policy，只包含 sqs:SendMessage, sqs:ReceiveMessage, sqs:DeleteMessage, sqs:GetQueueAttributes)。
保存权限。
第四步：给 Lambda 绑定 SQS 触发器 (Trigger)
我们现在要告诉 AWS，一旦 SQS 里面有了消息，就自动唤醒你的 Lambda。

回到你的 Lambda 函数页面。
点击上方的 + Add trigger 按钮。
从下拉菜单里选择 SQS。
SQS queue: 选择你刚刚创建的 RecallSmith-PublishJobs 队列。
Batch size: 这里建议设置为 1。意思是，只要有任务，SQS 每次只扔 1 个任务给 Lambda 实例处理（避免同一个小 Lambda 内存爆掉或者超时）。
点击 Add。
🎉 大功告成！
此时整个数据流就已经打通了：

前端点击发版 ➡️ 调用 API Gateway。
Lambda (API 路由) 收到 HTTP 请求 ➡️ INSERT INTO publish_jobs ➡️ 调用 SQS SDK 推送一条消息 ➡️ 立即返回 202 Accepted。
SQS 收到消息 ➡️ 自动唤醒一个新的 Lambda 实例 (走 SQS Trigger 路由)。
Lambda (Worker 路由) 取出消息 ➡️ 更新 DB 为 processing ➡️ 开始漫长的下载打包和传 S3 ➡️ 完成后更新 DB 为 completed。
前端通过 2 秒一次的短轮询，最终拿到 completed 的状态，完美实现解耦！