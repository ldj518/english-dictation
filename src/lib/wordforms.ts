/**
 * 词形变换规则引擎（v3.1）
 * —— 初二卷面「用所给单词的适当形式填空」的对标练习。
 * 规则自动推导答案，句子手工维护（质量比数量重要）。
 */
import { WORD_MAP } from './data'

export type FormKind = 's-3rd' | 'past' | 'ing' | 'plural'

export const KIND_LABEL: Record<FormKind, string> = {
  's-3rd': '第三人称单数',
  past: '过去式',
  ing: '现在分词（-ing）',
  plural: '复数',
}

export interface FormQ {
  word: string
  cn: string
  kind: FormKind
  answer: string
  /** ___ 为答案占位 */
  sentence: string
  sentenceCn: string
  /** 规则说明（判定后展示，讲为什么这么变） */
  ruleNote: string
}

/* ── 不规则过去式（初一常用） ── */
const IRREGULAR_PAST: Record<string, string> = {
  go: 'went', do: 'did', have: 'had', eat: 'ate', see: 'saw', get: 'got',
  come: 'came', take: 'took', make: 'made', buy: 'bought', bring: 'brought',
  think: 'thought', teach: 'taught', catch: 'caught', run: 'ran', sit: 'sat',
  stand: 'stood', swim: 'swam', give: 'gave', write: 'wrote', read: 'read',
  meet: 'met', feel: 'felt', keep: 'kept', sleep: 'slept', tell: 'told',
  say: 'said', find: 'found', know: 'knew', grow: 'grew', fly: 'flew',
  ride: 'rode', sing: 'sang', drink: 'drank', wear: 'wore', speak: 'spoke',
  leave: 'left', lose: 'lost', send: 'sent', spend: 'spent', win: 'won',
  begin: 'began', cut: 'cut', put: 'put', let: 'let', hurt: 'hurt',
}

/* ── 规则判定辅助 ── */

const isVowel = (c: string) => 'aeiou'.includes(c)

/** 以「辅音+元音+辅音」结尾且末字母不是 w/x/y → 需双写（单音节场景） */
function needsDoubling(w: string): boolean {
  if (w.length < 3) return false
  const a = w[w.length - 3], b = w[w.length - 2], c = w[w.length - 1]
  return !isVowel(a) && isVowel(b) && !isVowel(c) && !'wxy'.includes(c)
}

/**
 * 保守的单音节判定：只对 ≤4 字母、不以 en 结尾的词自动判双写
 * （visit/open/listen 这类双音节词靠长度或词尾直接排除，宁缺勿滥——
 * 句库里的多音节双写词如 begin/swim 已在手工表里）。
 */
const isSingleSyllable = (w: string) => w.length <= 4 && !/en$/.test(w)

function yToI(base: string): string { return base.slice(0, -1) + 'i' }

/* ── 四种变换 ── */

export function thirdOf(w: string): { s: string; note: string } | null {
  const w0 = w.toLowerCase()
  if (w0 === 'have') return { s: 'has', note: 'have 的第三人称单数是 has，特殊记' }
  if (/(s|x|z|ch|sh)$/.test(w0)) return { s: w0 + 'es', note: '以 s/x/z/ch/sh 结尾，加 -es' }
  if (/[^aeiou]y$/.test(w0)) return { s: yToI(w0) + 'es', note: '「辅音字母+y」结尾，变 y 为 i 加 -es' }
  return { s: w0 + 's', note: '一般直接加 -s' }
}

export function pastOf(w: string): { s: string; note: string } | null {
  const w0 = w.toLowerCase()
  if (IRREGULAR_PAST[w0]) return { s: IRREGULAR_PAST[w0], note: '不规则变化，要单独记' }
  if (/e$/.test(w0)) return { s: w0 + 'd', note: '以 e 结尾，直接加 -d' }
  if (/[^aeiou]y$/.test(w0)) return { s: yToI(w0) + 'ed', note: '「辅音字母+y」结尾，变 y 为 i 加 -ed' }
  const dbl = (isSingleSyllable(w0) || ['stop', 'plan', 'drop', 'regret', 'admit'].includes(w0)) && needsDoubling(w0)
  if (dbl) return { s: w0 + w0[w0.length - 1] + 'ed', note: '重读闭音节结尾，双写末字母再加 -ed' }
  return { s: w0 + 'ed', note: '一般直接加 -ed' }
}

