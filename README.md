# 在线英语听写学习系统

鲁教版（五四学制）七年级上册英语单词听写 Web 应用。
**368 词 · 48 个听写任务 · 96kbps 高保真音频（已消除旧版底噪）**

---

## 一句话定位

孩子拿手机打开就能自己听写，不用家长在旁边念；家长看分数和错词就知道哪里要补。

---

## 功能

| 模块 | 说明 |
|---|---|
| **听写引擎** | 逐词播放（可配 1–3 遍）、0.75×–1.15× 变速、上下题跳转、即时判分、中文提示（先听后看，防泄题） |
| **错词本 + 遗忘曲线** | 答错自动入本，按 1→2→4→7→15→30 天排复习；连续答对到满级自动毕业消失 |
| **期末模考** | 单元/期末整卷模式：全部答完统一判分、全程计时、题号导航、成绩单 |
| **游戏化** | 14 个成就徽章、8 级等级体系、积分、连续打卡、连击奖励 |
| **学习统计** | 14 天时长柱状图、成绩曲线、完成进度、历史记录 |
| **词库浏览** | 368 词可按单元筛选、中英双向搜索、一键朗读 |

---

## 技术栈

- **前端**：React 18 + TypeScript + Vite（纯静态 SPA，无后端）
- **数据**：词库/任务内置为 JSON；学习记录存 localStorage
- **音频**：Cloudflare R2（96kbps 单声道 MP3）+ Web Speech API 兜底
- **部署**：GitHub → Cloudflare Pages 自动构建

---

## 音频链路（重点：为什么没有杂音）

旧版杂音的根因已定位并用实测数据确认：

| 重编码码率 | 体积（373 秒单轨） | SNR | 听感 |
|---|---|---|---|
| 32 kbps | 1.43 MB | 13.7 dB | **持续沙沙底噪** ← 用户投诉的那版 |
| 48 kbps | — | — | 仍可感知 |
| **96 kbps（现用）** | 4.28 MB | **24.4 dB** | 干净 |
| 128 kbps | 5.70 MB | 25.5 dB | 收益趋平 |

静音窗噪声中位数实测为 0 → 噪声全部集中在人声里，正是「电流杂音」的来源。

**现用方案**：单声道 / 24 kHz / 96 kbps，经过去直流 → 裁首尾静音 → 10ms 余弦淡入淡出 → 峰值归一化到 −1.4 dBFS → **只编码一次**。

---

## 目录结构

```
english-dictation/
├── src/
│   ├── data/           words.json（368词）· tasks.json（48任务，含逐词时间戳）
│   ├── lib/
│   │   ├── assets.ts   音频地址（VITE_AUDIO_BASE 注入）
│   │   ├── data.ts     任务/词库加载
│   │   ├── player.ts   播放器（R2 音频 + Web Speech 兜底）
│   │   ├── storage.ts  判分 · 遗忘曲线 · 本地存储
│   │   ├── gamify.ts   积分 · 徽章 · 等级
│   │   └── store.tsx   全局状态
│   ├── pages/          Home · Dictation · Exam · Review · Words · Stats · Settings
│   └── components/     Shell（顶栏 + 底部导航）
├── public/audio/       本地音频（tracks/ words/ manifest.json，不进 git）
└── scripts/
    ├── extract-data.py   从旧项目抽取词库与任务
    ├── build-audio.py    生成逐词 + 整轨高保真音频
    ├── upload-r2.py      上传音频到 Cloudflare R2
    ├── logic-test.ts     核心逻辑单测（判分/遗忘曲线/积分/数据）
    ├── smoke.tsx         页面渲染冒烟测试
    └── test.sh           统一测试入口
```

---

## 本地开发

```bash
npm install
npm run dev          # http://localhost:5173
```

音频本地化（可选，不用 R2 时）：

```bash
python scripts/build-audio.py     # 生成到 public/audio/
```

---

## 测试

```bash
bash scripts/test.sh
```

覆盖：判分规则（9 项）、遗忘曲线（7 项）、积分徽章（9 项）、数据完整性（12 项）、页面渲染（7 项）。

---

## 部署

### 环境变量（Cloudflare Pages 构建时注入）

| 变量 | 说明 |
|---|---|
| `VITE_AUDIO_BASE` | 音频基础地址，如 `https://pub-xxx.r2.dev/` |

### 构建配置

- 构建命令：`npm run build`
- 输出目录：`dist`
- Node 版本：18+

### 重新上传音频

```bash
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
export R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
python scripts/upload-r2.py
```

---

## 设计原则

1. **防泄题优先**：答题时不显示英文；中文提示需主动点击才出现。
2. **分数照实算**：不美化、不隐藏低分，低分才知道要补什么。
3. **错词自动闭环**：不用手动整理错题，系统按遗忘曲线推送。
4. **零注册**：打开即用，记录存本地，支持导出/导入备份。
5. **密钥永不入库**：凭证只走环境变量。
