import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabase'
import {
  Search, X, ChevronLeft, ChevronRight,
  Tag, Car, Ruler, GitMerge, Hash, ChevronDown, ChevronUp, Loader2, ArrowUpRight, Package
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────
interface Specs {
  length?: string | null; length_1?: string | null; length_2?: string | null
  total_length_1?: string | null; overall_length?: string | null
  thread_measurement_1?: string | null; thread_measurement_2?: string | null
  thread_size?: string | null; thread_type?: string | null
  thread_diameter?: string | null; thread_pitch?: string | null
  inner_thread?: string | null; inner_thread_1?: string | null
  outer_thread?: string | null; outer_thread_1?: string | null
  diameter_1?: string | null; diameter_mm?: string | null
  inner_diameter_1_mm?: string | null
  hose_material?: string | null; jacket_material?: string | null
  end_1_type?: string | null; end_2_fitting_type?: string | null
  end_1_fitting_type?: string | null; end_1_attachment_type?: string | null
  end_2_attachment_type?: string | null
  brake_system?: string | null; color?: string | null
  weight_g?: string | null; spanner_size?: string | null
  describe_type?: string | null; bolt?: string | null
  bracket_included?: string | null; gasket_included?: string | null
  jacket_included?: string | null; package_contents?: string | null
  package_quantity?: string | null; mounting_hardware?: string | null
  number_of_connectors?: string | null; mapp_code?: string | null
  [key: string]: string | null | undefined
}

interface BrakelineProduct {
  id: number
  brand: string
  article: string
  oem: string | null
  original_oem: string | null
  status: number
  cross_refs: string | null
  application: string | null
  image: string | null
  extra_images: string[] | null
  specs: Specs | null
}

// ── Constants ──────────────────────────────────────────────────────────────────
const MAIN_BRANDS: string[] = ['HEL', 'DORMAN', 'TRW', 'BOSCH', 'ATE']
const OUR_BRANDS = new Set(['HEL', 'DORMAN', 'TRW', 'BOSCH', 'ATE'])
const PAGE_SIZE = 25

const BRAND_COLORS: Record<string, { bg: string; text: string; border: string; solid: string; light: string }> = {
  HEL:    { bg: 'bg-red-50',    text: 'text-[#ED1C24]',  border: 'border-red-200',    solid: '#ED1C24', light: '#FEF2F2' },
  DORMAN: { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   solid: '#3B82F6', light: '#EFF6FF' },
  TRW:    { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', solid: '#8B5CF6', light: '#F5F3FF' },
  BOSCH:  { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200',  solid: '#F59E0B', light: '#FFFBEB' },
  ATE:    { bg: 'bg-emerald-50',text: 'text-emerald-700',border: 'border-emerald-200',solid: '#10B981', light: '#ECFDF5' },
}

const SPEC_LABELS: Record<string, string> = {
  length: 'Длина', length_1: 'Длина 1', length_2: 'Длина 2',
  total_length_1: 'Общая длина', overall_length: 'Полная длина',
  thread_measurement_1: 'Резьба (ст. 1)', thread_measurement_2: 'Резьба (ст. 2)',
  thread_size: 'Размер резьбы', thread_type: 'Тип резьбы',
  thread_diameter: 'Диаметр резьбы', thread_pitch: 'Шаг резьбы',
  inner_thread: 'Внутр. резьба', inner_thread_1: 'Внутр. резьба 1',
  outer_thread: 'Внешн. резьба', outer_thread_1: 'Внешн. резьба 1',
  diameter_1: 'Диаметр 1', diameter_mm: 'Диаметр (мм)',
  inner_diameter_1_mm: 'Внутр. диаметр (мм)',
  hose_material: 'Материал шланга', jacket_material: 'Материал оболочки',
  end_1_type: 'Тип конца 1', end_1_fitting_type: 'Фитинг 1',
  end_2_fitting_type: 'Фитинг 2', end_1_attachment_type: 'Крепление 1',
  end_2_attachment_type: 'Крепление 2', brake_system: 'Тормозная система',
  color: 'Цвет', weight_g: 'Вес (г)', spanner_size: 'Размер ключа',
  describe_type: 'Тип', bolt: 'Болт', bracket_included: 'Кронштейн',
  gasket_included: 'Прокладка', jacket_included: 'Оболочка',
  package_contents: 'Состав упак.', package_quantity: 'Кол-во',
  mounting_hardware: 'Крепёж', number_of_connectors: 'Кол-во соед.',
  mapp_code: 'MAPP код',
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function parseApplication(raw: string | null): string[] {
  if (!raw) return []
  return raw.split('\n').map(s => s.trim()).filter(Boolean)
}

/**
 * Parse cross-refs string into { brand, num }[] entries.
 * Handles formats like:
 *   "A.B.S. SL6022, ATE 24529804743, 24529804753, BOSCH 1987481054, ..."
 * Logic: if a segment has a "BRAND ARTICLE" pattern → new brand
 * If it's just an article number → reuse last brand
 */
function parseCrossRefs(raw: string | null): { brand: string; num: string }[] {
  if (!raw) return []
  const results: { brand: string; num: string }[] = []
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
  let currentBrand = ''

  for (const part of parts) {
    // Match: one or more words (brand) followed by an alphanumeric article
    const m = part.match(/^([A-Z][A-Z0-9 &.\-/]{0,30}?)\s+([A-Z0-9][\w\-./]*)$/)
    if (m) {
      currentBrand = m[1].trim()
      results.push({ brand: currentBrand, num: m[2].trim() })
    } else if (currentBrand && /^[A-Z0-9][\w\-./]*$/.test(part)) {
      // continuation number for current brand
      results.push({ brand: currentBrand, num: part })
    } else if (!currentBrand && part.length > 0) {
      // unknown brand
      results.push({ brand: '—', num: part })
    }
  }
  return results.slice(0, 80)
}

// Ключи, которые рендерятся структурно (схема сборки HEL), не показываем в общей таблице характеристик
const STRUCT_SPEC_KEYS = new Set([
  'lines', 'fitting1', 'fitting2', 'insert1', 'insert2', 'bend1', 'bend2',
  'bend1_orient', 'bend2_orient', 'bolt1', 'bolt2', 'bolt1_washer', 'bolt2_washer',
  'bolt1_washer_qty', 'bolt2_washer_qty', 'bolt1_qty', 'bolt2_qty', 'cut', 'sleeve', 'sleeve_qty',
  'support1', 'support2', 'support3', 'support4', 'support5', 'support6',
  'support1_flip', 'support2_flip', 'support3_flip', 'support4_flip', 'support5_flip', 'support6_flip',
  'hose_color', 'legacy_article',
])
function getSpecEntries(specs: Specs | null | undefined): [string, string][] {
  if (!specs) return []
  return Object.entries(specs)
    .filter(([k, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object' && !STRUCT_SPEC_KEYS.has(k))
    .map(([k, v]) => [SPEC_LABELS[k] || k, v as string])
}

// Шайбы каталога: 3 для серии H161, иначе 2
const WASHER_SKU_CAT = 'CCW-10'
const washersForBoltCat = (sku: string): number => {
  const m = (sku || '').toUpperCase().match(/^H?(\d{3})/)
  return m && m[1] === '161' ? 3 : 2
}

interface SchemeLine {
  fitting1: string; insert1: string; bend1: string; bend1_orient: string; bolt1: string
  cut: string; supports: string[]; supports_flipped: boolean[]
  fitting2: string; insert2: string; bend2: string; bend2_orient: string; bolt2: string
}
// Нормализованные сегменты: из specs.lines[] (новый формат) или синтез из плоских ключей (старый)
function getSchemeLines(specs: Specs): SchemeLine[] {
  const norm = (o: Record<string, unknown>): SchemeLine => ({
    fitting1: String(o.fitting1 || ''), insert1: String(o.insert1 || ''),
    bend1: String(o.bend1 || ''), bend1_orient: String(o.bend1_orient || ''), bolt1: String(o.bolt1 || ''),
    cut: String(o.cut || ''),
    supports: (Array.isArray(o.supports) ? o.supports : []).map(String).filter(Boolean),
    supports_flipped: Array.isArray(o.supports_flipped) ? o.supports_flipped.map(Boolean) : [],
    fitting2: String(o.fitting2 || ''), insert2: String(o.insert2 || ''),
    bend2: String(o.bend2 || ''), bend2_orient: String(o.bend2_orient || ''), bolt2: String(o.bolt2 || ''),
  })
  const raw = (specs as unknown as { lines?: Record<string, unknown>[] }).lines
  if (Array.isArray(raw) && raw.length) return raw.map(norm)
  const supports = [specs.support1, specs.support2, specs.support3, specs.support4, specs.support5, specs.support6].filter(Boolean) as string[]
  const flip = supports.map((_, i) => specs[`support${i + 1}_flip`] === '1')
  return [{ ...norm(specs as unknown as Record<string, unknown>), supports, supports_flipped: flip }]
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const STORAGE_BASE = 'https://uspakygxibqcicmsjvct.supabase.co/storage/v1/object/public/analog-images'

function toStorageUrl(image: string | null): string | null {
  if (!image) return null
  // If already a full URL, use as-is
  if (image.startsWith('http')) return image
  const filename = image.split('/').pop()
  return filename ? `${STORAGE_BASE}/${filename}` : null
}

// ── Product Image with fallback placeholder ────────────────────────────────────
function ProductImage({ image, article, brand, size = 'md' }: {
  image: string | null; article: string; brand: string; size?: 'sm' | 'md' | 'lg'
}) {
  const [failed, setFailed] = useState(false)
  const c = BRAND_COLORS[brand] || { solid: '#6B7280', light: '#F9FAFB' }
  const heights: Record<string, string> = { sm: 'h-24', md: 'h-52', lg: 'h-64' }
  const src = toStorageUrl(image)

  if (src && !failed) {
    return (
      <div className={`w-full ${heights[size]} rounded-xl overflow-hidden bg-white flex items-center justify-center border border-neutral-100`}>
        <img
          src={src}
          alt={article}
          className="max-h-full max-w-full object-contain p-2"
          onError={() => setFailed(true)}
        />
      </div>
    )
  }

  // Fallback placeholder
  return (
    <div
      className={`w-full ${heights[size]} rounded-xl flex flex-col items-center justify-center gap-3 select-none`}
      style={{ background: c.light }}
    >
      <svg width="80" height="32" viewBox="0 0 80 32" fill="none" style={{ opacity: 0.4 }}>
        <rect x="0" y="10" width="14" height="12" rx="2" fill={c.solid} />
        <rect x="14" y="13" width="6" height="6" rx="1" fill={c.solid} />
        <rect x="20" y="14" width="40" height="4" rx="2" fill={c.solid} />
        <rect x="60" y="13" width="6" height="6" rx="1" fill={c.solid} />
        <rect x="66" y="10" width="14" height="12" rx="2" fill={c.solid} />
      </svg>
      <div className="text-center">
        <div className="font-mono font-bold text-sm" style={{ color: c.solid }}>{article}</div>
        <div className="text-xs mt-0.5" style={{ color: c.solid, opacity: 0.5 }}>фото недоступно</div>
      </div>
    </div>
  )
}

// ── Brand badge ────────────────────────────────────────────────────────────────
function BrandBadge({ brand, large = false }: { brand: string; large?: boolean }) {
  const c = BRAND_COLORS[brand]
  if (!c) return <span className="px-2 py-0.5 rounded text-xs font-bold border bg-neutral-100 text-neutral-600 border-neutral-200">{brand}</span>
  return (
    <span className={`${large ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs'} rounded font-bold border ${c.bg} ${c.text} ${c.border}`}>
      {brand}
    </span>
  )
}

// ── HEL Product helpers ───────────────────────────────────────────────────────
interface HelProduct { id: string; sku: string; name: string; image_url: string | null; price_dealer: number | null }
type HelMap = Map<string, HelProduct>

const HOSE_COLORS: Record<string, string> = {
  CLEAR: '#CCCCCC', BLACK: '#1a1a1a', BLUE: '#0066CC', RED: '#CC0000',
  'GREEN-KAWASAKI': '#00AA00', YELLOW: '#CCCC00', ORANGE: '#CC6600',
  'PURPLE-TRANS': '#660099', CARBON: '#444', GOLD: '#DAA520',
  PINK: '#FF69B4', WHITE: '#F5F5F5', 'BLUE-TINT': '#6699CC', 'RED-TINT': '#CC6666',
}

function PartImg({ sku, pm, size = 32, mirror = false }: { sku: string; pm: HelMap; size?: number; mirror?: boolean }) {
  const p = pm.get(sku)
  const [fail, setFail] = useState(false)
  if (p?.image_url && !fail) {
    return (
      <div className="rounded-md overflow-hidden bg-white border border-neutral-200 shrink-0 flex items-center justify-center" style={{ width: size, height: size, transform: mirror ? 'scaleX(-1)' : undefined }}>
        <img src={p.image_url} alt={sku} className="max-h-full max-w-full object-contain" onError={() => setFail(true)} />
      </div>
    )
  }
  return (
    <div className="rounded-md bg-neutral-100 shrink-0 flex items-center justify-center" style={{ width: size, height: size }}>
      <Package size={size * 0.4} className="text-neutral-300" />
    </div>
  )
}

function fmtRub(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽'
}

function HelSchemeCard({ specs, pm }: { specs: Specs; pm: HelMap }) {
  const lines = getSchemeLines(specs)
  const getP = (sku: string) => (sku ? (pm.get(sku)?.price_dealer ?? 0) : 0)
  const hoseProduct = Array.from(pm.values()).find(p => p.sku === 'H707')
  const hosePerM = hoseProduct?.price_dealer ?? getP('H707')
  const sleevePrice = getP('H707-03C')
  const washerPrice = getP(WASHER_SKU_CAT)

  const linePrice = (ln: SchemeLine) => {
    const hose = (parseFloat(ln.cut || '0') || 0) / 1000 * hosePerM
    const sleeves = sleevePrice * 2
    const washerQty = (ln.bolt1 ? washersForBoltCat(ln.bolt1) : 0) + (ln.bolt2 ? washersForBoltCat(ln.bolt2) : 0)
    const washers = washerQty * washerPrice
    const sup = ln.supports.reduce((s, k) => s + getP(k), 0)
    return getP(ln.fitting1) + getP(ln.insert1) + getP(ln.bolt1) + hose + getP(ln.insert2) + getP(ln.fitting2) + getP(ln.bolt2) + sleeves + washers + sup
  }
  const totalPrice = lines.reduce((s, ln) => s + linePrice(ln), 0)
  const hc = HOSE_COLORS[specs.hose_color || 'CLEAR'] || '#CCC'

  return (
    <div className="p-4 border-b border-neutral-100">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-bold text-[#ED1C24] uppercase tracking-widest">
          Схема сборки HEL{lines.length > 1 ? ` · ${lines.length} шланга` : ''}
        </span>
        {totalPrice > 0 && (
          <span className="font-mono text-sm font-black text-green-700 bg-green-50 border border-green-200 px-3 py-1 rounded-lg">{fmtRub(Math.round(totalPrice))}</span>
        )}
      </div>

      {lines.map((ln, li) => {
        const w1 = ln.bolt1 ? washersForBoltCat(ln.bolt1) : 0
        const w2 = ln.bolt2 ? washersForBoltCat(ln.bolt2) : 0
        return (
        <div key={li} className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 mb-2">
          {lines.length > 1 && <div className="text-[9px] font-bold text-neutral-400 uppercase mb-2">Шланг #{li + 1}</div>}
          {/* Assembly line */}
          <div className="flex items-center min-w-0">
            <div className="flex flex-col items-center shrink-0 w-[80px]">
              <PartImg sku={ln.fitting1} pm={pm} size={72} mirror />
              <div className="text-[8px] text-[#ED1C24] font-bold mt-1">Ф1</div>
              <div className="font-mono text-[9px] text-neutral-700 font-bold text-center">{ln.fitting1}</div>
              {ln.bend1 && <div className="text-[8px] text-amber-600 font-semibold">{ln.bend1}</div>}
              {ln.bend1_orient && <div className="text-[8px] text-blue-600 font-semibold">↪ {ln.bend1_orient}</div>}
            </div>
            {ln.insert1 && (
              <div className="flex flex-col items-center shrink-0 w-[80px] mx-0.5">
                <PartImg sku={ln.insert1} pm={pm} size={72} mirror />
                <div className="font-mono text-[8px] text-neutral-500 mt-0.5">{ln.insert1}</div>
              </div>
            )}
            <div className="flex-1 mx-2 flex flex-col items-center">
              <div className="w-full h-4 rounded-full relative overflow-hidden shadow-sm" style={{ background: hc }}>
                <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'repeating-linear-gradient(135deg,transparent,transparent 4px,rgba(255,255,255,0.4) 4px,rgba(255,255,255,0.4) 5px)' }} />
                {ln.supports.length > 0 && (
                  <div className="absolute inset-0 flex justify-around items-center">
                    {ln.supports.map((_, i) => <div key={i} className="w-1.5 h-7 rounded-full bg-amber-500 -mt-1.5" />)}
                  </div>
                )}
              </div>
              <span className="font-mono text-sm font-black text-neutral-900 mt-1">{ln.cut || '—'} <span className="text-neutral-400 text-[10px] font-normal">мм</span></span>
            </div>
            {ln.insert2 && (
              <div className="flex flex-col items-center shrink-0 w-[80px] mx-0.5">
                <PartImg sku={ln.insert2} pm={pm} size={72} />
                <div className="font-mono text-[8px] text-neutral-500 mt-0.5">{ln.insert2}</div>
              </div>
            )}
            <div className="flex flex-col items-center shrink-0 w-[80px]">
              <PartImg sku={ln.fitting2} pm={pm} size={72} />
              <div className="text-[8px] text-[#ED1C24] font-bold mt-1">Ф2</div>
              <div className="font-mono text-[9px] text-neutral-700 font-bold text-center">{ln.fitting2}</div>
              {ln.bend2 && <div className="text-[8px] text-amber-600 font-semibold">{ln.bend2}</div>}
              {ln.bend2_orient && <div className="text-[8px] text-blue-600 font-semibold">↪ {ln.bend2_orient}</div>}
            </div>
          </div>

          {/* Components row */}
          <div className="flex items-center justify-center gap-3 mt-3 pt-2 border-t border-neutral-200 flex-wrap">
            {ln.bolt1 && (
              <div className="flex items-center gap-1">
                <PartImg sku={ln.bolt1} pm={pm} size={48} mirror />
                <div className="text-[8px]"><span className="text-neutral-400">Болт </span><span className="font-mono text-neutral-600">{ln.bolt1}</span><br /><span className="text-neutral-400">Шайбы </span><span className="font-mono text-neutral-600">{WASHER_SKU_CAT} ×{w1}</span></div>
              </div>
            )}
            {ln.supports.map((s, i) => (
              <div key={i} className="flex items-center gap-1">
                <PartImg sku={s} pm={pm} size={48} mirror={ln.supports_flipped[i]} />
                <div className="text-[8px]"><span className="text-neutral-400">Креп </span><span className="font-mono text-amber-600">{s}</span></div>
              </div>
            ))}
            {ln.bolt2 && (
              <div className="flex items-center gap-1">
                <PartImg sku={ln.bolt2} pm={pm} size={48} />
                <div className="text-[8px]"><span className="text-neutral-400">Болт </span><span className="font-mono text-neutral-600">{ln.bolt2}</span><br /><span className="text-neutral-400">Шайбы </span><span className="font-mono text-neutral-600">{WASHER_SKU_CAT} ×{w2}</span></div>
              </div>
            )}
          </div>
        </div>
        )
      })}

      {/* Price breakdown — детализация по всем компонентам */}
      {totalPrice > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
          {lines.map((ln, li) => {
            const cutMm = parseFloat(ln.cut || '0') || 0
            const hose = cutMm / 1000 * hosePerM
            const w1 = ln.bolt1 ? washersForBoltCat(ln.bolt1) : 0
            const w2 = ln.bolt2 ? washersForBoltCat(ln.bolt2) : 0
            const wTotal = (w1 + w2) * washerPrice
            const row = (label: string, price: number, key: string) => price > 0
              ? <div key={key} className="flex justify-between"><span className="text-neutral-400">{label}</span><span className="font-mono text-neutral-700">{fmtRub(Math.round(price))}</span></div>
              : null
            return [
              row(`Ф1 ${ln.fitting1}`, getP(ln.fitting1), `${li}f1`),
              ln.insert1 ? row(`Вст ${ln.insert1}`, getP(ln.insert1), `${li}i1`) : null,
              cutMm > 0 ? row(`Шланг ${ln.cut}мм`, hose, `${li}h`) : null,
              ln.insert2 ? row(`Вст ${ln.insert2}`, getP(ln.insert2), `${li}i2`) : null,
              row(`Ф2 ${ln.fitting2}`, getP(ln.fitting2), `${li}f2`),
              ln.bolt1 ? row(`Болт ${ln.bolt1}`, getP(ln.bolt1), `${li}b1`) : null,
              ln.bolt2 ? row(`Болт ${ln.bolt2}`, getP(ln.bolt2), `${li}b2`) : null,
              ...ln.supports.map((s, i) => row(`Креп ${s}`, getP(s), `${li}s${i}`)),
              row('Гильзы H707-03C ×2', sleevePrice * 2, `${li}sl`),
              wTotal > 0 ? row(`Шайбы ${WASHER_SKU_CAT} ×${w1 + w2}`, wTotal, `${li}w`) : null,
            ]
          })}
        </div>
      )}
    </div>
  )
}

// ── Mini scheme for HEL in list ───────────────────────────────────────────────
function MiniScheme({ specs, pm }: { specs: Specs; pm: HelMap }) {
  const f1 = specs.fitting1 || ''
  const f2 = specs.fitting2 || ''
  const p1 = pm.get(f1)
  const p2 = pm.get(f2)
  const hc = HOSE_COLORS[specs.hose_color || 'CLEAR'] || '#CCC'
  return (
    <div className="flex items-center gap-0.5 w-24 h-9">
      {p1?.image_url ? (
        <img src={p1.image_url} alt="" className="w-6 h-6 object-contain shrink-0 rounded" style={{ transform: 'scaleX(-1)' }} />
      ) : (
        <div className="w-6 h-6 rounded bg-red-50 shrink-0" />
      )}
      <div className="flex-1 h-2 rounded-full" style={{ background: hc, minWidth: 16 }} />
      {p2?.image_url ? (
        <img src={p2.image_url} alt="" className="w-6 h-6 object-contain shrink-0 rounded" />
      ) : (
        <div className="w-6 h-6 rounded bg-red-50 shrink-0" />
      )}
    </div>
  )
}

// ── Image Gallery ─────────────────────────────────────────────────────────────
function ImageGallery({ product }: { product: BrakelineProduct }) {
  const [activeIdx, setActiveIdx] = useState(0)
  const allImages: string[] = []

  // Main image
  const mainSrc = toStorageUrl(product.image)
  if (mainSrc) allImages.push(mainSrc)

  // Extra images — convert relative paths to storage URLs
  if (product.extra_images?.length) {
    for (const ei of product.extra_images) {
      const filename = ei.split('/').pop()
      if (filename) allImages.push(`${STORAGE_BASE}/${filename}`)
    }
  }

  if (allImages.length === 0) {
    return (
      <div className="p-5 border-b border-neutral-100">
        <ProductImage image={product.image} article={product.article} brand={product.brand} size="md" />
      </div>
    )
  }

  return (
    <div className="p-5 border-b border-neutral-100">
      {/* Main image */}
      <div className="w-full h-52 rounded-xl overflow-hidden bg-white flex items-center justify-center border border-neutral-100">
        <img src={allImages[activeIdx] || allImages[0]} alt={product.article}
          className="max-h-full max-w-full object-contain p-2"
          onError={e => { (e.target as HTMLImageElement).src = '' }} />
      </div>
      {/* Thumbnails */}
      {allImages.length > 1 && (
        <div className="flex gap-1.5 mt-2 overflow-x-auto">
          {allImages.map((src, i) => (
            <button key={i} onClick={() => setActiveIdx(i)}
              className={`w-12 h-12 rounded-lg overflow-hidden border-2 shrink-0 cursor-pointer transition-all ${
                i === activeIdx ? 'border-[#ED1C24]' : 'border-neutral-200 hover:border-neutral-400'
              }`}>
              <img src={src} alt="" className="w-full h-full object-contain bg-white"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Product Card (right panel) ─────────────────────────────────────────────────
function ProductCard({
  product, onClose, onNavigate, onBack, helProducts
}: {
  product: BrakelineProduct
  onClose: () => void
  onNavigate: (article: string, brand: string) => void
  onBack: (() => void) | null
  helProducts: HelMap
}) {
  const [crossOpen, setCrossOpen] = useState(false)
  const [oemAnalogs, setOemAnalogs] = useState<BrakelineProduct[] | null>(null)
  const [oemLoading, setOemLoading] = useState(false)

  const specEntries = getSpecEntries(product.specs)
  const appLines = parseApplication(product.application)
  const crossRefs = parseCrossRefs(product.cross_refs)
  const oemNums = product.original_oem?.split(',').map(s => s.trim()).filter(Boolean) || []

  const ourCrossRefs = crossRefs.filter(r => OUR_BRANDS.has(r.brand))
  const otherCrossRefs = crossRefs.filter(r => !OUR_BRANDS.has(r.brand))
  const c = BRAND_COLORS[product.brand] || { solid: '#6B7280', light: '#F9FAFB', text: 'text-neutral-700', bg: 'bg-neutral-50', border: 'border-neutral-200' }

  // For OEM-only records (no scheme, no image), search for analogs in main brands
  const isOemOnly = !OUR_BRANDS.has(product.brand)
  useEffect(() => {
    if (!isOemOnly) { setOemAnalogs(null); return }
    setOemLoading(true)
    const oem = product.article
    supabase
      .from('brakeline_products')
      .select('*')
      .in('brand', MAIN_BRANDS)
      .or(`original_oem.ilike.%${oem}%,oem.ilike.%${oem}%,cross_refs.ilike.%${oem}%`)
      .limit(40)
      .then(({ data }) => {
        setOemAnalogs((data as BrakelineProduct[]) || [])
        setOemLoading(false)
      })
  }, [product.id, isOemOnly, product.article])

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Top accent bar */}
      <div className="h-1 shrink-0" style={{ background: c.solid }} />

      {/* Card header */}
      <div className="px-6 py-4 border-b border-neutral-100 shrink-0" style={{ background: c.light }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <BrandBadge brand={product.brand} large />
              {product.status === 1 && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-green-50 text-green-700 border-green-200">ACTIVE</span>
              )}
            </div>
            <div className="font-mono font-black text-2xl text-neutral-900 leading-tight tracking-tight">
              {product.article}
            </div>
            {product.oem && product.oem !== product.article && (
              <div className="font-mono text-xs text-neutral-500 mt-1">OEM: <span className="text-neutral-700">{product.oem}</span></div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onBack || onClose}
              className="px-3 py-1.5 text-sm font-semibold rounded-lg border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 cursor-pointer transition-colors flex items-center gap-1 shadow-sm">
              <ChevronLeft size={15} /> {onBack ? 'Назад' : 'К списку'}
            </button>
            <button onClick={onClose} title="Закрыть к списку"
              className="p-1.5 hover:bg-white/80 rounded-lg text-neutral-400 hover:text-neutral-700 cursor-pointer shrink-0 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">

        {/* OEM-only banner with analog search */}
        {isOemOnly && (
          <div className="p-5 border-b border-neutral-100">
            <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 mb-4">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-9 h-9 rounded-full bg-amber-200 flex items-center justify-center">
                  <Hash size={16} className="text-amber-800" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-amber-900">Оригинальный OEM номер</div>
                  <div className="text-xs text-amber-800 mt-0.5">
                    Это заводской номер производителя <span className="font-bold">{product.brand}</span>. Схемы и характеристик нет — ищем подходящие аналоги в каталоге.
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 mb-2">
              <ArrowUpRight size={13} className="text-[#ED1C24]" />
              <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-widest">
                Аналоги в каталоге
                {oemAnalogs && !oemLoading && <span className="ml-1 text-neutral-500">· {oemAnalogs.length}</span>}
              </span>
            </div>

            {oemLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 size={18} className="animate-spin text-neutral-300" />
              </div>
            ) : oemAnalogs && oemAnalogs.length > 0 ? (
              <div className="space-y-1.5">
                {oemAnalogs.map(a => {
                  const ac = BRAND_COLORS[a.brand]
                  return (
                    <button
                      key={a.id}
                      onClick={() => onNavigate(a.article, a.brand)}
                      className="w-full flex items-center gap-3 p-2 rounded-lg border border-neutral-200 hover:border-[#ED1C24] hover:bg-red-50/40 cursor-pointer transition-all group text-left"
                    >
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${ac ? `${ac.bg} ${ac.text} ${ac.border}` : 'bg-neutral-100 text-neutral-600 border-neutral-200'}`}>
                        {a.brand}
                      </span>
                      <span className="font-mono text-sm font-bold text-neutral-900 group-hover:text-[#ED1C24]">
                        {a.article}
                      </span>
                      <ArrowUpRight size={12} className="ml-auto text-neutral-300 group-hover:text-[#ED1C24]" />
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="text-xs text-neutral-400 py-4 text-center bg-neutral-50 rounded-lg">
                Аналоги не найдены
              </div>
            )}
          </div>
        )}

        {/* HEL scheme or Photo gallery — only for our brands */}
        {!isOemOnly && (
          product.brand === 'HEL' && product.specs?.fitting1 ? (
            <HelSchemeCard specs={product.specs} pm={helProducts} />
          ) : (
            <ImageGallery product={product} />
          )
        )}

        {/* Specs grid – always visible, prominent */}
        {specEntries.length > 0 && (
          <div className="p-5 border-b border-neutral-100">
            <div className="flex items-center gap-1.5 mb-3">
              <Ruler size={13} className="text-neutral-400" />
              <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-widest">
                Характеристики · {specEntries.length}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {specEntries.map(([label, val], i) => (
                <div key={i} className="min-w-0">
                  <div className="text-[10px] font-medium text-neutral-400 uppercase tracking-wide">{label}</div>
                  <div className="font-mono text-sm font-semibold text-neutral-800 truncate mt-0.5" title={val}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Application list */}
        {appLines.length > 0 && (
          <div className="p-5 border-b border-neutral-100">
            <div className="flex items-center gap-1.5 mb-3">
              <Car size={13} className="text-neutral-400" />
              <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-widest">
                Применение · {appLines.length} авт.
              </span>
            </div>
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {appLines.map((line, i) => (
                <div key={i} className="text-sm text-neutral-700 bg-neutral-50 rounded-md px-3 py-1.5 leading-snug">
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Original OEM numbers */}
        {oemNums.length > 0 && (
          <div className="p-5 border-b border-neutral-100">
            <div className="flex items-center gap-1.5 mb-3">
              <Hash size={13} className="text-neutral-400" />
              <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-widest">
                Оригинальные номера · {oemNums.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {oemNums.map((n, i) => (
                <span key={i} className="font-mono text-xs bg-neutral-100 text-neutral-700 border border-neutral-200 px-2 py-1 rounded-md">
                  {n}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Our-brand analogs — clickable */}
        {ourCrossRefs.length > 0 && (
          <div className="p-5 border-b border-neutral-100">
            <div className="flex items-center gap-1.5 mb-3">
              <ArrowUpRight size={13} className="text-[#ED1C24]" />
              <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-widest">
                Аналоги в каталоге
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {ourCrossRefs.map((r, i) => {
                const rc = BRAND_COLORS[r.brand]
                return (
                  <button
                    key={i}
                    onClick={() => onNavigate(r.num, r.brand)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all hover:shadow-md group ${rc ? `${rc.bg} ${rc.text} ${rc.border}` : 'bg-neutral-50 text-neutral-700 border-neutral-200'}`}
                  >
                    <span className="text-[10px] font-bold opacity-60">{r.brand}</span>
                    <span className="font-mono text-xs font-bold">{r.num}</span>
                    <ArrowUpRight size={11} className="opacity-40 group-hover:opacity-100 transition-opacity" />
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Other cross-refs — collapsible */}
        {otherCrossRefs.length > 0 && (
          <div className="border-b border-neutral-100">
            <button
              onClick={() => setCrossOpen(o => !o)}
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-neutral-50 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <GitMerge size={13} className="text-neutral-400" />
                <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-widest">
                  Прочие кросс-номера
                </span>
                <span className="text-[10px] text-neutral-400 ml-1">({otherCrossRefs.length})</span>
              </div>
              {crossOpen
                ? <ChevronUp size={14} className="text-neutral-400" />
                : <ChevronDown size={14} className="text-neutral-400" />
              }
            </button>
            {crossOpen && (
              <div className="px-5 pb-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {otherCrossRefs.map((r, i) => (
                    <div key={i} className="flex items-baseline gap-2 min-w-0">
                      <span className="text-[10px] font-bold text-neutral-400 shrink-0 truncate max-w-[72px]">{r.brand}</span>
                      <span className="font-mono text-xs text-neutral-600 truncate">{r.num}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Catalog Component ─────────────────────────────────────────────────────
const CAR_MAKES = [
  'SUBARU','TOYOTA','NISSAN','HONDA','FORD','BMW','AUDI','VW','MERCEDES-BENZ','MAZDA',
  'HYUNDAI','KIA','MITSUBISHI','VOLVO','PEUGEOT','RENAULT','OPEL','FIAT','CITROEN',
  'CHEVROLET','DODGE','CHRYSLER','SUZUKI','SAAB','ALFA ROMEO','SEAT','SKODA','ISUZU',
  'LAND ROVER','JAGUAR','PORSCHE','JEEP','DAIHATSU','LANCIA','ROVER','SMART','SSANGYONG',
]

export function BrakelineCatalog() {
  const [query, setQuery]       = useState('')
  const [brand, setBrand]       = useState<string | null>(null)
  const [carMake, setCarMake]   = useState<string>('')
  const [carModel, setCarModel] = useState<string>('')
  const [carModels, setCarModels] = useState<string[]>([])
  const [products, setProducts] = useState<BrakelineProduct[]>([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(0)
  const [loading, setLoading]   = useState(false)
  const [selected, setSelected] = useState<BrakelineProduct | null>(null)
  const [navHistory, setNavHistory] = useState<BrakelineProduct[]>([])
  const [counts, setCounts]     = useState<Record<string, number>>({})
  const debounceRef             = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [helProducts, setHelProducts] = useState<HelMap>(new Map())

  // Load HEL products + brand counts in one batch
  useEffect(() => {
    supabase.from('products').select('id, sku, name, image_url, price_dealer')
      .eq('is_active', true).order('sku')
    .then((prodRes) => {
      const m = new Map<string, HelProduct>()
      for (const p of (prodRes.data || []) as HelProduct[]) m.set(p.sku, p)
      setHelProducts(m)
    })
    // Load all brand counts dynamically
    supabase.rpc('get_brand_counts').then(({ data, error }) => {
      if (!error && data) {
        setCounts(Object.fromEntries(data.map((r: { brand: string; cnt: number }) => [r.brand, r.cnt])))
      } else {
        // Fallback
        Promise.all(
          MAIN_BRANDS.map(b =>
            supabase.from('brakeline_products').select('id', { count: 'exact', head: true }).eq('brand', b)
              .then(({ count }) => [b, count ?? 0] as [string, number])
          )
        ).then(r => setCounts(Object.fromEntries(r)))
      }
    })
  }, [])

  // Load car models when make changes
  useEffect(() => {
    if (!carMake) { setCarModels([]); setCarModel(''); return }
    supabase.from('brakeline_products')
      .select('application')
      .ilike('application', `%${carMake}%`)
      .limit(200)
      .then(({ data }) => {
        const models = new Set<string>()
        for (const r of (data || [])) {
          const lines = (r.application || '').split('\n')
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.toUpperCase().startsWith(carMake)) continue
            const afterMake = trimmed.slice(carMake.length).trim()
            const cleaned = afterMake
              .replace(/\s*(front|rear|left|right|middle)[;,\s].*/i, '')
              .replace(/\s*\d{4}.*$/, '')
              .replace(/\s*\(.*$/, '')
              .trim()
            if (cleaned && cleaned.length > 1 && !/[;,]/.test(cleaned)) models.add(cleaned.toUpperCase())
          }
        }
        setCarModels(Array.from(models).sort())
      })
  }, [carMake])

  const doFetch = useCallback(async (q: string, b: string | null, p: number, car: string = '', model: string = '') => {
    setLoading(true)
    try {
      let qb = supabase
        .from('brakeline_products')
        .select('*', { count: 'exact' })
        .range(p * PAGE_SIZE, (p + 1) * PAGE_SIZE - 1)
        .order('brand')
        .order('article')

      if (b) qb = qb.eq('brand', b)

      // Car make + model filter
      if (car && model) {
        qb = qb.ilike('application', `%${car} ${model}%`)
      } else if (car) {
        qb = qb.ilike('application', `%${car}%`)
      }

      const sq = q.trim()
      if (sq) {
        const up = sq.toUpperCase()
        qb = qb.or(
          `article.ilike.%${up}%,oem.ilike.%${up}%,original_oem.ilike.%${up}%,application.ilike.%${sq}%`
        )
      }

      const { data, count, error } = await qb
      if (error) throw error
      setProducts((data as BrakelineProduct[]) || [])
      setTotal(count || 0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPage(0)
      doFetch(query, brand, 0, carMake, carModel)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, brand, carMake, carModel, doFetch])

  const changePage = (p: number) => { setPage(p); doFetch(query, brand, p, carMake, carModel) }
  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Navigate to cross-ref product (push current to history, don't change search)
  const navigateTo = useCallback(async (article: string, brandName: string) => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('brakeline_products')
        .select('*')
        .eq('article', article)
        .eq('brand', brandName)
        .limit(1)
        .single()
      if (data) {
        setSelected(prev => {
          if (prev) setNavHistory(h => [...h, prev])
          return data as BrakelineProduct
        })
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const hasSelected = selected !== null
  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <div className="flex-1 flex flex-row min-h-0 overflow-hidden">

      {/* ── LEFT: List panel (scrollable) ────────────────────────────────── */}
      <div className={`flex flex-col bg-white min-h-0 overflow-hidden transition-all duration-300 ease-in-out ${selected ? 'hidden' : 'flex-1'}`}>
        <div
          className="flex flex-col bg-white h-full"
        >
        {/* Search toolbar */}
        <div className="px-4 py-3 border-b border-neutral-200 shrink-0 space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={hasSelected ? 'Поиск...' : 'Артикул, OEM, марка или модель авто...'}
              className="w-full pl-11 pr-8 py-2 text-sm border border-neutral-200 rounded-lg bg-neutral-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#ED1C24] focus:border-[#ED1C24] font-mono"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 cursor-pointer"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Brand filters — main + OEM dropdown */}
          <div className="flex items-center gap-1 flex-wrap">
            <button onClick={() => setBrand(null)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer transition-all ${!brand ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400'}`}>
              Все{!hasSelected && <span className="opacity-50 ml-1">{totalCount.toLocaleString()}</span>}
            </button>
            {MAIN_BRANDS.map(b => {
              const bc = BRAND_COLORS[b]
              if (!bc) return null
              return (
                <button key={b} onClick={() => setBrand(brand === b ? null : b)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer transition-all ${brand === b ? `${bc.bg} ${bc.text} ${bc.border}` : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400'}`}>
                  {b}{!hasSelected && counts[b] ? <span className="opacity-50 ml-1">{counts[b].toLocaleString()}</span> : null}
                </button>
              )
            })}
            {/* OEM brands dropdown */}
            {(() => {
              const oemBrands = Object.keys(counts).filter(b => !new Set([...MAIN_BRANDS]).has(b)).sort()
              if (!oemBrands.length) return null
              return (
                <select value={brand && !new Set([...MAIN_BRANDS]).has(brand) ? brand : ''}
                  onChange={e => setBrand(e.target.value || null)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer transition-all ${brand && !new Set([...MAIN_BRANDS]).has(brand) ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-white text-neutral-400 border-neutral-200'}`}>
                  <option value="">OEM марки</option>
                  {oemBrands.map(b => <option key={b} value={b}>{b} ({counts[b]})</option>)}
                </select>
              )
            })()}
          </div>

          {/* Car make + model filter */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Car size={13} className="text-neutral-400 shrink-0" />
            <select value={carMake} onChange={e => { setCarMake(e.target.value); setCarModel('') }}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer transition-all ${carMake ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-white text-neutral-400 border-neutral-200'}`}>
              <option value="">Марка авто</option>
              {CAR_MAKES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {carMake && carModels.length > 0 && (
              <select value={carModel} onChange={e => setCarModel(e.target.value)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer transition-all ${carModel ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-white text-neutral-400 border-neutral-200'}`}>
                <option value="">Модель</option>
                {carModels.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
            {(carMake || carModel) && (
              <button onClick={() => { setCarMake(''); setCarModel('') }} className="p-1 text-amber-500 hover:text-amber-700 cursor-pointer"><X size={12} /></button>
            )}
          </div>
        </div>

        {/* Status + pagination */}
        <div className="px-4 py-1.5 flex items-center justify-between border-b border-neutral-100 shrink-0 bg-neutral-50/50">
          <span className="text-[11px] text-neutral-400">
            {loading
              ? 'Поиск...'
              : total > 0
                ? `${total.toLocaleString()} · стр. ${page + 1}/${totalPages}`
                : query ? 'Не найдено' : ''}
          </span>
          {!loading && total > 0 && (
            <div className="flex items-center gap-0.5">
              <button onClick={() => changePage(page - 1)} disabled={page === 0}
                className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30 cursor-pointer text-neutral-500">
                <ChevronLeft size={13} />
              </button>
              <button onClick={() => changePage(page + 1)} disabled={page >= totalPages - 1}
                className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30 cursor-pointer text-neutral-500">
                <ChevronRight size={13} />
              </button>
            </div>
          )}
        </div>

        {/* Product list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center items-center py-16">
              <Loader2 size={22} className="animate-spin text-neutral-300" />
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
              <Tag size={36} strokeWidth={1} className="mb-3 opacity-30" />
              <span className="text-sm">{query ? 'Ничего не найдено' : 'Нет данных'}</span>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-neutral-50 border-b border-neutral-200 z-10">
                <tr>
                  <th className="w-12 px-2 py-2.5"></th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Бренд</th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Артикул</th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest hidden md:table-cell">OEM</th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest hidden lg:table-cell">Применение</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {products.map(p => {
                  const bc = BRAND_COLORS[p.brand]
                  const imgSrc = toStorageUrl(p.image)
                  return (
                    <tr
                      key={p.id}
                      onClick={() => { setNavHistory([]); setSelected(prev => prev?.id === p.id ? null : p) }}
                      className={`cursor-pointer transition-colors group ${selected?.id === p.id ? 'bg-red-50 border-l-2 border-l-[#ED1C24]' : 'hover:bg-red-50/40 border-l-2 border-l-transparent'}`}
                    >
                      <td className="px-2 py-1">
                        {p.brand === 'HEL' && p.specs?.fitting1 ? (
                          <MiniScheme specs={p.specs} pm={helProducts} />
                        ) : imgSrc ? (
                          <div className="w-9 h-9 rounded overflow-hidden bg-white border border-neutral-100 flex items-center justify-center">
                            <img src={imgSrc} alt="" loading="lazy" className="max-h-full max-w-full object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          </div>
                        ) : (
                          <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: bc?.light || '#f9fafb' }}>
                            <Tag size={12} style={{ color: bc?.solid || '#999', opacity: 0.3 }} />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${bc ? `${bc.bg} ${bc.text} ${bc.border}` : 'bg-neutral-100 text-neutral-500 border-neutral-200'}`}>
                          {p.brand}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono font-semibold text-neutral-900 group-hover:text-[#ED1C24] transition-colors">
                        {p.article}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-neutral-400 hidden md:table-cell max-w-[160px] truncate">{p.oem}</td>
                      <td className="px-3 py-2.5 text-neutral-400 hidden lg:table-cell max-w-xs truncate">
                        {parseApplication(p.application)[0] || <span className="text-neutral-200">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        </div>
      </div>

      {/* ── Product card — на всю рабочую область ───────────────────── */}
      {selected && (
        <div className="flex-1 min-w-0 overflow-hidden">
          <ProductCard
            product={selected}
            onClose={() => { setSelected(null); setNavHistory([]) }}
            onNavigate={navigateTo}
            onBack={navHistory.length > 0 ? () => {
              const prev = navHistory[navHistory.length - 1]
              setNavHistory(h => h.slice(0, -1))
              setSelected(prev)
            } : null}
            helProducts={helProducts}
          />
        </div>
      )}
    </div>
  )
}
