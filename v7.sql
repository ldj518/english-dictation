-- v7：answers 加题型列，家长后台按题型看正确率。
--
-- 为什么需要：
--   v6 已经把逐题记录落库了（含 word/correct/peek/fast/ms），
--   但没有「这道题是什么题型」。于是家长只能看到一个总分 62%，
--   看不到「拼写 32% / 选义 78%」——而这两件事的学习含义完全相反：
--   选义高是「认得」，拼写低是「写不出」，英语 20-30 分的孩子病根在后一个。
--   2026-10-29 上线拼写分级后，这一列更是唯一的验证手段：
--   分级到底有没有把拼写正确率抬起来，只能按 kind 切开看。
--
-- 取值：flash/teach（不判分，一般不会写进来）/
--       pick（听音选义）/ spell（拼写）/ sent（句子拼装）/
--       mean（句意选择）/ paper（纸笔默写）
--
-- 老数据这一列是 NULL，读的时候归到「早期（未分型）」，不影响既有统计。

ALTER TABLE answers ADD COLUMN kind TEXT;

CREATE INDEX IF NOT EXISTS idx_answers_stu_day_kind ON answers(student_id, day_key, kind);
