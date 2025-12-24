import { Context, Schema, Logger, sleep, h } from 'koishi' // 导入 h 函数用于构建元素

export const name = 'lolbaninfo'

export const usage = 
`
# ⚠️ LOL封号查询插件 ⚠️
- **此插件作者只是制作工具，网站API及其内容均与作者无关，请合理使用**
- 无需密码，直接根据QQ号查询账号封禁状态与详细信息

---

<details>
<summary><strong><span style="font-size: 1.3em; color: #2a2a2a;">📢 功能特点</span></strong></summary>

- 支持通过QQ号快速查询LOL账号封禁状态
- 自动重试机制，提高查询成功率
- 日志自动清理，避免日志过多占用内存
- 简单易用的指令操作，适合各类用户

</details>

<details>
<summary><strong><span style="font-size: 1.3em; color: #2a2a2a;">🛠️ 配置说明</span></strong></summary>

- apiUrl: 目标网站的API接口地址，通常无需修改
- apiToken: 网站API的访问Token（注册即可获得），注册网站：https://yun.4png.com/
- retryTimes: 请求失败时的最大重试次数，建议设置为2-3次
- retryDelay: 每次重试的间隔时间（毫秒），建议设置为1000-2000ms
- maxLogCount: 日志自动清理阈值（最大存储条数），建议设置为100-200条

</details>

<details>
<summary><strong><span style="font-size: 1.3em; color: #2a2a2a;">💡 使用指令</span></strong></summary>

- 查封号+空格+<qq号>：查询指定QQ号的LOL封禁状态
- 示例：<pre><code>查封号 123456789</code></pre>

</details>

<details>
<summary><strong><span style="font-size: 1.3em; color: #2a2a2a;">💡 使用指令</span></strong></summary>

- 查封号+空格+<qq号>：查询指定QQ号的LOL封禁状态
- 示例：<pre><code>查封号 123456789</code></pre>

</details>

<details>
<summary><strong><span style="font-size: 1.3em; color: #2a2a2a;">📄 注意事项</span></strong></summary>

- 请确保提供的API Token有效且有查询权限
- 本插件仅供查询封禁状态，请勿用于其他用途

</details>
`

// 回复方式枚举
export enum ReplyMode {
  MENTION = 'mention',  // @用户
  QUOTE = 'quote',      // 引用回复
  NORMAL = 'normal',    // 普通回复
}

// 配置接口
export interface Config {
  apiUrl: string               // 目标API地址，固定为文档地址
  apiToken: string             // API访问Token（注册获取）
  retryTimes: number           // Token失效最大重试次数
  retryDelay: number           // 重试间隔（毫秒）
  maxLogCount: number          // 日志自动清理阈值
  replyMode: ReplyMode         // 新增：回复模式
}

// ===================== 1. 配置模块 =====================
export const Config: Schema<Config> = Schema.object({
  apiUrl: Schema.string()
    .description('目标网站的API接口地址')
    .default('https://yun.4png.com/api/query.html')
    .required(),
  apiToken: Schema.string()
    .description('网站API的访问Token（注册即可获得）')
    .required(),
  replyMode: Schema.union([ // 新增配置项
    Schema.const(ReplyMode.MENTION).description('使用 @ 用户进行回复'),
    Schema.const(ReplyMode.QUOTE).description('使用引用进行回复'),
    Schema.const(ReplyMode.NORMAL).description('保持普通回复'),
  ])
  .description('机器人回复消息的方式')
  .default(ReplyMode.NORMAL), // 默认为普通模式
  retryTimes: Schema.number()
    .description('请求失败时的最大重试次数')
    .default(2)
    .min(0)
    .max(5),
  retryDelay: Schema.number()
    .description('每次重试的间隔时间（毫秒）')
    .default(1000)
    .min(500)
    .max(5000),
  maxLogCount: Schema.number()
    .description('日志自动清理阈值（最大存储条数）')
    .default(100)
    .min(20)
    .max(500),
})

// ===================== 2. 日志管理模块 =====================
/** 内存日志缓存 */
const logCache: string[] = []

/**
 * 添加日志并自动清理超出阈值的旧日志
 * @param logger 插件日志实例（修正类型为 Logger）
 * @param content 日志内容
 * @param maxCount 最大日志存储条数
 */
function addLogAndClean(
  logger: Logger,
  content: string,
  maxCount: number
): void {
  const formattedLog = `[${new Date().toLocaleString()}] ${content}`
  logCache.push(formattedLog)

  // 日志数量超出阈值时，删除最早的日志
  if (logCache.length > maxCount) {
    const deleteCount = logCache.length - maxCount
    logCache.splice(0, deleteCount)
    logger.info(`[日志清理] 已删除${deleteCount}条旧日志，当前保留${logCache.length}条`)
  }
}

// ===================== 3. API请求模块 =====================
/**
 * 带重试机制的API请求函数（适配GET请求+URL参数）
 * @param ctx       Koishi上下文
 * @param config    插件配置
 * @param qq        要查询的QQ号
 * @param logger    插件日志实例（修正类型为 Logger）
 * @returns         API返回结果
 */
