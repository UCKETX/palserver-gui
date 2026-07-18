'use client';

import { MAP_LOCALES, mapLocaleName, type MapLang } from './i18n';

/**
 * /map viewer 版的語言切換:外觀完全比照官網 components/LangSwitch.tsx(共用同一份
 * globals.css 的 `nav .lang` 樣式,見 map.css 底部補的 `nav .lang button` 規則),
 * 但點擊邏輯不同 —— 官網 LangSwitch 切站台路由語系(<a href>),這裡沒有網址可切,
 * 是純粹切換 viewer 自身顯示語言的 client state,所以用 <button> 不用 <a>
 * (MapPageClient 收到 onChange 後會存進 localStorage,下次進來記住)。
 */
export default function MapLangSwitch({
  current,
  onChange,
}: {
  current: MapLang;
  onChange: (lang: MapLang) => void;
}) {
  return (
    <div className="lang" role="group" aria-label="Language">
      {MAP_LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          className={l === current ? 'on' : ''}
          aria-current={l === current ? 'true' : undefined}
          onClick={() => onChange(l)}
        >
          {mapLocaleName[l]}
        </button>
      ))}
    </div>
  );
}
