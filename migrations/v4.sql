-- ═══════════════════════════════════════════════════════════
-- v4 迁移：词级记忆调度 + 每日会话账本
--
-- 原则（三条，都不能破）：
--  ① 只 ADD / CREATE，不 DROP、不改列、不删数据
--  ② 安卓库一个字不动（这是 Web 库 english-dictation-db 专用）
--  ③ 老表 sessions / answers / daily_stats 原样保留，历史一条不重算
--
-- 执行：
--   wrangler d1 execute english-dictation-db --remote --file=migrations/v4.sql
-- ═══════════════════════════════════════════════════════════

-- ── 词级记忆强度：日队列的唯一来源 ──
-- S 是连续量（天），取代老的固定档位 [1,2,4,7,15,30]。
-- 老档位下「错 20 次」和「错 1 次」对系统是同一件事，这就是
-- look forward to 卡在 stage 0 二十天出不去的根因。
CREATE TABLE IF NOT EXISTS word_state (
  student_id  TEXT NOT NULL,
  word        TEXT NOT NULL,
  s           REAL    DEFAULT 1,     -- 记忆强度（天）
  due_day     TEXT,                  -- 下次到期日 yyyy-mm-dd（北京时区）
  lapses      INTEGER DEFAULT 0,     -- 累计答错次数，≥4 进钉子词
  streak      INTEGER DEFAULT 0,     -- 连续无提示答对次数
  master      INTEGER DEFAULT 0,     -- 0 学习中 / 1 已掌握 / 2 已毕业
  ok_n        INTEGER DEFAULT 0,     -- 累计答对
  all_n       INTEGER DEFAULT 0,     -- 累计作答
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (student_id, word)
);
CREATE INDEX IF NOT EXISTS idx_ws_due  ON word_state(student_id, due_day);
CREATE INDEX IF NOT EXISTS idx_ws_master ON word_state(student_id, master);

-- ── 每日会话账本：战报、家长后台、「今天为什么只有 4 段」都读它 ──
CREATE TABLE IF NOT EXISTS day_log (
  student_id  TEXT NOT NULL,
  day_key     TEXT NOT NULL,         -- 北京时区日期
  tier        TEXT,                  -- normal/settle/recover/restart/sat/sun
  eff_sec     INTEGER DEFAULT 0,     -- 有效学习秒数（相邻操作间隔 ≤60s 才累加）
  idle_sec    INTEGER DEFAULT 0,     -- 挂机秒数（家长看「有效/挂机」比）
  must_done   INTEGER DEFAULT 0,
  must_total  INTEGER DEFAULT 0,
  q_n         INTEGER DEFAULT 0,     -- 作答题数
  right_n     INTEGER DEFAULT 0,     -- 首答正确数
  peek_n      INTEGER DEFAULT 0,     -- 看答案题数（不进分母）
  done        INTEGER DEFAULT 0,     -- 双闸门是否通过
  segs        TEXT,                  -- JSON: [{k,label,min,q,right}]
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (student_id, day_key)
);
CREATE INDEX IF NOT EXISTS idx_dl_day ON day_log(student_id, day_key);

-- ── 老表加列（全部可空，先加不写，新代码逐步填）──
-- sessions：分数口径改成「首答对 ÷ (总题 - peek题)」，需要分开存
ALTER TABLE sessions ADD COLUMN first_right INTEGER;
ALTER TABLE sessions ADD COLUMN peek_n INTEGER;
ALTER TABLE sessions ADD COLUMN eff_sec INTEGER;
ALTER TABLE sessions ADD COLUMN tier TEXT;

-- answers：单题耗时/尝试次数/是否看答案/是否速答
ALTER TABLE answers ADD COLUMN ms INTEGER;
ALTER TABLE answers ADD COLUMN attempts INTEGER;
ALTER TABLE answers ADD COLUMN peek INTEGER;
ALTER TABLE answers ADD COLUMN fast INTEGER;

-- daily_stats：有效时间与账本关联
ALTER TABLE daily_stats ADD COLUMN eff_sec INTEGER;

-- ── 后台配置（与 parent_rules 分开存：整体替换语义会抹字段，已踩过两次）──
-- app_settings 里新增两个 key：
--   study_config = {"minMinWork":30,"minMinWeekend":60,"newWordCap":6,...}
--   plan_state   = {"cutoverDay":"2026-11-02",...}
-- 不需要建表，沿用 app_settings(key, value)
