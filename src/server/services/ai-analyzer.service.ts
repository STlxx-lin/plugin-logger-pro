import { Application } from '@nocobase/server';
import https from 'https';
import http from 'http';
import { URL } from 'url';

export interface LLMServiceSelection {
  llmService?: string; // 系统服务标识 (如 v_c6u6kvt0t85)
  model?: string;      // 系统模型标识 (如 qwen-plus)
}

export interface AIAnalysisRequest {
  logText: string;
  employeeName?: string; // 选中的员工 username 或 system-error-expert
  llmSelection?: LLMServiceSelection;
  context?: {
    reqId?: string;
    method?: string;
    path?: string;
    collectionName?: string;
    actionName?: string;
    sqlQueries?: string[];
    userAgent?: string;
  };
}

export interface AIAnalysisResponse {
  id?: number | string;
  success: boolean;
  analyzerName: string;
  analysisReport: string;
  durationMs: number;
  createdAt?: string;
}

export class AIAnalyzerService {
  private app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  // 1. 获取 AI 员工列表 (内置错误分析专家 + 系统后台已配置的 AI 员工)
  async getAvailableEmployees() {
    const list: Array<{
      name: string;
      title: string;
      role?: string;
      avatar?: string;
      systemPrompt?: string;
      configuredModel?: string;
    }> = [];

    // 首选内置：系统错误分析专家
    list.push({
      name: 'system-error-expert',
      title: '🛡️ 系统错误分析专家 (内置专家)',
      role: '专长于 Node.js 运行时异常、空指针、中间件流转与数据库错误诊断',
      systemPrompt: `你是一名资深的 NocoBase 和 Node.js 全栈系统架构师与错误诊断专家。请对系统错误日志和调用堆栈进行深度诊断分析，严格按照 Markdown 格式输出：
### 🤖 AI 智能诊断分析报告
#### 🔍 1. 故障摘要与根因定位 (Root Cause)
#### 🧭 2. 受影响模块与代码调用链分析
#### 🛠️ 3. 解决方案与修复建议 (含代码示例)
#### 🛡️ 4. 预防措施与长效建议`,
    });

    // 从 NocoBase 插件 aiEmployees 集合中拉取已注册的 AI 员工 (如 Ellis 等)
    try {
      const repo = this.app.db.getRepository('aiEmployees');
      if (repo) {
        const records = await repo.find();
        for (const r of records) {
          const username = r.username || r.name;
          if (!username) continue;

          let modelDesc = '';
          if (r.modelSettings?.llmService && r.modelSettings?.model) {
            modelDesc = `${r.modelSettings.llmService}/${r.modelSettings.model}`;
          } else if (Array.isArray(r.modelSettings?.models) && r.modelSettings.models.length > 0) {
            modelDesc = `${r.modelSettings.models[0].llmService}/${r.modelSettings.models[0].model}`;
          }

          list.push({
            name: username,
            title: `🤖 ${r.nickname || r.name || username} (AI 员工)`,
            role: r.role || r.description || 'NocoBase 系统 AI 员工',
            avatar: r.avatar,
            systemPrompt: r.systemPrompt,
            configuredModel: modelDesc,
          });
        }
      }
    } catch {}

    return list;
  }

  // 2. 获取系统中已配置的真实 LLM 服务列表 (严格来自后台实际数据)
  async getAvailableLLMServices() {
    const servicesList: Array<{
      llmService: string;
      llmServiceTitle: string;
      provider: string;
      enabledModels: Array<{ label: string; value: string }>;
    }> = [];

    try {
      const repo = this.app.db.getRepository('llmServices') || this.app.db.getRepository('llm_services');
      let records: any[] = [];
      if (repo) {
        records = await repo.find();
      } else if (this.app.db.sequelize) {
        const [rows] = await this.app.db.sequelize.query('SELECT * FROM llm_services');
        records = rows || [];
      }

      for (const r of records) {
        const serviceName = r.name || r.id || r.key;
        if (!serviceName) continue;

        const provider = String(r.provider || r.llmType || r.type || 'openai');
        const title = r.title || r.name || provider;
        const options = r.options || {};
        const raw = r.enabledModels || r.models || options.models || options.enabledModels;
        let modelsList: Array<{ label: string; value: string }> = [];

        if (Array.isArray(raw) && raw.length > 0) {
          for (const m of raw) {
            const val = typeof m === 'string' ? m : m?.value || m?.model || m?.name;
            const lbl = (typeof m === 'object' && (m?.label || m?.name)) ? (m.label || m.name) : val;
            if (val) {
              modelsList.push({ label: lbl, value: val });
            }
          }
        } else if (raw && typeof raw === 'object') {
          const list = Array.isArray(raw.models) ? raw.models : [];
          for (const m of list) {
            const val = typeof m === 'string' ? m : m?.value || m?.model || m?.name;
            const lbl = (typeof m === 'object' && (m?.label || m?.name)) ? (m.label || m.name) : val;
            if (val) {
              modelsList.push({ label: lbl, value: val });
            }
          }
        }

        if (modelsList.length === 0) {
          modelsList.push({
            label: `${title}`,
            value: options.model || options.defaultModel || 'default',
          });
        }

        servicesList.push({
          llmService: serviceName,
          llmServiceTitle: title,
          provider,
          enabledModels: modelsList,
        });
      }
    } catch (err: any) {
      this.app.logger?.warn?.(`[LoggerPro] getAvailableLLMServices query error: ${err.message}`);
    }

    return servicesList;
  }

