-- v5：补齐方案 08 节缺的 5 张表（v4 只建了 word_state / day_log）
-- 全部 CREATE IF NOT EXISTS，可重复执行；不改老表结构。

-- ① 一次测验的抬头（单元闸门 / 周测 / 月考）
CREATE TABLE IF NOT EXISTS test_runs (
  id          TEXT PRIMARY KEY,          -- `${studentId}-${kind}-${unit||''}-${dayKey}-${at}`
  student_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,             -- gate（单元闸门）/ week（周测）/ month（月考）
  unit        TEXT,                      -- 单元闸门才有
  day_key     TEXT NOT NULL,             -- 北京日
  total       INTEGER DEFAULT 0,
  right_n     INTEGER DEFAULT 0,         -- 首答正确（不含看答案）
  peek_n      INTEGER DEFAULT 0,
  score       INTEGER DEFAULT 0,         -- 首答对 ÷ (总题 - 看答案题)
  pass        INTEGER DEFAULT 0,         -- 1 通过 / 0 未通过
  pass_line   INTEGER DEFAULT 80,        -- 当次用的通过线
  attempt     INTEGER DEFAULT 1,         -- 第几次考（补丁期内重考递增）
  patch_until TEXT,                      -- 未通过 → 补丁期结束日
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tr_stu ON test_runs(student_id, day_key);
CREATE INDEX IF NOT EXISTS idx_tr_unit ON test_runs(student_id, unit);

-- ② 测验逐题
CREATE TABLE IF NOT EXISTS test_items (
  run_id   TEXT NOT NULL,
  no       INTEGER NOT NULL,
  word     TEXT NOT NULL,
  qkind    TEXT,                         -- spell / pick / sent / paper
  correct  INTEGER DEFAULT 0,
  peek     INTEGER DEFAULT 0,
  ms       INTEGER DEFAULT 0,
  fast     INTEGER DEFAULT 0,
  PRIMARY KEY (run_id, no)
);

-- ③ 每天算出来的计划快照（家长问「当时为什么只排 4 段」时看它）
CREATE TABLE IF NOT EXISTS day_plan (
  student_id  TEXT NOT NULL,
  day_key     TEXT NOT NULL,
  tier        TEXT,
  min_min     REAL DEFAULT 0,
  max_min     REAL DEFAULT 0,
  target_q    INTEGER DEFAULT 0,
  due_n       INTEGER DEFAULT 0,
  new_n       INTEGER DEFAULT 0,
  per_item_sec INTEGER DEFAULT 20,
  ramp_week   INTEGER DEFAULT 2,
  segs        TEXT,                      -- JSON: PlanSeg[]
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (student_id, day_key)
);

-- ④ 分段进入/离开（看孩子卡在哪一段）
CREATE TABLE IF NOT EXISTS seg_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL,
  day_key    TEXT NOT NULL,
  seg_index  INTEGER NOT NULL,
  seg_kind   TEXT,
  enter_at   INTEGER DEFAULT 0,
  leave_at   INTEGER DEFAULT 0,
  q_n        INTEGER DEFAULT 0,
  right_n    INTEGER DEFAULT 0,
  peek_n     INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sl_day ON seg_log(student_id, day_key);

-- ⑤ 战报归档（微信转发/回看）
CREATE TABLE IF NOT EXISTS report_out (
  student_id TEXT NOT NULL,
  day_key    TEXT NOT NULL,
  text       TEXT,                       -- 可直接复制到微信的六块纯文本
  payload    TEXT,                       -- JSON：六块结构化数据
  created_at INTEGER NOT NULL,
  PRIMARY KEY (student_id, day_key)
);
