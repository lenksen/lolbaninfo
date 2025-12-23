import { Context, Schema, Logger } from 'koishi' 
import { resolve } from 'path'
import { sleep } from '@koishijs/utils'
import {} from '@koishijs/plugin-console'

export const name = 'lolbaninfo'

// 配置接口
export interface Config {
  apiUrl: string               // 目标API地址，固定为文档地址
  apiToken: string             // API访问Token（注册获取）
  retryTimes: number           // Token失效最大重试次数
  retryDelay: number           // 重试间隔（毫秒）
  maxLogCount: number          // 日志自动清理阈值
}

export const usage = `
# ⚠️ LOL封号查询插件 ⚠️
无需密码，直接根据QQ号查询账号封禁状态与详细信息
`

export const Config: Schema<Config> = Schema.object({
  apiUrl: Schema.string()
    .description('目标网站的API接口地址（固定为文档地址）')
    .default('https://yun.4png.com/api/query.html'),
  apiToken: Schema.string()
    .description('网站API的访问Token（注册即可获得）')
    .required(),
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
    .max(500)
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
function addLogAndClean(logger: Logger, content: string, maxCount: number): void {
  const formattedLog = `[${new Date().toLocaleString()}] ${content}`
  logCache.push(formattedLog)

  // 日志数量超出阈值时，删除最早的日志
  if (logCache.length > maxCount) {
    const deleteCount = logCache.length - maxCount
    logCache.splice(0, deleteCount)
    logger.info(`[日志清理] 已删除${deleteCount}条旧日志，当前保留${logCache.length}条`)
  }
}

/**
 * 获取当前日志缓存
 * @returns 格式化后的日志列表
 */
function getLogCache(): string {
  return logCache.length === 0 
    ? '当前暂无日志记录' 
    : `当前日志共${logCache.length}条：\n${logCache.join('\n')}`
}

// ===================== 3. API请求模块 =====================
/**
 * 带重试机制的API请求函数（适配GET请求+URL参数）
 * @param ctx Koishi上下文
 * @param config 插件配置
 * @param qq 要查询的QQ号
 * @param logger 插件日志实例（修正类型为 Logger）
 * @returns API返回结果
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

// ===================== 5. 插件核心逻辑 =====================
// 修复：apply函数添加第二个参数 config，接收插件配置
export function apply(ctx: Context, config: Config) {
  ctx.inject(['console'], (ctx) => {
    ctx.console.addEntry({
      dev: resolve(__dirname, '../client/index.ts'),
      prod: resolve(__dirname, '../dist'),
    })
  })

  // 创建插件专属日志实例
  const logger = ctx.logger(name)

  // 指令1：查询QQ号状态
  ctx.command('查封号 <qq号>', '查询QQ号封号状态')
    .action(async (_, qq) => {
      // 1. QQ号格式校验
      if (!isValidQQ(qq)) {
        const errMsg = `QQ号格式错误：${qq}（需5-13位数字）`
        addLogAndClean(logger, errMsg, config.maxLogCount)
        logger.warn(errMsg)
        return `❌ ${errMsg}`
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
            return `✅ 查询成功：${msg}\n📝 详细信息：${banInfo}`
          case 400:
            const warnResLog = `[查询结果] QQ${qq} 400错误：${msg}`
            addLogAndClean(logger, warnResLog, config.maxLogCount)
            logger.warn(warnResLog)
            return `❌ 查询失败 [错误码400]：${msg}（参数缺失，请检查配置）`
          default:
            const infoResLog = `[查询结果] QQ${qq} 错误码${result.code}：${msg}`
            addLogAndClean(logger, infoResLog, config.maxLogCount)
            logger.info(infoResLog)
            return `❌ 查询失败 [错误码${result.code}]：${msg}`
        }
      } catch (error: any) {
        const errMsg = error.message || '未知错误'
        const errorLog = `[接口调用出错] QQ${qq}：${errMsg}`
        addLogAndClean(logger, errorLog, config.maxLogCount)
        logger.error(errorLog)
        return `⚠️  接口调用出错：${errMsg}`
      }
    })

  // 指令2：查看当前日志缓存
  ctx.command('查看查号日志', '查看插件当前的日志缓存')
    .action(() => getLogCache())
}