export function ingOf(w: string): { s: string; note: string } | null {
  const w0 = w.toLowerCase()
  if (/ie$/.test(w0)) return { s: w0.slice(0, -2) + 'ying', note: '以 ie 结尾，变 ie 为 y 加 -ing' }
  if (/[^e]e$/.test(w0)) return { s: w0.slice(0, -1) + 'ing', note: '以不发音的 e 结尾，去 e 加 -ing' }
  const dbl = (isSingleSyllable(w0) || ['begin', 'swim', 'forget'].includes(w0)) && needsDoubling(w0)
  if (dbl) return { s: w0 + w0[w0.length - 1] + 'ing', note: '重读闭音节结尾，双写末字母再加 -ing' }
  return { s: w0 + 'ing', note: '一般直接加 -ing' }
}

export function pluralOf(w: string): { s: string; note: string } | null {
  const w0 = w.toLowerCase()
  const F_VES: Record<string, string> = { leaf: 'leaves', shelf: 'shelves', half: 'halves', scarf: 'scarves' }
  if (/fe$/.test(w0)) return { s: w0.slice(0, -2) + 'ves', note: '以 fe 结尾，变 fe 为 ves' }
  if (F_VES[w0]) return { s: F_VES[w0], note: '以 f 结尾的 special 词，变 f 为 ves' }
  if (/(s|x|z|ch|sh)$/.test(w0)) return { s: w0 + 'es', note: '以 s/x/z/ch/sh 结尾，加 -es' }
  if (/[^aeiou]y$/.test(w0)) return { s: yToI(w0) + 'es', note: '「辅音字母+y」结尾，变 y 为 i 加 -es' }
  return { s: w0 + 's', note: '一般直接加 -s' }
}

function transform(w: string, kind: FormKind): { s: string; note: string } | null {
  if (kind === 's-3rd') return thirdOf(w)
  if (kind === 'past') return pastOf(w)
  if (kind === 'ing') return ingOf(w)
  return pluralOf(w)
}

/* ── 手工句库：word → { kind: [句子, 中文] } ──
 * 句子里 ___ 是答案位。只给词库里真实存在且常用的词配句。 */

