'use client';

import { useEffect, useState } from 'react';
import { GitHubIcon } from '@/components/icons';
import DownloadLink from '@/components/DownloadLink';
import MapLangSwitch from './MapLangSwitch';
import { brandHref, type MapDict, type MapLang } from './i18n';

const GITHUB_URL = 'https://github.com/io-software-ai/palserver-gui';

/**
 * /map 公開地圖 viewer 的品牌頂欄:與官網首頁 components/Nav.tsx 視覺完全一致 ——
 * 不重畫一份樣式,而是直接渲染同一套 <nav>/.logo/.navctl/.menu 結構,讓
 * app/globals.css 裡那些沒有被 CSS module 隔離、以標籤/class 選到的 nav 規則
 * 原樣套用(見 globals.css:27-69)。與官網 Nav.tsx 的差異只有兩處:
 *   1. logo 不連回 `#top`(同頁錨點),而是連到官網對應語系首頁(brandHref)。
 *   2. 沒有 features/how/start/team/changelog 這排頁面連結 —— 那些是行銷首頁
 *      的分節錨點,/map 沒有對應內容,官網 Nav 的 `.links`/`.sp` 結構在這裡
 *      直接省略,靠 `.sp` 一樣把 navctl 推到最右。
 * 語言切換也換成 viewer 自己的 MapLangSwitch(見該檔案註解)。
 */
export default function MapNav({
  lang,
  onLangChange,
  d,
}: {
  lang: MapLang;
  onLangChange: (lang: MapLang) => void;
  d: MapDict;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element)?.closest('.menu')) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <nav aria-label="primary">
      <div className="in">
        <a className="logo" href={brandHref(lang)} target="_blank" rel="noopener noreferrer">
          <span className="m">
            <img src="/assets/logo.png" alt="" width={30} height={30} />
          </span>
          <span className="lt">palserver GUI</span>
        </a>
        <div className="sp" />
        {/* 桌機:一整排控制項;手機隱藏,改由下面的漢堡選單收納(斷點跟官網 nav 一致,860px)。 */}
        <div className="navctl">
          <MapLangSwitch current={lang} onChange={onLangChange} />
          <a className="btn btn-g btn-sm" href={GITHUB_URL}>
            <GitHubIcon />
            {d.github}
          </a>
          <DownloadLink className="btn btn-p btn-sm">{d.download}</DownloadLink>
        </div>
        <div className="menu">
          <button
            type="button"
            className="burger"
            aria-label="Menu"
            aria-haspopup="true"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
          <div className={open ? 'panel open' : 'panel'}>
            <MapLangSwitch
              current={lang}
              onChange={(l) => {
                onLangChange(l);
                close();
              }}
            />
            <a className="btn btn-g" href={GITHUB_URL} onClick={close}>
              <GitHubIcon />
              {d.github}
            </a>
            <DownloadLink className="btn btn-p" onClick={close}>
              {d.download}
            </DownloadLink>
          </div>
        </div>
      </div>
    </nav>
  );
}
