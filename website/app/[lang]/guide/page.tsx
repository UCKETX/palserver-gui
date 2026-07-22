import type { Metadata } from 'next';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import Shot from '@/components/Shot';
import DownloadLink from '@/components/DownloadLink';
import RevealObserver from '@/components/RevealObserver';
import { locales, isLocale, defaultLocale, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang: raw } = await params;
  const lang: Locale = isLocale(raw) ? raw : defaultLocale;
  const d = getDictionary(lang);
  return {
    // 父層 layout.tsx 的 title.template 已經是 '%s — palserver GUI',這裡給純標題就好,
    // 否則會疊成「X — palserver GUI — palserver GUI」(changelog/page.tsx 也有這個既有問題, 不在本次範圍內一併修)。
    title: d.guide.metaTitle,
    description: d.guide.lead,
    alternates: { canonical: `/${lang}/guide/` },
  };
}

/** 每個步驟就近借用「四語都存在」的既有截圖,避免 en/ja 缺圖 404。 */
const SHOTS: { name: string; width: number; height: number; reverse?: boolean }[] = [
  { name: 'dashboard', width: 1320, height: 848 },
  { name: 'create', width: 1320, height: 1012, reverse: true },
  { name: 'connect', width: 1320, height: 848 },
  { name: 'world', width: 1320, height: 848, reverse: true },
  { name: 'mods', width: 1320, height: 848 },
];

export default async function GuidePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  const lang: Locale = isLocale(raw) ? raw : defaultLocale;
  const d = getDictionary(lang);
  const g = d.guide;

  return (
    <>
      <div className="bg" aria-hidden="true">
        <i className="a" />
        <i className="b" />
      </div>
      <Nav d={d.nav} lang={lang} />
      <main className="wrap guide-page">
        <div className="col reveal">
          <p className="eyebrow">{g.eyebrow}</p>
          <h1>{g.h2}</h1>
          <p className="sec-lead">{g.lead}</p>
          <div className="guide-cta">
            <DownloadLink className="btn btn-p">{g.ctaDownload}</DownloadLink>
            <a className="btn btn-g" href={`/${lang}/`}>
              {g.ctaHome}
            </a>
          </div>
        </div>
        <div className="feat guide-steps">
          {g.steps.map((s, i) => {
            const shot = SHOTS[i];
            return (
              <div className={`frow reveal guide-step${shot.reverse ? ' rev' : ''}`} key={s.title}>
                <div className="txt">
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
                <Shot
                  src={`/assets/${lang}/${shot.name}.jpg`}
                  alt={s.shotAlt}
                  label={s.shotAlt}
                  width={shot.width}
                  height={shot.height}
                />
              </div>
            );
          })}
        </div>
      </main>
      <Footer d={d.footer} />
      <RevealObserver />
    </>
  );
}
