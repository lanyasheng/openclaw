# Human-Gate Message 薄接线实现报告

**任务**: Task 1 - `human-gate -> message` 薄接线  
**日期**: 2026-03-19  
**状态**: ✅ 完成 (最小闭环)

---

## 设计摘要

### 改动范围
- **新增文件**: 4 个 (src/infra/human-gate-*.ts)
- **修改文件**: 0 个 (隔离 worktree 中工作，不影响主分支)
- **核心功能**:
  1. 统一 decision payload 类型定义
  2. message 路径薄接线 adapter
  3. 最小单元测试

### 风险点
- **低**: 只在独立 worktree 分支中实现，不影响主分支
- **低**: 没有修改现有 approval registry 或 exec 审批流
- **中**: 需要与真实 message 通道集成 (下一步)

### 回退方案
- 整个实现在独立分支 `feat/human-gate-message-thin`
- 可直接丢弃 worktree 或 reset 分支，零影响

---

## 实现内容

### 1. Decision Payload 契约 (`human-gate-types.ts`)

```typescript
interface HumanGateDecisionPayload {
  decision_id: string;      // 决定事件 ID (幂等去重)
  task_id: string;          // Join key (对齐 minimal task registry)
  resume_token?: string;    // approve 路径恢复用
  verdict: "approve" | "reject" | "timeout" | "withdraw";
  source: {
    transport: "message" | "browser" | "file";
    ref: string;            // 消息 ID / 页面 URL / 文件路径
  };
  actor: {
    id: string;             // 决定者 ID (timeout 时=system)
    name?: string;
  };
  decided_at: string;       // ISO 8601 时间戳
  reason?: string;          // 可选原因
}
```

**关键设计决策**:
- `task_id` 作唯一 join key，不新增第二套 approval registry
- 细节进 `evidence.human_gate.request/decision`
- verdict 统一四态：approve/reject/timeout/withdraw

### 2. Message Adapter (`human-gate-message-adapter.ts`)

**核心 API**:
```typescript
class HumanGateMessageAdapter {
  // 注册审批请求 (发起审批时调用)
  registerRequest(params: {
    task_id: string;
    resume_token: string;
    timeout_ms: number;
  }): void;

  // 处理消息决定 (收到按钮点击/回复时调用)
  processMessageDecision(input: MessageDecisionInput): {
    success: true; payload: HumanGateDecisionPayload;
  } | { success: false; error: string; };

  // 检查超时请求
  checkTimeouts(): string[];

  // 生成超时决定
  generateTimeoutDecision(task_id: string): {...};
}
```

**关键特性**:
- 内存态 pending requests (task_id -> resume_token + expires_at)
- resume_token 校验防止误操作
- 超时自动检测
- 无持久化存储 (符合最薄闭环目标)

### 3. 单元测试 (`human-gate-message-adapter.test.ts`)

**覆盖场景**:
- ✅ Payload 验证 (合法/非法输入)
- ✅ Message 决定处理 (approve/reject/withdraw)
- ✅ resume_token 匹配校验
- ✅ 未知 task_id 拒绝
- ✅ 超时检测
- ✅ 超时决定生成

---

## 交付物清单

| 文件 | 行数 | 说明 |
|------|------|------|
| `src/infra/human-gate-types.ts` | 169 | Decision payload 类型定义 + 验证函数 |
| `src/infra/human-gate-message-adapter.ts` | 247 | Message adapter 实现 |
| `src/infra/human-gate-message-adapter.test.ts` | 313 | 单元测试 |
| `src/infra/human-gate.ts` | 10 | 模块导出 |
| **合计** | **739** | |

---

## 测试结果

**TypeScript 类型检查**: ✅ 通过
```
npx tsc --noEmit --skipLibCheck src/infra/human-gate-*.ts
(no output = no errors)
```

**单元测试**: ⚠️ 待运行 (worktree 无 node_modules，需集成到主 repo 测试套件)

---

## Worktree 信息

- **路径**: `/tmp/oc-human-gate-msg-20260319`
- **分支**: `feat/human-gate-message-thin`
- **Commit**: `e9780642a`
- **父 commit**: `573f2748d fix(acp): evict dormant oneshot runtimes under pressure`
- **远程**: `git@github.com:openclawbugfix/openclaw.git` (openclawbugfix 主仓)

---

## 下一步建议

### 立即行动
1. **集成测试**: 将 worktree 改动 merge 到主分支，运行完整测试套件
2. **Message 通道集成**: 在 Discord/Slack message handler 中添加 human-gate 入口
3. **审批消息发送**: 实现 `sendApprovalMessage()` 函数，发出带按钮的审批消息

### 后续迭代 (P1)
1. **Browser 路径**: 复用同一 decision payload，实现浏览器审批页
2. **持久化**: 将 pending requests 写入 KV 存储 (当前是内存态)
3. **状态机集成**: 与 Lobster/runtime 状态机对接 (approve → resume)

---

## 对齐 Proposal 契约

| Proposal 要求 | 实现状态 |
|--------------|----------|
| 统一 decision payload | ✅ `HumanGateDecisionPayload` |
| task_id 作 join key | ✅ 唯一主键 |
| 不新增 approval registry | ✅ 只用内存态 pending map |
| evidence.human_gate 结构 | ✅ `request` + `decision` 两段 |
| verdict 四态 | ✅ approve/reject/timeout/withdraw |
| source.transport | ✅ message/browser/file |
| actor.id | ✅ 支持 user 和 system |
| 最薄闭环 | ✅ 739 行，4 文件，0 外部依赖 |

---

## 风险与限制

### 当前限制
1. **内存态**: pending requests 重启后丢失 (P1 需持久化)
2. **无真实消息集成**: 只实现 adapter，未接 Discord/Slack 真实消息流
3. **无 browser 路径**: 只实现 message 路径 (符合 Task 1 范围)

### 已知风险
1. **并发安全**: 内存态 map 无锁 (单进程安全)
2. **超时精度**: 依赖 `checkTimeouts()` 轮询 (非精确计时器)

---

**报告生成**: 2026-03-19T17:XX:XX+08:00  
**作者**: Zoe (CTO & Chief Orchestrator)  
**审核状态**: 待老板验收
