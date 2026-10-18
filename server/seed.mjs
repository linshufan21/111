// 演示数据：9 个用户、14 个问题、约 100 张票与理由。
// 用法: node server/seed.mjs [--force]
import { randomUUID } from 'node:crypto'
import { createDb } from './db.mjs'
import { hashPassword } from './auth.mjs'

const db = createDb()
const force = process.argv.includes('--force')
const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
if (existing > 0 && !force) {
  console.log(`[seed] 已有 ${existing} 个用户，跳过。需要重置请加 --force`)
  process.exit(0)
}
if (force) {
  db.exec(
    'DELETE FROM votes; DELETE FROM reports; DELETE FROM notifications; DELETE FROM questions; DELETE FROM auth_tokens; DELETE FROM audit_logs; DELETE FROM sessions; DELETE FROM users;',
  )
}

const now = Date.now()
const iso = (hoursAgo) => new Date(now - hoursAgo * 3600_000).toISOString()
const future = (hours) => new Date(now + hours * 3600_000).toISOString()

const users = [
  { username: 'admin', email: 'admin@dajia.local', hue: 0, role: 'admin' },
  { username: 'demo', email: 'demo@dajia.local', hue: 12 },
  { username: '林小满', email: 'xiaoman@dajia.local', hue: 148 },
  { username: '阿哲', email: 'azhe@dajia.local', hue: 210 },
  { username: '桃子', email: 'taozi@dajia.local', hue: 330 },
  { username: '老周', email: 'laozhou@dajia.local', hue: 36 },
  { username: 'Mia', email: 'mia@dajia.local', hue: 268 },
  { username: '阿禾', email: 'ahe@dajia.local', hue: 92 },
  { username: '迟到大王', email: 'late@dajia.local', hue: 190 },
]

