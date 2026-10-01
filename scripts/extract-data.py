# -*- coding: utf-8 -*-
"""
从旧项目的 _data.json 抽取并归一化词库与任务数据。
产出:
  src/data/words.json   —— 368 个词的词条（词、英释、中释、词性、所属单元、首现天数）
  src/data/tasks.json   —— 48 个听写任务（36 天 + 7 单元 + 5 期末），含逐词时间戳
"""
import json, os, re, sys
from collections import OrderedDict

sys.stdout.reconfigure(encoding='utf-8')

SRC = r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/在线听写/_data.json"
OUT = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation/src/data"
os.makedirs(OUT, exist_ok=True)

data = json.load(open(SRC, encoding='utf-8'))

# ---- 1. 词条归一化 ----
POS_RE = re.compile(r'^(n|v|adj|adv|pron|prep|conj|num|interj|modal v|art|abbr|aux)\.\s*', re.I)

def split_pos(cn: str):
    """把 'n.节目；课程' 拆成 ('n.', '节目；课程')"""
    m = POS_RE.match(cn.strip())
    if m:
        return m.group(1), cn[m.end():].strip()
    return '', cn.strip()

words = OrderedDict()
for task in data:
    for idx, (no, w, cn, st, en) in enumerate(task['wmarks']):
        if w not in words:
            pos, mean = split_pos(cn)
            words[w] = {
                'word': w,
                'pos': pos,
                'cn': mean,
                'cnFull': cn,
                'firstTask': task['id'],
                'dayNo': idx + 1,
            }

# ---- 2. 任务归一化 ----
tasks = []
for t in data:
    kind = t['kind']
    if kind == 'daily':
        # day03 -> 第 3 天
        n = int(re.sub(r'\D', '', t['id']))
        order = n
        group = 'daily'
    elif kind == 'unit':
        n = int(re.sub(r'\D', '', t['id']))
        order = n
        group = 'unit'
    else:  # final
        n = int(re.sub(r'\D', '', t['id']))
        order = n
        group = 'final'

    tasks.append({
        'id': t['id'],
        'kind': kind,
        'group': group,
        'order': order,
        'label': t.get('label', ''),
        'file': t['file'],
        'seconds': t['seconds'],
        'wordCount': len(t['wmarks']),
        'sections': t.get('marks', []),
        # [no, word, cnFull, start, end]
        'items': t['wmarks'],
    })

# ---- 3. 单元归属：单词 -> 单元 ----
# 用 unit 任务的词表反推每词属于哪个单元
word_unit = {}
for t in tasks:
    if t['kind'] == 'unit':
        for _, w, cn, st, en in t['items']:
            word_unit.setdefault(w, t['id'])
for w, rec in words.items():
    rec['unit'] = word_unit.get(w, '')

# ---- 4. 输出 ----
json.dump(list(words.values()),
          open(os.path.join(OUT, 'words.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
json.dump(tasks,
          open(os.path.join(OUT, 'tasks.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)

# ---- 5. 统计 ----
n_unit = sum(1 for t in tasks if t['kind'] == 'unit')
n_daily = sum(1 for t in tasks if t['kind'] == 'daily')
n_final = sum(1 for t in tasks if t['kind'] == 'final')
print(f'词条 {len(words)} 个')
print(f'任务 {len(tasks)} 个（每日 {n_daily} / 单元 {n_unit} / 期末 {n_final}）')
print(f'有单元归属的词: {sum(1 for r in words.values() if r["unit"])}')
print('空闲(未带单元)的词示例:', [w for w, r in words.items() if not r['unit']][:12])
