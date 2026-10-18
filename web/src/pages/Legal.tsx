import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'

const CONTACT = 'https://github.com/linshufan21/111/issues'

type LegalKind = 'privacy' | 'terms'

const COPY: Record<LegalKind, { eyebrow: string; title: string; intro: string; sections: { h: string; p: string[] }[] }> = {
  privacy: {
    eyebrow: 'PRIVACY',
    title: '隐私政策',
    intro:
      '这是一份面向小范围邀请测试的隐私政策草案。我们尽量只收集运行投票所必需的信息，不用来做广告，也不卖给第三方。',
    sections: [
      {
        h: '我们收集什么',
        p: [
          '账号信息：昵称、邮箱、密码哈希（不保存明文密码）、邮箱验证状态。',
          '使用内容：你发起的问题、投票选择、理由、举报、通知，以及是否匿名。',
          '技术信息：IP 地址、浏览器 User-Agent、请求时间、请求 ID、错误日志，用于安全和排障。',
        ],
      },
      {
        h: '为什么收集',
        p: [
          '提供登录、邮箱验证、找回密码、发帖、投票、通知和举报处理。',
          '防止刷票、撞库、滥用和攻击；在必要时处理违规内容。',
          '我们不做个性化广告，不接入第三方广告追踪器。',
        ],
      },
      {
        h: 'Cookie',
        p: [
          'dd_session：HttpOnly 登录会话，30 天有效。',
          'dd_csrf：防跨站请求伪造的签名 token，前端需要读取。',
          '没有广告 Cookie，也没有跨站行为追踪。',
        ],
      },
      {
        h: '存储与保留',
        p: [
          '数据存储在运营者自建的 SQLite 数据库中，服务器可能位于境外免费云服务。',
          '数据库备份默认保留 14 天；备份可能包含个人信息，访问权限仅限运营者。',
          '注销账号后，昵称和邮箱会被替换为匿名值，登录凭证失效；已发布内容保留但显示为已注销用户。',
        ],
      },
      {
        h: '第三方',
        p: [
          '邮件发送：Brevo 或 Resend，仅向其传输收件邮箱和邮件内容。',
          '云服务器与对象存储：用于运行站点和保存备份。',
          '除上述必要服务或法律要求外，不向第三方提供个人信息。',
        ],
      },
      {
        h: '你的权利',
        p: [
          '你可以在账号设置中修改密码、退出其他设备、注销账号。',
          '如需访问、更正或删除数据，请在项目仓库提交 Issue，或通过管理员账号联系运营者。',
          '未成年人：未满 14 岁请勿注册；14–18 岁请在监护人同意下使用。',
        ],
      },
      {
        h: '跨境与变更',
        p: [
          '使用境外服务器时，数据可能被传输到所在国家/地区；如你对此有顾虑，请先不要注册。',
          '政策更新会在本页标注日期；重大变更会在站内提示。',
        ],
      },
    ],
  },
  terms: {
    eyebrow: 'TERMS',
    title: '用户协议',
    intro:
      '这是一份面向小范围邀请测试的用户协议草案。使用本站即表示你愿意遵守下面的基本规则。',
    sections: [
      {
        h: '你的账号',
        p: [
          '请提供真实可用的邮箱，并妥善保管密码；因你泄露密码造成的损失由你承担。',
          '一个用户不应批量注册账号、刷票或操纵投票结果。',
          '管理员账号不能自助注销；如需移交，请联系运营者。',
        ],
      },
      {
        h: '发布内容',
        p: [
          '不要发布违法、仇恨、骚扰、色情、诈骗、侵犯隐私或泄露他人个人信息的内容。',
          '问题、理由和举报应尽量具体、友善；你可以不同意别人的选择，但不能攻击个人。',
          '你保留自己内容的权利，同时授权本站展示、存储和处理这些内容以提供服务。',
        ],
      },
      {
        h: '审核与处置',
        p: [
          '我们可能对违规内容进行删除、隐藏、截止或停用账号，并保留审计记录。',
          '举报由管理员人工处理；处理结果会通过站内通知告知举报人。',
          '对处理结果有异议，可在项目仓库提交 Issue 说明情况。',
        ],
      },
      {
        h: '服务边界',
        p: [
          '本站是非盈利实验项目，不承诺永久在线、数据永不丢失或零故障。',
          '我们会尽量做备份和维护，但请勿把本站当作唯一的重要信息存储。',
          '因不可抗力、云服务故障、网络攻击或政策变化导致的服务中断，我们会尽力恢复，但不承担超出法律允许范围的责任。',
        ],
      },
      {
        h: '隐私与未成年',
        p: [
          '个人信息处理方式见隐私政策。',
          '未满 14 岁请勿注册；14–18 岁请在监护人同意下使用。',
        ],
      },
    ],
  },
}

function LegalPage({ kind }: { kind: LegalKind }) {
  const copy = COPY[kind]
  return (
    <Layout>
      <div className="legal-shell">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p className="legal-meta">最后更新：2026-10-18 · 草案，公开运营前需运营者与法务复核</p>
        <div className="legal-card">
          <p className="legal-intro">{copy.intro}</p>
          {copy.sections.map((section) => (
            <section className="legal-section" key={section.h}>
              <h2>{section.h}</h2>
              {section.p.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
          <p className="legal-note">
            联系方式：<a href={CONTACT}>项目仓库 Issue</a>。请不要在 Issue 中公开他人的邮箱、密码或其他敏感信息。
          </p>
          <p className="legal-back">
            <Link to="/">返回广场</Link>
          </p>
        </div>
      </div>
    </Layout>
  )
}

export function Privacy() {
  return <LegalPage kind="privacy" />
}

export function Terms() {
  return <LegalPage kind="terms" />
}