const userIds = {}
for (const u of users) {
  const id = randomUUID()
  userIds[u.username] = id
  const { hash, salt } = hashPassword(u.role === 'admin' ? 'admin1234' : 'demo1234')
  const createdAt = iso(240 + Math.random() * 240)
  db.prepare(
    `INSERT INTO users
       (id, username, email, password_hash, salt, avatar_hue, role, status, email_verified_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run(id, u.username, u.email, hash, salt, u.hue, u.role ?? 'user', createdAt, createdAt)
}

const questions = [
  {
    title: '我要不要买 iPhone 18？',
    description: '手上的 13 还能用，但电池一天两充。新机 7999，分期免息。',
    category: '消费', hours: 3, closes: 96, anonymous: false, author: '林小满', featured: true,
  },
  {
    title: '该不该辞掉稳定工作，去做独立开发？',
    description: '存款够撑 10 个月，手上有一个副业项目每月能赚 3000。',
    category: '工作', hours: 8, closes: 168, anonymous: false, author: '阿哲',
  },
  {
    title: '周末要不要去爬泰山看日出？',
    description: '天气预报多云，同行朋友临时放鸽子，一个人去有点犹豫。',
    category: '生活', hours: 12, closes: 48, anonymous: false, author: '桃子',
  },
  {
    title: '要不要再养一只猫，给现在的猫作伴？',
    description: '现在这只两岁，白天独自在家。怕它应激，也怕自己照顾不过来。',
    category: '生活', hours: 20, closes: 120, anonymous: true, author: '阿禾',
  },
  {
    title: '30 岁要不要辞职去读全日制研究生？',
    description: '考上了但需要脱产两年，毕业后大概率转行。',
    category: '工作', hours: 26, closes: 240, anonymous: false, author: '老周', featured: true,
  },
  {
    title: '要不要为了异地恋搬到对方的城市？',
    description: '在一起三年，对方城市有更好的机会，但我要重新找工作。',
    category: '关系', hours: 30, closes: 168, anonymous: false, author: 'Mia',
  },
  {
    title: '要不要花两万块报一个摄影进阶课？',
    description: '老师作品很喜欢，但课程周期半年，周末基本被占满。',
    category: '消费', hours: 36, closes: 120, anonymous: false, author: '桃子',
  },
  {
    title: '要不要把存款的一半拿去买指数基金？',
    description: '目前全放定期，利率太低；又怕现在位置太高。',
    category: '消费', hours: 44, closes: 200, anonymous: true, author: '阿哲',
  },
  {
    title: '该不该在家庭聚会上坦白自己已经辞职？',
    description: '爸妈一直以为我还在原公司，瞒了两个月，越拖越难开口。',
    category: '关系', hours: 52, closes: 72, anonymous: false, author: '迟到大王',
  },
  {
    title: '要不要为了早睡戒掉睡前刷短视频？',
    description: '每天平均刷 70 分钟，第二天起不来，但戒了又觉得少了点快乐。',
    category: '生活', hours: 60, closes: 96, anonymous: false, author: '林小满',
  },
  {
    title: '要不要把每周六固定成「学习日」？',
    description: '想系统补一下英语和剪辑，但周末也想留一天彻底放空。',
    category: '工作', hours: 64, closes: 120, anonymous: false, author: 'demo',
  },
  {
    title: '要不要现在就开始写年终总结？',
    description: '还有两周截止，现在写觉得没素材，拖到最后又一定熬夜。',
    category: '工作', hours: 76, closes: 72, anonymous: false, author: 'demo',
  },
  {
    title: '要不要接受涨薪 20% 但单程通勤 1.5 小时的工作？',
    description: '现在走路 15 分钟到公司，新机会平台更大。',
    category: '工作', hours: 70, closes: 144, anonymous: false, author: '老周',
  },
  {
    title: '35 岁前要不要去一次南极？',
    description: '报价 8 万，攒两年钱够，但总觉得这笔钱应该留着。',
    category: '生活', hours: 90, closes: -2, anonymous: false, author: 'Mia',
  },
]

const yesReasons = [
  '钱是拿来换体验的，能用钱解决的纠结就别拖。',
  '你已经反复想了很多次，说明现在的生活确实不对劲。',
  '先做了再说，最坏的结果也在可承受范围内。',
  '机会窗口比钱更稀缺，错过这次不一定还有下次。',
  '我做过类似的决定，后悔的是没早点做，不是做了。',
  '给自己设一个止损线，然后大胆一点。',
  '你描述里其实已经有答案了，只是在等别人点头。',
  '短期会痛，长期看是资产不是消费。',
]
const noReasons = [
  '现金流先留足，别把安全感一次性花掉。',
  '现在的方案还能撑一年，先攒更多信息再决定。',
  '这件事的成本被低估了，时间、精力、机会成本都要算。',
  '别在情绪高点做不可逆的决定，睡一觉再想。',
  '你真正想要的可能不是这个，而是逃离现在的状态。',
  '先做一个小规模的试验，不要一次押上全部。',
  '身边人的意见可以听，但最后承担结果的是你。',
  '如果还需要问这么多人，说明风险还没被看清。',
]

const voters = Object.keys(userIds)
let voteCount = 0
questions.forEach((q, qi) => {
  const qid = randomUUID()
  const createdAt = iso(q.hours)
  const closesAt = q.closes >= 0 ? future(q.closes) : iso(Math.abs(q.closes))
  db.prepare(
    `INSERT INTO questions
       (id, user_id, title, description, category, closes_at, close_notified_at,
        anonymous, featured, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    qid,
    userIds[q.author],
    q.title,
    q.description,
    q.category,
    closesAt,
    q.closes >= 0 ? null : createdAt,
    q.anonymous ? 1 : 0,
    q.featured ? 1 : 0,
    createdAt,
  )

  const pool = voters.filter((name) => name !== 'demo' && name !== 'admin')
  // 稳定的“随机”：按问题序号轮转，保证每次 seed 结果一致
  const start = (qi * 3) % pool.length
  const picks = []
  for (let i = 0; i < 8 + (qi % 4); i += 1) {
    picks.push(pool[(start + i) % pool.length])
  }
  const uniquePicks = [...new Set(picks)]
  const yesBias = 0.42 + ((qi * 7) % 10) / 50 // 0.42 ~ 0.60

  uniquePicks.forEach((name, idx) => {
    const choice = (qi + idx * 3) % 10 < yesBias * 10 ? 'yes' : 'no'
    const hasReason = (qi + idx) % 4 !== 0
    const reason = hasReason
      ? (choice === 'yes' ? yesReasons : noReasons)[(qi + idx) % 8]
      : ''
    const ts = iso(Math.max(q.hours - 1 - idx * 0.3, 0.1))
    db.prepare(
      `INSERT INTO votes (id, question_id, user_id, choice, reason, anonymous, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), qid, userIds[name], choice, reason, 0, ts, ts)
    voteCount += 1
  })

  // demo 用户参与前 4 个问题，方便体验“已投票”状态
  if (qi < 4) {
    const choice = qi % 2 === 0 ? 'yes' : 'no'
    const reason = qi === 0 ? '如果每天都要充电，换机的收益已经大于成本了。' : ''
    const ts = iso(q.hours - 2)
    db.prepare(
      `INSERT INTO votes (id, question_id, user_id, choice, reason, anonymous, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), qid, userIds.demo, choice, reason, 0, ts, ts)
    voteCount += 1
  }
})

console.log(
  `[seed] 完成：${users.length} 个用户，${questions.length} 个问题，${voteCount} 张票。\n` +
    '  体验账号 demo / demo1234\n  管理员   admin / admin1234（入口 /admin）',
)