export const FORM_SENTENCES: Record<string, Partial<Record<FormKind, [string, string]>>> = {
  /* 动词 */
  watch: { 's-3rd': ['She ___ TV with her grandma every evening.', '她每天晚上和奶奶一起看电视。'], plural: ['My father has two ___. One is new.', '我爸爸有两块手表，一块是新的。'] },
  play: { 's-3rd': ['He ___ soccer with his classmates after school.', '他放学后和同学踢足球。'], ing: ['Look! The boys ___ basketball on the playground.', '看！男孩们正在操场上打篮球。'] },
  study: { 's-3rd': ['My cousin ___ English for half an hour every day.', '我表弟每天学半小时英语。'], past: ['We ___ hard for the exam last term.', '上学期我们为考试努力学习了。'] },
  go: { 's-3rd': ['My father ___ to work by bus every day.', '我爸爸每天坐公交车上班。'], past: ['We ___ to the park last Sunday.', '上周日我们去了公园。'] },
  do: { 's-3rd': ['He ___ his homework right after dinner.', '他晚饭后马上做作业。'], past: ['What ___ you do last weekend?', '上周末你做什么了？'] },
  have: { 's-3rd': ['She ___ breakfast at seven every morning.', '她每天早上七点吃早饭。'], past: ['They ___ a good time at the party last night.', '昨晚他们在聚会上玩得很开心。'] },
  get: { 's-3rd': ['The shop ___ up at eight in the morning.', '那家店早上八点开门。'], past: ['He ___ up late this morning, so he missed the bus.', '他今早起晚了，所以没赶上公交。'], ing: ['Hurry up! The bus ___ colder and colder.', '快点！车里越来越冷了。'] },
  eat: { past: ['I ___ two eggs and some milk for breakfast this morning.', '今天早饭我吃了两个鸡蛋，喝了些牛奶。'] },
  read: { 's-3rd': ['Lily ___ English aloud every morning.', '莉莉每天早上大声读英语。'], past: ['I ___ an interesting book last night.', '昨晚我读了一本有趣的书。'] },
  write: { past: ['He ___ a letter to his pen pal last month.', '上个月他给笔友写了一封信。'], ing: ['Be quiet! Dad ___ something important.', '安静！爸爸在写重要的东西。'] },
  sing: { ing: ['Listen! Someone ___ in the music room.', '听！有人在音乐室里唱歌。'] },
  dance: { ing: ['The girls ___ on the stage now.', '女孩们正在台上跳舞。'], past: ['She ___ with her friends at the party yesterday.', '昨天她在聚会上和朋友们跳舞了。'] },
  swim: { ing: ['They ___ in the river to cool off.', '他们正在河里游泳乘凉。'] },
  run: { ing: ['Look! The little dog ___ after the ball.', '看！小狗正追着球跑。'], past: ['He ___ to school because he got up late.', '他跑着去上学，因为起晚了。'] },
  stop: { past: ['The bus ___ at the next station.', '公交车在下一站停了下来。'], ing: ['It ___ raining an hour ago.', '雨一小时前停了。'] },
  sit: { ing: ['Grandpa ___ in the sun and tells us stories.', '爷爷坐在阳光下给我们讲故事。'] },
  live: { 's-3rd': ['My uncle ___ in a small town near the sea.', '我叔叔住在海边的一个小镇上。'] },
  like: { 's-3rd': ['Everyone ___ her because she is kind.', '人人都喜欢她，因为她善良。'] },
  want: { 's-3rd': ['The little boy ___ to be a pilot.', '小男孩想当飞行员。'] },
  walk: { past: ['We ___ home after the movie yesterday.', '昨天看完电影我们步行回家。'] },
  visit: { past: ['She ___ her grandparents in the countryside last summer.', '去年夏天她去乡下看望了爷爷奶奶。'] },
  help: { past: ['He ___ his mother clean the house last weekend.', '上周末他帮妈妈打扫了房子。'] },
  call: { past: ['I ___ you twice, but you did not answer.', '我给你打了两次电话，但你没接。'] },
  use: { past: ['People ___ to send letters, but now they use email.', '人们过去寄信，现在用电子邮件。'] },
  hope: { past: ['We ___ to see you again soon.', '我们希望很快再见到你。'] },
  teach: { 's-3rd': ['Miss Li ___ us English this term.', '李老师这学期教我们英语。'] },
  fly: { ing: ['The children ___ kites in the field now.', '孩子们正在地里放风筝。'] },
  rain: { ing: ['Take an umbrella. It ___ hard outside.', '带把伞，外面雨下得很大。'] },
  talk: { past: ['They ___ about the football game all night.', '他们聊了一整晚足球比赛。'] },
  look: { ing: ['The kids ___ forward to the school trip.', '孩子们正盼着学校组织的旅行。'] },
  buy: { past: ['Mom ___ a new schoolbag for me yesterday.', '妈妈昨天给我买了个新书包。'] },
  bring: { past: ['He ___ some flowers to his teacher on Teachers Day.', '教师节那天他给老师带了些花。'] },
  see: { past: ['I ___ a bird with beautiful feathers this morning.', '今天早上我看见一只羽毛漂亮的鸟。'] },
  come: { past: ['She ___ to see me the day before yesterday.', '她前天来看我了。'] },
  take: { past: ['Dad ___ us to the museum last Friday.', '爸爸上周五带我们去了博物馆。'] },
  give: { past: ['My friend ___ me a birthday card last week.', '上周朋友给了我一人生日贺卡。'] },
  make: { past: ['We ___ a big cake for Grandmas birthday.', '我们为奶奶的生日做了一个大蛋糕。'] },
  know: { past: ['I ___ the answer, but I was afraid to speak.', '我知道答案，但不敢说。'] },
  find: { past: ['She ___ her keys under the sofa.', '她在沙发底下找到了钥匙。'] },
  tell: { past: ['Grandma ___ us an interesting story last night.', '奶奶昨晚给我们讲了个有趣的故事。'] },
  speak: { past: ['He ___ loudly at the meeting yesterday.', '昨天他在会上大声发言。'] },
  feel: { past: ['I ___ much better after a good rest.', '好好休息后我感觉好多了。'] },
  keep: { past: ['She ___ working until midnight.', '她一直工作到半夜。'] },
  begin: { past: ['The movie ___ at seven thirty.', '电影七点半开始。'] },
  wear: { past: ['He ___ his new coat to the party.', '他穿着新外套去参加聚会。'] },
  leave: { past: ['The train ___ ten minutes ago.', '火车十分钟前开走了。'] },
  meet: { past: ['I ___ an old friend on my way home.', '回家路上我遇到一位老朋友。'] },
  think: { past: ['I ___ about your idea all night.', '我整晚都在想你的主意。'] },
  /* 名词复数 */
  box: { plural: ['There are three ___ of books under the desk.', '书桌下面有三箱书。'] },
  class: { plural: ['There are forty-five ___ in our grade.', '我们年级有四十五个班。'] },
  bus: { plural: ['Two ___ stopped at the gate just now.', '刚才有两辆公交车停在大门口。'] },
  baby: { plural: ['The hospital takes care of fifty ___ every month.', '这家医院每个月照看五十个婴儿。'] },
  family: { plural: ['Six ___ live in this building.', '有六户人家住在这栋楼里。'] },
  library: { plural: ['Our city has three big ___ now.', '我们市现在有三个大图书馆。'] },
  city: { plural: ['Qingdao and Xiamen are beautiful ___.', '青岛和厦门是漂亮的城市。'] },
  story: { plural: ['Grandpa often tells us funny ___.', '爷爷常给我们讲有趣的故事。'] },
  country: { plural: ['People from different ___ came to the show.', '来自不同国家的人来看了演出。'] },
  knife: { plural: ['Be careful with those ___. They are sharp.', '小心那些刀，很锋利。'] },
  leaf: { plural: ['The wind blows the ___ off the trees.', '风把树叶从树上吹落。'] },
  tomato: { plural: ['She bought three ___ and some eggs.', '她买了三个西红柿和一些鸡蛋。'] },
  potato: { plural: ['We need two ___ for the soup.', '我们做汤需要两个土豆。'] },
  child: { plural: ['Three ___ are playing games in the yard.', '三个孩子正在院子里玩游戏。'] },
}

