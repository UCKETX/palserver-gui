import { useEffect, useRef, useState } from "react";
import { FiMapPin, FiX } from "react-icons/fi";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { mapToSav } from "@palserver/shared";
import { t, useI18n } from "./i18n";
import { Overlay, btn, btnGhost, card } from "./ui";

// 與 MapTab 一致的世界地圖圖與圖上座標邊界(改動請兩處同步)。
const MAP_IMAGE = "/palworld-full-map.jpg";
const IMAGE_BOUNDS = L.latLngBounds([-2125.3, -1922.44], [1031.13, 1233.99]);

/**
 * 地圖描點選座標:點地圖放圖釘,回傳 tp / spawn 等指令用的 Unreal 世界座標
 * 字串「X Y」(高度 Z 由伺服器自動找地面)。與線上地圖共用同一套座標轉換。
 */
export function MapPickModal({
  onPick,
  onClose,
}: {
  onPick: (coords: string) => void;
  onClose: () => void;
}) {
  useI18n();
  const elRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const [world, setWorld] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const map = L.map(el, {
      crs: L.CRS.Simple,
      attributionControl: false,
      zoomSnap: 0.25,
      maxZoom: 4,
    });
    el.style.background = "transparent";
    L.imageOverlay(MAP_IMAGE, IMAGE_BOUNDS).addTo(map);
    map.setMaxBounds(IMAGE_BOUNDS.pad(0.3));
    map.setView(IMAGE_BOUNDS.getCenter(), -2);

    const onClick = (e: L.LeafletMouseEvent) => {
      // Leaflet latlng = [lat=mapY(北), lng=mapX(東)] → 逆轉成世界座標。
      const sav = mapToSav(e.latlng.lng, e.latlng.lat);
      setWorld({ x: Math.round(sav.x), y: Math.round(sav.y) });
      if (markerRef.current) markerRef.current.setLatLng(e.latlng);
      else {
        markerRef.current = L.circleMarker(e.latlng, {
          radius: 8,
          color: "#ffffff",
          weight: 2,
          fillColor: "#3fa7e0",
          fillOpacity: 0.95,
        }).addTo(map);
      }
    };
    map.on("click", onClick);

    // 容器高度可能一開始是 0(版面尚未定),量到實際尺寸再 fit 一次。
    let fitted = false;
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      if (map.getSize().y === 0) return;
      map.setMinZoom(map.getBoundsZoom(IMAGE_BOUNDS) - 1);
      if (!fitted) {
        map.fitBounds(IMAGE_BOUNDS);
        fitted = true;
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      map.off("click", onClick);
      map.remove();
      markerRef.current = null;
    };
  }, []);

  return (
    <Overlay onClose={onClose}>
      <div
        className={`${card} flex h-[80vh] w-[820px] max-w-full flex-col gap-3`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between">
          <h2 className="inline-flex items-center gap-2 text-lg font-extrabold">
            <FiMapPin className="size-5 text-pal" /> {t("在地圖上選座標")}
          </h2>
          <button className={btnGhost} onClick={onClose} aria-label={t("關閉")}>
            <FiX className="size-4" />
          </button>
        </div>
        <p className="shrink-0 text-xs text-ink-muted">
          {t("點地圖任一處放置圖釘,選好按「使用此座標」。傳送高度(Z)由伺服器自動找地面。")}
        </p>
        <div ref={elRef} className="min-h-0 flex-1 overflow-hidden rounded-(--radius-cute) border-2 border-line" />
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <span className="font-mono text-sm text-ink-muted">
            {world ? `X ${world.x}  Y ${world.y}` : t("尚未選點")}
          </span>
          <button
            className={`${btn} inline-flex items-center gap-1.5`}
            disabled={!world}
            onClick={() => world && onPick(`${world.x} ${world.y}`)}
          >
            <FiMapPin className="size-4" /> {t("使用此座標")}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
