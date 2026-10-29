-- v6：每日流水线（/today）开始逐题落库。
--
-- 背景：answers 表原来只由老听写页在「结算」时批量写，
-- /today 这条线（v5 的每日流水线）一条明细都不写，家长后台只能看到
-- 分段耗时（seg_log）和词级状态（word_state），看不到「今天错了哪几个词」。
--
-- 新流程答一题写一条，所以需要三列：
--   student_id  直接归属到孩子（原来只能靠 session_id 反查，中途退出没 session 行就丢了）
--   day_key     按北京日索引（answers 原来完全没有时间信息）
--   at          作答时刻（毫秒）
--
-- 老数据这三列是 NULL，读的时候按「只有结算数据」处理，不影响既有报表。

ALTER TABLE answers ADD COLUMN student_id TEXT;
ALTER TABLE answers ADD COLUMN day_key TEXT;
ALTER TABLE answers ADD COLUMN at INTEGER;

CREATE INDEX IF NOT EXISTS idx_answers_stu_day ON answers(student_id, day_key, at);