/* ── 出题 ── */

export interface FormItem {
  word: string
  cn: string
  kinds: FormKind[]
}

/** 词库里有哪些词能出形态题（有句子的） */
export function availableForms(words: { word: string; cn: string }[]): FormItem[] {
  const out: FormItem[] = []
  for (const w of words) {
    const sent = FORM_SENTENCES[w.word.toLowerCase()]
    if (!sent) continue
    const kinds = (Object.keys(sent) as FormKind[]).filter(k => sent[k])
    if (kinds.length) out.push({ word: w.word, cn: w.cn, kinds })
  }
  return out
}

/**
 * 句库全量出题源：词形变换考的是语法规则，不依赖听写词库进度。
 * 词的中文释义能从词库查到就带上，查不到留空（句子中文已给足语境）。
 */
export function allFormItems(): FormItem[] {
  const out: FormItem[] = []
  for (const [word, kinds] of Object.entries(FORM_SENTENCES)) {
    const list = (Object.keys(kinds) as FormKind[]).filter(k => kinds[k])
    if (!list.length) continue
    out.push({ word, cn: WORD_MAP[word]?.cn || '', kinds: list })
  }
  return out
}

/** 生成一道题：按 word+kind 稳定出题（同词同型不出第二种答案） */
export function makeFormQ(item: FormItem, kind: FormKind): FormQ | null {
  const pair = FORM_SENTENCES[item.word.toLowerCase()]?.[kind]
  const t = transform(item.word, kind)
  if (!pair || !t) return null
  return {
    word: item.word,
    cn: item.cn,
    kind,
    answer: t.s,
    sentence: pair[0],
    sentenceCn: pair[1],
    ruleNote: t.note,
  }
}

/** 判定（宽松：忽略首尾空格与大小写） */
export function judgeForm(input: string, q: FormQ): boolean {
  return input.trim().toLowerCase() === q.answer.toLowerCase()
}