async function requestWithRetry(
  ctx: Context,
  config: Config,
  qq: string,
  logger: Logger // 修正类型为 Logger
): Promise<any> {
  let attempt = 0

  while (attempt <= config.retryTimes) {
    try {
      const requestLog = `[第${attempt + 1}次请求] 开始查询QQ：${qq}，目标API：${config.apiUrl}`
      addLogAndClean(logger, requestLog, config.maxLogCount)
      logger.info(requestLog)

      // 关键修改：GET请求，参数拼在URL上（符合文档要求）
      const response = await ctx.http.get(config.apiUrl, {
        params: {
          qq: qq,
          token: config.apiToken
        },
        // 强制解析JSON，避免返回文本格式
        responseType: 'json'
      })

      const successLog = `[第${attempt + 1}次请求] 查询成功，返回状态码：200`
      addLogAndClean(logger, successLog, config.maxLogCount)
      logger.success(successLog)

      return response
    } catch (error: any) {
      attempt++
      const status = error.response?.status || '未知状态'
      const failLog = `[第${attempt}次请求] 失败，状态码：${status}，错误信息：${error.message}`
      addLogAndClean(logger, failLog, config.maxLogCount)
      logger.warn(failLog)

      // 仅对参数/权限类错误（400/403）进行重试
      const isRetryable = [400, 403].includes(status)
      if (!isRetryable || attempt > config.retryTimes) {
        const endLog = `[请求终止] 非重试错误或已达最大重试次数(${config.retryTimes}次)`
        addLogAndClean(logger, endLog, config.maxLogCount)
        logger.error(endLog)
        throw error
      }

      const retryLog = `[准备重试] 间隔${config.retryDelay}ms后进行第${attempt}次重试`
      addLogAndClean(logger, retryLog, config.maxLogCount)
      logger.info(retryLog)

      await sleep(config.retryDelay)
    }
  }

  throw new Error('达到最大重试次数，请求失败')
}

// ===================== 4. 工具函数模块 =====================
/**
 * 校验QQ号格式是否合法
 * @param qq 要校验的QQ号
 * @returns 合法返回true，否则返回false
 */
function isValidQQ(qq: string): boolean {
  return /^\d{5,13}$/.test(qq)
}

/**
 * 根据配置和会话信息，生成带有前缀的消息字符串
 * @param session Koishi会话对象
 * @param message 要发送的原始消息内容
 * @param config 插件配置
 * @returns 处理后的消息字符串
 */
function formatReplyMessage(session: any, message: string, config: Config): string {
  let prefix = '';
  // @用户 [[1]]
  if (config.replyMode === ReplyMode.MENTION) {
    prefix = h.at(session.userId).toString() + '\n'; // 使用 h.at 构建 @ 元素并转为字符串 + 换行符
  }
  // 引用回复 [[1]]
  if (config.replyMode === ReplyMode.QUOTE) {
    prefix = h.quote(session.messageId).toString(); // 使用 h.quote 构建引用元素并转为字符串
  }
  // 普通回复 (config.replyMode === ReplyMode.NORMAL) 不添加前缀
  return prefix + message;
}

// ===================== 5. 插件核心逻辑 =====================
// 修复：apply函数添加第二个参数 config，接收插件配置
export function apply(ctx: Context, config: Config) {

  // 创建插件专属日志实例
  const logger = ctx.logger(name)

  // 指令1：查询QQ号状态
  ctx.command('查封号 <qq号>', '查询QQ号封号状态')
    .action(async ({ session }, qq) => { // 从 action 回调中解构出 session
      // 1. QQ号格式校验
      if (!isValidQQ(qq)) {
        const errMsg = `QQ号格式错误：${qq}（需5-13位数字）`
        addLogAndClean(logger, errMsg, config.maxLogCount)
        logger.warn(errMsg)
        // 使用格式化函数发送回复
        return formatReplyMessage(session, `❌ ${errMsg}`, config);
      }

      try {
        // 2. 发送带重试的GET请求
        const result = await requestWithRetry(ctx, config, qq, logger)
        const msg = result.msg || '无返回信息'

        // 3. 处理API返回结果（适配文档的code和data字段）
        switch (result.code) {
          case 200:
            const banInfo = result.data?.banmsg || '无详细封禁信息'
            const successResLog = `[查询结果] QQ${qq}：${msg} → ${banInfo}`
            addLogAndClean(logger, successResLog, config.maxLogCount)
            logger.success(successResLog)
            // 使用格式化函数发送回复
            return formatReplyMessage(session, `✅ 查询成功：${msg}\n📝 详细信息：${banInfo}`, config);
          case 400:
            const warnResLog = `[查询结果] QQ${qq} 400错误：${msg}`
            addLogAndClean(logger, warnResLog, config.maxLogCount)
            logger.warn(warnResLog)
            // 使用格式化函数发送回复
            return formatReplyMessage(session, `❌ 查询失败 [错误码400]：${msg}（参数缺失，请检查配置）`, config);
          default:
            const infoResLog = `[查询结果] QQ${qq} 错误码${result.code}：${msg}`
            addLogAndClean(logger, infoResLog, config.maxLogCount)
            logger.info(infoResLog)
            // 使用格式化函数发送回复
            return formatReplyMessage(session, `❌ 查询失败 [错误码${result.code}]：${msg}`, config);
        }
      } catch (error: any) {
        const errMsg = error.message || '未知错误'
        const errorLog = `[接口调用出错] QQ${qq}：${errMsg}`
        addLogAndClean(logger, errorLog, config.maxLogCount)
        logger.error(errorLog)
        // 使用格式化函数发送回复
        return formatReplyMessage(session, `⚠️  接口调用出错：${errMsg}`, config);
      }
    })
}