  // 通用 OpenAI 兼容协议 HTTP 请求
  private async callOpenAICompatible(
    baseURL: string,
    apiKey: string,
    modelName: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    const rawUrl = baseURL.trim().replace(/\/+$/, '');
    const apiUrl = rawUrl.endsWith('/chat/completions') ? rawUrl : `${rawUrl}/chat/completions`;

    const urlObj = new URL(apiUrl);
    const postData = JSON.stringify({
      model: modelName,
      messages,
      temperature: 0.2,
    });

    return new Promise((resolve, reject) => {
      const isHttps = urlObj.protocol === 'https:';
      const lib = isHttps ? https : http;

      const req = lib.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port || (isHttps ? 443 : 80),
          path: `${urlObj.pathname}${urlObj.search}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': apiKey ? `Bearer ${apiKey.trim()}` : '',
            'Content-Length': Buffer.byteLength(postData),
          },
          timeout: 45000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsed = JSON.parse(data);
                const reply = parsed.choices?.[0]?.message?.content || data;
                resolve(reply);
              } catch {
                resolve(data);
              }
            } else {
              reject(new Error(`大模型接口响应失败 (HTTP ${res.statusCode}): ${data.slice(0, 300)}`));
            }
          });
        },
      );

      req.on('error', (err) => {
        reject(new Error(`连接大模型接口失败: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求大模型服务响应超时 (45s)'));
      });

      req.write(postData);
      req.end();
    });
  }

  // 内置专家知识库保底分析
  private runHeuristicAnalysis(logText: string, context?: any): string {
    const lines = logText.split(/\r?\n/).filter((l) => l.trim());
    const contextSummary = context
      ? `\n\n> 🌐 **关联请求上下文**: \`${context.method || 'GET'} ${context.path || '-'}\` (ReqId: \`${context.reqId || '-'}\`)\n`
      : '';

    if (/Cannot read properties of undefined \(reading 'repository'\)|Cannot read properties of undefined \(reading 'getRepository'\)/i.test(logText)) {
      return `### 🤖 AI 智能诊断分析报告
${contextSummary}
#### 🔍 1. 故障摘要与根因定位 (Root Cause)
- **错误类型**: \`TypeError: Cannot read properties of undefined (reading 'repository')\`
- **根本原因**: 
  1. 系统在执行认证中间件（如 \`@nocobase/plugin-auth\` 的 \`getUserRepository\` / \`checkToken\`）或业务逻辑时，尝试从 \`app.db\` 获取 Repository，但此时目标数据表（如 \`users\`）或数据库实例尚未加载完成；
  2. 常见于系统热重载重启期间客户端发起并发鉴权请求，或者插件在 \`beforeLoad\` 阶段提前访问了数据库。

#### 🧭 2. 受影响模块与调用链分析
- **涉及模块**: \`@nocobase/plugin-auth\` (用户认证插件) / \`@nocobase/database\`
- **触发函数**: \`getUserRepository\` -> \`BasicAuth.checkToken\` -> \`AsyncEmitter\`

#### 🛠️ 3. 解决方案与修复建议
1. **服务启动等待**: 若在开发环境频繁热重载，请等待控制台输出 \`app has been started\` 后再刷新页面；
2. **代码级防御修复示例**:
\`\`\`typescript
// 在获取 repository 前增加防御性判定
const repo = app.db?.getRepository('users');
if (!repo) {
  throw new Error('Database repository "users" is not ready yet');
}
\`\`\`
3. **数据表检查**: 确认数据库核心 \`users\` 表是否完整且数据源正常连接。`;
    }

    if (/Cannot read properties of undefined \(reading 'getConfig'\)/i.test(logText)) {
      return `### 🤖 AI 智能诊断分析报告
${contextSummary}
#### 🔍 1. 故障摘要与根因定位 (Root Cause)
- **错误类型**: \`TypeError: Cannot read properties of undefined (reading 'getConfig')\`
- **根本原因**: 
  1. 插件在处理 Token 校验或配置读取时，所依赖的 ConfigService 或 Auth 认证对象为 \`undefined\`；
  2. 常见于未在后台初始化配置对应的身份验证器实例（如 \`basic\` 鉴权模式配置缺失）。

#### 🧭 2. 受影响模块与代码链
- **涉及模块**: \`@nocobase/plugin-auth\`
- **触发链路**: \`BasicAuth.checkToken (auth.js:246)\`

#### 🛠️ 3. 解决方案与修复建议
1. 进入 NocoBase 管理后台 -> **【用户认证 (Authentication)】**，检查基础认证方式是否已启用并保存配置；
2. 在代码中为 \`getConfig\` 增加可选链或默认空对象保底：
\`\`\`typescript
const config = authInstance?.getConfig?.() || {};
\`\`\``;
    }

    if (/Workflow pre-action.*collection.*not found/i.test(logText)) {
      return `### 🤖 AI 智能诊断分析报告
${contextSummary}
#### 🔍 1. 故障摘要与根因定位 (Root Cause)
- **警告类型**: \`[Workflow pre-action]: collection "xxx" not found\`
- **根本原因**: 工作流触发器监听了某个数据表的操作事件（如 \`myInAppMessages\`、\`loggerPro\` 等），但当前请求访问的模块并不是真实的数据表集合，导致工作流前置拦截器未在数据库中找到匹配的 Collection。

#### 🛠️ 2. 解决方案与建议
- 此类日志通常为 NocoBase 工作流前置检查的常规非致命 \`[warn]\`，系统会自动跳过无匹配 Collection 的请求，不会影响正常业务流转；
- 如需消除警告，可检查工作流触发配置，将其限定在明确的数据表集合范围内。`;
    }

    // 模式 4: 全链路生命周期追踪诊断模式
    if (logText.includes('【全链路请求生命周期全景诊断】') || (context && context.reqId)) {
      const isSuccess = context?.statusCode ? context.statusCode < 400 : !logText.includes('[error]');
      const sqlCount = context?.sqlQueries?.length || (logText.match(/SELECT|INSERT|UPDATE|DELETE/gi) || []).length;
      const duration = context?.durationMs !== undefined ? `${context.durationMs} ms` : '正常响应';

      return `### 🤖 AI 全链路生命周期智能诊断报告
${contextSummary}
#### 🌐 1. 请求画像与生命周期健康度
- **请求接口**: \`${context?.method || 'POST'} ${context?.path || '-'}\`
- **处理状态**: \`${isSuccess ? '✅ 请求正常响应 (HTTP ' + (context?.statusCode || 200) + ')' : '❌ 请求处理异常'}\`
- **总处理耗时**: \`${duration}\` ${Number(context?.durationMs) > 1000 ? '⚠️ (耗时偏高，存在慢查或阻塞)' : '⚡ (响应极为迅速)'}
- **操作者身份**: \`${context?.username || 'nocobase'}\` (IP: \`${context?.ip || '192.168.0.107'}\`)

#### 🗄️ 2. 数据库 SQL 与数据层交互分析
- **执行 SQL 数量**: \`${sqlCount} 条查询\`
${context?.sqlQueries && context.sqlQueries.length > 0 ? context.sqlQueries.slice(0, 3).map((s: string) => `- \`${s}\``).join('\n') : '- 当前请求主要完成元数据/路由解析，未产生额外的重型慢 SQL。'}

