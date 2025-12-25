import { Context, Schema, sleep, h } from 'koishi'

export const name = 'lolbaninfo'

export const usage = `
# ⚠️ LOL封号查询插件 ⚠️
- **此插件作者只是制作工具，网站API及其内容均与作者无关，请合理使用**
- 无需密码，直接根据QQ号查询账号封禁状态与详细信息
- 注册网站：https://yun.4png.com/

---

<details>
<summary><strong><span style="font-size: 1.3em; color: #2a2a2a;">📢 功能特点</span></strong></summary>

- 支持通过QQ号快速查询LOL账号封禁状态
- 自动重试机制，提高查询成功率
- 简单易用的指令操作，适合各类用户

</details>

<details>
<summary><strong><span style="font-size: 1.3em; color: #2a2a2a;">🛠️ 配置说明</span></strong></summary>

- apiUrl: 目标网站的API接口地址，通常无需修改
- apiToken: 网站API的访问Token（注册即可获得），注册网站：https://yun.4png.com/
- retryTimes: 请求失败时的最大重试次数，建议设置为2-3次
- retryDelay: 每次重试的间隔时间（毫秒），建议设置为1000-2000ms

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

// 配置接口 - 使用嵌套结构进行分类
export interface Config {
  api: {
    apiUrl: string               // 目标API地址
    apiToken: string             // API访问Token
  };
  reply: {
    replyMode: ReplyMode         // 回复模式
  };
  retry: {
    retryTimes: number           // 最大重试次数
    retryDelay: number           // 重试间隔（毫秒）
  };
}

// ===================== 1. 配置模块 (分类) =====================
  export const Config: Schema<Config> = Schema.intersect([          // 使用 intersect 来组合多个对象
  Schema.object({
    api: Schema.object({                                          // API相关配置分组
      apiUrl: Schema.string()
        .description('目标网站的API接口地址')
        .default('https://yun.4png.com/api/query.html'),
      apiToken: Schema.string()
        .description('网站API的访问Token（注册即可获得）')
          .required(),                                              // 需要用户输入的
      }).description('API 设置'),                                    // API 相关配置的分组描述
    reply: Schema.object({                                         // 回复相关配置分组
      replyMode: Schema.union([
        Schema.const(ReplyMode.MENTION).description('使用 @ 用户进行回复'),
        Schema.const(ReplyMode.QUOTE).description('使用引用进行回复'),
        Schema.const(ReplyMode.NORMAL).description('保持普通回复'),
      ])
      .description('机器人回复消息的方式')
        .default(ReplyMode.NORMAL),                                  // 默认为普通模式
      }).description('回复 设置'),                                  // 回复相关配置的分组描述
    retry: Schema.object({                                        // 重试相关配置分组
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
    }).description('重试 设置'),
  })
]);

// ===================== 2. API请求模块 =====================
/**
 * 带重试机制的API请求函数（适配GET请求+URL参数）
 * @param ctx       Koishi上下文
 * @param config    插件配置
 * @param qq        要查询的QQ号
 * @returns         API返回结果
 */
async function requestWithRetry(
  ctx: Context,
  config: Config,
  qq: string
): Promise<any> {
  let attempt = 0
  const { apiUrl, apiToken } = config.api               // 解构API配置
  const { retryTimes, retryDelay } = config.retry        // 解构重试配置

  //创建插件专属日志实例
  const logger = ctx.logger(name)
  
  // 重试循环
  while (attempt <= retryTimes) {
    try {
      const requestLog = `请求API（尝试第 ${attempt + 1} 次）`
      logger.info(requestLog)
      // 发送GET请求
      const response = await ctx.http.get(apiUrl, {
        params: {
          qq: qq,
          token: apiToken
        },
        responseType: 'json',
        timeout: 5000
      })
      const successLog = `API请求成功（第 ${attempt + 1} 次）`
      logger.info(successLog)
      return response
      // 捕获错误
    } catch (error: any) {
      attempt++
      
      const status = error.response?.status || '未知状态'
      const errorLog = `API请求失败（第 ${attempt} 次，状态：${status}，错误：${error.message || error.code})`
      logger.error(errorLog)

      // 仅对网络错误和5xx服务器错误进行重试
      const isRetryable = status >= 500 || !status || ['ECONNRESET', 'ETIMEDOUT'].includes(error.code)
      if (!isRetryable || attempt > retryTimes) {
        const finalErrorLog = `达到最大重试次数或不可重试错误，停止请求`
        logger.error(finalErrorLog)
        throw error
      }

      await sleep(retryDelay)
    }
  }

  throw new Error('达到最大重试次数，请求失败')
}

// ===================== 3. 工具函数模块 =====================
/**
 * 校验QQ号格式是否合法
 * @param qq     要校验的QQ号
 * @returns      合法返回true，否则返回false
 */
function isValidQQ(qq: string): boolean {
  return /^\d{5,13}$/.test(qq)
}

/**
 * 根据配置和会话信息，生成带有前缀的消息字符串
 * @param session    Koishi会话对象
 * @param message    要发送的原始消息内容
 * @param config     插件配置
 * @returns          处理后的消息字符串
 */
function formatReplyMessage(session: any, message: string, config: Config): string {
  let prefix = ''
  // 根据配置添加前缀
  // 使用@回复
  if (config.reply.replyMode === ReplyMode.MENTION) {
    prefix = h.at(session.userId).toString() + '&#13;'      //想实现@后面加换行符，但一直失败。
  }
  // 使用引用回复
  if (config.reply.replyMode === ReplyMode.QUOTE) {
    prefix = h.quote(session.messageId).toString()
  }
  // 返回最终消息
  return prefix + message
}

// ===================== 4. 插件核心逻辑 =====================
export function apply(ctx: Context, config: Config) {

  //创建插件专属日志实例
  const logger = ctx.logger(name)


  // 指令1：查询QQ号状态
  ctx.command('查封号 <qq号>', '查询QQ号封号状态')
    .action(
      async ({ session }, qq) => {
        
      // 1. QQ号格式校验
      if (!isValidQQ(qq)) {
        const errorLog = `QQ号格式错误：${qq}`
        logger.warn(errorLog)
        return formatReplyMessage(
          session, 
          `❌ QQ号格式错误：${qq}（需5-13位数字）`, 
          config
        )
      }

      try {
        // 2. 发送带重试的GET请求
        const result = await requestWithRetry(ctx, config, qq)
        const msg = result.msg || '无返回信息'

        // 3. 处理API返回结果
        switch (result.code) {
          case 200:
            const banInfo = result.data?.banmsg || '无详细封禁信息'
            const successLog = `查询成功：QQ号 ${qq}，封禁信息：${banInfo}`
            logger.info(successLog)
            return formatReplyMessage(
              session, 
              `✅ 查询成功：${msg}\n
               📝 详细信息：${banInfo}`,
               config
              )

          case 400:
            const failLog = `查询失败 [错误码400]：${msg}`
            logger.warn(failLog)
            return formatReplyMessage(
              session,
               `❌ 查询失败 [错误码400]：${msg}（参数缺失，请检查配置）`,
                config
              )
          
          case 401:
            logger.warn(`Token 无效 [401]：${msg}`)
            return formatReplyMessage(
              session,
              `🔑 API Token 无效或未授权 [401]：${msg}并更新配置`,
              config
            )

          case 403:
            logger.warn(`请求被拒绝 [403]：频率限制或IP封禁`)
            return formatReplyMessage(
              session,
              `🛑 请求被拒绝 [403]：可能因查询过于频繁或IP受限\n
               ⏳ 建议稍后再试，或联系 API 提供方`,
              config
            )

          case 404:
            logger.info(`未找到账号 [404]：QQ ${qq} 未绑定LOL账号或无封禁记录`)
            return formatReplyMessage(
              session,
              `❓ 未找到相关信息 [404]\n
               📢 QQ ${qq} 可能未绑定《英雄联盟》账号，或当前无封禁记录`,
              config
            )

            case 429:
            logger.info(`API账号会员已经过期，请付费使用`)
            return formatReplyMessage(
              session,
              `📢 API免费额度使用完毕或账号会员已经过期，请充值后使用`,
              config
            )

          case 500:
            logger.error(`服务器内部错误 [500]：${msg}`)
            return formatReplyMessage(
              session,
              `🛠️ 服务器内部错误 [500]：${msg}\n
               📡 问题出在 API 服务端，请稍后再试`,
              config
            )

          case 502:
          case 503:
          case 504:
            logger.error(`服务不可用 [${result.code}]：${msg}`)
            return formatReplyMessage(
              session,
              `☁️ 服务暂时不可用 [${result.code}]：${msg}\n
               🔌 可能是 API 服务维护或超载，请稍后重试`,
              config
            )
          
          default:
            const unknownLog = `查询失败 [错误码${result.code}]：${msg}`
            logger.error(unknownLog)
            return formatReplyMessage(
              session,
              `❗ 收到未知响应码 [${result.code}]：${msg}`,
              config
            )
        }

      } catch (error: any) {
        const errMsg = error.message || '未知错误'
        const errorLog = `接口调用出错：${errMsg}`
        logger.error(errorLog)
        return formatReplyMessage(
          session, 
          `⚠️ 查询过程中发生错误\n
           📡 请检查网络、API 地址及 Token 配置`,
          config
        )
      }
    })
}