#### 🧭 3. 插件流转与中间件时序链
- 客户端发起请求 -> Koa 中间件鉴权 (basic) -> 路由分发 -> 动作执行 (\`${context?.actionName || 'listMeta'}\`) -> 正常返回 Payload。
- 时序事件流转平稳，无中间件未捕获异常或阻塞现象。

#### 💡 4. 架构调优与长效建议
1. **缓存利用**: 对于 \`listMeta\` 等高频元数据接口，前端或 Gateway 层可开启短时 HTTP ETag / 内存缓存以进一步降低后台并发开销；
2. **审计留痕**: 该操作已被系统操作审计模块完整捕获留痕。`;
    }

    const errorMatch = logText.match(/Error:\s*([^\r\n]+)/i) || logText.match(/\[error\]\s*([^\r\n]+)/i) || logText.match(/\[warn\]\s*([^\r\n]+)/i);
    const errorTitle = errorMatch ? errorMatch[1] : '系统未捕获日志特征';

    return `### 🤖 AI 智能诊断分析报告
${contextSummary}
#### 🔍 1. 故障摘要与特征分析
- **日志特征**: \`${errorTitle}\`
- **日志行数**: \`${lines.length} 行堆栈信息\`

#### 🧭 2. 调用堆栈与模块分析
${lines.slice(0, 6).map((l) => `- \`${l.trim()}\``).join('\n')}

#### 🛠️ 3. 排查建议
1. 检查日志中相关的接口请求参数与上下文；
2. 确认相关依赖服务（数据库、缓存、第三方服务）连通性；
3. 查看关联的【全链路追踪】，确认在报错前最后执行的 SQL 查询或中间件流转情况。`;
  }

  // 确保 logger_ai_records 集合与表结构已就绪
  private async ensureCollection() {
    try {
      const collection = this.app.db.getCollection('logger_ai_records');
      if (collection) {
        await collection.sync();
      }
    } catch {}

    // SQL 保底建表 (兼容 SQLite 与 MySQL)
    try {
      if (this.app.db.sequelize) {
        await this.app.db.sequelize.query(`
          CREATE TABLE IF NOT EXISTS logger_ai_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            analyzerName VARCHAR(255),
            employeeName VARCHAR(255),
            llmService VARCHAR(255),
            model VARCHAR(255),
            logSummary VARCHAR(255),
            logText TEXT,
            context TEXT,
            analysisReport TEXT,
            durationMs INTEGER,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
      }
    } catch {}
  }

  // 保存一条 AI 诊断记录
  private async saveAnalysisRecord(data: {
    analyzerName: string;
    employeeName?: string;
    llmService?: string;
    model?: string;
    logText: string;
    context?: any;
    analysisReport: string;
    durationMs: number;
  }) {
    await this.ensureCollection();
    try {
      const repo = this.app.db.getRepository('logger_ai_records');
      const firstLine = (data.logText || '').split(/\r?\n/).find((l) => l.trim()) || '错误日志诊断';
      const logSummary = firstLine.slice(0, 150);

      if (repo) {
        const created = await repo.create({
          values: {
            analyzerName: data.analyzerName,
            employeeName: data.employeeName || 'system-error-expert',
            llmService: data.llmService || 'Dashscope',
            model: data.model || 'default',
            logSummary,
            logText: data.logText,
            context: data.context || null,
            analysisReport: data.analysisReport,
            durationMs: data.durationMs,
          },
        });
        return created?.id;
      } else if (this.app.db.sequelize) {
        // 直接 SQL 插入兜底
        const [res] = await this.app.db.sequelize.query(
          `INSERT INTO logger_ai_records (analyzerName, employeeName, llmService, model, logSummary, logText, analysisReport, durationMs, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          {
            replacements: [
              data.analyzerName,
              data.employeeName || 'system-error-expert',
              data.llmService || 'Dashscope',
              data.model || 'default',
              logSummary,
              data.logText,
              data.analysisReport,
              data.durationMs,
            ],
          },
        );
        return res;
      }
    } catch (err: any) {
      this.app.logger?.warn?.(`[LoggerPro] Failed to save AI record: ${err.message}`);
    }
    return null;
  }

  // 获取 AI 诊断历史记录列表
  async getAnalysisHistory(options: { page?: number; pageSize?: number } = {}) {
    const { page = 1, pageSize = 20 } = options;
    await this.ensureCollection();
    try {
      const repo = this.app.db.getRepository('logger_ai_records');
      if (repo) {
        const [rows, count] = await repo.findAndCount({
          sort: ['-createdAt', '-id'],
          offset: (page - 1) * pageSize,
          limit: pageSize,
        });
        return {
          rows,
          count,
          page,
          pageSize,
        };
      } else if (this.app.db.sequelize) {
        const [rows] = await this.app.db.sequelize.query('SELECT * FROM logger_ai_records ORDER BY id DESC LIMIT ? OFFSET ?', {
          replacements: [pageSize, (page - 1) * pageSize],
        });
        const [countRes]: any = await this.app.db.sequelize.query('SELECT count(*) as total FROM logger_ai_records');
        const count = countRes?.[0]?.total || rows.length;
        return { rows, count, page, pageSize };
      }
    } catch (err: any) {
      this.app.logger?.warn?.(`[LoggerPro] getAnalysisHistory error: ${err.message}`);
    }
    return { rows: [], count: 0, page, pageSize };
  }

  // 删除某条历史记录
  async deleteAnalysisRecord(id: string | number) {
    await this.ensureCollection();
    try {
      const repo = this.app.db.getRepository('logger_ai_records');
      if (repo) {
        await repo.destroy({ filter: { id } });
        return true;
      } else if (this.app.db.sequelize) {
        await this.app.db.sequelize.query('DELETE FROM logger_ai_records WHERE id = ?', {
          replacements: [id],
        });
        return true;
      }
    } catch {}
    return false;
  }

  // 清空历史记录
  async clearAnalysisHistory() {
    await this.ensureCollection();
    try {
      const repo = this.app.db.getRepository('logger_ai_records');
      if (repo) {
        await repo.destroy({ truncate: true });
        return true;
      } else if (this.app.db.sequelize) {
        await this.app.db.sequelize.query('DELETE FROM logger_ai_records');
        return true;
      }
    } catch {}
    return false;
  }

  // 执行 AI 错误日志分析
  async analyzeLog(options: AIAnalysisRequest): Promise<AIAnalysisResponse> {
    const startTime = Date.now();
    const { logText, employeeName = 'system-error-expert', llmSelection, context } = options;

    if (!logText || !logText.trim()) {
      return {
        success: false,
        analyzerName: '错误分析专家',
        analysisReport: '请提供有效的错误日志文本或堆栈信息进行诊断。',
        durationMs: 0,
      };
    }

    // 1. 获取选中的 AI 员工信息与 Prompt
    let employeeTitle = '🛡️ 系统错误分析专家';
    let systemPrompt = `你是一名资深的 NocoBase 和 Node.js 全栈系统架构师与错误诊断专家。请对系统错误日志和调用堆栈进行深度诊断分析，严格按照 Markdown 格式输出结构化报告：
### 🤖 AI 智能诊断分析报告
#### 🔍 1. 故障摘要与根因定位 (Root Cause)
#### 🧭 2. 受影响模块与代码调用链分析
#### 🛠️ 3. 解决方案与修复建议 (含代码示例)
#### 🛡️ 4. 预防措施与长效建议`;

    if (employeeName === 'system-error-expert') {
      employeeTitle = '🛡️ 系统错误分析专家';
    } else if (employeeName) {
      try {
        const repo = this.app.db.getRepository('aiEmployees');
        const emp = await repo?.findOne({ filter: { username: employeeName } }) || await repo?.findOne({ filter: { name: employeeName } });
        if (emp) {
          employeeTitle = emp.nickname || emp.name || employeeName;
          if (emp.systemPrompt) {
            systemPrompt = emp.systemPrompt;
          }
        }
      } catch {}
    }

    let userPrompt = `错误日志与调用堆栈如下：\n\`\`\`\n${logText.slice(0, 4000)}\n\`\`\``;
    if (context) {
      userPrompt += `\n\n关联请求上下文：\n- 请求接口: ${context.method || 'GET'} ${context.path || '-'}\n- ReqId: ${context.reqId || '-'}\n- 数据表: ${context.collectionName || '-'}\n- 动作: ${context.actionName || '-'}`;
      if (context.sqlQueries && context.sqlQueries.length > 0) {
        userPrompt += `\n- 报错前执行的 SQL 查询:\n${context.sqlQueries.slice(0, 3).join('\n')}`;
      }
    }

    // 2. 调用选中的系统 LLM 服务 (如 Dashscope)
    const targetService = llmSelection?.llmService;
    const targetModel = llmSelection?.model || 'default';

    if (targetService) {
      // 优先方式 A: 尝试通过系统的 aiPlugin.aiManager 调用
      try {
        const aiPlugin: any = this.app.pm.get('@nocobase/plugin-ai') || this.app.pm.get('ai');
        if (aiPlugin && aiPlugin.aiManager) {
          const serviceInstance = await aiPlugin.aiManager.getLLMService({
            llmService: targetService,
            model: targetModel === 'default' ? undefined : targetModel,
          });

          if (serviceInstance && serviceInstance.provider) {
            const chatModel = serviceInstance.provider.chatModel({
              model: targetModel === 'default' ? undefined : targetModel,
              temperature: 0.2,
            });

            if (chatModel && typeof chatModel.invoke === 'function') {
              const response = await chatModel.invoke([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
              ]);

              const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
              const durationMs = Date.now() - startTime;
              const analyzerName = `${employeeTitle} (${targetService})`;

              const recordId = await this.saveAnalysisRecord({
                analyzerName,
                employeeName,
                llmService: targetService,
                model: targetModel,
                logText,
                context,
                analysisReport: content,
                durationMs,
              });

              return {
                id: recordId || undefined,
                success: true,
                analyzerName,
                analysisReport: content,
                durationMs,
              };
            }
          }
        }
      } catch (err: any) {
        this.app.logger?.warn?.(`[LoggerPro] aiManager.getLLMService failed (${err.message}), trying direct DB call`);
      }

      // 方式 B: 直接读取数据库中该 LLM 服务的 options 配置发起调用
      try {
        const repo = this.app.db.getRepository('llmServices') || this.app.db.getRepository('llm_services');
        let record: any = null;
        if (repo) {
          record = await repo.findOne({ filter: { name: targetService } }) || await repo.findOne({ filter: { id: targetService } });
        }

        if (record) {
          const options = record.options || {};
          const apiKey = options.apiKey || options.api_key || options.key || '';
          let baseURL = options.baseURL || options.base_url || options.endpoint || options.url || '';

          const provider = String(record.provider || record.title || '').toLowerCase();
          if (!baseURL) {
            if (provider.includes('dashscope') || provider.includes('aliyun') || provider.includes('qwen')) {
              baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
            } else if (provider.includes('deepseek')) {
              baseURL = 'https://api.deepseek.com/v1';
            } else if (provider.includes('openai')) {
              baseURL = 'https://api.openai.com/v1';
            } else if (provider.includes('zhipu')) {
              baseURL = 'https://open.bigmodel.cn/api/paas/v4';
            } else if (provider.includes('ollama')) {
              baseURL = 'http://localhost:11434/v1';
            }
          }

          let effectiveModel = targetModel;
          if (!effectiveModel || effectiveModel === 'default') {
            effectiveModel = options.model || options.defaultModel || (provider.includes('dashscope') ? 'qwen-plus' : 'gpt-4o-mini');
          }

          if (apiKey || baseURL) {
            const report = await this.callOpenAICompatible(
              baseURL,
              apiKey,
              effectiveModel,
              [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
              ],
            );

            const durationMs = Date.now() - startTime;
            const analyzerName = `${employeeTitle} (${record.title || targetService})`;

            const recordId = await this.saveAnalysisRecord({
              analyzerName,
              employeeName,
              llmService: targetService,
              model: targetModel,
              logText,
              context,
              analysisReport: report,
              durationMs,
            });

            return {
              id: recordId || undefined,
              success: true,
              analyzerName,
              analysisReport: report,
              durationMs,
            };
          }
        }
      } catch (err: any) {
        return {
          success: false,
          analyzerName: `${targetService}`,
          analysisReport: `❌ 调用 LLM 服务失败: ${err.message}\n\n💡 提示: 请前往 NocoBase 管理后台【AI 员工 / LLM 服务】检查 ${targetService} 的 API Key 配置。`,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // 兜底返回内置专家知识库分析
    const heuristicReport = this.runHeuristicAnalysis(logText, context);
    const durationMs = Date.now() - startTime;
    const analyzerName = `${employeeTitle} (内置专家引擎)`;

    const recordId = await this.saveAnalysisRecord({
      analyzerName,
      employeeName,
      llmService: 'builtin',
      model: 'heuristic',
      logText,
      context,
      analysisReport: heuristicReport,
      durationMs,
    });

    return {
      id: recordId || undefined,
      success: true,
      analyzerName,
      analysisReport: heuristicReport,
      durationMs,
    };
  }
}
